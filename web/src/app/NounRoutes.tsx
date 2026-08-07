/* ============================================================
   app/NounRoutes.tsx — **명사 주소의 착지**(N-12 · W4 · 발산 6회차).

   ## 왜 리다이렉트인가 — 주소를 주는 것과 화면을 만드는 것은 다른 일이다

   이 앱에서 URL 을 가진 명사는 `subject` **하나**였다. 나머지(보고 있는 날 · 주 오프셋 ·
   고른 챕터 · 다가오는 시험)는 전부 화면 안의 `useState` 라, "그것을 다시 열기"가 **경로
   재현**이었다: 탭을 열고 스테퍼를 N번 누른다. 링크로 못 가리키는 것은 ⌘K 로도 못 찾고,
   알림도 못 데려가고, 앱이 자기 자신을 참조하지도 못한다.

   그런데 그 셋(챕터·주·시험)은 **답하는 화면이 이미 있다.** 새 화면을 만드는 것은 다른
   결정이고, 이 저장소는 그 결정을 다섯 번 강등으로 되돌린 이력이 있다(P10 §1-3). 그래서
   여기서 하는 일은 **명사를 그 화면의 정확한 상태로 착지시키는 것**뿐이다.

   ⚠ 로스터(이름)는 `shell/tabs.ts` 의 `role:'object'` 가 갖고, 여기는 착지만 안다. 갈 곳이
   매개변수의 함수라 정적 문자열(`TabMeta.to`)로는 표현되지 않는다 — 그게 두 필드를 가른 이유.
   ⚠ **매개변수를 신뢰하지 않는다.** URL 은 사용자·외부가 쓰는 입력이다. 못 읽으면 그 명사의
   호스트 화면으로 접는다(빈 화면·깨진 상태보다 낫다).
============================================================ */
import { Navigate, useParams } from 'react-router-dom';
import { SHEET_VIEW } from '@/shell/tabs';

/**
 * `/chapter/:sid/:chapter` — 그 챕터 하나.
 *
 * 착지는 과목 상세다: 챕터의 진척·복습 이력·노트를 이미 그 화면이 쥐고 있다(W12).
 * ⚠ 챕터명은 슬래시·`|`·공백을 포함할 수 있어 **인코딩된 채로 온다** — `useParams` 가 이미
 * 디코드해 주므로 다시 인코드해서 쿼리에 싣는다(이중 디코드 금지).
 */
export function ChapterRedirect(): React.JSX.Element {
  const { sid, chapter } = useParams<{ sid: string; chapter: string }>();
  if (!sid) return <Navigate to="/items" replace />;
  const q = chapter ? `?chapter=${encodeURIComponent(chapter)}` : '';
  return <Navigate to={`/subject/${encodeURIComponent(sid)}${q}`} replace />;
}

/**
 * `/week/:ws` — 그 주(월요일 ISO).
 *
 * 착지는 주간 배분 보드다. ⚠ 주 오프셋은 `useWeekOffset` 이 `useState` 로 쥐고 있어서
 * **주소가 그 상태를 세울 방법이 없었다** — 이 라우트가 생기며 그 훅이 `startMon` 을 받는다
 * (그 파일 주석이 근거의 SSOT). 즉 이 리다이렉트는 "쿼리로 갈아 끼우는" 편법이 아니라
 * 상태 소유자에게 초기값 입구를 낸 것이다.
 */
export function WeekRedirect(): React.JSX.Element {
  const { ws } = useParams<{ ws: string }>();
  const ok = ws && /^\d{4}-\d{2}-\d{2}$/.test(ws);
  return <Navigate to={ok ? `/alloc?week=${ws}` : '/alloc'} replace />;
}

/**
 * `/exam/:sid` — 그 과목의 다음 시험.
 *
 * 착지는 **시험 전날 한 장**(T-18)이다 — 시험이라는 명사에 대해 이 앱이 그리는 유일한 화면이고,
 * 그게 이 주소가 답해야 할 질문("이 시험을 어떻게 준비하나")과 정확히 같다.
 */
export function ExamRedirect(): React.JSX.Element {
  const { sid } = useParams<{ sid: string }>();
  if (!sid) return <Navigate to="/items" replace />;
  return <Navigate to={`/subject/${encodeURIComponent(sid)}?view=${SHEET_VIEW}`} replace />;
}
