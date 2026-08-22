/* ============================================================
   tauri.ts — Tauri 셸 경계(플랫폼 개편 1단계).

   **불변식 I2**: Tauri `invoke` 호출은 `lib/` 가 소유한다(React 무관 IO 의 정의).
   `features/` 에 `invoke` 가 직접 박히는 것이 1·3·4단계의 가장 흔한 위반 경로라, 이 파일이
   유일한 통로가 된다. 새 커맨드가 생기면 여기에 얇은 함수를 하나 더 두고, 나머지 층은
   그 함수만 본다(Rust 시그니처 변경의 파급을 한 파일로 가둔다).

   ⚠ 함수들이 여전히 "Tauri 아님"을 1급 상태로 다룬다(감지 실패는 예외가 아니라 `null`/기본값).
   4단계에서 serve.js 가 사라져 **브라우저엔 백엔드가 없지만**, `npm run dev` 와 트랙 A 는 여전히
   Chromium 이라 이 분기가 없으면 UI 개발과 시각 검증망이 함께 죽는다(2·3단계와 같은 판단).

   ## ⚠ 이름 규약 — `shell` 접두는 **이름 충돌이 있을 때만** 붙인다(2026-08-20 리뷰 n-6)

   상위 래퍼(`lib/api.ts`·`lib/anki.ts`)에 같은 개념의 함수가 이미 있으면 여기 것은 `shell` 을
   앞에 단다(`runTool` ↔ `shellRunTool` · `ankiConnect` ↔ `shellAnkiConnect`). 겹치지 않으면
   커맨드 이름을 그대로 쓴다(`vaultScan`·`workspaceStatus`·`dbUrl`·`checkUpdate`).

   ⚠ **예외 하나**: `artifactRead` 는 상위에 `getArtifact` 가 있는데도 접두가 없다. 이름이
   *다르므로* 충돌이 없어서인데, 규칙을 "겹칠 때만"으로 읽으면 일관되고 "래퍼가 있으면"으로
   읽으면 예외다. 지금 바꾸지 않는 이유는 소비처 경로를 깨뜨릴 값이 없어서이고, 규칙 자체는
   **겹칠 때만**이 정본이다 — 종전엔 이 문장이 아예 없어서 새 커맨드마다 매번 다시 정했다.
============================================================ */

/* ⚠ `isTauri` 는 **`lib/isTauri.ts` 로 떨어져 나갔다**(H7) — 부팅 경로 모듈이 판정 2줄 때문에
   이 파일 503줄을 통째로 끌던 것을 끊기 위해서다(폰 초기 로드의 30.3%). 여기서 다시 export 해
   기존 호출부는 그대로 둔다 — 그 모듈들은 어차피 무거운 커맨드를 쓰므로 얻을 게 없다.
   ⚠ **부팅 경로에서는 `@/lib/isTauri` 에서 직접 가져올 것**(`db/*`·`cloud/client`·`telemetry`). */
export { isTauri } from './isTauri';
import { isTauri } from './isTauri';

/* ── 경계 파싱(C-2) ──────────────────────────────────────────────
   `invoke<T>` 의 `<T>` 는 **주장일 뿐 검증이 아니다.** Rust 쪽 시그니처가 바뀌면 TS 는 아무것도
   모르고, 잘못된 모양이 앱 안쪽으로 그대로 흘러 한참 뒤 엉뚱한 곳에서 터진다. 5-C 가 이미 같은
   형태(행 모양 이중 정의)에 물렸다.

   ## ⚠ 여기는 **비차단**이다 — `cloud/schema.ts` 와 정책이 정반대인 이유

   이 경계 반대편은 **우리가 배포한 Rust 바이너리**다. 신뢰할 수 없는 입력이 아니라 *같은
   릴리스의 다른 절반*이다. 그래서 목적이 방어가 아니라 **드리프트 탐지**이고, 어긋났다고
   거부하면 필드 하나 이름이 바뀐 것 때문에 기능이 통째로 죽는다 — 그건 결함보다 나쁜 처방이다.
   `artifacts.ts:49` 의 관용구를 그대로 쓴다: **경고하고 원본을 돌려준다.**

   반대로 `cloud/schema.ts` 는 네트워크를 건너온 페이로드라 거부가 목적 그 자체다.
   **두 경계를 같은 정책으로 다루면 한쪽은 반드시 틀린다.** */
import * as z from 'zod/mini';

/** 모양이 계약과 다르면 경고만 남기고 원본을 통과시킨다(비차단). */
function checkShape<T>(cmd: string, data: unknown, schema: z.ZodMiniType<T>): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issues = r.error.issues
    .slice(0, 5) // 전량을 늘어놓으면 로그가 페이로드만큼 커진다
    .map((i) => `  · ${i.path.join('.') || '(루트)'}: ${i.message}`)
    .join('\n');
  console.warn(`[tauri:${cmd}] Rust 응답이 계약과 다릅니다 — 프런트 타입과 갈렸을 수 있습니다.\n${issues}`);
  return data as T;
}

/** invoke 를 지연 로드한다 — 브라우저 번들에 Tauri API 가 섞여 들어가 초기 로드를 늘리지 않게.
 *  `schema` 를 주면 응답 모양을 검사한다(비차단 — 위 주석 참조). */
async function call<T>(cmd: string, args?: Record<string, unknown>, schema?: z.ZodMiniType<T>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  const out = await invoke<T>(cmd, args);
  return schema ? checkShape(cmd, out, schema) : out;
}

/* 스키마는 인터페이스 **바로 옆**에 둔다 — 떨어뜨리면 한쪽만 고치는 일이 생긴다.
   ⚠ 전부 `.passthrough()` 가 기본이다: Rust 가 필드를 **추가**하는 것은 계약 위반이 아니라
   호환되는 확장이고, 그걸 경고로 띄우면 매 릴리스마다 거짓 경보가 난다. 우리가 잡으려는 것은
   **필드가 사라지거나 타입이 바뀌는** 쪽이다. */

/** 워크스페이스(knowledge·pipeline 의 부모) 상태. Rust `workspace_status` 와 1:1. */
export interface WorkspaceStatus {
  path: string | null;
  /** 경로가 존재하고 표지(knowledge/·pipeline/)를 가졌는가. false면 복구 UX 가 필요. */
  valid: boolean;
  /** 설정 없이 자동 추론된 값인가(사용자 확인 대상). */
  inferred: boolean;
}

