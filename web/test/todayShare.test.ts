/* ============================================================
   todayShare.test.ts — **적재량이 아니라 오늘 몫**(A-10 · W7).

   여기서 잠그는 명제 하나: **0을 만들 수 있는 수만 보여 준다.** 화면이 `12` 를 들이밀면 그
   12는 어떤 행동으로도 오늘 안에 0이 될 수 없고, 그건 목표가 아니라 마비다(알림 A-1 이 같은
   이유로 수를 버렸는데 화면만 남아 있었다).
============================================================ */
import { describe, expect, it } from 'vitest';
import { shareLine, todayShare } from '@/lib/todayShare';

const REV = 30; // 복습 1블록 30분

describe('todayShare — 오늘 들어가는 만큼만 센다', () => {
  it('남은 시간이 90분이면 3칸 — 적재량 12여도 오늘 몫은 3이다', () => {
    const s = todayShare({ overdue: 12, backlog: 4, freeLeftMin: 90, reviewMin: REV });
    expect(s.slots).toBe(3);
    expect(s.review.today).toBe(3);
    expect(s.review.total).toBe(12); // 적재량은 **버리지 않는다**(상세가 쓴다)
    expect(s.backlog.today).toBe(0); // 복습이 시간을 먼저 가져간다
  });

  it('복습이 다 들어가고 남으면 보충이 이어 받는다', () => {
    const s = todayShare({ overdue: 1, backlog: 5, freeLeftMin: 90, reviewMin: REV });
    expect(s.review.today).toBe(1);
    expect(s.backlog.today).toBe(2);
  });

  it('시간이 없으면 오늘 몫은 0이다 — 지어내지 않는다', () => {
    const s = todayShare({ overdue: 9, backlog: 9, freeLeftMin: 0, reviewMin: REV });
    expect(s.slots).toBe(0);
    expect(s.review.today).toBe(0);
    expect(s.backlog.today).toBe(0);
  });

  it('블록 길이가 0이어도 나눗셈이 터지지 않는다(칸 0)', () => {
    expect(todayShare({ overdue: 3, backlog: 0, freeLeftMin: 60, reviewMin: 0 }).slots).toBe(0);
  });

  it('음수 입력은 0으로 접는다 — 원장이 이상해도 화면은 정상 문장을 낸다', () => {
    const s = todayShare({ overdue: -3, backlog: -1, freeLeftMin: -60, reviewMin: REV });
    expect(s.review).toEqual({ today: 0, total: 0 });
    expect(s.backlog).toEqual({ today: 0, total: 0 });
  });
});

describe('shareLine — 수는 오늘 몫만 쓴다(A-1 과 같은 화법)', () => {
  const line = (o: number, b: number, free: number): string | null =>
    shareLine(todayShare({ overdue: o, backlog: b, freeLeftMin: free, reviewMin: REV }));

  it('말할 것이 없으면 문장도 없다', () => {
    expect(line(0, 0, 120)).toBeNull();
  });

  it('⭐ 적재량이 커도 **그 수를 안 쓴다** — 이 항목의 전부', () => {
    const t = line(12, 4, 90)!;
    expect(t).toContain('3개');
    expect(t).not.toContain('12');
    expect(t).not.toContain('16');
  });

  it('시간이 없으면 수 대신 사정을 말한다(마비를 만들지 않는다)', () => {
    expect(line(12, 0, 0)).toBe('오늘은 시간이 없어요 — 남은 건 내일 몫');
  });

  it('다 들어가면 "끝"이라고 말한다 — 남은 것이 있을 때와 문장이 다르다', () => {
    expect(line(2, 0, 120)).toContain('끝');
    expect(line(9, 0, 120)).toContain('충분');
  });
});
