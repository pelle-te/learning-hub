/* ============================================================
   useTrayCursor — 미지정 트레이의 키보드 커서 배선(W13 · 2026-07-31).

   ⚠ 상태기계는 `hooks/useListCursor` 가 소유한다(어휘 7개도 거기서 닫힌다). 여기 있는 것은
   **이 화면의 동사 매핑**뿐이다 — 블록과 할 일이 형태가 달라 한 배열에서 섞이므로 키에 접두를
   붙이고(`b:`/`t:`), 세 동사(`x` 완료 · `p` 배치 · `d` 삭제)를 각 형태의 뮤테이션으로 잇는다.

   파일을 가른 이유는 순전히 `max-lines` 래칫이다 — `DayPlanner` 는 이미 한계 근처이고,
   래칫의 계약은 "더 나빠지지 않는다"라 새 배선은 자기 파일을 갖는 것이 정직하다.
============================================================ */
import { useListCursor, type ListCursor } from '@/hooks/useListCursor';
import { removeBlock, SNAP } from '@/lib/dayPlans';
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
  /** 길이 편집(`e`) — 행의 −/＋ 스테퍼와 **같은 뮤테이션**을 부른다(H13). 블록/할 일 형태 차이는
   *  호출부가 흡수한다(`resizeBlock` vs `updateTaskMin`). 자동 계획 블록은 undefined. */
  setMin?: (it: { kind: 'block' | 'task'; id: string }, min: number) => void;
}

/* ⚠⚠ **길이 편집이 키보드로 도달 불가였다**(H13 · WCAG 2.1.1 · 2026-08-01).
   W13 이 행을 탭 스톱 하나로 접으면서 안쪽 컨트롤을 전부 `tabIndex={-1}` 로 뺐는데, `−`/`＋`
   스테퍼만 **대체 동사가 없었다**(체크박스→`x` · ⤵→`p` · ✕→`d` 는 전부 있었다). 즉 마우스
   없이는 트레이 항목의 길이를 바꿀 방법이 하나도 없었다.

   ⚠ 어휘를 늘리지 않는다 — 닫힌 7개 중 **`e`(편집)** 에 매핑한다(`useListCursor` 머리주석).
   ⚠ 한 키로 양방향 스테퍼를 표현할 수 없으므로 **순환**이다: +30 씩 오르다 상한을 넘으면
   `SNAP` 으로 돌아온다. 그게 "±버튼과 똑같이"보다 나은 이유는 키가 하나뿐이라는 제약이
   실제이기 때문이고, 순환이면 **어느 값에서도 원하는 값에 도달**한다(되돌릴 수 없는 조작이
   아니다 · ⌘Z 도 덮는다). 상한을 4시간으로 둔 것은 트레이 항목의 실사용 범위다. */
const CYCLE_MAX = 240;
const cycleMin = (min: number): number => (min + 30 > CYCLE_MAX ? SNAP : min + 30);

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
      /* ⚠ `setMin` 이 없으면(자동 계획 블록) **등재조차 안 한다** — `useListCursor` 가 `verbs` 의
         키로 치트시트를 만드므로, 빈 함수를 놓으면 `?` 가 "있다"고 거짓말한다. */
      ...(d.setMin
        ? {
            e: (it: Item) => {
              const cur = (it.kind === 'block' ? it.b.min : it.t.min) ?? 30;
              d.setMin?.({ kind: it.kind, id: it.kind === 'block' ? it.b.id : it.t.id }, cycleMin(cur));
            },
          }
        : {}),
    },
  });
}
