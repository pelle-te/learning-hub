/* ============================================================
   artifactState.ts — 볼트/외부 산출물 fetch 탭의 표시 상태 분류(순수·프레임워크 무관).
   reads·markets·mastery가 각자 손코딩하던 loading/offline/empty/error/ready 삼각측량을 하나로.
   이 구분엔 버그 이력이 있다(오프라인을 장애로 오판·'미수집'을 에러로 노출) — SSOT로 잠근다.

   phase 계약:
   • ready   — 데이터 있음(무조건 우선).
   • loading — 로딩/수집 중.
   • error   — 서버는 살아 있는데(online) 진짜 실패(미생성 계열 아님)일 때만. 에러 패널 노출.
   • empty   — 오프라인·미수집·미생성(404·'찾지 못했'·프록시 500). 셋업/수집 안내(ArtifactGate).
============================================================ */

export type ArtifactPhase = 'ready' | 'loading' | 'error' | 'empty';

export interface QueryLike {
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
}
export interface PingLike {
  ok?: boolean;
  isSuccess?: boolean;
  isLoading?: boolean;
}

/** '아직 산출물 없음' 계열 — 서버는 살아 있으나 파일이 생성 전인 정상적 무데이터.
    TypeError(dev/preview 프록시 500·네트워크 실패)·HTTP 404·'찾지 못했' 메시지를 여기로 본다. */
export function isNotYetError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg === 'HTTP 404' || msg.includes('찾지 못했');
}

/** 산출물 탭의 표시 단계. hasData가 있으면 무조건 ready.
    loading을 명시하면(수집 중 포함) 그 값을 우선, 아니면 query/ping의 로딩으로 판정. */
export function classifyArtifact(opts: {
  hasData: boolean;
  loading?: boolean;
  query: QueryLike;
  ping?: PingLike | null;
}): ArtifactPhase {
  const { hasData, query, ping } = opts;
  if (hasData) return 'ready';
  if (opts.loading ?? (query.isLoading || ping?.isLoading)) return 'loading';
  const online = !!(ping?.ok || ping?.isSuccess);
  if (query.isError && online && !isNotYetError(query.error)) return 'error';
  return 'empty';
}

/** 에러 패널 메시지 — Error면 message, 아니면 undefined(패널이 기본 문구로 폴백). */
export function artifactErrorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

/* ============================================================
   콜드 게이트 문구 (E17 · 2026-07-30) — **문구는 lib, 그리기는 `components/State`**

   ⚠ 로드맵은 이것을 _"워크스페이스 안내가 8곳에 각자 다른 문장으로 복제"_ → **1종으로** 라
   적었는데, 실측해 보니 **절반만 맞다.** 8곳을 나란히 놓으면 이렇게 갈린다:

   | 무엇이            | 8곳에서 |
   | ----------------- | ------- |
   | 머리("설정 안 됨") | **글자까지 같다** — 복제다 |
   | 처방("설정 탭에서 폴더 지정") | **글자까지 같다** — 복제다 |
   | 꼬리("그러면 *무엇이* 생기는가") | **전부 다르다** — 동향 / 지수·환율 / 지문 / 볼트·숙달도 / 원장 |

   즉 꼬리는 드리프트가 아니라 **각 화면이 콜드 게이트에서 사용자에게 주는 유일한 정보**다.
   1종으로 뭉개면 "설정하세요"만 남고 *왜 설정하는지*가 사라진다 — D-4 가 콜드 게이트를 고칠 때
   세운 원칙("막힌 지점으로 **데려다준다**")의 반대편이다.
   → **복제된 머리·처방만** 여기로 모으고 꼬리는 호출부가 준다. 8종이 1종이 되는 게 아니라
     **8종의 공통부가 1종이 된다.**
============================================================ */

/* ⚠ `WORKSPACE_UNSET`(문장)·`workspaceHint`·`artifactErrorCopy` 셋이 P10 W4 에서 빠졌다
   (2026-08-07). 셋 다 **콜드 게이트를 그리는 화면**이 소비자였는데(`ArtifactGate`·`reads`·
   `markets`·`discovery`·`control`), 그 화면들이 `survey/` 필러로 갔다. 남은 소비자는 칩 하나와
   실패 토스트 둘이라 문장형 공용부가 통째로 고아가 됐다 — E17 이 이 파일을 만든 근거("복제된
   머리·처방만 모은다")가 소비자 수와 함께 사라진 형태다. 되살리려면 `git show 1c21ad5:`. */
/** 워크스페이스 미설정의 **상태 칩** 표현. 칩은 한 낱말이라 문장을 실을 수 없다(같은 뜻, 다른 레지스터). */
export const WORKSPACE_UNSET_SHORT = '미설정';

/** 실패 토스트·문장 꼬리 — `…에 실패했어요(워크스페이스 설정 필요)` 형태를 한곳에서 만든다. */
export function needsWorkspace(what: string): string {
  return `${what}(워크스페이스 설정 필요)`;
}

/**
 * 도구 실행이 **던진** 경우의 문구(H23 · 2026-07-30 `/감사 근본`).
 *
 * ⚠⚠ **모든 예외를 "워크스페이스 설정 필요"로 말하지 말 것.** `run_tool` 의 `Err` 경로에는
 * 워크스페이스와 무관한 사유가 실재한다 — `tools.rs` 의 **동시성 캡 소진**("이미 실행 중인
 * 도구가 많아요 — 잠시 후 다시.")과 **알 수 없는 도구**가 그것이다. 그것을 워크스페이스
 * 문제로 말하면 사용자는 **이미 설정해 둔 워크스페이스를 다시 설정하러 간다** — 처방이
 * 원인과 무관하니 아무리 따라도 해결되지 않는다.
 *
 * 서버가 사유를 정확히 주는데 클라이언트가 한 문장으로 뭉개는 부류이고, H17(D1 한도를
 * "재시도 가능"으로 오분류)·H23①(등록 429)과 **같은 계열**이다. 올바른 형태는 이 저장소에
 * 이미 있었다 — `hooks/useCollectTool` 은 같은 자리에서 `e.message` 를 그대로 보여 준다.
 *
 * @param what 무엇을 못 했나(예: `'원장 재빌드에 실패했어요'`)
 */
export function toolFailureCopy(e: unknown, what: string): string {
  const msg = e instanceof Error ? e.message.trim() : typeof e === 'string' ? e.trim() : '';
  /* 사유가 있으면 그것이 가장 정확한 안내다. 길이만 자른다(토스트 한 줄) — 내용을 해석해
     분류하려 들면 그 분류가 곧 다음 오진이 된다(문구는 Rust 소유다). */
  if (msg) return `${what} — ${msg.slice(0, 140)}`;
  // 사유를 못 얻은 경우에만 종전 추측으로 폴백한다. 그때도 그것이 추측임이 문장에 드러난다.
  return needsWorkspace(what);
}
