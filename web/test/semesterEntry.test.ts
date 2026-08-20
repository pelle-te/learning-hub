/* ============================================================
   semesterEntry.test.ts — T-15 개강 리허설 · T-16 다음 학기 부하 시뮬.

   ⚠ 여기서 특히 잠그는 것 넷:
   - **추정의 근거를 함께 돌려준다**(`basis`). 근거 없는 수는 믿을지 판단할 수 없다.
   - **학점당 시간은 끝난 학기에서만 배운다.** 안 끝난 과목의 시간은 계획이지 실적이 아니다.
   - **리허설은 D-14 안쪽에서만 뜬다.** 그보다 이르면 잔소리다.
   - **리허설 항목은 데이터에서 충족 판정을 받는다** — 체크 상태를 저장하지 않는다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOURS_PER_CREDIT, creditRate, rehearsalSteps, simulateSemester } from '@/lib/semesterEntry';
import type { Item } from '@/lib/types';

const ch = (id: string, hours: number, done = false) => ({ id, name: id, hours, done });
const it_ = (id: string, chapters: ReturnType<typeof ch>[] = [], over: Partial<Item> = {}): Item =>
  ({ id, name: id, mode: 'weekly', chapters, ...over }) as Item;

/** 최소 AppState — `routine: []` 이면 하루 종일 가용이라 `studyMinByWeekday` 가 결정적이다
 *  (`ics.test.ts` 의 `baseState` 와 같은 관용구). */
const app = (over: Partial<AppState>): AppState =>
  ({
    startDate: '2026-06-23',
    moduleLen: 120,
    reviewRatio: 20,
    routine: [],
    dayOverrides: {},
    items: [],
    degree: { semesters: [] },
    ...over,
  }) as never;

describe('creditRate', () => {
  it('끝난 학기의 실투입에서 학점당 시간을 배운다', () => {
    const st = app({
      _today: '2026-08-02',
      items: [it_('a', [ch('c1', 30)]), it_('b', [ch('c1', 45)])],
      degree: {
        semesters: [
          {
            id: 's1',
            name: '지난',
            startDs: '2026-03-02',
            endDs: '2026-06-20',
            courses: [
              { id: 'x', name: 'A', credits: 3, category: '전공', status: 'done', itemId: 'a' },
              { id: 'y', name: 'B', credits: 3, category: '전공', status: 'done', itemId: 'b' },
            ],
          },
        ],
      } as never,
    });
    const r = creditRate(st, '2026-08-02');
    expect(r.basis).toBe('measured');
    expect(r.samples).toBe(2);
    expect(r.hoursPerCredit).toBe(12.5); // (10 + 15) / 2
  });
  it('아직 안 끝난 학기는 표본이 아니다 — 계획을 실적으로 읽지 않는다', () => {
    const st = app({
      items: [it_('a', [ch('c1', 30)])],
      degree: {
        semesters: [
          {
            id: 's1',
            name: '이번',
            startDs: '2026-07-01',
            endDs: '2026-12-20',
            courses: [{ id: 'x', name: 'A', credits: 3, category: '전공', status: 'now', itemId: 'a' }],
          },
        ],
      } as never,
    });
    const r = creditRate(st, '2026-08-02');
    expect(r.basis).toBe('default');
    expect(r.hoursPerCredit).toBe(DEFAULT_HOURS_PER_CREDIT);
  });
});

describe('simulateSemester', () => {
  const sem = {
    id: 's2',
    name: '다음',
    startDs: '2026-09-01',
    endDs: '2026-12-15',
    courses: [
      { id: 'x', name: '회로', credits: 3, category: '전공', status: 'plan', itemId: 'a' },
      { id: 'y', name: '통계', credits: 3, category: '전공', status: 'plan' },
    ],
  } as never;

  it('챕터가 있으면 챕터 시간이 근거이고, 없으면 학점 환산이다', () => {
    const st = app({ items: [it_('a', [ch('c1', 20)])], degree: { semesters: [sem] } as never });
    const sim = simulateSemester(st, sem, '2026-08-02');
    expect(sim.rows[0]).toMatchObject({ estH: 20, basis: 'chapters' });
    expect(sim.rows[1]).toMatchObject({ estH: 45, basis: 'credits' }); // 3 × 기본 15
    expect(sim.totalH).toBe(65);
  });
  it('주 수를 학기 날짜에서 파생한다 — 15주를 박아 두지 않는다', () => {
    const st = app({ items: [], degree: { semesters: [sem] } as never });
    expect(simulateSemester(st, sem, '2026-08-02').weeks).toBe(15);
    const short = { ...sem, endDs: '2026-10-06' } as never;
    expect(simulateSemester(st, short, '2026-08-02').weeks).toBe(5);
  });
});

describe('rehearsalSteps', () => {
  const sem = (over = {}) =>
    ({
      id: 's2',
      name: '다음',
      startDs: '2026-09-01',
      courses: [{ id: 'x', name: '회로', credits: 3, category: '전공', status: 'plan', itemId: 'a' }],
      ...over,
    }) as never;

  it('D-14 밖이면 아무것도 안 띄운다 — 이르면 잔소리다', () => {
    const st = app({ items: [it_('a')], degree: { semesters: [sem()] } as never });
    expect(rehearsalSteps(st, '2026-08-02')).toEqual([]); // D-30
  });
  it('D-14 안쪽이면 목록이 뜬다', () => {
    const st = app({ items: [it_('a')], degree: { semesters: [sem()] } as never });
    expect(rehearsalSteps(st, '2026-08-25').length).toBeGreaterThan(0); // D-7
  });
  it('충족은 데이터가 판정한다 — 챕터를 넣으면 그 줄이 done 이 된다', () => {
    const bare = app({ items: [it_('a')], degree: { semesters: [sem()] } as never });
    const filled = app({
      items: [it_('a', [ch('c1', 3)])],
      degree: { semesters: [sem()] } as never,
    });
    const at = (st: AppState, id: string) => rehearsalSteps(st, '2026-08-25').find((s) => s.id === id)!;
    expect(at(bare, 'chapters').done).toBe(false);
    expect(at(filled, 'chapters').done).toBe(true);
  });
  it('학기 중이면 리허설이 없다 — 국면이 다르다', () => {
    const st = app({
      items: [it_('a')],
      degree: { semesters: [sem({ startDs: '2026-07-01', endDs: '2026-12-20' })] } as never,
    });
    expect(rehearsalSteps(st, '2026-08-25')).toEqual([]);
  });
});