const WorkspaceStatusSchema = z.looseObject({
  path: z.nullable(z.string()),
  valid: z.boolean(),
  inferred: z.boolean(),
}) as z.ZodMiniType<WorkspaceStatus>;

/** 현재 워크스페이스 상태. 브라우저에선 null(경로 개념이 셸 전용이라 설정 UI 자체를 숨긴다). */
export async function workspaceStatus(): Promise<WorkspaceStatus | null> {
  if (!isTauri()) return null;
  try {
    return await call('workspace_status', undefined, WorkspaceStatusSchema);
  } catch {
    return null;
  }
}

/** 기본 연결 문자열 — 셸이 아니거나 커맨드가 없을 때(구 배포본) 쓰는 값. 예전의 상수 그대로다. */
export const DEFAULT_DB_URL = 'sqlite:learning-hub.db';

/**
 * 백엔드가 **실제로 마이그레이션한** DB 연결 문자열(SD-6).
 *
 * ⚠ 프런트가 이 값을 상수로 따로 들면, 하네스가 데이터 폴더를 격리했을 때 **백엔드는 A 에
 * 마이그레이션하고 프런트는 B 를 여는** 상태가 만들어진다 — 스키마 없는 빈 DB 가 열리고 앱은
 * "데이터가 없다"고 조용히 말한다. 그래서 값은 한 벌뿐이고 그 한 벌은 Rust 가 소유한다.
 * 실패 시 기본값으로 폴백하는 것은 **구 배포본 호환**용이다(커맨드가 없던 시절 = override 도 없다).
 */
export async function dbUrl(): Promise<string> {
  if (!isTauri()) return DEFAULT_DB_URL;
  try {
    return await call('db_url_cmd', undefined, z.string());
  } catch {
    return DEFAULT_DB_URL;
  }
}

/** 부팅 다운그레이드 가드(C2) — 판정에 필요한 값 둘 + 결론. */
const DbGuardZ = z.object({
  /** DB 에 적용된 최대 마이그레이션 버전(아직 없으면 null). */
  applied: z.nullable(z.number()),
  /** 이 빌드가 아는 최대 버전. */
  bundled: z.number(),
  downgraded: z.boolean(),
  /** I039 — 내용이 달라진 마이그레이션 버전. 비어 있지 않으면 **DB 를 열어선 안 된다**.
   *  ⚠ `_default([])` 인 이유: 구 배포본의 커맨드엔 이 필드가 없다. 없으면 «드리프트 없음»이
   *  맞다(그 빌드에서는 판정 자체가 없었으니 새 사실을 지어내면 안 된다). */
  drifted: z._default(z.array(z.number()), []),
});
export type DbGuard = z.infer<typeof DbGuardZ>;

/**
 * **DB 를 열기 전에** 다운그레이드인지 묻는다(C2 · 2026-07-26 감사).
 *
 * 신버전이 적용한 DB 를 구버전 exe 가 열면 sqlx 가 `VersionMissing` 으로 거부하는데
 * (`src-tauri/src/db.rs` 의 가드 절 · `cargo test` 가 그 전제를 붙들고 있다), 그 실패는
 * `getDb()` null → C1 경로로 흘러 **"뜨는데 데이터가 옛날 것"** 이 된다. 열기 전에 물으면
 * 그 상태를 화면으로 말할 수 있다.
 *
 * 실패·미지원(구 배포본엔 커맨드가 없다)이면 `null` — 종전 거동으로 되돌아간다. 그 경우에도
 * 데이터가 위험해지지는 않는다(연결 실패는 C1 이 임시 저장 + 배너로 받는다).
 */
export async function dbVersionGuard(): Promise<DbGuard | null> {
  if (!isTauri()) return null;
  try {
    return await call('db_version_guard', undefined, DbGuardZ);
  } catch {
    return null;
  }
}

/* 창 닫기 훅(`onCloseRequested`)은 **일부러 두지 않는다** — 근거는 실측이다(2026-07-19).
   설계 §8 은 "Tauri 창 닫기에서 `pagehide` 발화가 보장되지 않아 `useApp` 의 언로드 안전망이
   안 걸린다"고 보고 1단계에 셸 전용 훅을 요구했다. **재보니 발화한다**: WM_CLOSE 로 창을 닫으면
   WebView2 가 `beforeunload`·`visibilitychange:hidden`·`pagehide`·`unload` 를 **전부** 쏜다.
   즉 기존 브라우저 안전망이 셸에서도 그대로 동작하고, 훅은 1단계에서 순수 잉여였다.
   (한 번 넣어 봤다가 되돌린 이유: 훅을 쓰려면 `core:window:allow-destroy` 를 열어야 하는데,
   그게 없으면 Tauri 가 닫기를 보류한 채 destroy 가 ACL 에 막혀 **창이 영영 안 닫힌다**.
   측정되지 않은 이득을 위해 "앱이 안 닫힐 수 있는" 실패 경로를 새로 만드는 거래였다.)

   ▶ **2단계에서 되살렸다(아래 `installCloseGuard`).** 근거는 이번에도 추론이 아니라 실측이다 —
   트랙 B `2단계-C` 케이스가 "디바운스 대기 중 창을 닫으면 비동기 SQL 쓰기가 잘린다"를 실제로
   보여줬다(설계의 예측이 이번엔 맞았다. 1단계와 반대 결과라, 재본 것 자체가 값을 했다).
   `core:window:allow-destroy` 를 함께 켰다 — 안 켜면 Tauri 가 닫기를 보류한 채 destroy 가
   ACL 에 막혀 **창이 영영 안 닫힌다**(1단계 실측). */

/** 창 닫기 가드 — 닫기를 잠깐 보류하고 `beforeClose` 를 끝낸 뒤 창을 파괴한다.
 *
 *  ⚠ 이 함수는 **반드시 창을 닫아야 한다.** `beforeClose` 가 던지든 늦든 destroy 는 불린다
 *  (1단계에서 "앱이 안 닫히는" 실패를 실제로 만든 적이 있어, 저장보다 닫힘을 우선한다).
 *  타임아웃을 두는 이유도 같다 — 저장이 걸리면 사용자는 앱을 끌 수 없게 된다.
 *
 *  브라우저에선 no-op(창 개념이 셸 전용). 해제 함수를 돌려준다. */
