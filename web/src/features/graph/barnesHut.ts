/* ============================================================
   barnesHut — 지식맵 힘 시뮬의 반발(repulsion) 누적기.
   기존 step()의 O(N²) 쌍별 반발이 MAX_NODES 캡의 근본 원인(프레임당 N² 연산)이었다.
   이를 Barnes–Hut 쿼드트리로 근사해 프레임당 Θ(N log N)로 낮춰 대형 볼트(수천 노드)도 돌린다.
   • 소형 그래프(N ≤ EXACT_MAX)는 정확한 쌍별 계산을 그대로 유지 — 기존 레이아웃과 수식 동일(픽셀 동일).
   • 순수·비캔버스 — 단위테스트 대상(Graph.tsx는 이 함수만 호출).
   좌표계·반발 상수(REP)·겹침 방어(d²<0.01)는 Graph.tsx의 기존 수식을 보존한다.
============================================================ */

/** 위치를 읽을 수 있는 최소 바디(SimNode가 이를 만족). */
export interface Body {
  x: number;
  y: number;
}

/** 이 이하 노드 수는 정확 O(N²)로 계산(트리 오버헤드 없이 기존과 동일한 결과). */
export const EXACT_MAX = 256;
/** Barnes–Hut 개방각(θ) — 작을수록 정확·느림. 0.8이면 시각적으로 충분히 정확. */
const THETA = 0.8;
/** 쿼드트리 최소 셀 크기 — 겹친(동일좌표) 바디의 무한 세분 방지. 이하면 집합 버킷으로. */
const MIN_CELL = 1e-3;

/**
 * nodes의 쌍별 반발을 fx/fy에 **누적**한다(가법 — 호출 전 0으로 초기화 가정).
 * 반발 크기 = rep / d²(방향은 서로 밀어냄), Graph.tsx의 기존 수식과 동일.
 * N ≤ EXACT_MAX면 정확 계산, 그 이상이면 Barnes–Hut 근사.
 */
export function accumulateRepulsion(
  nodes: readonly Body[],
  fx: Float64Array,
  fy: Float64Array,
  rep: number,
  theta: number = THETA,
): void {
  const n = nodes.length;
  if (n <= EXACT_MAX) {
    exactRepulsion(nodes, fx, fy, rep);
    return;
  }

  // 1) 경계 → 정사각 루트 셀.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const b = nodes[i]!;
    if (b.x < minX) minX = b.x;
    if (b.x > maxX) maxX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.y > maxY) maxY = b.y;
  }
  let size = Math.max(maxX - minX, maxY - minY);
  if (!(size > 0)) size = 1; // 전 노드 동일좌표 방어
  size *= 1.0000001; // 경계 바디가 셀 안쪽에 들도록 미세 확장

  // 2) 쿼드트리 구축.
  const root = new BHTree(minX, minY, size);
  for (let i = 0; i < n; i++) root.insert(nodes[i]!, 0);

  // 3) 각 노드에 대해 트리 순회 → 반발 누적.
  for (let i = 0; i < n; i++) root.applyForce(nodes[i]!, i, fx, fy, rep, theta);
}

/** 정확 쌍별 반발 — Graph.tsx step()의 이너 루프와 수식·겹침 방어까지 동일(대칭 누적). */
function exactRepulsion(nodes: readonly Body[], fx: Float64Array, fy: Float64Array, rep: number): void {
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < n; j++) {
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
      const ux = (dx / d) * f;
      const uy = (dy / d) * f;
      fx[i]! += ux;
      fy[i]! += uy;
      fx[j]! -= ux;
      fy[j]! -= uy;
    }
  }
}

/** Barnes–Hut 쿼드트리 노드. 정사각 영역 [x0,x0+size]×[y0,y0+size]를 4분면으로 재귀 분할. */
class BHTree {
  private readonly x0: number;
  private readonly y0: number;
  private readonly size: number;
  /** 포함 바디 수(집합 질량 — 모든 바디 질량 1). */
  private mass = 0;
  /** 질량중심(누적 평균). */
  private cx = 0;
  private cy = 0;
  /** 리프에 단일 바디(내부 노드가 되면 null). */
  private body: Body | null = null;
  /** 내부 노드 4분면 [NW, NE, SW, SE](리프면 null). */
  private kids: (BHTree | null)[] | null = null;

