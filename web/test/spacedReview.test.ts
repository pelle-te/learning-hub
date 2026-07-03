/* ============================================================
   spacedReview.test.ts — 개념(챕터) 간격반복 위험 + freeMinAfter(홈 헬퍼) 회귀.
============================================================ */
import { describe, expect, it } from 'vitest';
import { chapterReviews, riskChapters, riskOf, riskSummary } from '@/lib/spacedReview';
import { freeMinAfter } from '@/lib/scheduler';
import type { AppState, Day, ScheduleItem } from '@/lib/types';

const TODAY = '2026-07-04';

const newIt = (sid: string, name: string, chapters: string[]): ScheduleItem => ({
  type: 'new',
  sid,
  name,
  min: 120,
  chapters,
  color: '#0f0',
});
const day = (ds: string, items: ScheduleItem[]): Day =>
  ({ ds, date: new Date(ds + 'T00:00:00'), wd: 0, studyMin: 0, used: 0, modLeft: 0, revLeft: 0, items }) as Day;

function stateWith(done: [string, string, string][]): AppState {
  const completions: Record<string, Record<string, { done: boolean; min: number }>> = {};
  for (const [ds, sid, type] of done) {
    (completions[ds] = completions[ds] || {})[sid + '|' + type] = { done: true, min: 60 };
  }
  return { items: [], completions } as unknown as AppState;
}

describe('spacedReview — riskOf 임계(REVIEW_OFFSETS 16/7 정렬)', () => {
  it('16↑ overdue, 7↑ due, 그 외 fresh', () => {
    expect(riskOf(16)).toBe('overdue');
    expect(riskOf(20)).toBe('overdue');
    expect(riskOf(7)).toBe('due');
    expect(riskOf(15)).toBe('due');
    expect(riskOf(6)).toBe('fresh');
    expect(riskOf(0)).toBe('fresh');
  });
});

describe('spacedReview — chapterReviews', () => {
  const days = [
    day('2026-06-18', [newIt('m', '수학', ['1장'])]), // age 16 → overdue (완료)
    day('2026-06-25', [newIt('m', '수학', ['4장'])]), // 미완료 → 제외
    day('2026-06-26', [newIt('m', '수학', ['5장'])]), // age 8 → due (완료)
    day('2026-06-30', [newIt('m', '수학', ['2장'])]), // age 4 → fresh (완료)
    day('2026-07-04', [newIt('p', '물리', ['역학'])]), // 오늘 → fresh (완료)
    day('2026-07-10', [newIt('m', '수학', ['3장'])]), // 미래 → 무시(완료여도)
  ];
  const state = stateWith([
    ['2026-06-18', 'm', 'new'],
    ['2026-06-26', 'm', 'new'],
    ['2026-06-30', 'm', 'new'],
    ['2026-07-04', 'p', 'new'],
    ['2026-07-10', 'm', 'new'],
  ]);

  it('완료 세션만·미래 제외·경과일/위험 계산', () => {
    const revs = chapterReviews(state, days, TODAY);
    const byCh = Object.fromEntries(revs.map((r) => [r.chapter, r]));
    expect(byCh['4장']).toBeUndefined(); // 미완료
    expect(byCh['3장']).toBeUndefined(); // 미래
    expect(byCh['1장']!.daysSince).toBe(16);
    expect(byCh['1장']!.risk).toBe('overdue');
    expect(byCh['5장']!.risk).toBe('due');
    expect(byCh['2장']!.risk).toBe('fresh');
    expect(byCh['역학']!.daysSince).toBe(0);
    // 위험 큰 순 정렬(첫 항목 = 가장 오래됨)
    expect(revs[0]!.chapter).toBe('1장');
  });

  it('riskChapters = due/overdue만, riskSummary 집계', () => {
    const risky = riskChapters(state, days, TODAY);
    expect(risky.map((r) => r.chapter)).toEqual(['1장', '5장']);
    expect(riskSummary(state, days, TODAY)).toEqual({ overdue: 1, due: 1 });
  });

  it('마지막으로 만진 날 = 여러 세션 중 최신', () => {
    const days2 = [day('2026-06-20', [newIt('m', '수학', ['1장'])]), day('2026-07-02', [newIt('m', '수학', ['1장'])])];
    const s2 = stateWith([
      ['2026-06-20', 'm', 'new'],
      ['2026-07-02', 'm', 'new'],
    ]);
    const revs = chapterReviews(s2, days2, TODAY);
    expect(revs).toHaveLength(1);
    expect(revs[0]!.lastDs).toBe('2026-07-02');
    expect(revs[0]!.daysSince).toBe(2);
  });
});

describe('scheduler — freeMinAfter(now 이후 남은 자유시간)', () => {
  const free: [number, number][] = [
    [540, 600], // 09:00–10:00
    [900, 1080], // 15:00–18:00
  ];
  it('now가 창 중간이면 남은 뒷부분만', () => {
    expect(freeMinAfter(free, 570)).toBe(30 + 180); // 09:30 이후
  });
  it('now가 모든 창 뒤면 0', () => {
    expect(freeMinAfter(free, 1200)).toBe(0);
  });
  it('now가 하루 시작이면 전부', () => {
    expect(freeMinAfter(free, 0)).toBe(60 + 180);
  });
});
