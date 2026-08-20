/* ============================================================
   reviewHold.test.ts — **복습 보류 선반**(P-11 · 2026-08-01).

   잠그는 것은 하나다: `건너뛰기` 가 아무것도 안 써서 밀린 챕터가 **내일 그대로 돌아오던**
   구조가 실제로 끊겼는가. 그리고 그 끊김이 **되돌릴 수 있는가**(P-9 와 같은 규칙).
============================================================ */
import { describe, it, expect } from 'vitest';
import { holdKey, isHeld, holdReview, releaseReview, heldReviews } from '@/lib/reviewHold';

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
