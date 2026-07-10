/* ============================================================
   barnesHut.test.ts — 지식맵 힘 시뮬 반발 누적기 회귀(Vitest).
   순수·결정론: 소형은 정확 O(N²), 대형은 Barnes–Hut 근사. 대칭·유한성·근사오차를 고정.
============================================================ */
import { describe, expect, it } from 'vitest';
import { accumulateRepulsion, EXACT_MAX, type Body } from '@/features/graph/barnesHut';

const REP = 5200;

/** 참조: 정확 쌍별 반발(Graph.tsx 원 수식) — BH 근사와 대조용. */
function bruteForce(nodes: Body[], rep = REP): { fx: number[]; fy: number[] } {
  const n = nodes.length;
  const fx = new Array(n).fill(0);
  const fy = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        dx = (i - j) * 0.1 + 0.1;
        dy = 0.1;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const f = rep / d2;
      fx[i] += (dx / d) * f;
      fy[i] += (dy / d) * f;
      fx[j] -= (dx / d) * f;
      fy[j] -= (dy / d) * f;
    }
  }
  return { fx, fy };
}

/** 결정론적 의사난수 좌표(Math.random 금지 — 스냅샷/테스트 안정). */
function seededNodes(n: number, spread = 800): Body[] {
  const out: Body[] = [];
  let s = 123456789 >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let i = 0; i < n; i++) out.push({ x: (rnd() - 0.5) * spread, y: (rnd() - 0.5) * spread });
  return out;
}

describe('accumulateRepulsion — 반발 누적', () => {
  it('소형(N ≤ EXACT_MAX)은 정확 쌍별 계산과 완전 일치', () => {
    const nodes = seededNodes(30);
    const fx = new Float64Array(nodes.length);
    const fy = new Float64Array(nodes.length);
    accumulateRepulsion(nodes, fx, fy, REP);
    const ref = bruteForce(nodes);
    for (let i = 0; i < nodes.length; i++) {
      expect(fx[i]).toBeCloseTo(ref.fx[i]!, 9);
      expect(fy[i]).toBeCloseTo(ref.fy[i]!, 9);
    }
  });

  it('두 노드: 서로 반대 방향으로 rep/d² 크기만큼 민다', () => {
    const nodes: Body[] = [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
    ]; // d=5, d²=25
    const fx = new Float64Array(2);
    const fy = new Float64Array(2);
    accumulateRepulsion(nodes, fx, fy, REP);
    const mag = REP / 25; // 208
    // node0은 -방향(원점이 (3,4)로부터 멀어짐 = -x,-y), node1은 +방향.
    expect(fx[0]).toBeCloseTo((-3 / 5) * mag, 6);
    expect(fy[0]).toBeCloseTo((-4 / 5) * mag, 6);
    expect(fx[1]).toBeCloseTo((3 / 5) * mag, 6);
    expect(fy[1]).toBeCloseTo((4 / 5) * mag, 6);
  });

  it('대형(N > EXACT_MAX)은 Barnes–Hut로 정확 계산을 근사(상대오차 작음)', () => {
    const n = EXACT_MAX + 300; // BH 경로 강제
    const nodes = seededNodes(n);
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    accumulateRepulsion(nodes, fx, fy, REP);
    const ref = bruteForce(nodes);
    // 노드별 힘 벡터의 상대오차를 집계 — θ=0.8이면 평균오차가 낮아야 한다.
    let sumErr = 0;
    let sumMag = 0;
    for (let i = 0; i < n; i++) {
      const ex = ref.fx[i]!;
      const ey = ref.fy[i]!;
      const dxErr = fx[i]! - ex;
      const dyErr = fy[i]! - ey;
      sumErr += Math.hypot(dxErr, dyErr);
      sumMag += Math.hypot(ex, ey);
    }
    const rel = sumErr / sumMag;
    expect(rel).toBeLessThan(0.15); // 15% 이내(시각적으로 동등한 레이아웃)
    // 유한성 — NaN/Inf 없음.
    expect(fx.every((v) => Number.isFinite(v))).toBe(true);
    expect(fy.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('대형에서 겹친(동일좌표) 노드가 있어도 NaN/Inf가 생기지 않는다', () => {
    const nodes = seededNodes(EXACT_MAX + 50);
    // 일부 노드를 동일 좌표로 강제(겹침 방어 경로 자극).
    for (let i = 0; i < 20; i++) {
      nodes[i]!.x = 10;
      nodes[i]!.y = 10;
    }
    const fx = new Float64Array(nodes.length);
    const fy = new Float64Array(nodes.length);
    accumulateRepulsion(nodes, fx, fy, REP);
    expect(fx.every((v) => Number.isFinite(v))).toBe(true);
    expect(fy.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('누적(가법) — 호출은 fx/fy에 더한다(덮어쓰지 않음)', () => {
    const nodes = seededNodes(10);
    const fxA = new Float64Array(nodes.length);
    const fyA = new Float64Array(nodes.length);
    accumulateRepulsion(nodes, fxA, fyA, REP);
    const fxB = new Float64Array(nodes.length).fill(100);
    const fyB = new Float64Array(nodes.length).fill(-50);
    accumulateRepulsion(nodes, fxB, fyB, REP);
    for (let i = 0; i < nodes.length; i++) {
      expect(fxB[i]).toBeCloseTo(fxA[i]! + 100, 6);
      expect(fyB[i]).toBeCloseTo(fyA[i]! - 50, 6);
    }
  });
});
