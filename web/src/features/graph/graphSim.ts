/* ============================================================
   graphSim — 지식맵(Graph) 탭의 힘 시뮬 + 좌표 기하 + 뷰 상태를 담는 명령형 코어.
   캔버스/React 무관(DOM 접근 0) → Graph.tsx가 얇게 배선하고, 이 코어가 "물리·좌표변환·
   드래그/줌/팬/검색" 상태기계를 소유한다. 그래서 인터랙션 FSM 전체를 <canvas> 없이도
   단위테스트할 수 있다(barnesHut·graphData와 같은 '순수 코어' 사상).

   책임 분리:
   • 코어(이 파일) — nodes/links 소유, 힘 적분(step), auto-fit 변환, 스크린↔월드 역변환,
     히트테스트, 드래그/팬/줌/검색 순회. 좌표는 전부 '캔버스-로컬 px'(rect 보정은 호출자 몫).
   • 컴포넌트(Graph.tsx) — <canvas>·2D 컨텍스트·팔레트·draw()·RAF 냉각 루프·포인터 리스너.
     draw는 코어의 nodes/transform/view/sx·sy만 읽어 그린다(상태를 되쓰지 않음).
============================================================ */
import type { Graph, GraphLink, GraphNode } from './graphData';
import { accumulateRepulsion } from './barnesHut';

/** 힘 시뮬 상수(스프링-반발-중력, alpha 냉각). Graph.tsx에서 이동 — 값 불변. */
export const FORCE = {
  REP: 5200, // 반발 상수
  SPRING: 0.045, // 링크 스프링
  REST: 74, // 링크 자연 길이
  GRAV: 0.012, // 중심 인력
  DAMP: 0.85, // 감쇠
} as const;

/** 줌 배율 한계(휠·버튼 공용). */
export const K_MIN = 0.4;
export const K_MAX = 6;

/** 화면 자동맞춤 변환(월드→스크린 base). */
export interface Transform {
  scale: number;
  ox: number;
  oy: number;
}
/** 사용자 뷰(줌/팬) — auto-fit 위에 얹는 스크린-공간 오버레이. */
export interface View {
  k: number;
  x: number;
  y: number;
}

/** 검색 순회 결과 — 매치 위치(i/n)와 타깃 노드(컴포넌트가 상세 패널·힌트로 소비). */
export interface FocusResult {
  i: number;
  n: number;
  target: GraphNode;
}

export interface GraphSim {
  readonly nodes: GraphNode[];
  readonly links: GraphLink[];
  /** id로 노드 조회(draw의 링크 양끝 해석용). */
  node(id: string): GraphNode | undefined;

  transform(): Transform;
  view(): View;
  /** 유효 배율 = auto-fit × user-view(노드 크기·라벨 임계·히트 반경 공용). */
  effScale(): number;
  /** 월드 x/y → 스크린(캔버스-로컬) x/y. draw가 노드/링크 좌표에 사용. */
  sx(x: number): number;
  sy(y: number): number;

  /** 드래그 중인가(RAF 루프가 정착 판정에 사용). */
  isDragging(): boolean;

  /** 뷰포트 크기 변경 — auto-fit 재계산 대상 크기 갱신. */
  resize(cw: number, ch: number): void;
  /** 사용자 뷰가 아니면 auto-fit 변환을 재계산(draw 진입 시 호출). */
  refit(): void;
  /** 힘 시뮬 1스텝 — nodes를 제자리 적분, 평균 운동에너지(정착 판정) 반환. */
  step(alpha: number): number;

  /** 스크린(캔버스-로컬) → 월드 좌표. */
  screenToWorld(px: number, py: number): { x: number; y: number };
  /** 스크린(캔버스-로컬) 좌표에서 가장 가까운 히트 노드(렌더 반경 + 여유). */
  hitTest(px: number, py: number): GraphNode | null;

