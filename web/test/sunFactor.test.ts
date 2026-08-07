/* ============================================================
   sunFactor.test.ts — **캔버스가 하루의 위치를 싣는다**(N-21 · W6).

   셰이더 안에서 계산했다면 이 명제를 잴 수 없었다: *새벽 3시와 오후 3시가 구분되는가.*
   그래서 곡선만 순수 함수로 뽑았고, 여기서 잠그는 것은 두 가지다 —
   ① 방향(정오가 가장 밝다) ② **범위가 좁다**(배경 대비가 시계의 함수가 되면 a11y 가 시각에
   달린다 — 이 앱이 허용하지 않는 형태).
============================================================ */
import { describe, expect, it } from 'vitest';
import { sunFactor } from '@/components/AmbientCanvas';

describe('sunFactor — 하루의 위치', () => {
  it('정오가 가장 밝고 자정이 가장 어둡다', () => {
    expect(sunFactor(12)).toBeGreaterThan(sunFactor(3));
    expect(sunFactor(0)).toBeLessThan(sunFactor(9));
  });

  it('⭐ 새벽과 오후가 실제로 구분된다 — 안 그러면 이 축은 상수이고 값이 0이다', () => {
    expect(sunFactor(15) - sunFactor(3)).toBeGreaterThan(0.1);
  });

  it('범위가 좁다(0.8~1.1) — 배경 대비가 시계의 함수가 되면 안 된다', () => {
    for (let h = 0; h < 24; h++) {
      expect(sunFactor(h)).toBeGreaterThan(0.8);
      expect(sunFactor(h)).toBeLessThan(1.1);
    }
  });

  it('시각이 범위를 벗어나도 접힌다(24 = 0 · 음수도)', () => {
    expect(sunFactor(24)).toBeCloseTo(sunFactor(0), 6);
    expect(sunFactor(-3)).toBeCloseTo(sunFactor(21), 6);
  });
});
