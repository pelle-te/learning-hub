/* ============================================================
   phaseRamp.test.ts — T-4 국면 전환(방학 램프 · 학기 처분).

   ⚠ 여기서 특히 잠그는 것 셋:
   - **`off` 는 수를 지어내지 않는다.** 도착점이 없으면 "하루 N분"은 거짓말이다.
   - **개강 당일에 나누기 0 이 안 난다.** 그 경계는 매년 한 번 실제로 지나간다.
   - **`deferred` 는 남은 학습량이 아니다.** 램프가 그걸 다시 밀어 넣으면 은퇴가 무력해진다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { phaseRamp, remainingMin, staleSemesterLinks } from '@/lib/phaseRamp';
import type { AppState, Item } from '@/lib/types';

const ch = (id: string, hours: number, done = false, deferred = false) => ({ id, name: id, hours, done, deferred });
const it_ = (id: string, chapters: ReturnType<typeof ch>[] = []): Item =>
  ({ id, name: id, mode: 'weekly', chapters }) as Item;

const state = (over: Partial<AppState>): Pick<AppState, 'degree' | 'items' | '_today'> =>
  ({ items: [], degree: { semesters: [] }, ...over }) as never;

describe('remainingMin', () => {
  it('끝난 것과 미룬 것을 뺀다', () => {
    expect(remainingMin([it_('a', [ch('c1', 1), ch('c2', 2, true), ch('c3', 3, false, true)])])).toBe(60);
  });
});

describe('phaseRamp — pre(개강 전)', () => {
  const base = state({
    _today: '2026-08-02',
    items: [it_('a', [ch('c1', 10)])], // 600분
    degree: { semesters: [{ id: 's1', name: '2학기', courses: [], startDs: '2026-09-01' }] } as never,
  });
  it('하루 몇 분이면 밀림 0 인지 답한다', () => {
    const r = phaseRamp(base);
    expect(r.kind).toBe('pre');
    expect(r.daysToStart).toBe(30);
    expect(r.perDayMin).toBe(20); // 600 / 30
    expect(r.advice).toContain('하루 20분');
  });
  it('개강 당일에도 나누기 0 이 안 난다', () => {
    const r = phaseRamp({ ...base, _today: '2026-09-01' } as never, '2026-08-31');
    expect(Number.isFinite(r.perDayMin!)).toBe(true);
  });
  it('남은 범위가 0 이면 수가 아니라 다음 할 일을 말한다', () => {
    const r = phaseRamp({ ...base, items: [it_('a', [ch('c1', 10, true)])] } as never);
    expect(r.perDayMin).toBe(0);
    expect(r.advice).toContain('선수 점검');
  });
});

describe('phaseRamp — off / in', () => {
  it('off 는 하루 목표를 지어내지 않는다', () => {
    const r = phaseRamp(state({ _today: '2026-08-02', items: [it_('a', [ch('c1', 10)])] }));
    expect(r.kind).toBe('off');
    expect(r.perDayMin).toBeNull();
    expect(r.advice).toContain('개강일을 넣으면');
  });
  it('in 은 처방을 계획에 넘긴다 — 두 벌의 계획을 만들지 않는다', () => {
    const r = phaseRamp(
      state({
        _today: '2026-09-10',
        degree: { semesters: [{ id: 's1', name: '2학기', courses: [], startDs: '2026-09-01' }] } as never,
      }),
    );
    expect(r.kind).toBe('in');
    expect(r.perDayMin).toBeNull();
  });
});

describe('staleSemesterLinks', () => {
  it('끝난 학기에 매달린 실행 과목을 돌려준다 — 지우지는 않는다', () => {
    const s = state({
      _today: '2026-08-02',
      items: [it_('a', [ch('c1', 1), ch('c2', 1, true)])],
      degree: {
        semesters: [
          { id: 's1', name: '1학기', startDs: '2026-03-02', endDs: '2026-06-20', courses: [{ itemId: 'a' }] },
        ],
      } as never,
    });
    const out = staleSemesterLinks(s);
    expect(out).toHaveLength(1);
    expect(out[0]!.openChapters).toBe(1);
    expect(s.items).toHaveLength(1); // 아무것도 안 지웠다
  });
  it('아직 안 끝난 학기는 처분 대상이 아니다', () => {
    const s = state({
      _today: '2026-08-02',
      items: [it_('a', [ch('c1', 1)])],
      degree: {
        semesters: [
          { id: 's1', name: '2학기', startDs: '2026-07-01', endDs: '2026-12-20', courses: [{ itemId: 'a' }] },
        ],
      } as never,
    });
    expect(staleSemesterLinks(s)).toEqual([]);
  });
});
