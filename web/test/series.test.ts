/* ============================================================
   series.test.ts — T-14 데이터워드 · T-21 지층 · T-23 작은 배수의 **공통 판정**.

   ⚠ 여기서 잠그는 것은 세 가지이고 전부 "안 그리는 조건"이다:
   - **점이 모자라면 `null`.** _"3점 이하면 스파크는 거짓말"_ 이 이 상수의 근거다.
   - **꼬리의 0 은 점이 아니다.** 미래 주를 0 으로 채우면 모든 스파크가 우하향한다 —
     데이터가 아니라 달력이 만든 모양이다.
   - **공유 척도.** 계열마다 자기 최댓값으로 정규화하면 전부 천장에 닿아 비교가 불가능해진다
     (= 작은 배수가 아니라 그냥 작은 차트 여러 개).
============================================================ */
import { describe, expect, it } from 'vitest';
import { MIN_POINTS, sharedMax, strata, weekSeries, weekTotals, type WeekMatrix } from '@/lib/series';

/** n주짜리 행렬 — 값은 인자로 준다. 주 키는 사전순=시간순이 되게 만든다. */
const mat = (vals: Record<string, number[]>): WeekMatrix => {
  const len = Math.max(...Object.values(vals).map((v) => v.length));
  const m: WeekMatrix = {};
  for (let i = 0; i < len; i += 1) {
    const wk = `2026-01-${String(i + 1).padStart(2, '0')}`;
    m[wk] = {};
    for (const [k, v] of Object.entries(vals)) m[wk]![k] = v[i] ?? 0;
  }
  return m;
};

describe('weekSeries', () => {
  it('점이 모자라면 null — 두 점을 이은 선은 추세가 아니다', () => {
    expect(weekSeries(mat({ a: [1, 2, 3] }), 'a')).toBeNull();
  });
  it('충분하면 시간순 배열을 준다', () => {
    const xs = Array.from({ length: MIN_POINTS }, (_, i) => i + 1);
    expect(weekSeries(mat({ a: xs }), 'a')).toEqual(xs);
  });
  it('꼬리의 0 을 잘라낸다 — 안 자르면 모든 스파크가 우하향한다', () => {
    const xs = [...Array.from({ length: MIN_POINTS }, (_, i) => i + 1), 0, 0, 0];
    expect(weekSeries(mat({ a: xs }), 'a')).toHaveLength(MIN_POINTS);
  });
  it('꼬리를 자른 뒤 모자라면 null — 자르기가 판정을 우회하지 않는다', () => {
    expect(weekSeries(mat({ a: [1, 2, 0, 0, 0, 0, 0, 0] }), 'a')).toBeNull();
  });
  it('중간의 0 은 진짜 0 이다(그 주에 안 했다)', () => {
    const xs = [1, 0, 3, 0, 5, 6];
    expect(weekSeries(mat({ a: xs }), 'a')).toEqual(xs);
  });
  it('없는 대상은 전부 0 → 잘려서 null', () => {
    expect(weekSeries(mat({ a: [1, 2, 3, 4, 5, 6] }), '없음')).toBeNull();
  });
});

describe('weekTotals', () => {
  it('전 대상 합계를 시간순으로', () => {
    const m = mat({ a: [1, 1, 1, 1, 1, 1], b: [2, 2, 2, 2, 2, 2] });
    expect(weekTotals(m)).toEqual([3, 3, 3, 3, 3, 3]);
  });
});

describe('strata', () => {
  it('6주 미만이면 null — 3주짜리 띠는 지층이 아니라 막대 세 개다', () => {
    expect(strata(mat({ a: [1, 2, 3] }), ['a'])).toBeNull();
  });
  it('충분하면 주마다 층을 준다 · 합이 0 인 주도 남긴다(쉰 주도 지층의 일부)', () => {
    const rows = strata(mat({ a: [1, 0, 1, 1, 1, 1], b: [1, 0, 1, 1, 1, 1] }), ['a', 'b'])!;
    expect(rows).toHaveLength(6);
    expect(rows[1]!.total).toBe(0);
    expect(rows[0]!.parts.map((p) => p.key)).toEqual(['a', 'b']); // 층 순서는 인자 그대로
  });
  it('뒤쪽 빈 주를 자른다 — 안 자르면 학기 초에 오른쪽 절반이 비어 "무너지는 중"으로 보인다', () => {
    const rows = strata(mat({ a: [1, 1, 1, 1, 1, 1, 0, 0] }), ['a'])!;
    expect(rows).toHaveLength(6);
  });
});

describe('sharedMax', () => {
  it('여러 계열의 공통 천장 — 이게 없으면 작은 배수가 아니다', () => {
    expect(sharedMax([[1, 2], [9], null])).toBe(9);
  });
  it('전부 0/빈이면 1 — 0 으로 나누지 않는다', () => {
    expect(sharedMax([null, [0, 0]])).toBe(1);
  });
});