  constructor(x0: number, y0: number, size: number) {
    this.x0 = x0;
    this.y0 = y0;
    this.size = size;
  }

  insert(b: Body, depth: number): void {
    // 빈 리프 → 단일 바디로.
    if (this.mass === 0) {
      this.body = b;
      this.mass = 1;
      this.cx = b.x;
      this.cy = b.y;
      return;
    }
    // 최소 셀 도달(겹친 바디) → 세분 없이 집합 버킷으로만 누적(무한 재귀 방지).
    if (this.size <= MIN_CELL || depth > 48) {
      this.cx = (this.cx * this.mass + b.x) / (this.mass + 1);
      this.cy = (this.cy * this.mass + b.y) / (this.mass + 1);
      this.mass += 1;
      this.body = null; // 집합 버킷(단일 바디 아님)
      return;
    }
    // 단일 바디 리프였다면 내부 노드로 승격 — 기존 바디를 자식으로 밀어넣는다.
    if (this.body !== null) {
      const old = this.body;
      this.body = null;
      this.kids = [null, null, null, null];
      this.childFor(old).insert(old, depth + 1);
    }
    // 내부 노드: COM 갱신 + 해당 자식에 삽입.
    this.cx = (this.cx * this.mass + b.x) / (this.mass + 1);
    this.cy = (this.cy * this.mass + b.y) / (this.mass + 1);
    this.mass += 1;
    this.childFor(b).insert(b, depth + 1);
  }

  /** 바디가 속한 자식 4분면을 (없으면 생성해) 반환. */
  private childFor(b: Body): BHTree {
    const half = this.size / 2;
    const east = b.x >= this.x0 + half ? 1 : 0;
    const south = b.y >= this.y0 + half ? 1 : 0;
    const q = south * 2 + east; // 0 NW · 1 NE · 2 SW · 3 SE
    const kids = this.kids!;
    let k = kids[q];
    if (!k) {
      k = new BHTree(this.x0 + east * half, this.y0 + south * half, half);
      kids[q] = k;
    }
    return k;
  }

  /** 이 서브트리가 노드 b(인덱스 i)에 주는 반발을 fx/fy에 누적. */
  applyForce(b: Body, i: number, fx: Float64Array, fy: Float64Array, rep: number, theta: number): void {
    if (this.mass === 0) return;
    // 단일 바디 리프 — 자기 자신은 건너뛴다.
    if (this.body !== null) {
      if (this.body === b) return;
      accum(b, i, this.body.x, this.body.y, 1, fx, fy, rep);
      return;
    }
    // 집합(내부 노드 또는 겹침 버킷): θ 판정.
    const dx = b.x - this.cx;
    const dy = b.y - this.cy;
    const d2 = dx * dx + dy * dy;
    // size/d < θ  ⇔  size² < θ²·d² → 충분히 멀어 집합체로 근사.
    if (this.kids === null || this.size * this.size < theta * theta * d2) {
      accum(b, i, this.cx, this.cy, this.mass, fx, fy, rep);
      return;
    }
    // 가까움 → 자식 재귀.
    const kids = this.kids;
    for (let q = 0; q < 4; q++) {
      const k = kids[q];
      if (k) k.applyForce(b, i, fx, fy, rep, theta);
    }
  }
}

/** 바디 i에 (ox,oy)의 질량 mass가 주는 반발을 누적. 겹침(d²<0.01)은 결정론적 미세 분리로 방어. */
function accum(
  b: Body,
  i: number,
  ox: number,
  oy: number,
  mass: number,
  fx: Float64Array,
  fy: Float64Array,
  rep: number,
): void {
  let dx = b.x - ox;
  let dy = b.y - oy;
  let d2 = dx * dx + dy * dy;
  if (d2 < 0.01) {
    dx = 0.1;
    dy = 0.1;
    d2 = dx * dx + dy * dy;
  }
  const d = Math.sqrt(d2);
  const f = (rep * mass) / d2;
  fx[i]! += (dx / d) * f;
  fy[i]! += (dy / d) * f;
}
