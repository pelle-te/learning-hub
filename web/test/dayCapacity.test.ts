/* ============================================================
   dayCapacity.test.ts — "오늘 안에 들어가는가"의 단일 판정(W6).
   E9(오늘 밖 접기)의 회귀망을 여기로 옮겨 왔고, 새로 잠그는 것은 **여유 방향의 문장**이다:
   매일 "N개는 오늘 밖"만 말하면 E9 가 없앤 실패감을 히어로 크기로 되살린다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { dayCapacity } from '@/lib/dayCapacity';
import { untimedChoreMin } from '@/lib/tasks';
import type { AppState } from '@/lib/schema';

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

/* ── 7-I4 할 일이 창을 먼저 깎는다 ────────────────────────────────────────── */
/* ── A-11(W7) — **실측 배율을 아침 판정 문장에** ─────────────────────────────────────
   배율은 과목 상세에만 있었고 오늘 화면과 연결이 0이었다: 앱이 "내 추정이 20% 낙관적"임을
   알면서 아침에 한 번도 말하지 않았다. 여기서 잠그는 것 셋 —
   ① 배율이 문장에 실제로 들어간다 ② **±5% 안쪽은 말하지 않는다**(잡음을 신호로 올리지 않는다)
   ③ `slackMin` 을 **덮지 않는다**(계획된 여유와 보정 여유는 다른 값이다). */
describe('A-11 실측 배율 — 아침 문장이 그것을 말한다', () => {
  const blocks = [{ key: 'a', start: 540, min: 120, done: false, name: 'A' }];

  it('낙관적이었으면(배율>1) 모자란다고 말한다', () => {
    const c = dayCapacity(blocks, 150, 0, 1.4);
    expect(c.calibratedSlackMin).toBe(150 - 168);
    expect(c.fitLine).toContain('실측대로면');
    expect(c.fitLine).toContain('모자람');
  });

  it('덜 걸렸으면(배율<1) 여유를 말한다', () => {
    const c = dayCapacity(blocks, 150, 0, 0.7);
    expect(c.calibratedSlackMin).toBe(150 - 84);
    expect(c.fitLine).toContain('실측대로면 여유');
  });

  it('⭐ ±5% 안쪽은 **말하지 않는다** — 잡음을 아침 문장에 얹으면 그 문장 전체가 안 믿긴다', () => {
    const c = dayCapacity(blocks, 150, 0, 1.03);
    expect(c.calibratedSlackMin).toBeNull();
    expect(c.fitLine).not.toContain('실측');
  });

  it('배율이 없으면(표본 부족) 종전 문장 그대로다', () => {
    expect(dayCapacity(blocks, 150, 0, null).fitLine).toBe(dayCapacity(blocks, 150).fitLine);
  });

  it('`slackMin` 을 덮지 않는다 — 계획된 여유와 보정 여유는 다른 값이다', () => {
    const c = dayCapacity(blocks, 150, 0, 1.4);
    expect(c.slackMin).toBe(30);
    expect(c.calibratedSlackMin).not.toBe(c.slackMin);
  });

  it('할 것이 없으면 배율이 있어도 조용하다(없는 일에 판정을 붙이지 않는다)', () => {
    expect(dayCapacity([], 150, 0, 1.4).calibratedSlackMin).toBeNull();
  });
});

describe('7-I4 choreMin — 할 일도 하루를 먹는다', () => {
  const blocks = [{ key: 'a', start: 540, min: 120, done: false }];

  it('창에서 **먼저** 뺀다 — 시각 없는 할 일도 하루를 먹기 때문', () => {
    const before = dayCapacity(blocks, 240);
    const after = dayCapacity(blocks, 240, 60);
    expect(before.slackMin).toBe(120);
    expect(after.slackMin).toBe(60); // 240-60 창에서 120 계획
  });

  it('⭐ 깎였으면 **그 사실을 말한다** — 조용히 줄면 왜 여유가 없는지 못 읽는다', () => {
    expect(dayCapacity(blocks, 240, 60).fitLine).toContain('할 일');
    expect(dayCapacity(blocks, 240, 0).fitLine).not.toContain('할 일');
  });

  it('할 일이 창을 넘겨도 창은 음수가 안 된다(막대 축척이 뒤집힌다)', () => {
    const cap = dayCapacity(blocks, 60, 999);
    expect(cap.slackMin).toBe(-120); // 창 0 · 계획 120 → 초과 판정은 살아 있다
    expect(cap.scaleMin).toBeGreaterThan(0);
  });

  it('기본값 0 — 기존 호출부는 한 글자도 안 바뀐다', () => {
    expect(dayCapacity(blocks, 240)).toEqual(dayCapacity(blocks, 240, 0));
  });
});

/* ⚠ 옛 이름은 `choreMinForDay`(시각 유무를 안 가리는 총합)였고 **W8 에서 지웠다** — N-1 이
   시각 박힌 과제를 창에서 *구간*으로 빼기 시작해, 그 총합을 쓰면 두 번 깎인다. 여기서 잠그는
   성질(소요를 적은 미완만 · 그날 것만)은 그대로다. */
describe('7-I4 untimedChoreMin — 무엇을 세고 무엇을 안 세나', () => {
  const st = (tasks: unknown[]): AppState => ({ tasks }) as unknown as AppState;

  it('소요를 적은 미완 할 일만 센다', () => {
    const s = st([
      { id: '1', title: 'a', ds: '2026-08-07', min: 60 },
      { id: '2', title: 'b', ds: '2026-08-07', min: 30, done: true }, // 완료 → 이미 지나간 시간
      { id: '3', title: 'c', ds: '2026-08-07' }, // 소요 미기재 → 추측하지 않는다
      { id: '4', title: 'd', ds: '2026-08-08', min: 90 }, // 다른 날
    ]);
    expect(untimedChoreMin(s, '2026-08-07')).toBe(60);
  });

  it('할 일이 없으면 0(창을 안 건드린다)', () => {
    expect(untimedChoreMin(st([]), '2026-08-07')).toBe(0);
  });
});
