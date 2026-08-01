/* ============================================================
   confidence.test.ts — **잠정값 레지스터**(P-12 · 2026-08-01).

   잠그는 것 둘:
   ① 상류가 이미 싣고 있던 `measured`/`n`/`quarantined` 가 실제로 소비된다(종전 소비처 0건).
   ② **앱이 자기 임계를 발명하지 않는다** — `threshold_pct` 는 상류 것을 쓴다.
============================================================ */
import { describe, it, expect } from 'vitest';
import { overallConfidence, subjectConfidence } from '@/lib/confidence';
import type { Knowledge } from '@/lib/knowledge';

const k = (over: Partial<Knowledge>): Knowledge => ({ n_notes: 100, ...over });

describe('overallConfidence', () => {
  it('산출물이 없으면 unknown', () => {
    expect(overallConfidence(undefined).level).toBe('unknown');
  });

  it('상류가 검역했으면 값이 있어도 unknown — 우리가 다시 판단하지 않는다', () => {
    const c = overallConfidence(
      k({ overall: 0.62, evidence_coverage: { measured: 3, total: 100, pct: 3, quarantined: true } }),
    );
    expect(c.level).toBe('unknown');
    expect(c.caption).toBe('측정 3/100');
  });

  it('덮개율이 상류 임계 미만이면 잠정', () => {
    const c = overallConfidence(
      k({ overall: 0.62, evidence_coverage: { measured: 30, total: 100, pct: 30, threshold_pct: 60 } }),
    );
    expect(c.level).toBe('tentative');
    expect(c.speech).toContain('잠정');
  });

  it('임계를 넘으면 solid — 그때만 종전과 똑같이 그린다', () => {
    const c = overallConfidence(
      k({ overall: 0.62, evidence_coverage: { measured: 80, total: 100, pct: 80, threshold_pct: 60 } }),
    );
    expect(c.level).toBe('solid');
    expect(c.caption).toBe('측정 80/100');
  });

  it('상류 임계가 같은 값이라도 **상류 것**을 쓴다(폴백이 이기지 않는다)', () => {
    // 폴백(60)보다 낮은 임계를 상류가 주면 그 판단을 따른다 — 여기서 solid 가 나와야 한다.
    const c = overallConfidence(
      k({ overall: 0.5, evidence_coverage: { measured: 20, total: 100, pct: 20, threshold_pct: 10 } }),
    );
    expect(c.level).toBe('solid');
  });

  it('관측이 0건이면 unknown — 전부 사전분포라 평균이 사실이 아니다', () => {
    const c = overallConfidence(k({ overall: 0.5, evidence_coverage: { measured: 0, total: 40, pct: 0 } }));
    expect(c.level).toBe('unknown');
  });

  it('메타가 아예 없으면 값만 믿는다(옛 산출물 무손상)', () => {
    const c = overallConfidence(k({ overall: 0.7 }));
    expect(c.level).toBe('solid');
    expect(c.caption).toBe('');
  });
});

describe('subjectConfidence', () => {
  it('mastery 가 null 이면 unknown', () => {
    expect(subjectConfidence({ subject: 'x', mastery: null }).level).toBe('unknown');
  });
  it('measured 0 이면 unknown', () => {
    expect(subjectConfidence({ subject: 'x', mastery: 0.5, measured: 0, n: 12 }).level).toBe('unknown');
  });
  it('표본이 얇으면 잠정 · 분모를 캡션이 말한다', () => {
    const c = subjectConfidence({ subject: 'x', mastery: 0.62, measured: 3, n: 40 });
    expect(c.level).toBe('tentative');
    expect(c.caption).toBe('측정 3/40');
  });
  it('충분하면 solid', () => {
    expect(subjectConfidence({ subject: 'x', mastery: 0.62, measured: 35, n: 40 }).level).toBe('solid');
  });
  it('분모를 모르면 건수만 말한다(없는 분모를 지어내지 않는다)', () => {
    expect(subjectConfidence({ subject: 'x', mastery: 0.62, measured: 7 }).caption).toBe('측정 7건');
  });
});