/** 닫기 가드가 저장을 기다리는 상한(ms). **`tray.rs` 의 `QUIT_FALLBACK_MS` 와 같은 값이어야
 *  한다** — 갈리면 트레이 종료와 창 닫기 중 어느 쪽이 이겼는지 사고 때 답할 수 없다.
 *  ⚠ 그 정합은 `test/shellContract.test.ts` 가 **Rust 원본을 파싱해** 대조한다(M-8). */
export const CLOSE_GUARD_MS = 3000;
/* ⚠ **`TRAY_QUIT_EVENT` 가 여기 있었다 — 트레이가 은퇴했다**(I049 · 2026-08-22). */

export async function installCloseGuard(
  beforeClose: () => Promise<void>,
  timeoutMs = CLOSE_GUARD_MS,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const un = await win.onCloseRequested(async (e) => {
      e.preventDefault(); // 우리가 destroy 할 때까지 보류
      try {
        await Promise.race([beforeClose(), new Promise((r) => setTimeout(r, timeoutMs))]);
      } catch {
        /* 저장 실패가 앱을 못 닫게 만들지는 않는다 */
      }
      /* ⚠ 종전엔 여기 상주 모드 분기가 있었다(닫으면 숨긴다) — T-3 이 은퇴하며 사라졌다(I049).
         닫기는 이제 언제나 파괴다. flush 계약은 위 `beforeClose` 그대로다. */
      await win.destroy();
    });
    return un;
  } catch {
    // 훅 등록 자체가 실패하면 **가드 없이 평소대로 닫히게** 둔다(닫힘 > 저장).
    return () => {};
  }
}

/* ⚠⚠ **여기 T-3 상주 트레이·자동 시작이 있었다 — 은퇴했다**(I049 · 2026-08-22 발상 축).

   `onShellQuit`·`shellQuit`·`autostartEnabled`·`setAutostart` 넷. 그 축이 존재한 이유는
   `tray.rs` 가 스스로 적어 뒀다: *"예약 알림(T-6)은 발사 시각에 프로세스가 살아 있어야 하고,
   우회가 없다 — 그래서 `T-3 → T-6` 이 원리적 선행"*. **T-6 이 은퇴했으므로 그 선행의 목적지가
   사라졌다.** 남은 것은 «닫아도 안 죽는 프로세스»뿐이고, 그건 이 앱이 사용자에게 파는 값이
   아니다. 복구: `git show <이 커밋의 부모>:web/src/lib/tauri.ts`. */

/* ── 미니 HUD 창 모드(N-8) ──────────────────────────────────────────────────
   집중 중 남은 시간 확인이 **alt-tab 2회**였다(`FocusChip` 이 TopBar 안이라 창이 가려지면 같이
   사라진다) — 집중을 지키려는 도구가 그 왕복으로 집중을 깬다. 타이머는 탭이 아니라 **창 모드**다.

   ⚠ 새 플러그인 0 · 새 창 0. **같은 창**을 줄이고 항상 위로 올릴 뿐이라 SQLite 커넥션·종료
   가드·단일 인스턴스 계약이 전부 그대로다(새 창을 만들면 그 셋을 전부 다시 상대해야 한다).
   ⚠ 복귀 크기는 **들어갈 때 실측한 값**을 쓴다 — 상수로 굳히면 사용자가 창을 키워 둔 것을
   앱이 조용히 되돌린다(그리고 그 손실은 한 번 일어나면 복구가 불가능하다).
   ⚠ 실패는 전부 `false` 다: 권한이 없거나 브라우저면 **아무 일도 안 일어난 것**이 되고 호출부가
   라우팅을 취소한다. 반쯤 들어간 상태(작아졌는데 라우트는 그대로)가 최악이다. */
export interface WindowBox {
  width: number;
  height: number;
}

/** 현재 내부 크기(물리 픽셀 → 논리 픽셀). 브라우저·실패 시 null. */
export async function windowInnerSize(): Promise<WindowBox | null> {
  if (!isTauri()) return null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const size = await win.innerSize();
    const f = await win.scaleFactor();
    const logical = size.toLogical(f);
    return { width: Math.round(logical.width), height: Math.round(logical.height) };
  } catch {
    return null;
  }
}

/** 미니 모드 진입/복귀. `box` 가 있으면 그 크기로 되돌린다(복귀). 성공 여부를 돌려준다. */
export async function setMiniWindow(on: boolean, box?: WindowBox | null): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const target = on ? MINI_WINDOW : (box ?? RESTORE_FALLBACK);
    await win.setAlwaysOnTop(on);
    await win.setResizable(!on); // 알약을 늘려 봐야 내용이 없다 — 그리고 늘린 채 복귀하면 실측이 무의미해진다
    await win.setSize(new LogicalSize(target.width, target.height));
    return true;
  } catch {
    return false;
  }
}

/** 알약 크기 — 남은 시간·블록명·중지 버튼 한 줄이 들어가는 최소치. */
export const MINI_WINDOW: WindowBox = { width: 320, height: 92 };
/** 알약 + 캡처 한 줄(W9). 폭은 그대로 — **같은 창**이 잠깐 자라는 것이지 새 창이 아니다. */
export const MINI_CAPTURE_WINDOW: WindowBox = { width: 320, height: 132 };

/** 미니 창 높이만 바꾼다(알약 ↔ 알약+캡처). 실패는 조용히 false — 캡처 UI 는 그래도 뜬다
 *  (창이 안 자라면 잘려 보이지만, 안 뜨는 것보다는 낫고 Esc 로 즉시 빠진다). */
export async function setMiniCaptureWindow(on: boolean): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
    const t = on ? MINI_CAPTURE_WINDOW : MINI_WINDOW;
    await getCurrentWindow().setSize(new LogicalSize(t.width, t.height));
    return true;
  } catch {
    return false;
  }
}
/** 복귀 실측이 없을 때만 쓰는 폴백(tauri.conf.json 의 기본 창 크기와 같은 값). */
const RESTORE_FALLBACK: WindowBox = { width: 1440, height: 900 };

/** Rust 가 읽어 준 볼트 노트 레코드 — 정본 인덱스의 `notes[]` 와 같은 모양.
 *  ⚠ **집계된 결과가 아니다.** 집계는 `lib/vault.ts` 의 `subjectsFromIndex` 하나가 소유한다
 *  (3단계-B 에서 집계 구현이 두 벌이라 같은 볼트에서 숫자가 갈리던 결함을 고쳤다 —
 *  Rust 로 또 한 벌을 만들면 같은 실수를 언어만 바꿔 반복하는 셈이다). */
