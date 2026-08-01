/* ============================================================
   estimateCalibration.test.ts — Q-5 추정 vs 실측 대조.

   이 파일의 핵심은 **게이트가 진짜로 닫혀 있는지**다. 로드맵이 Q-5 를 `Now*` 로 표시하고
   "채움률 ≥15% 확인 선행"을 단 것을, 사람의 기억이 아니라 코드가 지키는지 잠근다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { MIN_FILL, MIN_SAMPLES, calibrationLabel, subjectCalibration } from '@/lib/estimateCalibration';
import type { AppState } from '@/lib/types';

/** n건의 완료를 만든다. `withActual` 건에만 실측을 싣는다. */
const st = (n: number, withActual: number, plannedMin = 100, actualMin = 150) => {
  const completions: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < n; i++) {
    completions[`2026-07-${String(i + 1).padStart(2, '0')}`] = {
      'sub1|new': { done: true, min: plannedMin, ...(i < withActual ? { actualMin } : {}) },
    };
  }
  return { completions } as unknown as AppState;
};

describe('subjectCalibration — 게이트가 먼저다', () => {
  it('완료가 아예 없으면 null', () => {
    expect(subjectCalibration(st(0, 0), 'sub1')).toBeNull();
  });

  it(`실측 표본이 ${MIN_SAMPLES}건 미만이면 null — 1건 중 1건(100%)으로 배율을 말할 순 없다`, () => {
    expect(subjectCalibration(st(3, 3), 'sub1')).toBeNull();
  });

  it(`⭐ 채움률이 ${MIN_FILL * 100}% 미만이면 null — 표본 수가 충분해도`, () => {
    // 100건 중 5건만 실측(5%) → 표본 수는 넉넉하지만 채움률이 문턱 아래다.
    const c = subjectCalibration(st(100, 5), 'sub1');
    expect(c).toBeNull();
  });

  it('문턱을 넘으면 배율이 나온다 — 계획 100분에 실제 150분이면 1.5', () => {
    const c = subjectCalibration(st(20, 20), 'sub1');
    expect(c).not.toBeNull();
    expect(c!.ratio).toBeCloseTo(1.5, 5);
    expect(c!.fill).toBe(1);
    expect(c!.samples).toBe(20);
  });

  it('⚠ 분모는 계획 min 이다 — completionMin 폴백을 쓰면 비율이 항상 1 이 된다', () => {
    // 실측 없는 완료가 섞여 있어도 그것들은 **분자·분모 어디에도** 안 들어간다.
    const c = subjectCalibration(st(20, 10), 'sub1');
    expect(c!.ratio).toBeCloseTo(1.5, 5); // 1 쪽으로 희석되지 않는다
    expect(c!.total).toBe(20);
    expect(c!.samples).toBe(10);
  });

  it('다른 과목의 완료는 안 섞인다', () => {
    const s = st(20, 20);
    (s.completions['2026-07-01'] as Record<string, unknown>)['other|new'] = {
      done: true,
      min: 100,
      actualMin: 9999,
    };
    expect(subjectCalibration(s, 'sub1')!.ratio).toBeCloseTo(1.5, 5);
  });
});

describe('calibrationLabel — 잡음을 신호로 읽지 않게', () => {
  const c = (ratio: number) => ({ samples: 10, total: 10, fill: 1, ratio });

  it('5% 안쪽은 "대체로 맞음"', () => {
    expect(calibrationLabel(c(1.02))).toBe('추정 대체로 맞음');
    expect(calibrationLabel(c(0.97))).toBe('추정 대체로 맞음');
  });

  it('낙관적이었으면 "더 걸림"', () => {
    expect(calibrationLabel(c(1.5))).toBe('추정보다 50% 더 걸림');
  });

  it('비관적이었으면 "덜 걸림"', () => {
    expect(calibrationLabel(c(0.7))).toBe('추정보다 30% 덜 걸림');
  });
});
