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
