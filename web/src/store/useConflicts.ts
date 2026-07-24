/* ============================================================
   useConflicts.ts — 동기화가 LWW 로 덮은 **동시 편집의 그림자**를 담는 로컬 store(Phase 4).

   설계서 §150 이 CRDT 를 의도적으로 배제했고, 그 대가는 "같은 레코드를 두 기기가 고치면 늦은
   쪽이 조용히 이긴다"였다. 이 store 는 그 조용한 손실을 **관측 가능**하게 만든다 — 무엇이
   덮였는지 사용자가 알고(배지), 옛 값을 확인하고 넘길 수 있게(설정 목록).

   ## ⚠ 이건 앱 데이터가 아니다 — 동기화되지 않는다

   충돌 그림자는 **기기별 관측 기록**이다. `useApp`(정본·동기화 대상)에 넣지 않고 별도 store +
   로컬 KV(`CONFLICTS_KEY`)에 둔다 — 그래서 `rows.ts`/`schema.ts`/D1 스키마를 건드리지 않는다
   (그 층은 델리킷하고 Rust 미러와 공유된다). 다른 기기로 "내 기기에서 뭐가 덮였다"를 보낼
   이유도 없다(각자 자기 것만 본다).
============================================================ */
import { create } from 'zustand';
import { readJSON, writeJSON } from '@/lib/localStore';
import type { ConflictShadow } from '@/lib/cloud/conflicts';

/** 로컬 관측 기록 저장 키(동기화 대상 아님 — LOCAL_EXTRA_KEYS 에도 넣지 않는다). */
export const CONFLICTS_KEY = 'lh:conflicts';

/** 무한 성장 방지 — 관측 목적이므로 최근 것만 남긴다(오래된 것부터 버린다). */
const MAX_SHADOWS = 50;

/** 그림자 한 건의 안정 식별자 — (감지시각, 테이블, 첫 키)로 유일. dismiss 대상 지정에 쓴다. */
export function shadowId(s: ConflictShadow): string {
  return `${s.detectedAt}:${s.tbl}:${s.key[0] ?? ''}:${s.key[1] ?? ''}`;
}

interface ConflictsStore {
  shadows: ConflictShadow[];
  /** 새 충돌을 앞에 쌓는다(최신이 위). 빈 배열이면 무동작. */
  add: (incoming: ConflictShadow[]) => void;
  /** 한 건 확인 처리(제거). */
  dismiss: (id: string) => void;
  /** 전부 확인 처리. */
  dismissAll: () => void;
}

function persist(shadows: ConflictShadow[]): void {
  writeJSON(CONFLICTS_KEY, shadows);
}

export const useConflicts = create<ConflictsStore>()((set) => ({
  // 부팅 시 로컬 KV 에서 복원 — 배지가 새로고침을 넘어 살아남는다.
  shadows: readJSON<ConflictShadow[]>(CONFLICTS_KEY, []),
  add(incoming) {
    if (!incoming.length) return;
    set((s) => {
      const next = [...incoming, ...s.shadows].slice(0, MAX_SHADOWS);
      persist(next);
      return { shadows: next };
    });
  },
  dismiss(id) {
    set((s) => {
      const next = s.shadows.filter((x) => shadowId(x) !== id);
      persist(next);
      return { shadows: next };
    });
  },
  dismissAll() {
    persist([]);
    set({ shadows: [] });
  },
}));
