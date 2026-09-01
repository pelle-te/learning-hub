/* ============================================================
   recallEvidence.test.ts — 인출 증거·추세 파생(통계·인출카드 중복 제거 SSOT) 회귀.
   dedup으로 Stats.tsx RetrievalCard↔메인의 이중계산을 methodology 헬퍼로 수렴시킨 것을 고정.
============================================================ */
import { describe, expect, it } from 'vitest';
import { recallEvidence, cbmsTrendGlyph } from '@/lib/methodology';
import type { ScheduleResult, Summary } from '@/lib/types';
import type { AppState } from '@/lib/schema';

const sum = (id: string): Summary => ({ id, sid: 'a', name: 'n', s1: '1', s2: '2', s3: '3' });
const S = (summaries: object, completions: object): AppState =>
  ({ items: [], summaries, completions }) as unknown as AppState;

describe('methodology — recallEvidence', () => {
  it('백지 계획/완료·모의·요약을 집계(공용 SSOT)', () => {
    const s = S(
      { '2026-07-01': [sum('1'), sum('2')] }, // 요약 2
      { '2026-07-01': { 'a|blank': { done: true }, 'b|mock': { done: true } } },
    );
    const r = {
      days: [
        {
          ds: '2026-07-01',
          items: [
            { type: 'blank', sid: 'a' }, // 완료
            { type: 'blank', sid: 'c' }, // 미완료
            { type: 'mock', sid: 'b' }, // 완료
          ],
        },
      ],
    } as unknown as ScheduleResult;
    const ev = recallEvidence(s, r);
    expect(ev.blankPlan).toBe(2);
    expect(ev.blankDone).toBe(1);
    expect(ev.mockDone).toBe(1);
    expect(ev.blankRate).toBe(50);
    expect(ev.recallActs).toBe(2 + 1 + 1); // 요약2 + 백지1 + 모의1
  });

  it('빈 스케줄/데이터는 0으로 안전', () => {
    const ev = recallEvidence(S({}, {}), { days: [] } as unknown as ScheduleResult);
    expect(ev).toEqual({ blankPlan: 0, blankDone: 0, mockDone: 0, blankRate: 0, recallActs: 0 });
  });
});

describe('methodology — cbmsTrendGlyph', () => {
  it('감소=개선(good, ▼)', () => {
    const g = cbmsTrendGlyph({ lastW: 5, thisW: 2 });
    expect(g.good).toBe(true);
    expect(g.icon).toBe('▼ 감소');
    expect(g.delta).toBe(3);
  });
  it('증가=악화(▲, not good)', () => {
    const g = cbmsTrendGlyph({ lastW: 1, thisW: 4 });
    expect(g.good).toBe(false);
    expect(g.icon).toBe('▲ 증가');
  });
  it('동일=유지(＝)', () => {
    expect(cbmsTrendGlyph({ lastW: 3, thisW: 3 }).icon).toBe('＝ 유지');
  });
  it('둘 다 0 = 유지·good(오답 기록 없음)', () => {
    const g = cbmsTrendGlyph({ lastW: 0, thisW: 0 });
    expect(g.good).toBe(true);
    expect(g.icon).toBe('＝ 유지');
  });
});