export interface VaultNotesFromRust {
  notes: { subject?: string; folder?: string; kind?: string; status?: string; anki_exported?: boolean }[];
  /** UI 에 표시하는 출처 문구('정본 _index.json' | '파일 스캔(.md)'). */
  src: string;
  path: string;
}

const VaultNotesSchema = z.looseObject({
  /* 노트 원소는 **전 필드가 옵셔널**이다(인터페이스 그대로) — 볼트 노트는 사용자가 손으로
       쓰는 파일이라 필드 누락이 정상이다. 여기서 잡으려는 건 `notes` 가 배열이 아닌 경우다. */
  notes: z.array(z.looseObject({})),
  src: z.string(),
  path: z.string(),
}) as z.ZodMiniType<VaultNotesFromRust>;

/* ── 복구 행동(M-9 · 2026-08-06) ─────────────────────────────────────────────────
   두 채널은 실패 *사유*를 화면까지 실어 나르면서 사용자가 할 수 있는 일이 **앱 재시작**뿐이었다.
   둘 다 원인이 일시적인 경우가 흔하다(단축키 선점 · 폴더 잠금·네트워크 드라이브 끊김) —
   그때 맞는 처방은 재시작이 아니라 **다시 걸기**다. 근거 전문은 Rust 쪽 두 커맨드 주석이 갖는다. */

/** 전역 캡처 단축키 등록 재시도. 성공하면 true, 실패하면 사유를 던진다. */
export async function shellHotkeyRetry(): Promise<void> {
  if (!isTauri()) return;
  await call('hotkey_retry');
}

/** 볼트 감시 재시작. ⚠ 성공 여부를 안 돌려준다 — 감시는 스레드에서 서고 사유가 나중에 앉는다.
 *  화면은 다음 `ping` 에서 사유가 사라졌는지로 판단한다(없는 확신을 지어내지 않는다). */
export async function shellVaultWatchRetry(): Promise<void> {
  if (!isTauri()) return;
  await call('vault_watch_retry');
}

/** 셸에서 볼트를 읽는다. 브라우저면 null(호출부가 File System Access 폴백으로 간다).
 *
 *  ⚠⚠ **실패는 던진다**(U006 · 2026-08-21 ux 축). 종전엔 여기서 `console.error` 만 찍고 `null` 을
 *  돌려주며 *"사용자 표면은 감시 채널(`capabilities.vaultWatchError`)이 맡는다"* 고 적어 뒀는데,
 *  그 값을 세우는 곳은 `vault.rs` 의 **감시자뿐**이다(`start_watch` → `set_watch_error`). 즉
 *  스캔 실패의 사용자 표면은 **구조적으로 존재한 적이 없고**, 주석이 그 사실의 유일한 기록이라
 *  다음 사람은 주석을 사실로 읽는다(리포트 §R3 의 형태). 던지면 호출부가 "볼트가 비었다"와
 *  "읽다 죽었다"를 실제로 가를 수 있다 — 미설정(폴더 없음)은 Rust 가 `Ok(빈 목록)` 으로 답하므로
 *  여기 오는 것은 진짜 실패다. */
export async function vaultScan(): Promise<VaultNotesFromRust | null> {
  if (!isTauri()) return null;
  return await call('vault_scan', undefined, VaultNotesSchema);
}

/** T-11 — 부재 기간에 **밖에서** 손댄 볼트 노트(mtime 기준). Rust `vault_touched` 와 1:1. */
export interface VaultTouched {
  /** 손댄 노트 전체 수(표본 상한에 안 잘린다). */
  count: number;
  /** 표본(Rust 상한 64개). 브리핑은 과목 이름 두어 개만 쓴다. */
  notes: { subject?: string; folder?: string }[];
  /**
   * 읽지 못한 폴더 수(O021 · 2026-08-22 운영 축).
   *
   * ⚠⚠ **`count` 를 이 값 없이 읽으면 안 된다.** 순회는 못 읽은 하위 트리를 조용히 건너뛰므로
   * `count: 0` 은 「밖에서 아무것도 안 했다」와 「200개 중 3개 폴더를 못 봤다」를 **같은 값으로**
   * 그린다. 이 파일이 바로 아래에서 *"실패는 null 이고 0 이 아니다"* 라 적은 그 규율의
   * **부분 실패판**이다 — 그쪽은 전량 실패만 가렸다.
   * ⚠ 옛 셸(이 필드가 없는 빌드)이 붙을 수 있으므로 **옵셔널**이다. 없으면 「모른다」이지 0 이
   * 아니고, `looseObject` 계약이 그 하위 호환을 이미 진다.
   */
  unreadable?: number;
}

const VaultTouchedSchema = z.looseObject({
  count: z.number(),
  notes: z.array(z.looseObject({})),
  unreadable: z.optional(z.number()),
}) as z.ZodMiniType<VaultTouched>;

/**
 * `sinceMs` **이후**에 수정된 볼트 노트. 브라우저면 null — 부재 브리핑의 이 조각은
 * 원리적으로 셸 전용이다(FSA 엔 폴더 mtime 순회가 없다).
 *
 * ⚠ **실패는 null 이고 0 이 아니다.** 0 은 "밖에서 아무것도 안 했다"라는 *사실 주장*이라,
 * 읽기가 죽은 것을 그렇게 그리면 화면이 조용히 거짓말한다(`ankiLapses` 의 `no-tags` 와 같은 규율).
 */
export async function vaultTouched(sinceMs: number): Promise<VaultTouched | null> {
  if (!isTauri()) return null;
  try {
    return await call('vault_touched', { sinceMs }, VaultTouchedSchema);
  } catch (e) {
    console.error('[vault] 부재 델타 조회 실패 — 밖에서 바뀐 노트를 세지 못했습니다.', e);
    return null;
  }
}

/** T-18 — 챕터 폴더의 노트 **본문**. Rust `vault_notes_text` 와 1:1(해석은 `lib/examSheet`). */
export interface VaultNoteText {
  folder: string;
  title: string;
  text: string;
}

const VaultNoteTextSchema = z.array(
  z.looseObject({ folder: z.string(), title: z.string(), text: z.string() }),
) as z.ZodMiniType<VaultNoteText[]>;

