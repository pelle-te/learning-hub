/* ============================================================
   reviewQueue.ts — 오늘 복습 큐 조립(데스크톱·폰 공용 순수 로직).

   `features/review-run/ReviewRun.tsx`(데스크톱 러너)에 인라인이던 `buildQueue` 를 여기로 올린다.
   폰 복습 러너(`phone/ReviewView`)가 **같은 규칙**을 써야 하기 때문 — 설계서 §9-4 의 "화면은
   따로, 규칙은 lib" 를 그대로 따른다(픽셀만 이원화, 큐 판정은 한 곳).

   큐 = 회상 1 → 착각 재확인 1 → 밀린 챕터 상위 N. 하루 단위 결정적(회상·착각은 날짜 해시).

   ⚠ 밀린 챕터는 **과목 인터리빙**(ID-2)으로 배열한다 — 위험 티어(overdue→due)는 지키되 티어
   안에서 과목을 라운드로빈으로 끼워, 같은 과목을 연달아 인출하지 않게 한다(블록 학습보다 파지
   유리). 인터리빙을 **cap 전에** 적용하는 것이 핵심: cap 을 먼저 씌우면 한 과목의 밀린
   챕터가 상한을 다 먹어 다른 과목이 통째로 빠질 수 있다(인터리빙이 무의미해진다).
============================================================ */
import { chapterReviews, interleaveBySubject, type ChapterReview } from './spacedReview';
import { pickRetrieval, pickConfidentWrong, type RetrievalCard, type ConfidentWrongCard } from './retrieval';
import type { AppState, Day } from './types';

export type RunItem =
  | { kind: 'retrieval'; card: RetrievalCard }
  | { kind: 'confident'; card: ConfidentWrongCard }
  | { kind: 'chapter'; ch: ChapterReview };

/** 밀린 챕터 상한 — 한 세션에 몰아넣지 않는다(나머지는 다음 세션으로 자연 이월). */
export const REVIEW_CHAPTER_CAP = 12;

/** 오늘 복습 큐를 만든다. `days` 는 스케줄 창(밀린 챕터 판정용) — 없으면 회상·착각만 남는다. */
export function buildReviewQueue(state: AppState, days: Day[], today: string): RunItem[] {
  const q: RunItem[] = [];
  const rc = pickRetrieval(state, today);
  if (rc) q.push({ kind: 'retrieval', card: rc });
  const cw = pickConfidentWrong(state, today);
  if (cw) q.push({ kind: 'confident', card: cw });
  // 위험 챕터 전체를 과목 인터리빙 후 cap — riskChapters(cap 먼저)를 쓰지 않는 이유는 위 주석 참고.
  const risk = chapterReviews(state, days || [], today).filter((c) => c.risk !== 'fresh');
  for (const ch of interleaveBySubject(risk).slice(0, REVIEW_CHAPTER_CAP)) q.push({ kind: 'chapter', ch });
  return q;
}
