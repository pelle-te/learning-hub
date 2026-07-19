/* ============================================================
   useUI.ts — UI 환경설정 스토어(Zustand+Immer). lib/uiState의 순수 boot/persist를 감싸고,
   변경 시 즉시 영속 + IDB 미러('ui' 키)한다. 앱 데이터(useApp)와 분리된 단일 출처.
   뷰 토글·팔레트 최근명령처럼 자주 바뀌지만 가벼운 설정 전용(디바운스 불필요).
============================================================ */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { storage } from '@/lib/kv';
import { idbMirror } from '@/lib/idb';
import {
  bootUI,
  persistUI,
  pushRecent,
  type Accent,
  type NavSurface,
  type SchedView,
  type UIState,
} from '@/lib/uiState';

export interface UIStore {
  ui: UIState;
  setSchedView: (v: SchedView) => void;
  setAccent: (a: Accent) => void;
  setFxLite: (on: boolean) => void;
  toggleNav: () => void;
  setNavSurface: (s: NavSurface) => void;
  recordRecent: (id: string) => void;
  recentIds: () => string[];
  /** KV에서 다시 부팅(가져오기 복원 등 화면 밖 경로가 lh_ui_v1을 교체했을 때).
   *  flush 없음 — 방금 KV에 쓰인 값을 읽는 것이라 되쓰면 왕복만 늘어난다. */
  reloadUI: () => void;
}

export const useUI = create<UIStore>()(
  immer((set, get) => {
    const flush = () => {
      try {
        idbMirror(persistUI(storage, get().ui), 'ui');
      } catch {
        /* 저장 실패는 무시 — 메모리 상태는 계속 동작 */
      }
    };
    return {
      ui: bootUI(storage),
      setSchedView(v) {
        set((s) => {
          s.ui.schedView = v;
        });
        flush();
      },
      setAccent(a) {
        set((s) => {
          s.ui.accent = a;
        });
        flush();
      },
      setFxLite(on) {
        set((s) => {
          s.ui.fxLite = on;
        });
        flush();
      },
      toggleNav() {
        set((s) => {
          s.ui.navCollapsed = !s.ui.navCollapsed;
        });
        flush();
      },
      setNavSurface(surface) {
        set((s) => {
          s.ui.navSurface = surface;
        });
        flush();
      },
      recordRecent(id) {
        set((s) => {
          s.ui.recentCommands = pushRecent(s.ui.recentCommands, id);
        });
        flush();
      },
      recentIds() {
        return get().ui.recentCommands;
      },
      reloadUI() {
        const next = bootUI(storage);
        set((s) => {
          s.ui = next;
        });
      },
    };
  }),
);
