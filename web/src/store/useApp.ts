/* ============================================================
   useApp.ts — 로컬-퍼스트 앱 상태의 단일 원천(Zustand + Immer).
   레거시의 전역 state/persist/render 3개를 이 스토어로 리다이렉트 → 원천이 하나라
   Strangler 이전 중에도 동기화 문제가 없다(설계도 §5).
   액션은 lib의 순수 함수를 호출하는 얇은 오케스트레이션 + 디바운스 영속(+IDB 미러).
============================================================ */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { setAutoFreeze } from 'immer';
import { boot, persist, setDone } from '@/lib/persistence';
import { refineItemColors } from '@/lib/utils';
import { idbMirror } from '@/lib/idb';
import { storage } from '@/lib/kv';
import * as M from '@/lib/methodology';
import type { AppState, CbmsCode, SessionType, Theme } from '@/lib/types';

// 파생 셀렉터(schedule 등)가 인엔진에서 state를 읽는 경로가 동결되면 곤란 → autoFreeze off(레거시도 off였음).
// 모든 변형은 mutate(immer set) 드래프트 안에서 일어나므로 안전.
setAutoFreeze(false);

export interface AppStore {
  state: AppState;
  /** 임의 변형 + 영속 — 얇은 오케스트레이션(features가 lib 순수함수를 recipe로 넘김). */
  mutate: (recipe: (s: AppState) => void) => void;
  /** 상태 통째 교체(가져오기·되돌리기·복구) + 즉시 영속. */
  loadState: (s: AppState) => void;
  /** 서버/외부 캐시 write-through — Query가 소유한 결과를 인엔진 소비처(스케줄러 graphPriority·오늘 Anki
   *  KPI·캘린더 신선도 배지)에 흘려준다. *파일 내보내기*(exportSnapshot)에선 제외하되, *로컬 persist*엔
   *  남겨 reload 후 즉시 표시한다(낙관적 캐시). 설계도 §1-B. */
  setRuntimeCache: (key: '_knowState' | '_ankiLive' | '_vaultScan' | '_ankiFile' | '_icsExport', val: unknown) => void;
  setTheme: (t: Theme) => void;
  toggleDone: (ds: string, sid: string, type: SessionType, plannedMin: number, on: boolean) => void;
  addCbms: (
    ds: string,
    sid: string,
    name: string,
    chapter: string,
    code: CbmsCode,
    note: string,
    conf?: boolean,
  ) => void;
  setBlankResult: (ds: string, sid: string, name: string, passed: boolean, note: string, chapter: string) => void;
}

export const useApp = create<AppStore>()(
  immer((set, get) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      try {
        const json = persist(storage, get().state);
        idbMirror(json);
      } catch {
        /* 저장공간 초과 등 — 호출부 UI가 안내(Phase 4). 앱은 계속 동작. */
      }
    };
    /** 텍스트 입력마다 쓰지 않게 디바운스(설계도 §1-A). */
    const schedulePersist = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 400);
    };

    return {
      state: refineItemColors(boot(storage)),
      mutate(recipe) {
        set((s) => {
          recipe(s.state);
        });
        schedulePersist();
      },
      loadState(next) {
        set((s) => {
          s.state = next;
        });
        flush(); // 통째 교체는 즉시 영속(디바운스 X) — 가져오기/복구 직후 새로고침해도 안전.
      },
      setRuntimeCache(key, val) {
        // state 참조만 갱신하고 *저장은 스케줄하지 않는다*(캐시 업데이트마다 디스크 쓰기 churn 방지).
        // 값은 다음 mutate의 디바운스 flush에 묻어 로컬에 남고(EPHEMERAL_ONLY_KEYS 제외), 다음 부팅 때
        // 오늘 탭 KPI·캘린더 배지가 즉시 읽는다. 파일 내보내기에선 RUNTIME_CACHE_KEYS로 전부 빠진다.
        set((s) => {
          (s.state as Record<string, unknown>)[key] = val;
        });
      },
      setTheme(t) {
        set((s) => {
          s.state.theme = t;
        });
        schedulePersist();
      },
      toggleDone(ds, sid, type, plannedMin, on) {
        set((s) => {
          setDone(s.state, ds, sid, type, plannedMin, on);
        });
        schedulePersist();
      },
      addCbms(ds, sid, name, chapter, code, note, conf) {
        set((s) => {
          M.addCbms(s.state, ds, sid, name, chapter, code, note, conf);
        });
        schedulePersist();
      },
      setBlankResult(ds, sid, name, passed, note, chapter) {
        set((s) => {
          M.setBlankResult(s.state, ds, sid, name, passed, note, chapter);
        });
        schedulePersist();
      },
    };
  }),
);
