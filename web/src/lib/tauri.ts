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

/** 폴더 선택 → 확정 저장. 취소하면 null, 잘못된 폴더면 Rust 가 사유를 담아 throw 한다. */
export async function pickWorkspace(): Promise<WorkspaceStatus | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title: '워크스페이스 폴더 선택' });
  if (typeof picked !== 'string') return null; // 취소
  return call<WorkspaceStatus>('set_workspace', { path: picked });
}
