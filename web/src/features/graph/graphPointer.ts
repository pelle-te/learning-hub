/* ============================================================
   graphPointer.ts — 캔버스 **포인터 제스처** 상태기계(호버 툴팁 · 노드 드래그 · 빈 공간 팬 ·
   클릭 선택 · 휠 줌). `graphSim`(코어) · `graphDraw`(그리기)의 셋째 짝이다.

   ## 왜 떼어냈나 (F5 재설계 · 2026-08-01)

   `graphDraw` 를 떼어낸 것과 같은 이유다. 이 상태기계는 **DOM 이벤트만 상대**하고 React 상태는
   콜백으로만 건드린다 — 이펙트 안에 있을 이유가 없었고, 남아 있는 동안 그 이펙트 하나가 화면
   전체의 인지복잡도를 지배했다(Graph.tsx 38 중 대부분이 여기였다).

   ⚠ **클릭과 드래그의 구분이 여기 산다.** 4px 이동 임계를 넘으면 드래그로 보고, 안 넘으면 클릭
   으로 본다 — 그 판정 없이 `pointerup` 에서 바로 선택하면 노드를 옮길 때마다 상세가 열린다.
   ⚠ `pointercancel` 도 `onUp` 으로 받는다(호출부 배선) — 안 받으면 캡처가 남아 캔버스가 굳는다.
============================================================ */
import { prefersReducedMotion } from '@/lib/motion';
import type { GraphNode } from './graphData';
import type { GraphSim } from './graphSim';

export interface PointerDeps {
  canvas: HTMLCanvasElement;
  sim: GraphSim;
  /** 현재 프레임 다시 그리기(팬·줌처럼 시뮬 없이 뷰만 바뀌는 경우). */
  draw: () => void;
  /** RAF 루프 재가열(드래그 시작·종료). */
  reheat: (a?: number) => void;
  /** 정지해 있으면 RAF 루프를 다시 세운다. */
  ensureLoop: () => void;
  showTip: (x: number, y: number, text: string) => void;
  hideTip: () => void;
  tipText: (n: GraphNode) => string;
  /** 노드를 클릭했다(드래그가 아니다). */
  onSelect: (n: GraphNode) => void;
  /** '+N개 더' 오버플로 노드를 눌렀다 — 그 허브를 펼쳐 숨은 챕터를 드러낸다. */
  onExpand: (itemId: string) => void;
  /** 빈 공간을 눌렀다 — 선택 해제. */
  onClearSel: () => void;
}

export interface PointerHandlers {
  onDown: (e: PointerEvent) => void;
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
  onLeave: () => void;
  onWheel: (e: WheelEvent) => void;
}

export function createPointerHandlers(d: PointerDeps): PointerHandlers {
  const { canvas, sim } = d;
  // 클릭(선택) vs 드래그·팬 구분은 포인터 제스처(DOM)라 여기가 소유한다.
  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOrigX = 0;
  let panOrigY = 0;
  let downId: string | null = null;
  let downX = 0;
  let downY = 0;
  let moved = false;

  /** 캔버스-로컬 좌표. */
  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  };
  /** 캡처 해제 — 이미 풀린 경우가 정상 흐름에 있다(pointercancel). */
  const release = (id: number) => {
    try {
      canvas.releasePointerCapture(id);
    } catch {
      /* 이미 해제됨 */
    }
  };

  const onDown = (e: PointerEvent) => {
    const { px, py } = local(e);
    const n = sim.hitTest(px, py);
    if (!n) {
      // 빈 공간 = 캔버스 팬(뷰 이동) + 선택 해제.
      panning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      const v = sim.view();
      panOrigX = v.x;
      panOrigY = v.y;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      d.onClearSel();
      return;
    }
    sim.beginDrag(n.id);
    downId = n.id;
    downX = e.clientX;
    downY = e.clientY;
    moved = false;
    canvas.setPointerCapture(e.pointerId);
    d.reheat(0.4);
  };

  const onMove = (e: PointerEvent) => {
    const { px, py } = local(e);
    if (panning) {
      sim.pan(panOrigX + (e.clientX - panStartX), panOrigY + (e.clientY - panStartY));
      d.draw();
      return;
    }
    if (sim.isDragging()) {
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 4) moved = true;
      sim.dragTo(px, py);
      if (prefersReducedMotion()) d.draw();
      else d.ensureLoop();
      const dn = downId ? sim.node(downId) : undefined;
      if (dn) d.showTip(px, py, d.tipText(dn));
      return;
    }
    const n = sim.hitTest(px, py);
    canvas.style.cursor = n ? 'grab' : 'default';
    if (n) d.showTip(px, py, d.tipText(n));
    else d.hideTip();
  };

  const onUp = (e: PointerEvent) => {
    if (panning) {
      panning = false;
      release(e.pointerId);
      canvas.style.cursor = 'default';
      return;
    }
    if (sim.isDragging()) {
      const n = downId ? sim.node(downId) : undefined;
      sim.endDrag();
      release(e.pointerId);
      d.reheat(0.3);
      // 거의 안 움직였으면 클릭 = 상세 패널 열기(드래그 후엔 열지 않음).
      if (n && !moved && downId === n.id) {
        // 오버플로 노드 = 빈 상세 데드엔드였던 것 → 그 허브를 펼쳐 숨은 챕터를 드러낸다.
        if (n.overflow) d.onExpand(n.itemId);
        else d.onSelect(n);
      }
    }
    downId = null;
    moved = false;
  };

  const onLeave = () => {
    if (!sim.isDragging()) d.hideTip();
  };

  // 줌(휠) — 커서 아래 지점을 고정한 채 확대/축소(코어가 뷰 계산, 변화 시 draw).
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { px, py } = local(e);
    if (sim.zoomAt(px, py, Math.exp(-e.deltaY * 0.0012))) d.draw();
  };

  return { onDown, onMove, onUp, onLeave, onWheel };
}
