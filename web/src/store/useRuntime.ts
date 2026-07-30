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
import { RUNTIME_CACHE_KEYS } from '@/lib/persistence';
import type { AppState } from '@/lib/types';
import type { AnkiFile, AnkiLive } from '@/lib/anki';
import type { VaultScan } from '@/lib/vault';

/** state에서 분리해 이 store가 소유하는 키 — RUNTIME_CACHE_KEYS 중 _knowState(스케줄러 입력) 제외 전부.
    SSOT는 persistence.RUNTIME_CACHE_KEYS 하나 — 여기서 파생해 두 목록이 손으로 갈리는 드리프트를 없앤다
    (새 런타임 캐시 키를 persistence에만 추가하고 여기 누락 시 그 키가 state에 남아 B1/B3 성능 회귀 재발). */
export type RuntimeKey = Exclude<(typeof RUNTIME_CACHE_KEYS)[number], '_knowState'>;
export const RUNTIME_SPLIT_KEYS = RUNTIME_CACHE_KEYS.filter((k) => k !== '_knowState') as readonly RuntimeKey[];

/** 각 런타임 캐시 키가 담는 실제 값의 형태. 예전엔 값이 통째로 `unknown`이라 **읽는 쪽마다**
 *  `as AnkiLive | undefined | null` 같은 캐스트가 필요했다 — 경계는 코드로 지켜지는데 타입으로는
 *  새고 있었다. 키별 타입을 여기 한 곳에서 선언해 소비처의 캐스트를 없앤다.
 *  ⚠ `_vaultScan`/`_ankiFile` 은 **쓰는 곳도 읽는 곳도 0이다**(2026-07-31 감사 실측 — 이 스토어의
 *  `set()` 실호출은 `_ankiLive`·`_icsExport` 둘뿐이다). 그래도 슬롯을 지우지 않는 이유는
 *  `RuntimeKey` 가 `RUNTIME_CACHE_KEYS` 에서 파생되기 때문이고, **그 목록 자체가 옛 데이터에 대한
 *  가드**라 지울 수 없다 — 논거는 `persistence.EPHEMERAL_ONLY_KEYS` 주석(지우면 볼트 경로가
 *  `settings` 행이 되어 D1 으로 나간다). 즉 여기 두 줄은 죽은 코드가 아니라 그 가드의 타입 짝이다. */
export interface RuntimeCache {
  _vaultScan?: VaultScan | null;
  _ankiFile?: AnkiFile | null;
  _ankiLive?: AnkiLive | null;
  _icsExport?: { at?: string; sig?: string } | null;
}

interface RuntimeStore {
  cache: RuntimeCache;
  /** 키에 맞는 값만 받는다(키↔값 짝을 타입이 강제). */
  set: <K extends RuntimeKey>(key: K, val: RuntimeCache[K]) => void;
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
  // split/merge는 디스크 JSON을 키 단위로 옮기는 경계라 여기서만 느슨한 레코드로 다룬다
  // (형태 보증은 위 RuntimeCache가, 값의 출처 신뢰는 persistence의 sanitize가 담당).
  const cache = { ...useRuntime.getState().cache } as Record<string, unknown>;
  let moved = false;
  for (const k of RUNTIME_SPLIT_KEYS) {
    if (k in rec) {
      cache[k] = rec[k];
      delete rec[k];
      moved = true;
    }
  }
  if (moved) useRuntime.setState({ cache: cache as RuntimeCache });
  return state;
}

/** persist/직렬화 직전 병합 — 디스크 JSON은 분리 이전과 동일 형태(EPHEMERAL strip은 serialize 몫). */
export function mergeRuntime(state: AppState): AppState {
  return { ...state, ...useRuntime.getState().cache } as AppState;
}
