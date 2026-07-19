/* ============================================================
   shellApp.ts — 빌드된 Tauri exe 를 띄우고 그 안의 WebView2 에 붙는 하네스(트랙 B).

   핵심 두 가지:
   ① `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 로 CDP 포트를 여는 건 **이 하네스뿐**이다 —
      배포본은 이 환경변수 없이 실행되므로 디버그 포트가 열리지 않는다.
   ② 창을 닫을 땐 반드시 **WM_CLOSE(정상 종료)** 로 닫는다. `taskkill` 같은 강제 종료는
      `CloseRequested` 를 건너뛰어 **검사 대상인 flush 경로 자체를 우회**해 버린다.
============================================================ */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

// ESM 스코프라 __dirname 이 없다 — 설정(testDir)이 web/ 기준으로 도므로 cwd 에서 잡는다.
const EXE = path.resolve(process.cwd(), '../src-tauri/target/release/learning-hub.exe');
const CDP_PORT = 9222;
const SIDECAR_PORT = 8000;

export interface Shell {
  page: Page;
  browser: Browser;
  proc: ChildProcess;
  pid: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PowerShell 한 줄 실행 — 창 핸들 조작·프로세스 조회는 node 표준 라이브러리로 안 된다. */
function ps(script: string): string {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  return (r.stdout || '').trim();
}

/** 앱을 띄우고 WebView2 에 CDP 로 붙는다. */
export async function launchShell(): Promise<Shell> {
  if (!existsSync(EXE)) {
    throw new Error(`빌드된 exe 가 없습니다: ${EXE}\n먼저 \`npm run tauri:build\` 를 돌리세요.`);
  }
  await ensureNoStrayShell();

  const proc = spawn(EXE, {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` },
    detached: false,
    stdio: 'ignore',
  });

  // WebView2 가 CDP 를 열 때까지 대기(부팅 + sidecar 헬스체크가 앞에 있어 몇 초 걸린다).
  const browser = await connectWithRetry(30_000);
  const page = await resolveAppPage(browser, 30_000);

  return { page, browser, proc, pid: proc.pid! };
}

/**
 * 앱 문서가 **실제로 올라온** 페이지를 고른다.
 *
 * ⚠ CDP 로 붙으면 Playwright 가 아직 `about:blank` 인 타깃을 먼저 넘겨준다(원본 타깃 URL 은 이미
 * `http://tauri.localhost/` 인데도). 그 상태로 진행하면 **불투명 오리진이라 localStorage 접근이
 * `SecurityError` 로 거부**되고, 라우팅 셀렉터는 영원히 안 잡힌다(실측 — 이 함수가 없을 때 3건 실패).
 * 그래서 URL 문자열이 아니라 **문서 안에서 직접** 오리진과 앱 루트를 확인할 때까지 기다린다.
 */
async function resolveAppPage(browser: Browser, timeoutMs: number): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) {
        const ok = await p
          .evaluate(() => location.origin.includes('tauri.localhost') && !!document.querySelector('#root, main, nav'))
          .catch(() => false);
        if (ok) return p;
      }
    }
    await sleep(300);
  }
  throw new Error('앱 문서(tauri.localhost)를 가진 페이지를 찾지 못했습니다 — 셸이 백지로 떴을 수 있습니다.');
}

async function connectWithRetry(timeoutMs: number): Promise<Browser> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    } catch (e) {
      last = e;
      await sleep(400);
    }
  }
  throw new Error(`CDP(${CDP_PORT}) 연결 실패: ${String(last)}`);
}

/**
 * 창을 **정상 경로로** 닫는다(WM_CLOSE) — `CloseRequested` → 프런트 flush → `destroy()`.
 * 강제 종료로 바꾸면 이 하네스가 검사하려는 경로를 그대로 건너뛴다.
 */
export async function closeShell(shell: Shell): Promise<void> {
  // CDP 연결을 먼저 끊는다 — 붙어 있으면 WebView2 종료가 지연될 수 있다.
  await shell.browser.close().catch(() => {});
  ps(`$p = Get-Process -Id ${shell.pid} -ErrorAction SilentlyContinue; if ($p) { $p.CloseMainWindow() | Out-Null }`);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && isAlive(shell.pid)) await sleep(300);
  if (isAlive(shell.pid)) {
    ps(`Stop-Process -Id ${shell.pid} -Force -ErrorAction SilentlyContinue`);
    throw new Error('창이 정상 종료로 닫히지 않았습니다(강제 종료함) — allow-destroy 권한을 확인하세요.');
  }
}

export function isAlive(pid: number): boolean {
  return ps(`[bool](Get-Process -Id ${pid} -ErrorAction SilentlyContinue)`) === 'True';
}

/** 포트 8000 을 물고 있는 node 가 남았는가(고아 sidecar 검사). */
export function sidecarAlive(): boolean {
  const out = ps(`[bool](Get-NetTCPConnection -LocalPort ${SIDECAR_PORT} -State Listen -ErrorAction SilentlyContinue)`);
  return out === 'True';
}

/** 이전 테스트의 잔존물 정리 — 남아 있으면 single-instance 가 새 창을 안 띄워 테스트가 헛돈다. */
export async function ensureNoStrayShell(): Promise<void> {
  ps(`Get-Process learning-hub -ErrorAction SilentlyContinue | Stop-Process -Force`);
  ps(`Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*node.exe' } | Out-Null`);
  await sleep(800);
}
