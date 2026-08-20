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

/**
 * 챕터 카드가 **왜 돌아왔는지** 한 문단으로 말한다(H14 · 2026-07-31 `/감사 근본`).
 *
 * ## ⚠ 여기 있는 이유 — 같은 함수가 두 번째로 갈렸다
 *
 * 결정로그가 `chapterCopy` 2벌로 이미 한 번 물렸고, H13 이 그 교훈으로 **배지**만 `cardSpeech`
 * 로 올렸다. 본문은 두고 갔고 — 그 사이 W2 가 데스크톱에만 **`fromVault` 분기**를 더해 다시
 * 갈렸다. 관측 가능한 결과: 볼트 유래 앵커 챕터가 폰에서는 앱 인출 기록과 **같은 말**로 떴다.
 * 그건 `lib/vaultAnchors.ts` 가 _"UI 가 배지로 구분한다"_ 고 적어 둔 계약을 폰이 조용히 깨는
 * 것이고, 부모(`벌트DB.py`)가 _"라이브 관측이 흐르면 이 지표는 폴백으로 강등돼야 한다"_ 고
 * 적은 값을 앱이 승격시키는 셈이다.
 *
 * 설계서 §9-4 의 계약은 _"화면은 갈라도 규칙(문구·판정·실패 처리)은 `lib/` 하나"_ 다.
 * 문구는 규칙이다.
 *
 * ⚠ 강조(`<b>`)를 담지 않는다 — 마크업은 화면의 것이다. 문장 자체가 이미 그 사실을 말한다.
 */
export function chapterCopy(ch: ChapterReview): { badge: string; age: string; body: string } {
  if (ch.maintenance) {
    if (!ch.lastDs)
      return {
        badge: '유지',
        age: '',
        body: '끝낸 챕터인데 마지막으로 본 날이 기록에 없어요. 한 번 인출하면 그때부터 유지 주기가 잡힙니다.',
      };
    return {
      badge: '유지',
      age: ` · ${ch.daysSince}일 방치`,
      body: `끝낸 챕터예요. 마지막으로 본 지 ${ch.daysSince}일(${ch.lastDs}) — 유지 인출로 붙잡아 둡니다.`,
    };
  }
  const badge = ch.risk === 'overdue' ? '많이 밀림' : '복습 때';
  const age = ` · ${ch.daysSince}일 방치`;
  if (ch.fromVault)
    return {
      badge,
      age,
      body: `볼트 기록으로는 ${ch.lastDs}에 검증했고 그 뒤 앱에 인출 기록이 없어요(${ch.daysSince}일). 한 번 인출하면 그때부터 앱 자신의 앵커가 잡힙니다.`,
    };
  return {
    badge,
    age,
    body: `배웠지만 ${ch.daysSince}일 안 봤어요(마지막 ${ch.lastDs}). 지금 인출해 망각곡선을 리셋하세요.`,
  };
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
  /* ⚠ 보류 선반(P-11) — 사용자가 "이건 안 볼게"라고 말한 챕터는 큐에서 빠진다.
     **cap 앞에서** 거른다: cap 뒤에 거르면 뺀 자리가 빈 채로 남아 세션이 조용히 짧아지고,
     그러면 "뺐는데 아무것도 안 달라졌다"가 된다(뺀 만큼 다음 챕터가 올라와야 의미가 있다).
     `risk !== 'fresh'` 필터와 같은 자리인 이유도 같다 — 둘 다 *큐에 들어갈 자격*의 문제다. */
  const held = (c: ChapterReview): boolean => !!state.reviewHold?.[`${c.sid}|${c.chapter}`];
  // 위험 챕터 전체를 과목 인터리빙 후 cap — riskChapters(cap 먼저)를 쓰지 않는 이유는 위 주석 참고.
  const risk = chapterReviews(state, days || [], today).filter((c) => c.risk !== 'fresh' && !held(c));
  for (const ch of interleaveBySubject(risk).slice(0, REVIEW_CHAPTER_CAP)) q.push({ kind: 'chapter', ch });
  // 유지(끝낸 챕터)는 **맨 뒤**에 상한만큼. 앞에 끼우면 진행 중 overdue 가 밀린다(강등 불변식의 배치판).
  const keep = maintenanceReviews(state, today).filter((c) => c.risk !== 'fresh' && !held(c));
  for (const ch of interleaveBySubject(keep).slice(0, MAINTENANCE_CAP)) q.push({ kind: 'chapter', ch });
  return q;
}

/**
 * 이 카드가 옮길 수 있는 **복습 앵커**(`reviewTouches` 의 `sid|chapter`) — 없으면 null.
 *
 * E1(2026-07-29) — 러너의 인출 판정이 위험모델에 도달하는 통로다. 카드 종류별로 답이 다르고,
 * 그 차이가 곧 설계다:
 * · `chapter` — 앵커 그 자체다.
 * · `confident` — `Cbms` 가 `sid`·`chapter` 를 다 가지므로 옮길 수 있다. 착각 재확인의
 *   "다시 확인했어요"는 대조를 거친 **진짜 인출 사건**인데 종전엔 세션 카운터만 올리고 버려졌다.
 * · `retrieval` — **원리적으로 없다.** `Summary` 스키마에 `chapter` 필드가 아예 없다(요약은
 *   과목 단위다). sid 만으로 그 과목의 아무 챕터나 리셋하는 것은 인출 기록이 아니라 오염이다.
 *
 * ⚠ lib 에 두는 이유는 폰 러너(`phone/ReviewView`)가 **같은 판정**을 써야 하기 때문이다 —
 * 설계서 §9-4("화면은 따로, 규칙은 lib"). 이게 화면마다 갈리면 어느 기기에서 인출했느냐에 따라
 * 사다리가 달라지고, 그건 조용하다.
 */
