/* ============================================================
   graphSim.test.ts — 지식맵 힘 시뮬 + 좌표 기하 코어 회귀(Vitest).
   Graph.tsx에서 추출한 명령형 코어(DOM 무관)를 <canvas> 없이 단위 검증한다:
   물리(냉각·결정론·드래그 고정) · 히트테스트 왕복 · 줌 커서고정 불변식 · 검색 순회(L-4) · reset/pan.
============================================================ */
import { describe, expect, it } from 'vitest';
import { createGraphSim, K_MAX, K_MIN } from '@/features/graph/graphSim';
import type { Graph, GraphNode } from '@/features/graph/graphData';

const CW = 800;
const CH = 600;

/** 최소 필드로 노드 생성(초기 속도 0). */
function node(id: string, x: number, y: number, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, kind: 'leaf', label: id, itemId: 'it', x, y, vx: 0, vy: 0, radius: 5, ...extra };
}

/** 허브 1 + 잎 3의 결정론적 소형 그래프(매 호출 새 객체 — 사이드이펙트 격리). */
function mkGraph(): Graph {
  const nodes: GraphNode[] = [
    node('hub', 0, 0, { kind: 'hub', label: '항목', itemId: 'hub', radius: 20, done: 1, total: 3 }),
    node('a', 120, 40, { label: '알파' }),
    node('b', -80, 90, { label: '알파벳' }),
    node('c', 30, -110, { label: '베타' }),
  ];
  const links = [
    { source: 'hub', target: 'a' },
    { source: 'hub', target: 'b' },
    { source: 'hub', target: 'c' },
  ];
  return { nodes, links };
}

describe('createGraphSim — 힘 시뮬(step)', () => {
  it('결정론 — 동일 그래프에서 같은 스텝 수는 동일 좌표를 낳는다(Math.random 금지)', () => {
    const s1 = createGraphSim(mkGraph(), CW, CH);
    const s2 = createGraphSim(mkGraph(), CW, CH);
    let a = 1;
    for (let i = 0; i < 60; i++) {
      s1.step(a);
      s2.step(a);
      a *= 0.98;
    }
    for (let i = 0; i < s1.nodes.length; i++) {
      expect(s1.nodes[i]!.x).toBeCloseTo(s2.nodes[i]!.x, 9);
      expect(s1.nodes[i]!.y).toBeCloseTo(s2.nodes[i]!.y, 9);
    }
  });

  it('냉각 — 반복 스텝 후 운동에너지가 유한하고 감소해 정착으로 향한다', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    let a = 1;
    let first = 0;
    let last = 0;
    for (let i = 0; i < 200; i++) {
      const ke = sim.step(a);
      a *= 0.98;
      if (i === 5) first = ke;
      last = ke;
      expect(Number.isFinite(ke)).toBe(true);
    }
    expect(last).toBeLessThan(first); // 냉각 → 후반 KE가 초반보다 작다
  });

  it('드래그 고정 — beginDrag한 노드는 step에도 위치가 고정되고 속도가 0으로 유지된다', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.beginDrag('a');
    const a = sim.node('a')!;
    const x0 = a.x;
    const y0 = a.y;
    for (let i = 0; i < 20; i++) sim.step(1);
    expect(a.x).toBe(x0);
    expect(a.y).toBe(y0);
    expect(a.vx).toBe(0);
    expect(a.vy).toBe(0);
    // 대조: 고정 안 한 노드는 움직인다.
    sim.endDrag();
    const b = sim.node('b')!;
    const bx = b.x;
    sim.step(1);
    expect(b.x).not.toBe(bx);
  });
});

describe('createGraphSim — 좌표 기하', () => {
  it('히트테스트 왕복 — 노드의 스크린 좌표에서 되짚으면 그 노드를 맞힌다', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.refit(); // auto-fit 변환 채움
    for (const n of sim.nodes) {
      const px = sim.sx(n.x);
      const py = sim.sy(n.y);
      expect(sim.hitTest(px, py)?.id).toBe(n.id);
    }
  });

  it('히트테스트 — 노드에서 멀리 떨어진 빈 공간은 null', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.refit();
    // 캔버스 모서리(노드 군집에서 먼 곳).
    expect(sim.hitTest(2, 2)).toBeNull();
  });

  it('screenToWorld ∘ world→screen 은 항등(왕복 오차 0)', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.refit();
    const n = sim.node('c')!;
    const w = sim.screenToWorld(sim.sx(n.x), sim.sy(n.y));
    expect(w.x).toBeCloseTo(n.x, 6);
    expect(w.y).toBeCloseTo(n.y, 6);
  });
});