/**
 * 볼트의 한 폴더(챕터) 아래 노트 본문 전량. 브라우저면 null — 이 조각은 셸 전용이다
 * (FSA 로도 가능하긴 하나 폴더 권한을 매번 다시 묻게 되고, 시험 전날에 그건 마찰이다).
 *
 * ⚠ 실패는 **throw** 다. `vaultScan` 과 달리 여기는 사용자가 **버튼을 눌러 명시적으로** 요청한
 * 것이라, 조용히 빈 결과를 주면 "노트에 아무것도 없다"로 읽힌다(`artifactRead` 와 같은 판단).
 */
export async function vaultNotesText(folder: string): Promise<VaultNoteText[] | null> {
  if (!isTauri()) return null;
  return await call('vault_notes_text', { folder }, VaultNoteTextSchema);
}

/** 볼트 파일이 바뀌면 부르는 구독. 해제 함수를 돌려준다(브라우저면 no-op).
 *  FSA 엔 watch 가 없어 브라우저에선 **원리적으로** 불가능했던 것이라, 이 구독은 셸 전용이다. */
export async function onVaultChanged(cb: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen('vault:changed', () => cb()); // 이름은 src-tauri/src/vault.rs 의 VAULT_CHANGED
  } catch (e) {
    // ⚠ 구독 실패 = 이후 자동 갱신이 **영원히 없다**. no-op 으로 접되 흔적은 남긴다(H7).
    console.error('[vault] 변경 구독 실패 — 자동 갱신이 동작하지 않습니다.', e);
    return () => {};
  }
}

/** 전역 캡처 단축키가 눌리면 부르는 구독(E20 · 셸 전용). 해제 함수를 돌려준다.
 *
 *  ⚠ Rust 는 **"눌렸다"만** 보낸다 — 창을 띄우고 포커스하는 것까지가 그쪽 일이고, *무엇을 열지*는
 *  화면 층의 결정이다(`src-tauri/src/hotkey.rs` 머리주석). 이 경계 덕에 열 대상을 바꾸는 것이
 *  프런트 한 줄이고 Rust 재빌드가 0 이다.
 *  ⚠ 이벤트 이름은 `hotkey.rs` 의 `CAPTURE_EVENT` 와 짝이다(문자열 두 벌 — 다른 구독 2종과 같은
 *  형태이고, 이름이 갈리면 조용히 아무 일도 안 일어난다). */
export async function onGlobalCapture(cb: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen('global-capture', () => cb()); // src-tauri/src/hotkey.rs CAPTURE_EVENT
  } catch {
    return () => {};
  }
}

/** 산출물 읽기 결과 — Rust `artifact::ArtifactOut` 과 1:1.
 *  `data`(JSON 파싱 성공) 또는 `raw`(파싱 실패 원문) 중 하나만 실린다. */
export interface ArtifactOut<T = unknown> {
  ok: boolean;
  data?: T;
  raw?: string;
}

/** Rust 가 '미생성·알 수 없는 이름'에 붙이는 접두(`artifact.rs` `NOT_FOUND` 와 같은 값).
 *  한국어 메시지 본문이 아니라 이 접두를 분류 키로 쓴다 — 문구를 다듬어도 분류가 안 깨지게. */
export const ARTIFACT_NOT_FOUND = 'NOT_FOUND';

/* 봉투(`ok`/`data`/`raw`)만 검사한다 — `data` 안쪽은 산출물 종류마다 달라서 여기가 알 수 없고,
   그건 이미 `artifacts.ts` 의 `parseArtifact` 가 종류별 zod 로 검사한다(중복 방어 금지). */
const ArtifactEnvelopeSchema = z.looseObject({
  ok: z.boolean(),
  data: z.optional(z.unknown()),
  raw: z.optional(z.string()),
});

/** 산출물 1종을 셸에서 읽는다(4단계-B). 브라우저면 null → 호출부가 `/api` 폴백.
 *
 *  ⚠ **이 함수는 `vaultScan` 과 달리 에러를 삼키지 않는다.** 저기는 "볼트 연결 안 됨"이
 *  정상 상태라 null 로 접는 게 맞지만, 여기선 *왜* 실패했는지가 화면을 가른다 —
 *  '미생성(수집 안내)'과 '진짜 실패(에러 패널)'를 `artifactState.ts` 가 구분해야 하는데
 *  null 로 접으면 그 정보가 사라진다. 2단계-E 에서 "정본을 쥔 층의 침묵은 그 자체가 결함"을
 *  실사고로 배운 것과 같은 이유다. */
export async function artifactRead<T = unknown>(name: string): Promise<ArtifactOut<T> | null> {
  if (!isTauri()) return null;
  return call('artifact_read', { name }, ArtifactEnvelopeSchema as z.ZodMiniType<ArtifactOut<T>>);
}

/** 파이썬 도구 실행 결과 — Rust `tools::RunOut` 과 1:1. `stats` 는 프런트가 붙인다(`toolStats.ts`). */
export interface RunToolOut {
  ok: boolean;
  out: string;
  code: number;
  label: string;
}

const RunToolOutSchema = z.looseObject({
  ok: z.boolean(),
  out: z.string(),
  code: z.number(),
  label: z.string(),
}) as z.ZodMiniType<RunToolOut>;

/** 화이트리스트 도구 1종을 셸에서 실행한다(4단계-C).
 *  동시성 캡·타임아웃·프로세스 트리 종료는 전부 Rust 가 소유한다 — 캡이 차 있으면 throw. */
export function shellRunTool(tool: string, subject?: string): Promise<RunToolOut> {
  return call('run_tool', { tool, subject: subject ?? null }, RunToolOutSchema);
}

/** 로컬 Ollama 생성 5종(4단계-E). `onDelta` 를 주면 스트리밍, 안 주면 단발.
 *
 *  ⚠ **반환은 항상 봉투**(`{ok, error?, …}`)다 — Rust 가 실패도 값으로 준다. 소비처가 `.ok` 로
 *  분기하고 있어서 throw 로 바꾸면 그 분기가 전부 죽는다(4-D 와 같은 규율).
 *  ⚠ `signal` 은 **실제로 생성을 멈춘다** — `ollama_cancel` 이 업스트림 연결을 끊는다.
 *  4단계-C 에서 "취소가 아직 안 넘어간다"고 미뤄 둔 자리를 여기서 갚았다. */
