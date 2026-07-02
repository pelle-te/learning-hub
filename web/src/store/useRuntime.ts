/* ============================================================
   useRuntime.ts — plan-무관 런타임 캐시의 단일 store(B1/B3).
   _ankiLive(오늘 KPI)·_icsExport(캘린더 신선도)는 schedule() 입력이 아닌데
   useApp.state 안에 있으면 settle마다 state 참조가 갈려 selectSchedule(참조 캐시)이
   무거운 schedule()을 통째 재계산한다 → AppState 밖 별도 store로 분리.
   (_knowState만 스케줄러 graphPriority 입력이라 state에 남는다 — 그 무효화는 정확성에 필요.)

   디스크 계약은 불변: useApp.flush가 저장 직전 병합해 같은 localStorage JSON(KEY)에 남기고,
   boot/loadState 직후 splitRuntime으로 뽑아온다 — persist 2계층(내보내기/로컬) 계약·테스트 그대로.
============================================================ */
import { create } from 'zustand';
import type { AppState } from '@/lib/types';

/** state에서 분리해 이 store가 소유하는 키 — RUNTIME_CACHE_KEYS 중 _knowState 제외 전부. */
export const RUNTIME_SPLIT_KEYS = ['_ankiLive', '_icsExport', '_vaultScan', '_ankiFile'] as const;
export type RuntimeKey = (typeof RUNTIME_SPLIT_KEYS)[number];

interface RuntimeStore {
  cache: Partial<Record<RuntimeKey, unknown>>;
  set: (key: RuntimeKey, val: unknown) => void;
}

export const useRuntime = create<RuntimeStore>()((set) => ({
  cache: {},
  set(key, val) {
    set((s) => ({ cache: { ...s.cache, [key]: val } }));
  },
}));

/** boot/loadState 직후 호출 — plan-무관 캐시를 state에서 뽑아 런타임 store로 옮기고 제거(제자리 변형). */
export function splitRuntime(state: AppState): AppState {
  const rec = state as unknown as Record<string, unknown>;
  const cache: Partial<Record<RuntimeKey, unknown>> = { ...useRuntime.getState().cache };
  let moved = false;
  for (const k of RUNTIME_SPLIT_KEYS) {
    if (k in rec) {
      cache[k] = rec[k];
      delete rec[k];
      moved = true;
    }
  }
  if (moved) useRuntime.setState({ cache });
  return state;
}

/** persist/직렬화 직전 병합 — 디스크 JSON은 분리 이전과 동일 형태(EPHEMERAL strip은 serialize 몫). */
export function mergeRuntime(state: AppState): AppState {
  return { ...state, ...useRuntime.getState().cache } as AppState;
}
