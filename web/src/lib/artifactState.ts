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

/** 워크스페이스 미설정 — 제목·툴팁 공용(실측: 3곳에 글자까지 같은 문장이 있었다). */
export const WORKSPACE_UNSET = '워크스페이스가 설정되지 않았어요';
/** 같은 사실의 **상태 칩** 표현. 칩은 한 낱말이라 문장을 실을 수 없다(같은 뜻, 다른 레지스터). */
export const WORKSPACE_UNSET_SHORT = '미설정';

/**
 * 콜드 게이트 안내 — 처방(공통) + `gains`(이 화면이 얻는 것 · 호출부가 준다).
 * @param gains 예: `'전세계 지수 등락과 금융 뉴스가 채워집니다'`
 */
export function workspaceHint(gains: string): string {
  return `설정 탭에서 워크스페이스 폴더를 지정하면 ${gains}.`;
}

/** 실패 토스트·문장 꼬리 — `…에 실패했어요(워크스페이스 설정 필요)` 형태를 한곳에서 만든다. */
export function needsWorkspace(what: string): string {
  return `${what}(워크스페이스 설정 필요)`;
}

/**
 * 산출물 로드 실패 문구 — 옛 `components/ArtifactError` 가 컴포넌트로 들고 있던 것.
 *
 * ⚠ **컴포넌트가 아니라 문구여야 한다**(E17). `ArtifactError` 는 `State` 를 한 겹 감싸 제목·설명을
 * 조립하기만 했는데, 그 결과 "에러를 그리는 것"이 앱 안에 둘(`ArtifactError` · Ledger/Mastery 의
 * 손코딩 바디)이 됐다. 조립은 문구고 그리기는 `State` 다 — 이 저장소의 층 규율 그대로.
 * @param label 무엇을(예: `'지문을'` · `'증시 데이터를'`)
 * @param detail 오류 메시지(있으면 뒤에 붙는다)
 */
export function artifactErrorCopy(label: string, detail?: string): { title: string; desc: string } {
  return {
    title: `${label} 불러오지 못했어요`,
    desc: `워크스페이스는 연결됐지만 응답에 문제가 있어요${detail ? ` — ${detail}` : '.'}`,
  };
}
