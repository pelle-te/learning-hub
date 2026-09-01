/* ============================================================
   statsView.test.ts — 통계 뷰모델 순수 로직(임계값·미래 마스킹·집계).
============================================================ */
import { describe, expect, it } from 'vitest';
import { buildStreakGrid, radarPoint, radarPolygon, radarRing, streakLevel, type RadarGeom } from '@/lib/statsView';
import type { AppState } from '@/lib/schema';

describe('streakLevel — 강도 임계값(30·60·120)', () => {
  it('경계값을 정확히 가른다', () => {
    expect(streakLevel(0)).toBe(0);
    expect(streakLevel(1)).toBe(1);
    expect(streakLevel(29)).toBe(1);
    expect(streakLevel(30)).toBe(2);
    expect(streakLevel(59)).toBe(2);
    expect(streakLevel(60)).toBe(3);
    expect(streakLevel(119)).toBe(3);
    expect(streakLevel(120)).toBe(4);
  });
});

describe('buildStreakGrid', () => {
  const base = (comp: AppState['completions']): AppState =>
    ({ _today: '2026-06-24', completions: comp }) as unknown as AppState; // 2026-06-24 = 수요일

  it('weeks × 7 그리드를 만든다', () => {
    const g = buildStreakGrid(base({}), 4);
    expect(g.cols.length).toBe(4);
    expect(g.cols.every((c) => c.length === 7)).toBe(true);
  });

  it('오늘 이후 날짜는 v=l=-1로 마스킹', () => {
    const g = buildStreakGrid(base({}), 4);
    const future = g.cols.flat().filter((c) => c.ds > '2026-06-24');
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((c) => c.v === -1 && c.l === -1)).toBe(true);
  });

  it('완료분을 합산해 activeDays·totalMin·레벨을 계산', () => {
    const g = buildStreakGrid(
      base({
        '2026-06-22': { s1: { done: true, min: 40 }, s2: { done: true, min: 30 } }, // 70분 → lvl3
        '2026-06-23': { s1: { done: true, min: 20 } }, // 20분 → lvl1
        '2026-06-20': { s1: { done: false, min: 90 } }, // 미완료 → 0
      }),
      4,
    );
    expect(g.activeDays).toBe(2);
    expect(g.totalMin).toBe(90);
    const c22 = g.cols.flat().find((c) => c.ds === '2026-06-22')!;
    expect(c22.v).toBe(70);
    expect(c22.l).toBe(3);
    const c20 = g.cols.flat().find((c) => c.ds === '2026-06-20')!;
    expect(c20.v).toBe(0);
    expect(c20.l).toBe(0);
  });

  it('월이 바뀌는 열에만 월 라벨을 붙인다', () => {
    const g = buildStreakGrid(base({}), 8);
    const labeled = g.monthLabels.filter(Boolean);
    expect(labeled.length).toBeGreaterThanOrEqual(1);
    expect(labeled.every((l) => /^\d+월$/.test(l))).toBe(true);
  });
});

/* 레이더 기하 — 한때 Stats.tsx 안 클로저(pt/ring/poly)라 테스트가 불가능했다.
   그 파일에서 유일하게 자명하지 않은 계산이었는데도. lib으로 옮기며 계약을 잠근다. */
describe('레이더(CBMS 분포) 기하', () => {
  const g: RadarGeom = { cx: 100, cy: 100, r: 50, n: 5 };

  it('첫 축은 12시 방향(중심 바로 위)에서 시작한다', () => {
    const [x, y] = radarPoint(0, g.r, g);
    expect(x).toBeCloseTo(100, 5);
    expect(y).toBeCloseTo(50, 5); // cy - r
  });

  it('축은 n등분되어 한 바퀴를 돈다(i=n이면 i=0과 같은 자리)', () => {
    const [x0, y0] = radarPoint(0, g.r, g);
    const [xn, yn] = radarPoint(g.n, g.r, g);
    expect(xn).toBeCloseTo(x0, 5);
    expect(yn).toBeCloseTo(y0, 5);
  });

  it('ring(f)는 반지름 비율 f의 정n각형 — 모든 꼭짓점이 중심에서 f·r 거리', () => {
    const pts = radarRing(0.5, g)
      .split(' ')
      .map((p) => p.split(',').map(Number) as [number, number]);
    expect(pts).toHaveLength(5);
    for (const [x, y] of pts) {
      expect(Math.hypot(x - g.cx, y - g.cy)).toBeCloseTo(25, 1); // 0.5 * 50
    }
  });

  it('polygon은 최대값을 바깥 링에 맞춰 정규화한다', () => {
    const pts = radarPolygon([1, 2, 4, 0, 0], g)
      .split(' ')
      .map((p) => p.split(',').map(Number) as [number, number]);
    const dist = (i: number) => Math.hypot(pts[i]![0] - g.cx, pts[i]![1] - g.cy);
    expect(dist(2)).toBeCloseTo(50, 1); // 최대(4) → r
    expect(dist(1)).toBeCloseTo(25, 1); // 2/4 → r/2
    expect(dist(3)).toBeCloseTo(0, 1); // 0 → 중심
  });

  it('값이 전부 0이어도 0으로 나누지 않고 중심에 수렴한다', () => {
    const pts = radarPolygon([0, 0, 0, 0, 0], g);
    expect(pts).not.toContain('NaN');
    for (const p of pts.split(' ')) {
      const [x, y] = p.split(',').map(Number) as [number, number];
      expect(Math.hypot(x - g.cx, y - g.cy)).toBeCloseTo(0, 5);
    }
  });
});