describe('createGraphSim — 줌/팬', () => {
  it('줌 커서 고정 — 커서 아래 월드 점이 확대 후에도 그대로다', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.refit();
    const mx = 300;
    const my = 220;
    const before = sim.screenToWorld(mx, my);
    expect(sim.zoomAt(mx, my, 2)).toBe(true);
    const after = sim.screenToWorld(mx, my);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(sim.effScale()).toBeCloseTo(sim.transform().scale * 2, 6);
  });

  it('줌 한계 — K_MIN/K_MAX를 넘어서면 변화 없음(false)', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.refit();
    // 상한까지 밀어붙인 뒤 추가 확대는 무효.
    while (sim.zoomAt(CW / 2, CH / 2, 2)) {
      /* K_MAX까지 */
    }
    expect(sim.view().k).toBeCloseTo(K_MAX, 6);
    expect(sim.zoomAt(CW / 2, CH / 2, 2)).toBe(false);
    // 하한도 대칭.
    while (sim.zoomAt(CW / 2, CH / 2, 0.5)) {
      /* K_MIN까지 */
    }
    expect(sim.view().k).toBeCloseTo(K_MIN, 6);
    expect(sim.zoomAt(CW / 2, CH / 2, 0.5)).toBe(false);
  });

  it('pan — 절대 뷰 위치를 설정하고 auto-fit을 동결(refit이 덮어쓰지 않음)', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.refit();
    sim.pan(37, -21);
    sim.refit(); // userView가 켜졌으니 tf/ view를 유지해야 한다
    expect(sim.view().x).toBe(37);
    expect(sim.view().y).toBe(-21);
  });

  it('reset — 전체 보기로 복귀(view 항등 + auto-fit 재개)', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.refit();
    sim.zoomAt(200, 200, 3);
    sim.pan(50, 50);
    sim.reset();
    expect(sim.view()).toEqual({ k: 1, x: 0, y: 0 });
    // reset 후 refit은 다시 auto-fit을 계산한다(동결 해제) — 노드가 화면 안에 들어온다.
    sim.refit();
    const n = sim.node('hub')!;
    expect(sim.sx(n.x)).toBeGreaterThanOrEqual(0);
    expect(sim.sx(n.x)).toBeLessThanOrEqual(CW);
  });
});

describe('createGraphSim — 검색 순회(focus, L-4)', () => {
  it('부분일치 전체를 모아 같은 검색어 반복 시 다음 매치로 순회한다', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.refit();
    const r1 = sim.focus('알파');
    expect(r1).not.toBeNull();
    expect(r1!.n).toBe(2); // '알파', '알파벳'
    expect(r1!.i).toBe(1);
    expect(r1!.target.id).toBe('a');
    const r2 = sim.focus('알파');
    expect(r2!.i).toBe(2);
    expect(r2!.target.id).toBe('b');
    const r3 = sim.focus('알파'); // 순환
    expect(r3!.i).toBe(1);
    expect(r3!.target.id).toBe('a');
  });

  it('매치 없음/빈 검색어 → null, 뷰 이동 없음', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.refit();
    const v0 = { ...sim.view() };
    expect(sim.focus('없는개념')).toBeNull();
    expect(sim.focus('   ')).toBeNull();
    expect(sim.view()).toEqual(v0);
  });

  it('오버플로 노드는 검색 매치에서 제외된다(빈 상세 데드엔드 방지)', () => {
    const g = mkGraph();
    g.nodes.push(node('ov', 200, 200, { label: '알파 +5개 더', overflow: true }));
    const sim = createGraphSim(g, CW, CH);
    sim.refit();
    // '알파' 매치는 여전히 2개(오버플로 'ov' 제외).
    expect(sim.focus('알파')!.n).toBe(2);
  });

  it('focus는 타깃을 화면 중앙 근처로 센터링한다', () => {
    const sim = createGraphSim(mkGraph(), CW, CH);
    sim.refit();
    const r = sim.focus('베타')!;
    const px = sim.sx(r.target.x);
    const py = sim.sy(r.target.y);
    expect(px).toBeCloseTo(CW / 2, 3);
    expect(py).toBeCloseTo(CH / 2, 3);
  });
});
