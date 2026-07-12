/* ============================================================
   useApp.ts — 로컬-퍼스트 앱 상태의 단일 원천(Zustand + Immer).
   레거시의 전역 state/persist/render 3개를 이 스토어로 리다이렉트 → 원천이 하나라
   Strangler 이전 중에도 동기화 문제가 없다(설계도 §5).
   액션은 lib의 순수 함수를 호출하는 얇은 오케스트레이션 + 디바운스 영속(+IDB 미러).
============================================================ */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { setAutoFreeze } from 'immer';
import { boot, persist, serialize, setDone } from '@/lib/persistence';
import { mergeRuntime, splitRuntime } from './useRuntime';
import { refineItemColors } from '@/lib/utils';
import { idbMirror } from '@/lib/idb';
import { storage } from '@/lib/kv';
import { announce, onSync } from '@/lib/sync';
import { toast } from '@/shell/toast';
import * as M from '@/lib/methodology';
import type { AppState, CbmsCode, SessionType, Theme } from '@/lib/types';

// immer autoFreeze ON(기본값 복원) — 모든 immer 스토어(useApp·useUI·useFocus·toast·modal·chrome)의
// state를 동결해 드래프트 밖 우발적 변형을 즉시 TypeError로 잡는다(6개 스토어 공통 안전망 회복).
// 예전엔 OFF였다(SD-5): 읽기 함수 summariesFor가 state를 렌더 중 제자리 변형(지연초기화)해 동결과 충돌했다.
// 그 read-path 변형을 순수화(methodology.summariesFor)해 근본 해소 → 이제 안전하게 켠다.
// 쓰기경로(add*/set*/restore*)의 지연초기화는 전부 mutate 드래프트 안이라 동결 대상이 아니다(무해).
setAutoFreeze(true);

/* 저장 실패 안내 — 편집 중 매 flush(400ms 디바운스)마다 뜨면 소음이라 ~30초에 1번만.
   (shell/toast는 zustand 단독 모듈이라 store→toast import에 순환 없음 — actions.ts와 무관.) */
let _lastSaveFailToastAt = 0;
const SAVE_FAIL_TOAST_GAP_MS = 30_000;
function warnSaveFailure(): void {
  const now = Date.now();
  if (now - _lastSaveFailToastAt < SAVE_FAIL_TOAST_GAP_MS) return;
  _lastSaveFailToastAt = now;
  toast('저장 실패 — 저장공간이 가득 찼을 수 있어요. 데이터 내보내기로 백업하세요.', 'bad', 6000);
}

export interface AppStore {
  state: AppState;
  /** 임의 변형 + 영속 — 얇은 오케스트레이션(features가 lib 순수함수를 recipe로 넘김). */
  mutate: (recipe: (s: AppState) => void) => void;
  /** 상태 통째 교체(가져오기·되돌리기·복구) + 즉시 영속. */
  loadState: (s: AppState) => void;
  /** 서버/외부 캐시 write-through — schedule() *입력*인 _knowState 전용(graphPriority).
   *  plan-무관 캐시(_ankiLive·_icsExport 등)는 useRuntime store가 소유 — state 참조를 갈지 않아
   *  selectSchedule 재계산이 없다(B1/B3). 영속 스코프(내보내기 제외·로컬 유지)는 두 경로 동일. */
  setRuntimeCache: (key: '_knowState', val: unknown) => void;
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
      // 런타임 캐시(useRuntime)는 저장 직전에만 병합 — 디스크 JSON 형태는 분리 이전과 동일(계약 불변).
      let json: string | null = null;
      try {
        json = persist(storage, mergeRuntime(get().state));
      } catch {
        // 저장공간 초과 등 — 조용히 삼키지 않고 사용자에게 백업을 안내(스로틀). 앱은 계속 동작.
        warnSaveFailure();
      }
      // localStorage가 실패해도 IDB 미러는 시도(전소 시 복구의 최후 보루 — idbMirror는 자체 비차단).
      try {
        idbMirror(json ?? serialize(mergeRuntime(get().state)));
      } catch {
        /* 직렬화 자체 실패(비정상 상태) — 미러 불가 */
      }
      // 멀티탭 동기화 — 다른 탭이 이 스냅샷을 채택하게 방송(상호 덮어쓰기 유실 방지 + 대시보드 모드).
      if (json != null) announce({ kind: 'app' });
    };
    /** 텍스트 입력마다 쓰지 않게 디바운스(설계도 §1-A). */
    const schedulePersist = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 400);
    };

    /* 언로드 안전망 — 디바운스(400ms) 대기 중 탭이 닫히면 마지막 편집이 유실됐다.
       pagehide(데스크톱 닫기/새로고침) + visibilitychange=hidden(모바일 스와이프 종료·앱 전환)에서
       대기 타이머를 즉시 비우고 동기 flush. 여러 번 불려도 flush는 멱등(같은 상태를 다시 쓸 뿐). */
    if (typeof window !== 'undefined') {
      const flushNow = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        flush();
      };
      window.addEventListener('pagehide', flushNow);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNow();
      });

      /* 멀티탭 동기화(수신) — 다른 탭이 저장하면 그 스냅샷을 채택한다. 단, 내 편집이 디바운스
         대기 중이면 건너뜀(곧 내 flush가 방송된다 — 마지막 편집자 우선). 채택은 영속하지 않아
         메아리 루프가 없다(BroadcastChannel은 발신 탭에 배달되지 않음). */
      onSync((m) => {
        if (m.kind !== 'app' || timer) return;
        set((s) => {
          s.state = splitRuntime(refineItemColors(boot(storage)));
        });
      });
    }

    return {
      state: splitRuntime(refineItemColors(boot(storage))),
      mutate(recipe) {
        set((s) => {
          recipe(s.state);
        });
        schedulePersist();
      },
      loadState(next) {
        set((s) => {
          s.state = splitRuntime(next); // 가져온 스냅샷에 남아있던 런타임 캐시도 분리(디스크 왕복 대칭)
        });
        flush(); // 통째 교체는 즉시 영속(디바운스 X) — 가져오기/복구 직후 새로고침해도 안전.
      },
      setRuntimeCache(key, val) {
        // _knowState는 schedule() 입력 — state 참조를 갈아 selectSchedule 무효화(정확성에 필요).
        // 저장은 스케줄하지 않는다: 값은 다음 mutate의 디바운스 flush에 묻어 로컬에 남는다.
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