export function anchorOf(item: RunCard): { sid: string; chapter: string } | null {
  if (item.kind === 'chapter') return { sid: item.ch.sid, chapter: item.ch.chapter };
  if (item.kind === 'confident' && item.card.cbms.chapter)
    return { sid: item.card.cbms.sid, chapter: item.card.cbms.chapter };
  return null;
}

/**
 * 이 카드를 **못 떠올렸을 때 오답으로 남길 대상**(P-2). `anchorOf` 와 다른 함수인 이유가 요지다.
 *
 * `anchorOf` 는 *망각곡선을 리셋해도 되는가*를 답하므로 챕터가 없으면 `null` 이다(아무 챕터나
 * 리셋하는 것은 오염이다). 오답 기록은 그 제약이 없다 — `mistakeArchive` 가 `chapter: ''` 를
 * **정당한 칸**으로 이미 다루고(`sid|''`), 과목 단위 오답은 그 자체로 읽을 수 있는 사실이다.
 * 두 질문을 한 함수로 합치면 회상 카드(요약 = 과목 단위)에서 **오답 경로가 통째로 막힌다.**
 *
 * ⚠ 코드(C/B/M/S/T)는 여기서 정하지 않는다 — 앱이 아는 것은 "못 떠올렸다"뿐이고 분류는 사람이
 * 고른다. `insights.ts` 가 _"LLM 자동 CBMS 분류가 조용한 오분류로 드롭됐다"_ 고 못박은 경계다.
 */
export function missTarget(item: RunCard): { sid: string; name: string; chapter: string } {
  if (item.kind === 'chapter') return { sid: item.ch.sid, name: item.ch.subject, chapter: item.ch.chapter };
  if (item.kind === 'confident')
    return { sid: item.card.cbms.sid, name: item.card.cbms.name, chapter: item.card.cbms.chapter || '' };
  return { sid: item.card.summary.sid, name: item.card.summary.name, chapter: '' };
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

/* ── 이어하기 커서 판정(N-7) ─────────────────────────────────────────────────
   ⚠⚠ **이 규칙이 lib 에 있는 이유는 커서가 단방향이었기 때문이다**(2026-08-20 리뷰 M-10).

   커서 **쓰기**가 데스크톱 러너에만 있었다(전 저장소 `writeResume` 호출부 셋 중 러너는 하나).
   그런데 폰은 커서를 **읽는다**(`phone/PhoneApp` 이 `startAt` 으로 넘긴다). 결과가 둘:

   ① 폰에서 7장 하고 PC 를 열면 **0장부터** 연다 — `lib/resume.ts` 가 이 기능의 존재 이유로 든
      *"틀리면 같은 걸 두 번 한다"* 를 기능이 절반만 막았다.
   ② 폰에서 **끝내도** `dropResume()` 이 안 돌아 커서가 TTL(6시간) 동안 살아남는다 → PC·폰 홈에
      `이어하기 (7/12)` 유령 칩이 뜨고, 누르면 이미 끝낸 큐의 7번째로 착지한다.

   둘 다 **무증상으로 진행된다** — 화면 어디에도 "커서가 한쪽만 쓴다"는 사실이 없다.
   판정을 여기 두면 두 러너가 같은 규칙을 쓰고, 한쪽만 고쳐지는 일이 구조적으로 사라진다.
   ⚠ IO(`writeResume`/`dropResume`)는 여전히 호출부 몫이다 — `lib` 은 store 를 모른다. */

/** 커서를 몇 장마다 쓰나. ⚠ 카드마다 쓰면 한 세션이 아웃박스에 12행을 남기고, 그 12행이 말하는
 *  것은 같은 한 가지("복습 중")다. */
export const RESUME_EVERY = 5;

export type CursorOp = { kind: 'write'; progress: string } | { kind: 'drop' } | null;

/**
 * `idx` 번째 카드를 넘긴 **직후** 커서를 어떻게 할지.
 *
 * @param idx  방금 넘긴 카드의 0-based 인덱스
 * @param len  큐 길이
 *
 * · 마지막 장을 넘겼으면 **drop**(유령 칩 방지 — 위 ②).
 * · 그 전이고 `RESUME_EVERY` 의 배수면 **write**(진행 표기는 *다음* 카드 기준).
 * · 그 외엔 아무것도 안 한다.
 */
export function cursorOp(idx: number, len: number): CursorOp {
  const next = idx + 1;
  if (next >= len) return { kind: 'drop' };
  if (next % RESUME_EVERY === 0) return { kind: 'write', progress: `${next + 1}/${len}` };
  return null;
}

/** 이어하기로 들어왔을 때의 착지 인덱스 — 큐가 줄었어도 범위를 벗어나지 않는다.
 *  ⚠ 두 러너가 **글자 그대로 같은 식**을 각자 들고 있었다(M-10). 한 곳이 정본이다. */
export function landingIndex(startAt: number, len: number): number {
  return Math.max(0, Math.min(startAt, Math.max(0, len - 1)));
}
