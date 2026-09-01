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
     ③ **이 실행보다 먼저 생긴 것**이며
     ④ **우리가 바인딩할 그 포트를 실제로 쥐고 있다**(P047 · 아래 문단).
   ⚠⚠ ③을 «이 모듈이 `webServer` 앞에 돈다»로 가정했다가 **자기 서버를 죽였다**(2026-08-23
   실측 — 첫 판이 그랬다: `[e2e] … PID 14516 정리` 뒤 4케이스가 통째로 실패했다).
   Playwright 는 `globalSetup` 보다 `webServer` 를 **먼저** 띄운다. 가정하지 말고 **재라** —
   프로세스 생성 시각이 이 실행의 시작보다 앞선 것만 죽인다.
   ⚠ 하나라도 못 맞추면 **아무것도 안 죽인다** — 못 죽이는 것보다 남의 것을 죽이는 쪽이 나쁘다.

   ## ⚠⚠ ④가 나중에 붙었다 — 셋만으로는 **작동 중인 남의 서버**를 죽였다(P047 · 2026-08-28)

   ①②③ 은 «이 저장소의 오래된 preview» 를 뜻하지 **«우리를 막고 있는 preview»** 를 뜻하지
   않는다. 그래서 사람이 재측정용으로 띄워 둔 preview 가 **다른 포트에 있어도** 죽었다 —
   2026-08-27 성능 회차에서 `:4173`·`:4174` 가 각각 한 번씩 끊겼고, 재현(2026-08-28)에서도
   `:4176` 이 죽었다(`after=000`). e2e 는 그 포트를 쓰지도 않는다.

   ⭐ 판정의 축이 틀렸던 것이다: O035 가 산 것은 «`npm ci` 가 안 죽는다» 인데, 그건 **다음번**
   문제이고 지금 실행을 막지 않는다. 지금 실행을 막는 것은 **포트 하나**뿐이다(O038). 그래서
   포트를 쥔 것만 죽이고, 그 밖의 우리 것은 **죽이는 대신 알린다** — O035 가 막으려던 것이
   «아무도 안 치운다»가 아니라 **«아무도 모른다»** 였다는 그 진단 그대로다.
   ⚠ 포트는 **인자로 받는다.** 여기서 4173 을 다시 적으면 `playwright.config.ts` 의
   `webServer.command` 와 두 벌이 되고, 그 두 벌이 갈리면 이 가드는 조용히 아무것도 안 죽인다.

   ## ⚠⚠ 호출 자리가 바뀌었다 — `globalSetup` 이 아니다(O038 · 2026-08-27)

   바로 위 문단의 그 순서(`webServer` 가 먼저)가 **이 파일을 `globalSetup` 에 두면 안 되는
   이유**이기도 하다는 것이 뒤늦게 드러났다: 떠도는 preview 가 포트를 쥐고 있으면 `webServer`
   가 먼저 바인딩에 실패해 런이 죽고, **이 함수는 한 줄도 안 돈다.** O035 는 그래서 «다음
   `npm ci` 가 안 죽는다»만 샀고 **포트 충돌은 그대로 남아 있었다**(2026-08-27 게이트가 물렸다 ·
   재현하면 아래 메시지가 0줄이다 — 안 걸린 게 아니라 안 돌았다).

   → 지금은 **`playwright.config.ts` 최상단**(모듈 평가 시점)에서 부른다. 설정은 `webServer`
   기동보다 먼저 평가되므로 그 자리가 유일하게 이르다. ⭐ 그 시점엔 우리 서버가 **아직 없어서**
   위 사고가 원리적으로 불가능하지만, ③ 가드는 **그대로 둔다** — 사람이 옆 터미널에 띄워 둔
   것까지 보게 되므로 가드를 걷으면 그때 죽는 것은 남의 것이다.

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

/* ⚠⚠ **한 번만 돈다 — 재평가가 ③을 뒤집는다**(O038 실행 중 실측 · 2026-08-27).

   설정 모듈은 메인 프로세스에서 한 번만 평가되지 않는다(워커·리포터가 다시 import 한다).
   그런데 `RUN_STARTED` 는 **그 프로세스의** 시작 시각이라, 워커에서 다시 평가되면 기준선이
   **우리 `webServer` 보다 나중**이 된다 → 우리 서버가 «이 실행보다 먼저 생긴 것»으로 보여
   **자기 서버를 죽인다.** 2026-08-23 의 그 사고가 형태만 바꿔 되살아난 것이고, 실측이 정확히
   그랬다: 정리 메시지가 **두 줄** 찍히고 테스트가 `ERR_CONNECTION_REFUSED` 로 죽었다.

   → 첫 평가(= `webServer` 기동 전의 메인)에서만 돈다. 센티널을 **환경변수**에 둔다: 워커는
   메인이 심은 env 를 상속하므로 자동으로 건너뛴다. ⚠ 모듈 스코프 변수로는 안 된다 —
   프로세스가 다르면 그 변수도 새로 난다(그게 이 버그의 원인 그 자체다). */
const 센티널 = '__HUB_STRAY_REAPED';

/** 그 포트를 **듣고 있는** PID 들. 못 알아내면 빈 집합 = 아무것도 안 죽인다(④가 거짓이 된다). */
function 포트를쥔PID(port: number): Set<number> {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 },
    );
    return new Set(
      out
        .split(/\r?\n/)
        .map((l) => Number(l.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    );
  } catch {
    return new Set();
  }
}

/**
 * 떠도는 preview 를 거둔다. 실패는 삼킨다 — 정리가 검사를 막으면 처방이 병보다 나쁘다.
 *
 * @param port 이 실행이 바인딩할 포트. **이걸 쥔 것만 죽인다**(④ · 위 머리주석).
 */
export default function killStrayPreview(port: number): void {
  if (process.platform !== 'win32') return;
  if (process.env[센티널]) return;
  process.env[센티널] = '1';
  const 막는중 = 포트를쥔PID(port);
  let list: Proc[] = [];
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId,CommandLine,@{n='Born';e={[System.DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}} | ConvertTo-Json -Compress`,
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

    /* ④ — **우리를 막고 있는가.** 아니면 죽이지 않는다(P047): 다른 포트의 preview 는 사람이
       일부러 띄워 둔 것일 수 있고, 그걸 끊는 대가가 이 청소가 사는 값보다 크다. */
    if (!막는중.has(p.ProcessId)) {
      console.warn(
        `[e2e] ⚠ 떠도는 vite preview(PID ${p.ProcessId}) — :${port} 를 쥐고 있지 않아 **두었다**. ` +
          `이 저장소의 node_modules 를 쥐고 있으면 다음 \`npm ci\` 가 EPERM 으로 죽는다(O035) — ` +
          `필요하면 \`taskkill /PID ${p.ProcessId} /F\`.`,
      );
      continue;
    }

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