  beginDrag(id: string): void;
  /** 드래그 대상 노드를 커서(스크린-로컬) 아래로 이동(속도 0). */
  dragTo(px: number, py: number): void;
  endDrag(): void;

  /** 캔버스 팬 — 절대 뷰 위치 설정(userView 켜짐). */
  pan(x: number, y: number): void;
  /** 커서(mx,my 캔버스-로컬) 아래 지점을 고정한 채 확대/축소. 변화 있으면 true. */
  zoomAt(mx: number, my: number, factor: number): boolean;
  /** 라벨 부분일치 노드로 이동/센터. 같은 검색어 반복이면 다음 매치로 순회(L-4). */
  focus(query: string): FocusResult | null;
  /** 전체 보기로 초기화(auto-fit 복귀). */
  reset(): void;
}

/**
 * 지식맵 힘 시뮬 코어 생성. graph(노드/링크)를 소유하고, 초기 뷰포트(cw×ch)로 auto-fit을 준비한다.
 * 반환 핸들은 순수 상태기계 — DOM에 손대지 않는다(컴포넌트가 canvas·draw·RAF를 배선).
 */
export function createGraphSim(graph: Graph, cw: number, ch: number): GraphSim {
  const { nodes, links } = graph;
  const byId = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
  const idxById = new Map<string, number>(nodes.map((n, i) => [n.id, i]));

  // auto-fit 변환(월드→스크린) — refit이 채운다. 히트테스트 역변환에 재사용.
  let tf: Transform = { scale: 1, ox: 0, oy: 0 };
  // 사용자 뷰(줌/팬). userView가 켜지면 auto-fit을 동결(프레이밍 유지).
  const view: View = { k: 1, x: 0, y: 0 };
  let userView = false;
  let dragId: string | null = null;
  // 검색 매치 순회 상태(같은 검색어로 반복 시 다음 매치로).
  let searchNeedle = '';
  let searchIdx = -1;

  // 힘 누적 스크래치(프레임마다 재사용 — 재할당 없음).
  const fx = new Float64Array(nodes.length);
  const fy = new Float64Array(nodes.length);

  // ── auto-fit 변환 ────────────────────────────────────────────────────────
  const computeTransform = () => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.radius);
      minY = Math.min(minY, n.y - n.radius);
      maxX = Math.max(maxX, n.x + n.radius);
      maxY = Math.max(maxY, n.y + n.radius);
    }
    const pad = 48;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const scale = Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh, 1.6);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    tf = { scale, ox: cw / 2 - cx * scale, oy: ch / 2 - cy * scale };
  };

  // 최종 스크린 좌표 = 사용자 뷰(view) ∘ auto-fit(tf).
  const sx = (x: number) => view.x + view.k * (tf.ox + x * tf.scale);
  const sy = (y: number) => view.y + view.k * (tf.oy + y * tf.scale);
  const effScale = () => tf.scale * view.k;

  const screenToWorld = (px: number, py: number) => {
    // 스크린(캔버스-로컬) → auto-fit(base) → 월드: view를 먼저 풀고, 그다음 tf를 푼다.
    const bx = (px - view.x) / view.k;
    const by = (py - view.y) / view.k;
    return { x: (bx - tf.ox) / tf.scale, y: (by - tf.oy) / tf.scale };
  };

  const hitTest = (px: number, py: number): GraphNode | null => {
    const { x: wx, y: wy } = screenToWorld(px, py);
    // L-3 — 렌더 반경과 히트 반경 일치: draw가 쓰는 nodeScale/effScale를 그대로 반영한다.
    // 화면 반경 = n.radius * nodeScale, 여기에 6px 여유를 더해 월드로 환산(줌 무관 일관).
    const eff = effScale();
    const ns = Math.min(1.6, Math.max(0.7, eff));
    let best: GraphNode | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const dx = n.x - wx;
      const dy = n.y - wy;
      const d = dx * dx + dy * dy;
      const worldR = (n.radius * ns + 6) / eff;
      const rr = worldR * worldR;
      if (d <= rr && d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  };

  // ── 힘 시뮬 1스텝(스프링-반발-중력, alpha 냉각) ─────────────────────────────
  const step = (alpha: number): number => {
    fx.fill(0);
    fy.fill(0);
    // 반발(repulsion): 소형 그래프는 정확 O(N²), 대형은 Barnes–Hut Θ(N log N)로 자동 전환.
    accumulateRepulsion(nodes, fx, fy, FORCE.REP);
    for (const l of links) {
      const s = byId.get(l.source);
      const t = byId.get(l.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = FORCE.SPRING * (d - FORCE.REST);
      const ux = (dx / d) * f;
      const uy = (dy / d) * f;
      const si = idxById.get(l.source)!;
      const ti = idxById.get(l.target)!;
      fx[si]! += ux;
      fy[si]! += uy;
      fx[ti]! -= ux;
      fy[ti]! -= uy;
    }
    let ke = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (n.id === dragId) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      const ax = (fx[i]! - n.x * FORCE.GRAV) * alpha;
      const ay = (fy[i]! - n.y * FORCE.GRAV) * alpha;
      n.vx = (n.vx + ax) * FORCE.DAMP;
      n.vy = (n.vy + ay) * FORCE.DAMP;
      n.x += n.vx;
      n.y += n.vy;
      ke += n.vx * n.vx + n.vy * n.vy;
    }
    return ke / nodes.length;
  };

  // ── 줌(커서 고정) ──────────────────────────────────────────────────────────
  const zoomAt = (mx: number, my: number, factor: number): boolean => {
    const newK = Math.max(K_MIN, Math.min(K_MAX, view.k * factor));
    if (newK === view.k) return false;
    userView = true;
    // 커서 아래 점 고정: mx = view.x + view.k*base  →  base 불변 → view.x 보정.
    view.x = mx - ((mx - view.x) * newK) / view.k;
    view.y = my - ((my - view.y) * newK) / view.k;
    view.k = newK;
    return true;
  };

  return {
    nodes,
    links,
    node: (id) => byId.get(id),
    transform: () => tf,
    view: () => view,
    effScale,
    sx,
    sy,
    isDragging: () => dragId != null,

    resize: (w, h) => {
      cw = w;
      ch = h;
    },
    refit: () => {
      if (!userView) computeTransform(); // 사용자가 줌/팬하면 auto-fit 동결(프레이밍 유지).
    },
    step,
    screenToWorld,
    hitTest,

    beginDrag: (id) => {
      dragId = id;
    },
    dragTo: (px, py) => {
      if (dragId == null) return;
      const n = byId.get(dragId);
      if (!n) return;
      const { x, y } = screenToWorld(px, py);
      n.x = x;
      n.y = y;
      n.vx = 0;
      n.vy = 0;
    },
    endDrag: () => {
      dragId = null;
    },

    pan: (x, y) => {
      userView = true;
      view.x = x;
      view.y = y;
    },
    zoomAt,
    focus: (q) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return null;
      // L-4 — 첫 매치만이 아니라 전체 매치를 모아 반복 시 순회한다.
      const matches = nodes.filter((n) => !n.overflow && n.label.toLowerCase().includes(needle));
      if (!matches.length) return null;
      if (needle === searchNeedle) searchIdx = (searchIdx + 1) % matches.length;
      else {
        searchNeedle = needle;
        searchIdx = 0;
      }
      const target = matches[searchIdx]!;
      userView = true;
      const k = 1.9;
      view.k = k;
      view.x = cw / 2 - k * (tf.ox + target.x * tf.scale);
      view.y = ch / 2 - k * (tf.oy + target.y * tf.scale);
      return { i: searchIdx + 1, n: matches.length, target };
    },
    reset: () => {
      userView = false;
      view.k = 1;
      view.x = 0;
      view.y = 0;
    },
  };
}
