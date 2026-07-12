/* ============================================================
   statsView.test.ts — 통계 뷰모델 순수 로직(임계값·미래 마스킹·집계).
============================================================ */
import { describe, expect, it } from 'vitest';
import { buildStreakGrid, streakLevel } from '@/lib/statsView';
import type { AppState } from '@/lib/types';

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
