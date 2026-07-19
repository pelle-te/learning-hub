/* ============================================================
   tauri.ts — Tauri 셸 경계(플랫폼 개편 1단계).

   **불변식 I2**: Tauri `invoke` 호출은 `lib/` 가 소유한다(React 무관 IO 의 정의).
   `features/` 에 `invoke` 가 직접 박히는 것이 1·3·4단계의 가장 흔한 위반 경로라, 이 파일이
   유일한 통로가 된다. 새 커맨드가 생기면 여기에 얇은 함수를 하나 더 두고, 나머지 층은
   그 함수만 본다(Rust 시그니처 변경의 파급을 한 파일로 가둔다).

   ⚠ 앱은 **브라우저에서도 그대로 돌아야 한다** — 1단계는 셸만 이사하고 웹 실행 경로를 죽이지
   않는다(`npm run dev` · `node serve.js` 둘 다 유지). 그래서 모든 함수가 "Tauri 아님"을
   1급 상태로 다룬다: 감지 실패는 예외가 아니라 `null`/기본값이다.
============================================================ */

/** Tauri WebView 안에서 실행 중인가. 브라우저(dev·serve.js)에선 false. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** invoke 를 지연 로드한다 — 브라우저 번들에 Tauri API 가 섞여 들어가 초기 로드를 늘리지 않게. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** 워크스페이스(knowledge·pipeline 의 부모) 상태. Rust `workspace_status` 와 1:1. */
export interface WorkspaceStatus {
  path: string | null;
  /** 경로가 존재하고 표지(knowledge/·pipeline/)를 가졌는가. false면 복구 UX 가 필요. */
  valid: boolean;
  /** 설정 없이 자동 추론된 값인가(사용자 확인 대상). */
  inferred: boolean;
}

/** 현재 워크스페이스 상태. 브라우저에선 null(경로 개념이 셸 전용이라 설정 UI 자체를 숨긴다). */
export async function workspaceStatus(): Promise<WorkspaceStatus | null> {
  if (!isTauri()) return null;
  try {
    return await call<WorkspaceStatus>('workspace_status');
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
export async function installCloseGuard(beforeClose: () => Promise<void>, timeoutMs = 3000): Promise<() => void> {
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
      await win.destroy();
    });
    return un;
  } catch {
    // 훅 등록 자체가 실패하면 **가드 없이 평소대로 닫히게** 둔다(닫힘 > 저장).
    return () => {};
  }
}

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

/** 셸에서 볼트를 읽는다. 브라우저면 null(호출부가 File System Access 폴백으로 간다). */
export async function vaultScan(): Promise<VaultNotesFromRust | null> {
  if (!isTauri()) return null;
  try {
    return await call<VaultNotesFromRust>('vault_scan');
  } catch {
    // 볼트 폴더를 못 찾는 경우 등 — 호출부가 "연결 안 됨"으로 다루게 null.
    return null;
  }
}

/** 볼트 파일이 바뀌면 부르는 구독. 해제 함수를 돌려준다(브라우저면 no-op).
 *  FSA 엔 watch 가 없어 브라우저에선 **원리적으로** 불가능했던 것이라, 이 구독은 셸 전용이다. */
export async function onVaultChanged(cb: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen('vault:changed', () => cb()); // 이름은 src-tauri/src/vault.rs 의 VAULT_CHANGED
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

/** 산출물 1종을 셸에서 읽는다(4단계-B). 브라우저면 null → 호출부가 `/api` 폴백.
 *
 *  ⚠ **이 함수는 `vaultScan` 과 달리 에러를 삼키지 않는다.** 저기는 "볼트 연결 안 됨"이
 *  정상 상태라 null 로 접는 게 맞지만, 여기선 *왜* 실패했는지가 화면을 가른다 —
 *  '미생성(수집 안내)'과 '진짜 실패(에러 패널)'를 `artifactState.ts` 가 구분해야 하는데
 *  null 로 접으면 그 정보가 사라진다. 2단계-E 에서 "정본을 쥔 층의 침묵은 그 자체가 결함"을
 *  실사고로 배운 것과 같은 이유다. */
export async function artifactRead<T = unknown>(name: string): Promise<ArtifactOut<T> | null> {
  if (!isTauri()) return null;
  return call<ArtifactOut<T>>('artifact_read', { name });
}

/** 파이썬 도구 실행 결과 — Rust `tools::RunOut` 과 1:1. `stats` 는 프런트가 붙인다(`toolStats.ts`). */
export interface RunToolOut {
  ok: boolean;
  out: string;
  code: number;
  label: string;
}

/** 화이트리스트 도구 1종을 셸에서 실행한다(4단계-C).
 *  동시성 캡·타임아웃·프로세스 트리 종료는 전부 Rust 가 소유한다 — 캡이 차 있으면 throw. */
export function shellRunTool(tool: string, subject?: string): Promise<RunToolOut> {
  return call<RunToolOut>('run_tool', { tool, subject: subject ?? null });
}

/** 폴더 선택 → 확정 저장. 취소하면 null, 잘못된 폴더면 Rust 가 사유를 담아 throw 한다. */
export async function pickWorkspace(): Promise<WorkspaceStatus | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title: '워크스페이스 폴더 선택' });
  if (typeof picked !== 'string') return null; // 취소
  return call<WorkspaceStatus>('set_workspace', { path: picked });
}
