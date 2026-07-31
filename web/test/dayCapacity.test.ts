/* ============================================================
   dayCapacity.test.ts — "오늘 안에 들어가는가"의 단일 판정(W6).
   E9(오늘 밖 접기)의 회귀망을 여기로 옮겨 왔고, 새로 잠그는 것은 **여유 방향의 문장**이다:
   매일 "N개는 오늘 밖"만 말하면 E9 가 없앤 실패감을 히어로 크기로 되살린다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { dayCapacity } from '@/lib/dayCapacity';

const b = (key: string, start: number | null, min: number, done = false) => ({ key, start, min, done });

describe('오늘 밖 접기 — 남은 창을 넘는 순간부터', () => {
  it('시각 순으로 누적해 창을 넘는 블록부터 접는다', () => {
    const r = dayCapacity([b('a', 540, 120), b('b', 720, 120), b('c', 900, 120)], 200);
    expect([...r.beyondKeys]).toEqual(['b', 'c']);
    expect(r.beyondMin).toBe(240);
    expect(r.remainMin).toBe(360);
  });

  it('완료 블록은 안 센다(이미 쓴 시간은 창에서 빠져 있다 — 이중 차감 방지)', () => {
    const r = dayCapacity([b('done', 540, 120, true), b('a', 720, 60)], 90);
    expect(r.remainMin).toBe(60);
    expect(r.beyondKeys.size).toBe(0);
  });

  it('시각이 없는 블록은 순서를 못 매기므로 판정에서 빠진다', () => {
    const r = dayCapacity([b('x', null, 300)], 10);
    expect(r.remainMin).toBe(0);
    expect(r.fitLine).toBeNull();
  });
});

describe('한 줄 판정 — 여유가 있으면 여유를 먼저 말한다', () => {
  it('다 들어가면 남는 시간을 말한다(실패감을 매일 렌더하지 않는다)', () => {
    const r = dayCapacity([b('a', 540, 60)], 180);
    expect(r.fitLine).toContain('여유');
    expect(r.fitLine).not.toContain('오늘 밖');
  });

  it('안 들어가면 몇 개가 오늘 밖인지 말한다', () => {
    const r = dayCapacity([b('a', 540, 120), b('b', 720, 120)], 100);
    expect(r.fitLine).toContain('2개는 오늘 밖');
  });

  it('창이 남은 계획보다 작아도 여유는 음수로 새지 않는다', () => {
    // 창 0 = 모든 블록이 오늘 밖 → "여유 -Xh" 같은 문장이 원리적으로 안 나온다.
    expect(dayCapacity([b('a', 540, 60)], 0).fitLine).toContain('오늘 밖');
  });

  it('할 것이 없으면 아무 말도 안 한다(말할 것이 없으면 안 그린다)', () => {
    expect(dayCapacity([], 300).fitLine).toBeNull();
    expect(dayCapacity([b('done', 540, 60, true)], 300).fitLine).toBeNull();
  });
});
