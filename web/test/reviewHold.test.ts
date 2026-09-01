/* ============================================================
   reviewHold.test.ts — **복습 보류 선반**(P-11 · 2026-08-01).

   잠그는 것은 하나다: `건너뛰기` 가 아무것도 안 써서 밀린 챕터가 **내일 그대로 돌아오던**
   구조가 실제로 끊겼는가. 그리고 그 끊김이 **되돌릴 수 있는가**(P-9 와 같은 규칙).
============================================================ */
import { describe, it, expect } from 'vitest';
import { holdKey, isHeld, holdReview, releaseReview, heldReviews, snoozeReview, reviewPause } from '@/lib/reviewHold';
import type { AppState } from '@/lib/schema';

const st = (over: Partial<AppState> = {}): AppState =>
  ({ items: [{ id: 's1', name: '회로이론', mode: 'weekly', chapters: [] }], ...over }) as unknown as AppState;

describe('reviewHold', () => {
  it('앵커 키가 reviewTouches 와 같은 형태다(같은 대상을 가리키는 두 기록)', () => {
    expect(holdKey('s1', '3장')).toBe('s1|3장');
  });

  it('빼면 걸리고 되돌리면 풀린다', () => {
    const s = st();
    expect(isHeld(s, 's1', '3장')).toBe(false);
    holdReview(s, 's1', '3장', '2026-08-01');
    expect(isHeld(s, 's1', '3장')).toBe(true);
    releaseReview(s, 's1', '3장');
    expect(isHeld(s, 's1', '3장')).toBe(false);
  });

  it('두 번 빼도 날짜를 덮지 않는다 — "언제 뺐나"는 첫 결정의 날짜다', () => {
    const s = st();
    holdReview(s, 's1', '3장', '2026-07-20');
    holdReview(s, 's1', '3장', '2026-08-01');
    expect(s.reviewHold!['s1|3장']).toBe('2026-07-20');
  });

  it('선반은 최근에 뺀 것부터 · 없어진 과목도 남는다(안 남기면 되돌릴 수 없다)', () => {
    const s = st({ reviewHold: { 's1|3장': '2026-07-20', 's1|5장': '2026-08-01', 'gone|1장': '2026-07-25' } });
    const list = heldReviews(s);
    expect(list.map((h) => h.chapter)).toEqual(['5장', '1장', '3장']);
    expect(list[0]!.name).toBe('회로이론');
    expect(list.find((h) => h.sid === 'gone')!.name).toBeNull();
  });

  it('챕터 이름에 `|` 가 들어가도 sid 를 잃지 않는다', () => {
    const s = st({ reviewHold: { 's1|a|b': '2026-08-01' } });
    expect(heldReviews(s)[0]).toMatchObject({ sid: 's1', chapter: 'a|b' });
  });
});

/* ============================================================
   I040 — **「오늘은 빼기」**(2026-08-22 발상 축).

   미루기가 하나뿐이라 *영구 포기*와 *하루 미룸*이 같은 버튼이었다. 여기서 잠그는 것 넷:
   ① 스누즈는 **그 날짜에만** 유효하다(자정에 스스로 풀린다 — 되돌리기가 없는 대가)
   ② **배타** — 「당분간」이 이긴다. 두 술어를 호출부가 조합하면 「오늘만 미뤘는데 선반에도 뜨는」
      상태가 생기고, 그건 P-11 이 세운 «두 개의 다른 버리기를 만들지 않는다»의 위반이다
   ③ 스누즈는 **덮어쓴다**(hold 와 반대) — 「오늘」의 뜻은 가장 최근 오늘이다
   ④ 선반(`heldReviews`)에는 **스누즈가 안 뜬다** — 되돌릴 것이 없는 항목을 되돌리기 목록에
      올리면 그게 유령 버튼이다
============================================================ */
describe('I040 — 오늘은 빼기(스누즈)', () => {
  it('오늘 미룬 것은 오늘만 빠진다 — 내일은 그대로 온다', () => {
    const s = st();
    snoozeReview(s, 's1', '3장', '2026-08-22');
    expect(reviewPause(s, 's1', '3장', '2026-08-22')).toBe('snoozed');
    expect(reviewPause(s, 's1', '3장', '2026-08-23')).toBeNull();
  });

  it('⚠⚠ 배타 — 「당분간」이 이기고, 「당분간」을 누르면 스누즈가 흡수된다', () => {
    const s = st();
    snoozeReview(s, 's1', '3장', '2026-08-22');
    holdReview(s, 's1', '3장', '2026-08-22');
    expect(reviewPause(s, 's1', '3장', '2026-08-22')).toBe('held');
    expect(s.reviewSnooze?.[holdKey('s1', '3장')]).toBeUndefined();
  });

  it('⚠ 이미 「당분간」이면 하루 미룸은 아무것도 안 한다', () => {
    const s = st();
    holdReview(s, 's1', '3장', '2026-08-20');
    snoozeReview(s, 's1', '3장', '2026-08-22');
    expect(s.reviewSnooze?.[holdKey('s1', '3장')]).toBeUndefined();
    expect(isHeld(s, 's1', '3장')).toBe(true);
  });

  it('스누즈는 덮어쓴다 — 「오늘」의 뜻은 가장 최근 오늘이다(hold 와 반대)', () => {
    const s = st();
    snoozeReview(s, 's1', '3장', '2026-08-22');
    snoozeReview(s, 's1', '3장', '2026-08-23');
    expect(s.reviewSnooze?.[holdKey('s1', '3장')]).toBe('2026-08-23');
  });

  it('⚠ 선반에는 스누즈가 안 뜬다 — 되돌릴 것이 없는 항목의 되돌리기 버튼은 유령이다', () => {
    const s = st();
    snoozeReview(s, 's1', '3장', '2026-08-22');
    expect(heldReviews(s)).toEqual([]);
  });

  it('쓰는 김에 낡은 것을 턴다 — 별도 청소 호출처를 두면 그중 하나가 반드시 빠진다', () => {
    const s = st();
    snoozeReview(s, 's1', '3장', '2026-08-20');
    snoozeReview(s, 's1', '4장', '2026-08-22');
    expect(Object.keys(s.reviewSnooze ?? {})).toEqual([holdKey('s1', '4장')]);
  });

  it('릴리스는 「당분간」만 푼다(스누즈는 자기 만료가 있다)', () => {
    const s = st();
    holdReview(s, 's1', '3장', '2026-08-20');
    releaseReview(s, 's1', '3장');
    expect(reviewPause(s, 's1', '3장', '2026-08-22')).toBeNull();
  });
});
