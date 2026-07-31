/* ============================================================
   useTrayCursor — 미지정 트레이의 키보드 커서 배선(W13 · 2026-07-31).

   ⚠ 상태기계는 `hooks/useListCursor` 가 소유한다(어휘 7개도 거기서 닫힌다). 여기 있는 것은
   **이 화면의 동사 매핑**뿐이다 — 블록과 할 일이 형태가 달라 한 배열에서 섞이므로 키에 접두를
   붙이고(`b:`/`t:`), 세 동사(`x` 완료 · `p` 배치 · `d` 삭제)를 각 형태의 뮤테이션으로 잇는다.

   파일을 가른 이유는 순전히 `max-lines` 래칫이다 — `DayPlanner` 는 이미 한계 근처이고,
   래칫의 계약은 "더 나빠지지 않는다"라 새 배선은 자기 파일을 갖는 것이 정직하다.
============================================================ */
import { useListCursor, type ListCursor } from '@/hooks/useListCursor';
import { removeBlock } from '@/lib/dayPlans';
import { removeTask, toggleTaskDone } from '@/lib/tasks';
import type { AppState, SessionType } from '@/lib/types';

/** 이 훅이 실제로 만지는 최소 형태만 받는다 — 트레이 행의 전체 타입을 끌어오면 결합만 커진다. */
export interface TrayBlock {
  id: string;
  sid: string;
  type: SessionType;
  min: number;
  done?: boolean;
}
export interface TrayTask {
  id: string;
  min?: number;
  done?: boolean;
}
type Item = { kind: 'block'; b: TrayBlock } | { kind: 'task'; t: TrayTask };

export interface TrayDeps {
  mutate: (recipe: (st: AppState) => void) => void;
  ds: string;
  /** 이 날이 수동 배치인가 — ⚠ 자동 계획 블록엔 삭제 개념이 없다(엔진이 다시 만든다). */
  manual: boolean;
  blockDone: (b: TrayBlock) => boolean;
  toggleBlock: (b: TrayBlock, on: boolean) => void;
  placeFirstFree: (kind: 'block' | 'task', id: string, min: number) => void;
}

export function useTrayCursor(blocks: readonly TrayBlock[], tasks: readonly TrayTask[], d: TrayDeps): ListCursor {
  const items = [
    ...blocks.map((b) => ({ key: 'b:' + b.id, item: { kind: 'block', b } as Item })),
    ...tasks.map((t) => ({ key: 't:' + t.id, item: { kind: 'task', t } as Item })),
  ];
  return useListCursor<Item>({
    items,
    docTitle: '이 화면 · 트레이',
    verbs: {
      x: (it) =>
        it.kind === 'block'
          ? d.toggleBlock(it.b, !d.blockDone(it.b))
          : d.mutate((st) => toggleTaskDone(st, it.t.id, !it.t.done)),
      p: (it) =>
        d.placeFirstFree(
          it.kind,
          it.kind === 'block' ? it.b.id : it.t.id,
          (it.kind === 'block' ? it.b.min : it.t.min) ?? 30,
        ),
      d: (it) => {
        if (it.kind === 'task') d.mutate((st) => removeTask(st, it.t.id));
        else if (d.manual) d.mutate((st) => removeBlock(st, d.ds, it.b.id));
      },
    },
  });
}
