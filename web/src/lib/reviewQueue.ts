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
import { chapterReviews, interleaveBySubject, maintenanceReviews, type ChapterReview } from './spacedReview';
import { pickRetrieval, pickConfidentWrong, type RetrievalCard, type ConfidentWrongCard } from './retrieval';
import type { AppState, Day } from './types';

export type RunCard =
  | { kind: 'retrieval'; card: RetrievalCard }
  | { kind: 'confident'; card: ConfidentWrongCard }
  | { kind: 'chapter'; ch: ChapterReview };

/** 큐 원소 = 카드 + 재삽입 표식. `again` 은 **세션 내 두 번째 등장**임을 뜻한다(D-1). */
export type RunItem = RunCard & { again?: true };

/**
 * 카드 한 장을 **한 줄로** 말한다 — 배지와 대상(H13 · 2026-07-26 감사).
 *
 * 왜 lib 인가: 데스크톱·폰 두 러너가 카드 전환을 스크린리더에 알려야 하는데, 그 문구가 화면마다
 * 갈리면 "폰만 다르게 읽히는" 상태가 조용히 생긴다(설계서 §9-4 의 "화면은 따로, 규칙은 lib" ·
 * 결정로그가 `chapterCopy` 2벌로 이미 물린 부류). 배지 문자열은 각 카드의 시각 배지와 **같은 말**이다.
 */
export function cardSpeech(item: RunCard): { badge: string; subject: string } {
  if (item.kind === 'retrieval') return { badge: '회상', subject: item.card.summary.name };
  if (item.kind === 'confident') {
    const ch = item.card.cbms.chapter ? ` · ${item.card.cbms.chapter}` : '';
    return { badge: '착각 재확인', subject: `${item.card.cbms.name}${ch}` };
  }
  const badge = item.ch.maintenance ? '유지' : item.ch.risk === 'overdue' ? '많이 밀림' : '복습 때';
  return { badge, subject: `${item.ch.subject} · ${item.ch.chapter}` };
}

/** 밀린 챕터 상한 — 한 세션에 몰아넣지 않는다(나머지는 다음 세션으로 자연 이월). */
export const REVIEW_CHAPTER_CAP = 12;
/** 유지(끝낸 챕터) 상한 — **세션당 2장**(N-10). 진행 중 복습이 주(主)이고 유지는 꼬리다.
 *  상한이 생사인 이유: 이 기능 이전에 끝낸 챕터는 앵커가 없어 전부 `due` 로 들어오므로,
 *  상한이 없으면 켠 날 러너가 "끝낸 것 전부 다시"가 된다. 2장씩이면 볼 때마다 진짜 앵커가
 *  하나씩 생겨(`reviewTouches`) 큐가 스스로 정상 사다리로 수렴한다. */
export const MAINTENANCE_CAP = 2;

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
  // 유지(끝낸 챕터)는 **맨 뒤**에 상한만큼. 앞에 끼우면 진행 중 overdue 가 밀린다(강등 불변식의 배치판).
  const keep = maintenanceReviews(state, today).filter((c) => c.risk !== 'fresh');
  for (const ch of interleaveBySubject(keep).slice(0, MAINTENANCE_CAP)) q.push({ kind: 'chapter', ch });
  return q;
}

/** 카드의 세션 내 정체성 — 재삽입본과 원본이 **같은 카드**임을 세는 키(분모가 흔들리지 않게). */
export function runItemKey(item: RunItem): string {
  if (item.kind === 'retrieval') return `r:${item.card.summary.id}`;
  if (item.kind === 'confident') return `c:${item.card.cbms.id}`;
  return `h:${item.ch.sid}|${item.ch.chapter}`;
}

/* ── D-1 세션 내 확장 인출(재큐) ──────────────────────────────────────────
   러너가 12장을 넘기는 동안 **산출 데이터가 0**이었다 — 못 떠올린 카드를 그 자리에서 영구히
   버리고, 세션이 끝나면 그 사실조차 남지 않았다. 인출 연습의 값은 *실패한 것을 다시 만나는 데*
   있으므로, 넘긴 카드를 세션 안에서 딱 한 번 더 준다.

   숫자 셋의 근거(임의 계수를 만들지 않는다는 `spacedReview.ts:29-31` 규율과 같은 논리):
   ① **간격 3장** — 확장 인출(expanding retrieval)은 "직후가 아니라 조금 뒤"가 요점이다. 바로
      다음 장에 다시 주면 작업기억에서 꺼내는 것이라 인출이 아니고, 너무 뒤면 세션이 끝난다.
      큐의 카드 종류가 셋(회상·착각·챕터)이라 3장이면 최소 한 번은 다른 종류가 사이에 낀다.
   ② **1회 상한** — 두 번째도 못 하면 그건 세션이 풀 문제가 아니라 다음 복습일의 문제다.
      상한이 없으면 못 하는 카드가 큐를 무한히 늘려 러너가 끝나지 않는다.
   ③ **큐 ≥4일 때만** — 3장 간격이 성립하지 않는 짧은 큐에서 재삽입하면 사실상 "직후 반복"이라
      ①의 근거를 스스로 깬다.

   ⚠ 순수 함수다. 데스크톱(`ReviewRun`)·폰(`ReviewView`) 두 러너가 이 한 곳을 공유하고,
   유닛 테스트가 UI 없이 전량을 덮는다(스냅샷과 무관한 안전망). */
export const REQUEUE_GAP = 3;
export const REQUEUE_MIN_QUEUE = 4;

/**
 * `idx` 의 카드를 **3장 뒤에 1회** 재삽입한 새 큐를 돌려준다(조건 미달이면 원본 그대로).
 * 끝을 넘어가면 마지막에 붙인다 — 세션 밖으로 밀어내면 재큐가 아니라 삭제다.
 */
export function requeue(queue: RunItem[], idx: number): RunItem[] {
  const item = queue[idx];
  if (!item || item.again) return queue; // 이미 두 번째 등장 → 상한(②)
  if (queue.length < REQUEUE_MIN_QUEUE) return queue; // 짧은 큐(③)
  const at = Math.min(idx + 1 + REQUEUE_GAP, queue.length);
  const next = queue.slice();
  next.splice(at, 0, { ...item, again: true });
  return next;
}