export async function shellOllamaRun<T>(
  kind: string,
  body: Record<string, unknown>,
  opts?: { onDelta?: (accumulated: string) => void; signal?: AbortSignal },
): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  // 요청 식별자 — 취소가 이 값으로 자기 스트림을 찾는다. crypto.randomUUID 는 WebView2 에 있다.
  const requestId = crypto.randomUUID();

  let onDelta: unknown;
  if (opts?.onDelta) {
    const chan = new core.Channel<{ d: string }>();
    let acc = '';
    chan.onmessage = (m) => {
      // Rust 는 **증분**만 보낸다. 누적은 여기서 — `StreamOpts.onDelta(accumulated)` 계약이
      // "누적 원문"이라 그대로 유지해야 `previewFromJsonStream` 이 안 깨진다.
      acc += m.d;
      opts.onDelta?.(acc);
    };
    onDelta = chan;
  }

  const abort = () => void core.invoke('ollama_cancel', { requestId });
  opts?.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await core.invoke<T>('ollama_run', { kind, body, requestId, onDelta });
  } finally {
    opts?.signal?.removeEventListener('abort', abort);
  }
}

/** 텍스트 배열 → 임베딩 벡터(의미 검색·지식맵 자동 연결). 반환은 봉투. */
export async function shellOllamaEmbed<T>(texts: string[]): Promise<T> {
  return call<T>('ollama_embed', { texts });
}

/** 능력 탐지(4단계-F) — `serve.js` `/api/ping` 의 자리. `PingResponse` 와 필드가 같다.
 *  ⚠ `ok` 의 의미가 **"서버가 떠 있는가"에서 "워크스페이스가 유효한가"로 옮겨졌다.** 셸에선
 *  프로세스가 곧 백엔드라 전자는 항상 참인 상수가 되고, 그러면 10개 탭의 에러 UI 가 통째로
 *  무력화된다(설계 §4-4단계 경고). 워크스페이스가 무효면 도구 11종·산출물 8종이 전부 조용히
 *  빈 결과를 내므로, 그 순간이 정확히 셋업 안내를 띄워야 하는 순간이다.
 *  ⚠ 도구·산출물 수는 P10 W4 에서 줄었다(도구 11→8 · 산출물 9→6) — 수집 계열이 `survey/` 로 갔다. */
export function shellCapabilities<T>(): Promise<T> {
  return call<T>('capabilities');
}

/** 파일 내보내기 — 저장 위치를 묻고 쓴다(4단계-F). 저장했으면 true, 사용자가 취소하면 false.
 *
 *  ⚠ **`<a download>` 를 대체한다.** WebView2 에선 그게 **예외 없이 아무 파일도 만들지 않는다**
 *  (트랙 B 프로브로 실측 — 다운로드 폴더·프로필·앱 폴더 어디에도 안 생긴다). 내보내기 6경로가
 *  전부 그 한 함수에 수렴하고 그중 하나가 **백업**이라, 2단계-E 로 배포 경로를 셸로 좁힌 뒤
 *  줄곧 백업이 안 되고 있었다. 실패가 조용했던 게 이 결함의 본질이다. */
export async function shellSaveFile(filename: string, contents: string): Promise<boolean> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ defaultPath: filename });
  if (!path) return false; // 사용자 취소 — 실패가 아니다
  await call<void>('save_text_file', { path, contents });
  return true;
}

/**
 * **워크스페이스 루트**에 파일 하나를 쓴다 — 대화상자 없이 경로가 파생된다(볼트 백업).
 *
 * ## ⚠⚠ 왜 필요했나 — 되먹임 루프가 셸에서 원리적으로 막혀 있었다(2026-08-06)
 *
 * 지식엔진(`pipeline/_도구/지식엔진.py`)은 워크스페이스 루트나 `knowledge/` 에서
 * **`러닝허브_백업.json`** 을 찾아 앱 관측을 인제스트한다. 그 파일을 만드는 유일한 경로가
 * `shell/actions.ts` 의 `backupToVault()` 였는데, 그건 **File System Access API** 를 쓴다 —
 * 즉 **브라우저에서만** 동작한다. 그런데 이 앱의 배포 진입점은 2단계-E 이후 **셸 하나**다.
 * 결과: 사용자의 실제 앱에서는 그 파일이 **한 번도 만들어질 수 없었고**, 로드맵의 "되먹임 루프
 * 재개"는 선행 조건이 다 충족된 뒤에도 계속 막혀 있었다. 2026-08-01 감사는 이걸 _"파일명 하나"_
 * 로 적었는데, 실측하면 이름이 아니라 **경로 자체가 없었다**(앱은 그 이름으로 쓰고 있다).
 *
 * ⚠ `save_text_file` 의 머리주석은 경로 출처가 "사용자가 방금 고른 저장 대화상자"라고 적는다.
 * 여기서는 **Rust 가 소유한 워크스페이스 경로 + 고정 파일명**이라 그 신뢰 근거가 더 좁다
 * (프런트가 만든 임의 문자열이 아니다). 파일명을 호출부에서 받되 경로 조각은 못 받는 이유가 그것.
 *
 * @returns 쓴 절대경로. 셸이 아니거나 워크스페이스가 무효면 `null`(호출부가 폴백한다).
 */
export async function shellSaveInWorkspace(filename: string, contents: string): Promise<string | null> {
  if (!isTauri()) return null;
  if (filename.includes('/') || filename.includes('\\')) throw new Error('파일명에 경로를 담을 수 없습니다.');
  const ws = await workspaceStatus();
  if (!ws?.valid || !ws.path) return null;
  const sep = ws.path.includes('\\') ? '\\' : '/';
  const path = `${ws.path}${sep}${filename}`;
  await call<void>('save_text_file', { path, contents });
  return path;
}

/**
 * 시스템 알림 하나(P-8 · 2026-08-01). 셸이 아니면 **아무 일도 안 한다**(브라우저엔 채널이 없다).
 *
 * ## ⚠⚠ 웹 `Notification` 을 쓰지 않는 이유 — 실측
 *
 * `FocusChip` 은 `Notification.permission === 'granted'` 가드 뒤에서 `new Notification(...)` 을
 * 쐈다. 실 셸(릴리스 exe · CDP 프로브)에서 재 보니:
 *
 *     origin=http://tauri.localhost · permissionBefore="denied"
 *     await Notification.requestPermission() → "denied"  (프롬프트 없이 즉시)
 *     new Notification(...) → 객체는 생기지만 `onerror` 발화 · **표시 안 됨**
 *
 * 즉 그 가드가 **항상 거짓**이라 이 앱은 알림을 한 번도 쏜 적이 없다 — 개입 채널이 1개인 줄
 * 알았는데 **0개**였다. 웹 API 로는 못 고친다(그 오리진에 알림 권한이 없다).
 *
 * ⚠ **실패해도 조용히 넘어간다.** 알림은 부가 신호이고 같은 사실을 화면 안 토스트가 말한다 —
 *   알림 때문에 세션 종료 처리가 죽으면 그건 훨씬 나쁜 교환이다.
 * ⚠ **액션 버튼은 못 붙인다**(Windows 에서 원리적으로 · Actions API 는 모바일 전용). 그래서
 *   행동 선택지는 앱 안이 진다 — 이 함수는 "지금 끝났다"만 나른다.
 */
