/* ============================================================
   shellApp.ts — 빌드된 Tauri exe 를 띄우고 그 안의 WebView2 에 붙는 하네스(트랙 B).

   핵심 두 가지:
   ① `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 로 CDP 포트를 여는 건 **이 하네스뿐**이다 —
      배포본은 이 환경변수 없이 실행되므로 디버그 포트가 열리지 않는다.
   ② 창을 닫을 땐 반드시 **WM_CLOSE(정상 종료)** 로 닫는다. `taskkill` 같은 강제 종료는
      `CloseRequested` 를 건너뛰어 **검사 대상인 flush 경로 자체를 우회**해 버린다.
============================================================ */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

// ESM 스코프라 __dirname 이 없다 — 설정(testDir)이 web/ 기준으로 도므로 cwd 에서 잡는다.
const EXE = path.resolve(process.cwd(), '../src-tauri/target/release/learning-hub.exe');
const CDP_PORT = 9222;

/* ── 데이터 폴더 격리(SD-6) ─────────────────────────────────────────────────
   트랙 B 는 **사용자의 실제 DB 를 상대**하고 있었다. 이미 실사고를 냈다 — 옛 케이스가 `docs` 에
   2열 INSERT 를 해서 실제 독후감의 `updated_at` 을 0 으로 깎았고, 그 행은 클라우드 동기화에서
   영원히 빠졌다(앱은 "최신"이라고 말한다). 그 뒤로는 **"하네스는 실 DB 에 쓰지 않는다"는 규약**
   으로 막고 있었는데, 규약은 흘러내린다. 이제 구조로 막는다.

   ⚠ `APPDATA` 를 갈아끼우는 방식은 **안 통한다(실측)** — `dirs` 크레이트가 Win32
   `SHGetKnownFolderPath` 를 부르므로 환경변수를 무시한다. 그래서 **앱이 스스로 읽는**
   override 를 쓴다(`src-tauri/src/paths.rs`). DB·`workspace.json`·`research-jobs.json` 이
   함께 옮겨간다 — 원래 한 폴더에 있는 삼형제다.

   ⚠ 폴더는 **실행마다 새로** 만든다. 재사용하면 앞선 실행의 상태가 다음 실행의 전제가 되어,
   "혼자 돌리면 통과하는데 전체로 돌리면 실패"가 생긴다(그리고 그 반대도). 임시 폴더라
   OS 가 알아서 치우므로 정리 코드도 필요 없다. */
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lh-e2e-'));

export interface Shell {
  page: Page;
  browser: Browser;
  proc: ChildProcess;
  pid: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── 공유 셸 ────────────────────────────────────────────────────────────────
   2026-07-20 층 재배치 전까지 트랙 B 는 케이스마다 exe 를 띄웠다 내렸다 해서 회당 기동이
   19번이었다. 그중 대부분은 **읽기 전용 IPC 프로브**라 같은 창에서 다 돌 수 있었다
   (실물을 상대해야 하던 케이스들은 아예 `cargo test` 로 내려갔다 — `src-tauri/src/testkit.rs`).

   ⚠ 공유 셸과 전용 셸을 **섞으면 서로를 죽인다**: `launchShell()` 은 `ensureNoStrayShell()` 로
   learning-hub 프로세스를 전부 정리하고 시작한다(single-instance 때문에 필요하다). 그래서
   자기 셸을 따로 쓰는 케이스는 **반드시 `closeSharedShell()` 을 먼저** 불러야 한다. */
let shared: Shell | null = null;

/** 읽기 전용 케이스들이 함께 쓰는 셸. 처음 부를 때만 실제로 띄운다. */
export async function sharedShell(): Promise<Shell> {
  shared ??= await launchShell();
  return shared;
}

/** 공유 셸을 내린다. 재시작 계약을 검사하는 케이스가 **자기 셸을 띄우기 전에** 부른다. */
export async function closeSharedShell(): Promise<void> {
  if (!shared) return;
  const s = shared;
  shared = null; // 먼저 비운다 — 닫기가 실패해도 다음 호출이 죽은 핸들을 재사용하지 않게.
  await closeShell(s).catch(() => {});
}

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
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
      LEARNING_HUB_E2E_DATA_DIR: dataDir,
    },
    detached: false,
    stdio: 'ignore',
  });

  // WebView2 가 CDP 를 열 때까지 대기(부팅이 앞에 있어 몇 초 걸린다).
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

/** 이번 실행의 격리 데이터 폴더 — 케이스가 "실 DB 를 안 건드렸다"를 단언할 때 쓴다. */
export function e2eDataDir(): string {
  return dataDir;
}

export function isAlive(pid: number): boolean {
  return ps(`[bool](Get-Process -Id ${pid} -ErrorAction SilentlyContinue)`) === 'True';
}

/** 이전 테스트의 잔존물 정리 — 남아 있으면 single-instance 가 새 창을 안 띄워 테스트가 헛돈다. */
export async function ensureNoStrayShell(): Promise<void> {
  ps(`Get-Process learning-hub -ErrorAction SilentlyContinue | Stop-Process -Force`);
  ps(`Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*node.exe' } | Out-Null`);
  await sleep(800);
}
