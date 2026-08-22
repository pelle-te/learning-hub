/* ============================================================
   _strayPreview.ts — **떠도는 `vite preview` 를 거둔다**(O035 · 2026-08-23 운영 축).

   ## 왜 생겼나 — 남은 서버가 `npm ci` 를 죽인다

   실측(2026-08-23): **2026-08-21 15:03 부터** 떠 있던 `vite preview --port 4199` 가
   `node_modules/lightningcss-win32-x64-msvc/*.node` 를 쥐고 있어서 `npm ci` 가
   `EPERM: unlink` 로 죽었다 — 그것도 **node_modules 를 반쯤 지운 뒤에**(`.bin` 0개 ·
   패키지 76개만 남음). 복구는 `npm install`(지우지 않고 채운다).

   ⚠ 증상이 `EPERM` 이라 「권한 문제」로 읽히고, 그러면 원인에서 멀어진다. Windows 에서 이
   오류는 대개 **파일을 쥔 프로세스**다.

   ## ⭐ 짝이 이미 있었다 (R3)

   트랙 B 는 `ensureNoStrayShell()` 로 떠도는 `learning-hub.exe` 를 **매번** 정리한다
   (single-instance 때문에 필요하다). 트랙 A 의 preview 서버엔 그 짝이 없었다 —
   같은 관용구가 한쪽에만 적용된, 이 저장소가 반복해 만나는 형태다.

   ## ⚠⚠ 범위를 좁히는 것이 이 파일의 전부다

   node 프로세스를 이름으로 죽이면 **사용자의 다른 작업**(에디터 LSP · MCP 서버 · 다른
   저장소의 dev 서버)을 함께 죽인다. 실제로 이 머신에는 그런 프로세스가 여럿 떠 있었다.
   그래서 셋을 **모두** 만족할 때만 죽인다:
     ① `vite` 와 `preview` 를 함께 든 명령줄이고
     ② 그 경로가 **이 저장소의 `node_modules`** 안이며 — ⚠ 명령줄이 **상대경로**일 수 있다
        (`node_modules\.bin/../vite/bin/vite.js` · 실측). 그때는 소유를 **증명할 수 없다**
     ③ **이 실행보다 먼저 생긴 것**이다.
   ⚠⚠ ③을 «이 모듈이 `webServer` 앞에 돈다»로 가정했다가 **자기 서버를 죽였다**(2026-08-23
   실측 — 첫 판이 그랬다: `[e2e] … PID 14516 정리` 뒤 4케이스가 통째로 실패했다).
   Playwright 는 `globalSetup` 보다 `webServer` 를 **먼저** 띄운다. 가정하지 말고 **재라** —
   프로세스 생성 시각이 이 실행의 시작보다 앞선 것만 죽인다.
   ⚠ 하나라도 못 맞추면 **아무것도 안 죽인다** — 못 죽이는 것보다 남의 것을 죽이는 쪽이 나쁘다.

   ## ⚠⚠ 증명 못 하면 **죽이는 대신 시끄럽게 말한다**

   상대경로로 뜬 preview 는 ②를 만족시킬 방법이 없다(Win32_Process 는 cwd 를 안 준다).
   그렇다고 «vite preview 면 다 죽인다»로 넓히면 **다른 저장소의 dev 서버**를 죽인다 —
   이 머신에는 실제로 그런 프로세스가 여럿 떠 있었다.
   그래서 그 부류는 **PID 를 찍어 경고**한다. 이 항목이 막으려는 것은 «아무도 안 치운다»가
   아니라 **«아무도 모른다»** 이고(그 대가가 `npm ci` 파괴였다), 경고는 그걸 끝낸다.

   ⚠ Windows 전용 경로다(`Win32_Process`). 다른 OS 에서는 조용히 아무것도 안 한다 —
   이 저장소는 Windows 단일 타깃이고(설계 §6), 없는 OS 를 위해 못 검증할 코드를 두지 않는다.
============================================================ */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** 이 저장소의 `node_modules` 절대경로 — ②의 판정 기준. */
/* ⚠ **구분자를 정규화한다.** `path.resolve` 는 Windows 에서 백슬래시를 주는데 명령줄은
   슬래시로 올 수 있다(`node D:/…/vite.js` · 실측) — 안 맞추면 ②가 조용히 늘 거짓이다. */