/**
 * 알림 권한을 **미리** 받아 둔다 — 세션 *시작* 때 부른다(P-8).
 *
 * ⚠ 끝날 때 처음 요청하면 권한 대화상자가 뜨는 사이 그 세션의 알림은 이미 놓친다. 그리고
 * 시작을 누른 순간이 "끝나면 알려 달라"는 뜻이므로, 물어보기에 가장 정직한 시점이기도 하다.
 * ⚠ 실패는 조용하다(권한 거부는 정당한 답이고, 화면 안 토스트가 같은 사실을 말한다).
 */
export async function shellNotifyPrime(): Promise<void> {
  if (!isTauri()) return;
  try {
    const api = await import('@tauri-apps/plugin-notification');
    if (!(await api.isPermissionGranted())) await api.requestPermission();
  } catch {
    /* 권한 거부·플러그인 부재 — 토스트가 커버한다 */
  }
}

/**
 * OS 알림 1발. **전달됐는지를 돌려준다** — 호출부가 폴백을 걸 수 있어야 한다.
 *
 * ⚠⚠ 종전엔 `Promise<void>` 였고 권한 거부를 조용히 삼키며 _"토스트가 커버한다"_ 고 적어
 * 뒀는데, **그 토스트가 어디에도 없었다**(H-9 · 2026-08-06 감사 · grep 0건). 그래서
 * `useDailyReminder` 는 "쐈다"고 기록만 하고 **아무 소리도 안 나는** 상태가 매일 반복될 수
 * 있었다 — 사용자는 알림을 켜 놓고 영원히 못 받는다. 삼키는 것 자체는 맞다(알림 실패가 앱을
 * 멈추면 안 된다) 틀린 것은 **호출부가 그 사실을 알 수 없던 것**이다.
 */
export async function shellNotify(title: string, body: string, route?: string): Promise<boolean> {
  if (!isTauri()) return false;
  /* ⚠⚠ **착지가 있으면 플러그인을 안 쓴다**(W3 · 발산 6회차). 플러그인의 Windows 경로는
     토스트 핸들을 버려서(`desktop.rs`: `let _ = notification.show()`) `onAction` 이 **영원히
     안 불린다** — 리스너를 달아 두면 "클릭 착지가 있다"는 착시만 남는다(P-8 이 잡은 것과
     같은 형태: 항상 거짓인 가드 뒤에서 아무 일도 안 일어났다). 그래서 착지가 필요한 알림은
     Rust 가 `tauri-winrt-notification` 을 직접 쓴다(`src-tauri/src/notify.rs`).
     ⚠ 실패하면 **아래 플러그인 경로로 떨어진다** — 착지 없는 알림이 알림 없는 것보다 낫다. */
  if (route) {
    try {
      await call<void>('notify_landing', { title, body, route });
      return true;
    } catch {
      /* 플랫폼·AUMID·권한 — 폴백은 바로 아래다 */
    }
  }
  try {
    const api = await import('@tauri-apps/plugin-notification');
    if (!(await api.isPermissionGranted()) && (await api.requestPermission()) !== 'granted') return false;
    api.sendNotification({ title, body });
    return true;
  } catch {
    return false; // 권한 거부·플러그인 부재 — 호출부가 폴백을 고른다
  }
}

/** 알림을 클릭했을 때 부르는 구독(셸 전용) — 인자는 **착지 경로**다.
 *
 *  ⚠ 창을 되살리는 것은 **Rust 가 이미 했다**(`notify.rs` 가 `tray::show` 를 부른다) — 상주
 *  모드의 숨은 창은 프런트에서 못 깨우기 때문이다. 여기 남는 일은 라우팅뿐이다.
 *  ⚠ 이벤트 이름은 `notify.rs` 의 `NOTIFY_CLICK` 과 짝이고, `test/shellContract.test.ts` 가
 *  그 파일을 파싱해 이 상수와 대조한다(손베낌 두 벌이 조용히 갈리는 것을 막는 유일한 자리). */
export const NOTIFY_CLICK_EVENT = 'notify:click';

export async function onNotifyClick(cb: (route: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<string>(NOTIFY_CLICK_EVENT, (e) => {
      if (typeof e.payload === 'string' && e.payload.startsWith('/')) cb(e.payload);
    });
  } catch {
    return () => {};
  }
}

/** 시스템 전역 유휴 시간(초 · N-8). 브라우저·비Windows·실패는 **0**(= 방금 입력함).
 *
 *  ⚠ 웹 이벤트로는 못 잰다 — 창이 뒤에 있으면 앱이 보는 입력은 항상 0이라 *유휴*와
 *  *다른 창에서 일하는 중*이 구분되지 않는다. 그 구분이 이 신호의 전부다(`notify.rs`). */
