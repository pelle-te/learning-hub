/* ============================================================
   useTimeboxDnd — 타임박스 드래그 시간박기 프로토콜(자기완결).

   DayPlanner(복잡도 41)에서 **책임 이전**으로 떼어냈다(FlowRail 사상). HTML5 DnD 규약(MIME
   직렬화/역직렬화)·좌표→분 변환·`resolveSlot` 슬롯 해소를 이 훅이 소유한다. 실제 배치/복귀는
   **불투명 콜백**(onPlace·onUnplace)으로 부모에 이전하고, "빈 자리 없음" UI 도 부모(onNoRoom)가
   소유한다 — 훅은 store·toast 를 모른다. 그래서 인터페이스가 데이터(colRef·lo·span·occupiedExcept)
   + 콜백 3개로 끝난다(prop-drilling 아님). 키보드 대안(placeFirstFree)은 windows/wake0 에 묶여
   부모에 남는다 — 드래그 프로토콜만 이전하는 경계다.
============================================================ */
import type { DragEvent, RefObject } from 'react';
import { clamp } from '@/lib/utils';
import { resolveSlot } from '@/lib/dayPlans';
import { MIME, type DragKind } from './dayPlannerShared';

interface DragPayload {
  kind: DragKind;
  id: string;
  dur: number;
}

export interface TimeboxDnd {
  /** 드래그 소스에 payload 를 싣는다. `onDragStart={dnd.onDragStart('block', id, min)}`. */
  onDragStart: (kind: DragKind, id: string, dur: number) => (e: DragEvent) => void;
  /** 타임라인에 드롭 — 좌표를 분으로 바꿔 슬롯 해소 후 배치. */
  onTimelineDrop: (e: DragEvent) => void;
  /** 트레이에 드롭 — 미지정으로 복귀. */
  onTrayDrop: (e: DragEvent) => void;
  /** dragover — 우리 MIME 일 때만 드롭 허용. */
  allowDrop: (e: DragEvent) => void;
}

export interface TimeboxDndInput {
  colRef: RefObject<HTMLDivElement | null>;
  /** 타임라인 세로 스팬(분) — 좌표 비율을 분으로 환산할 때 쓴다. */
  lo: number;
  span: number;
  /** 점유 구간(드래그 대상 제외). 겹침 해소가 이걸 피한다. */
  occupiedExcept: (excludeId?: string) => [number, number][];
  onPlace: (kind: DragKind, id: string, at: number) => void;
  onUnplace: (kind: DragKind, id: string) => void;
  /** 놓을 빈 자리가 없을 때(UI 는 부모 소유). */
  onNoRoom: () => void;
}

function readDrag(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

export function useTimeboxDnd({
  colRef,
  lo,
  span,
  occupiedExcept,
  onPlace,
  onUnplace,
  onNoRoom,
}: TimeboxDndInput): TimeboxDnd {
  const onDragStart =
    (kind: DragKind, id: string, dur: number) =>
    (e: DragEvent): void => {
      e.dataTransfer.setData(MIME, JSON.stringify({ kind, id, dur }));
      e.dataTransfer.effectAllowed = 'move';
    };

  const onTimelineDrop = (e: DragEvent): void => {
    e.preventDefault();
    const d = readDrag(e);
    const el = colRef.current;
    if (!d || !el) return;
    const rect = el.getBoundingClientRect();
    const frac = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    const at = resolveSlot(occupiedExcept(d.id), lo + frac * span, d.dur, 1440); // §6-2 밀거나 거부
    if (at == null) {
      onNoRoom();
      return;
    }
    onPlace(d.kind, d.id, at);
  };

  const onTrayDrop = (e: DragEvent): void => {
    e.preventDefault();
    const d = readDrag(e);
    if (!d) return;
    onUnplace(d.kind, d.id);
  };

  const allowDrop = (e: DragEvent): void => {
    if (e.dataTransfer.types.includes(MIME)) e.preventDefault();
  };

  return { onDragStart, onTimelineDrop, onTrayDrop, allowDrop };
}
