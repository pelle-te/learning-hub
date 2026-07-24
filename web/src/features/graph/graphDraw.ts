/* ============================================================
   graphData.ts 의 짝 — 그래프 캔버스 **렌더(순수 그리기)**. Graph.tsx 의 320줄 캔버스 이펙트에서
   `draw` 를 떼어냈다. 코어 상태(sim)·팔레트·치수만 읽어 그린다 — DOM/이벤트/상태 되쓰기가 없어
   이펙트 밖 모듈 함수로 산다(이펙트는 RAF·리사이즈·제스처 배선만 남는다).
============================================================ */
import type { GraphNode } from './graphData';
import type { GraphSim } from './graphSim';
import type { SemEdge } from '@/lib/semantic';

/** 캔버스가 var()를 못 읽어 런타임 해석해 넣는 색·폰트(테마 전환 시 `readPalette` 가 갱신). */
export interface Palette {
  bg: string;
  line: string;
  txt: string;
  mut: string;
  good: string;
  learning: string;
  acc: string;
  font: string;
}

/** 잎 노드 색 — 진척 톤(done/learning/그 외)에 따라. */
export function leafColor(n: GraphNode, p: Palette): string {
  return n.tone === 'done' ? p.good : n.tone === 'learning' ? p.learning : p.mut;
}

/** 캔버스 픽셀 치수(DPR·논리 폭·높이) — 리사이즈 때 갱신되는 값이라 draw 시점에 넘긴다. */
export interface DrawDims {
  dpr: number;
  cw: number;
  ch: number;
}

/**
 * 그래프를 한 프레임 그린다. sim 의 좌표/뷰만 읽고 **되쓰지 않는다** — RAF 루프·리사이즈·테마 전환이
 * 각자 이걸 부른다. Graph.tsx 이펙트가 `const draw = () => drawGraph(ctx, sim, palette, dims, sem)` 로 감싼다.
 */
export function drawGraph(
  ctx: CanvasRenderingContext2D,
  sim: GraphSim,
  palette: Palette,
  { dpr, cw, ch }: DrawDims,
  semEdges: SemEdge[],
): void {
  sim.refit(); // 사용자가 줌/팬하지 않았으면 auto-fit 재계산(프레이밍 유지).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  // 링크
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 1;
  for (const l of sim.links) {
    const s = sim.node(l.source);
    const t = sim.node(l.target);
    if (!s || !t) continue;
    ctx.beginPath();
    ctx.moveTo(sim.sx(s.x), sim.sy(s.y));
    ctx.lineTo(sim.sx(t.x), sim.sy(t.y));
    ctx.stroke();
  }
  // 의미 연결(자동) — 과목 경계를 넘는 점선(액센트, 그리기 전용 — 힘에는 불참).
  if (semEdges.length) {
    ctx.strokeStyle = palette.acc;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([5, 5]);
    for (const l of semEdges) {
      const s = sim.node(l.source);
      const t = sim.node(l.target);
      if (!s || !t) continue;
      ctx.beginPath();
      ctx.moveTo(sim.sx(s.x), sim.sy(s.y));
      ctx.lineTo(sim.sx(t.x), sim.sy(t.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  // 노드
  const nodeScale = Math.min(1.6, Math.max(0.7, sim.effScale()));
  for (const n of sim.nodes) {
    const r = n.radius * nodeScale;
    const px = sim.sx(n.x);
    const py = sim.sy(n.y);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    if (n.kind === 'hub') {
      ctx.fillStyle = n.color || palette.acc;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.bg;
      ctx.stroke();
    } else {
      ctx.fillStyle = leafColor(n, palette);
      ctx.globalAlpha = n.overflow ? 0.6 : 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  // 허브 라벨(항상) + 잎 라벨(충분히 확대했을 때만 — 평소엔 툴팁으로 폭주 방지).
  ctx.fillStyle = palette.txt;
  ctx.font = palette.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const showLeafLabels = sim.effScale() > 1.35; // 줌인하면 챕터 이름도 드러난다(터치·탐색 지원).
  for (const n of sim.nodes) {
    if (n.kind !== 'hub' && !(showLeafLabels && !n.overflow)) continue;
    const r = n.radius * nodeScale;
    if (n.kind === 'hub') {
      ctx.fillStyle = palette.txt;
      ctx.fillText(n.label, sim.sx(n.x), sim.sy(n.y) + r + 3);
    } else {
      ctx.fillStyle = palette.mut;
      ctx.fillText(n.label, sim.sx(n.x), sim.sy(n.y) + r + 2);
    }
  }
}
