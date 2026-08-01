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

/* ── P-7 막대 축척 ────────────────────────────────────────────────────────────
   여기서 잠그는 것 하나: **분모가 창이 아니라 둘 중 큰 값**이라는 것. 창으로 나누면 초과분이
   100% 에서 잘려 *넘쳤다는 사실 자체가 안 보이고*, 그건 이 앱이 `beyondKeys` 를 조용히 필터로
   지우던 실패를 그래픽으로 반복하는 것이다. */
describe('막대 축척 — 넘친 것이 잘리지 않는다', () => {
  it('남은 계획이 창보다 크면 축척은 계획 쪽이다(초과분이 밖으로 삐져나온다)', () => {
    const r = dayCapacity([b('a', 540, 120), b('b', 720, 120)], 100);
    expect(r.scaleMin).toBe(240);
    expect(r.windowRatio).toBeCloseTo(100 / 240);
  });

  it('여유가 있으면 축척은 창이고 막대 끝에 빈 자리가 남는다', () => {
    const r = dayCapacity([b('a', 540, 60)], 300);
    expect(r.scaleMin).toBe(300);
    expect(r.windowRatio).toBe(1);
  });

  it('칸은 시각 순이고 beyondKeys 와 같은 규칙으로 갈린다(막대와 레일이 다른 말을 하지 않는다)', () => {
    const r = dayCapacity([b('c', 900, 60), b('a', 540, 120), b('b', 720, 120)], 150);
    expect(r.segments.map((s) => s.key)).toEqual(['a', 'b', 'c']);
    expect(r.segments.filter((s) => s.beyond).map((s) => s.key)).toEqual([...r.beyondKeys]);
  });

  it('그릴 것이 없으면 축척이 0이다(호출부가 그걸로 안 그린다를 판정한다)', () => {
    expect(dayCapacity([], 0).scaleMin).toBe(0);
    expect(dayCapacity([], 0).windowRatio).toBe(0);
  });
});

describe('Q-2 slackMin — 44px 앵커의 값', () => {
  const blk = (key: string, start: number, min: number, done = false) => ({ key, start, min, done, name: key });

  it('할 것이 없으면 null — fitLine 과 **같은 조건**이다(여유 0 과 구분)', () => {
    const c = dayCapacity([], 300);
    expect(c.slackMin).toBeNull();
    expect(c.fitLine).toBeNull();
  });

  it('남은 창 - 남은 계획 = 여유(양수)', () => {
    const c = dayCapacity([blk('a', 540, 120)], 300);
    expect(c.slackMin).toBe(180);
  });

  it('초과하면 **음수**다 — 0 으로 깎지 않는다(넘쳤다는 사실이 값에 남아야 한다)', () => {
    const c = dayCapacity([blk('a', 540, 240), blk('b', 700, 240)], 300);
    expect(c.slackMin).toBe(-180);
    expect(c.beyondKeys.size).toBeGreaterThan(0);
  });

  it('완료된 블록은 남은 계획에서 빠진다', () => {
    const c = dayCapacity([blk('a', 540, 120, true), blk('b', 700, 60)], 300);
    expect(c.slackMin).toBe(240);
  });
});