export async function systemIdleSeconds(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    const n = await call<number>('system_idle_seconds');
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/* ⚠⚠ **여기 Q-30 작업표시줄 배지(`badgePng`·`shellBadge`)가 있었다 — 은퇴했다**(I049 ·
   2026-08-22). 소비처였던 `app/useTaskbarBadge` 와 함께 갔고, `capabilities` 의
   `core:window:allow-set-overlay-icon` 도 그 파일이 예약해 둔 대로 함께 걷었다. */

/* ⚠⚠ **여기 Q-28 실시간 poke 소켓 중계가 있었다 — 은퇴했다**(I051 · 2026-08-22 발상 축).
   `ShellLiveEvent`·`shellLiveOpen`·`shellLiveClose`·`onShellLive` 넷. 근거는
   `store/syncController` 의 그 자리 주석(그 채널 스스로 «정확성의 전제가 아니다»라 적었고,
   실측은 8일간 동기화할 편집 0건이었다). */

/**
 * I006 — 볼트 노트를 OS 기본 앱으로 연다. `rel` 은 **볼트 루트 기준 상대경로**.
 *
 * ⚠ 경로 검증은 **Rust 가 한다**(`files::open_in_vault` → `vault::safe_join`). 프런트가
 * 검증하면 그 검증을 우회하는 다른 호출부가 언제든 생긴다 — 경계는 신뢰 경계에 둔다.
 * ⚠ 실패는 **던진다**: 「눌렀는데 아무 일도 안 일어남」이 이 저장소가 `<a download>` 에서
 * 이미 한 번 물린 형태다(`files.rs` 머리주석). 호출부가 토스트로 말한다.
 */
export async function shellOpenInVault(rel: string): Promise<void> {
  if (!isTauri()) throw new Error('셸에서만 열 수 있어요');
  await call<void>('open_in_vault', { rel });
}

/** AnkiConnect 액션 중계(4단계-F). 브라우저 직통은 셸 오리진이 CORS 화이트리스트에 없어 막힌다. */
export function shellAnkiConnect<T>(action: string, params: Record<string, unknown>): Promise<T> {
  return call<T>('anki_connect', { action, params });
}

/** 볼트 Anki 카드 스캔(4단계-I) — 폴더를 묻지 않는다(워크스페이스를 이미 안다). */
export function shellAnkiScan<T>(): Promise<T> {
  return call<T>('anki_scan');
}

/** 폴더 선택 → 확정 저장. 취소하면 null, 잘못된 폴더면 Rust 가 사유를 담아 throw 한다. */
export async function pickWorkspace(): Promise<WorkspaceStatus | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title: '워크스페이스 폴더 선택' });
  if (typeof picked !== 'string') return null; // 취소
  return call<WorkspaceStatus>('set_workspace', { path: picked });
}

/* ⚠ **LAN 모바일 뷰 서버(5단계-A)는 은퇴했다**(§9-1 결정, 2026-07-20).

   근거: 클라우드(C-4·C-5)가 같은 요구를 더 잘 채우고, C-6 폰 웹앱이 로컬 캐시를 갖게 되면
   "인터넷 없을 때 집 안에서 조회"조차 캐시가 커버한다. 남겨 두면 폰 번들이 **백엔드 둘**을
   상대해야 하고 인증이 두 벌이 되는데, LAN 쪽 모델은 **만료 없는 PSK 를 URL 에 싣는** 방식
   이라 설계서 P0-2 가 명시적으로 금지한 바로 그 형태다.

   그 결과 이 앱은 다시 **여는 포트가 0** 이다(4단계-G 가 세운 성질의 복원). */

/* ── 클라우드 HTTP 중계(C-5 후속) ─────────────────────────────── */

/** Rust `cloud_http` 의 응답. 본문은 문자열 그대로 — 파싱·검증은 `cloud/schema.ts` 가 소유한다. */
export interface CloudHttpResponse {
  status: number;
  body: string;
}

const CloudHttpResponseSchema = z.looseObject({
  status: z.number(),
  body: z.string(),
}) as z.ZodMiniType<CloudHttpResponse>;

/**
 * 클라우드 워커에 요청한다 — **셸 전용**. 브라우저(폰·dev)는 `client.ts` 가 `fetch` 로 간다.
 *
 * ⚠ 웹뷰에서 직접 `fetch` 하면 CSP(`connect-src 'self' ipc:`)에 막힌다. 실측으로 확인했고,
 * CSP 를 푸는 대신 요청을 Rust 로 내렸다 — 뉴스·Ollama·Anki 와 같은 규약이다(`cloud.rs`).
 */
export function cloudHttp(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<CloudHttpResponse> {
  return call('cloud_http', { url, method, headers, body: body ?? null }, CloudHttpResponseSchema);
}

/* ── 자동 업데이트(2026-07-25) ─────────────────────────────────────────────
   관측(텔레메트리)의 짝이다 — 결함을 알게 되는 경로를 만들었으니 고친 것을 전달할 경로도
   있어야 한다. 종전 배포는 NSIS 수동 재설치뿐이었다.

   ⚠ **확인과 설치를 가른 것이 계약이다.** 확인은 부작용이 없고, 설치는 앱을 재시작한다.
   섞으면 UI 가 "확인만" 을 표현할 수 없어 결국 자동 설치로 흐른다 — 학습 세션 중 재시작은
   이 앱에서 가장 나쁜 실패다(진행 중인 집중 타이머·미저장 편집이 날아간다).

   ⚠ 셸 전용. 브라우저·폰에는 업데이터가 없다(폰은 SW 가, 브라우저는 새로고침이 그 역할). */
export interface UpdateInfo {
  available: boolean;
  version: string;
  current: string;
  notes: string;
}

const UpdateInfoSchema = z.looseObject({
  available: z.boolean(),
  version: z.string(),
  current: z.string(),
  notes: z.string(),
}) as z.ZodMiniType<UpdateInfo>;

/**
 * 업데이트가 있는지 **확인만** 한다(받지도 설치하지도 않는다).
 *
 * `endpoint` 는 사용자 자신의 Workers 오리진에 올린 `latest.json` 주소다(C3). 안 넘기면
 * `tauri.conf.json` 의 기본 엔드포인트를 쓰는데, **그건 실측 404 였다**(비공개 저장소) —
 * 근거와 신뢰 경계 논증은 `src-tauri/src/updater.rs` 머리주석이 SSOT.
 */
export function checkUpdate(endpoint?: string): Promise<UpdateInfo> {
  return call('check_update', { endpoint: endpoint ?? null }, UpdateInfoSchema);
}

/**
 * 받아서 설치하고 **앱을 재시작한다.** 사용자가 명시적으로 누른 뒤에만 부를 것.
 *
 * ⚠ 정상 경로에서 이 프라미스는 **resolve 하지 않는다** — 프로세스가 갈아탄다.
 * 호출 전에 저장이 끝났음을 보장해야 한다(UI 가 확인 대화를 끼는 이유).
 */
export function installUpdate(endpoint?: string): Promise<void> {
  // ⚠ 확인 때와 **같은 엔드포인트**를 넘겨야 한다(본 것과 다른 것을 설치하지 않게).
  return call('install_update', { endpoint: endpoint ?? null }, z.unknown() as z.ZodMiniType<void>);
}

/* ⚠ `shellTrayTooltip`(A-6 트레이 툴팁)이 여기 있었다 — 트레이가 은퇴했다(I049). */