const norm = (v: string): string => v.toLowerCase().split('\\').join('/');
const OURS = norm(path.resolve(import.meta.dirname, '..', 'node_modules'));

interface Proc {
  ProcessId: number;
  CommandLine: string | null;
  /**
   * 생성 시각(epoch ms) — ③의 판정 기준.
   *
   * ⚠⚠ **`CreationDate` 를 그대로 받지 않는다.** `ConvertTo-Json` 은 그것을 **`/Date(…)/`**
   * (Microsoft 전용 형식)로 내고 `Date.parse` 는 그걸 **`NaN`** 으로 준다 — 첫 판이 그래서
   * 「시각을 못 읽으면 안 죽인다」 가드에 **전부 걸려 아무것도 안 했다**(안전한 방향으로
   * 실패했지만, 재는 것이 0이면 검사가 아니다). PowerShell 쪽에서 **숫자로** 만들어 넘긴다.
   *
   * ⚠⚠ 그리고 그 변환도 한 번 틀렸다: `(Get-Date '1970-01-01Z')` 는 **로컬로 파싱**돼
   * 기준선이 시간대만큼 밀리고(KST 라 **9시간**), 그러면 모든 프로세스가 «이 실행보다 나중»
   * 으로 보여 ③이 또 전부 거른다. `[System.DateTimeOffset]::new(...)` 가 Kind 를 존중한다.
   */
  Born: number | null;
}

/** 이 프로세스가 시작된 시각(epoch ms). 이보다 **나중에** 생긴 것은 우리 것이다. */
const RUN_STARTED = Date.now() - process.uptime() * 1000;

/** 떠도는 preview 를 거둔다. 실패는 삼킨다 — 정리가 검사를 막으면 처방이 병보다 나쁘다. */
export default function killStrayPreview(): void {
  if (process.platform !== 'win32') return;
  let list: Proc[] = [];
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine,@{n='Born';e={[System.DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}} | ConvertTo-Json -Compress`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 },
    ).trim();
    if (!out) return;
    const parsed: unknown = JSON.parse(out);
    list = Array.isArray(parsed) ? (parsed as Proc[]) : [parsed as Proc];
  } catch {
    return; // 목록을 못 얻으면 아무것도 안 한다(②를 확인할 수 없으므로)
  }

  for (const p of list) {
    const cmd = norm(p.CommandLine ?? '');
    if (!cmd.includes('vite') || !cmd.includes('preview')) continue; // ①
    /* ③ — 이 실행보다 **먼저** 생긴 것만. 우리 `webServer` 는 항상 나중에 생기므로 안 걸린다.
       ⚠ 시각을 못 읽으면 **안 죽인다**: 모르는 채 죽이는 것이 이 파일의 가장 나쁜 실패다. */
    const born = typeof p.Born === 'number' ? p.Born : NaN;
    if (!Number.isFinite(born) || born >= RUN_STARTED) continue;

    /* ② — 절대경로면 **우리 것임이 증명된다**. 상대경로면 증명 불가 → 죽이지 않고 알린다. */
    if (!cmd.includes(OURS)) {
      console.warn(
        `[e2e] ⚠ 떠도는 vite preview(PID ${p.ProcessId} · ${new Date(born).toISOString().slice(0, 16).replace('T', ' ')}) — ` +
          `명령줄이 상대경로라 **이 저장소 것인지 증명할 수 없어 두었다**. ` +
          `이 저장소 것이면 이 저장소의 node_modules 를 쥐고 있어 \`npm ci\` 가 EPERM 으로 죽는다(O035). ` +
          `확인 후 \`taskkill /PID ${p.ProcessId} /F\`.`,
      );
      continue;
    }
    try {
      execFileSync('taskkill', ['/PID', String(p.ProcessId), '/F', '/T'], { stdio: 'ignore', timeout: 10_000 });
      console.log(`[e2e] 떠도는 vite preview 정리 — PID ${p.ProcessId} (O035)`);
    } catch {
      /* 이미 죽었거나 권한이 없다 — 다음 단계가 포트 충돌로 시끄럽게 실패한다 */
    }
  }
}
