/* ============================================================
   docTitle.ts — 현재 라우트에 대응하는 문서 제목의 단일 출처.
   App의 제목 이펙트(라우트 전환 반영)와 FocusChip 세션 종료 복원이 공유한다.
   FocusChip이 모듈로드 스냅샷(BASE_TITLE)을 복원하면 stale 제목이 남던 문제(X-9)를
   종료 시점의 *현재* 라우트로 재계산해 해소한다.
============================================================ */
import { tabByKey } from '@/shell';

/** pathname(기본: 현재 URL) → `<라벨> · 러닝허브`. 라벨을 못 찾으면 '러닝허브'. */
export function routeTitle(pathname: string = window.location.pathname): string {
  const label = tabByKey(pathname.replace(/^\//, '') || 'today')?.label ?? '';
  return label ? `${label} · 러닝허브` : '러닝허브';
}
