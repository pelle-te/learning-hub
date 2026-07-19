/* ============================================================
   useApp.ts — 로컬-퍼스트 앱 상태의 단일 원천(Zustand + Immer).
   레거시의 전역 state/persist/render 3개를 이 스토어로 리다이렉트 → 원천이 하나라
   Strangler 이전 중에도 동기화 문제가 없다(설계도 §5).
   액션은 lib의 순수 함수를 호출하는 얇은 오케스트레이션 + 디바운스 영속(+IDB 미러).
============================================================ */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { setAutoFreeze } from 'immer';
import { boot, persist, serialize, setDone, defaults, CORRUPT_KEY, KEY } from '@/lib/persistence';
import { mergeRuntime, splitRuntime } from './useRuntime';
import { refineItemColors } from '@/lib/utils';
import { idbMirror } from '@/lib/idb';
import { mirrorAndVerify } from '@/lib/db/dual';
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

/* 부팅 최후 방어선 — boot()는 JSON 파싱 실패를 이미 CORRUPT_KEY 보존 + defaults()로 덮지만,
   그 뒤의 refineItemColors/splitRuntime이 throw하면(예: items에 비객체 원소) 여기서 터진다.
   이 코드는 zustand create() 안, 즉 *모듈 평가 시점*이라 렌더 트리 밖이다 — main.tsx의 ShellFallback도
   App.tsx의 TabFallback도 못 잡아 앱이 영구 백지가 되고, 사용자가 localStorage를 손으로 지우기 전까지
   자가 복구 경로가 0이었다. 원본을 보존한 뒤 기본 상태로 부팅해 최소한 앱은 뜨게 한다. */
function bootSafely(): AppState {
  try {
    return splitRuntime(refineItemColors(boot(storage)));
  } catch (e) {
    try {
      const raw = storage.getItem(KEY);
      if (raw != null && storage.getItem(CORRUPT_KEY) == null) storage.setItem(CORRUPT_KEY, raw);
    } catch {
      /* 보존 실패해도 부팅은 계속 — 백지보다 낫다. */
    }
    console.error('[러닝허브] 저장 데이터 복원 실패 — 기본 상태로 부팅합니다.', e);
    setTimeout(
      () => toast('저장 데이터가 손상돼 기본 상태로 시작했어요. 원본은 보존돼 있습니다(⋯ 메뉴 → 복구).', 'bad', 8000),
      0,
    );
    return splitRuntime(refineItemColors(defaults()));
  }
}

export interface AppStore {
  state: AppState;
  /** 임의 변형 + 영속 — 얇은 오케스트레이션(features가 lib 순수함수를 recipe로 넘김). */
  mutate: (recipe: (s: AppState) => void) => void;
  /** 상태 통째 교체(가져오기·되돌리기·복구) + 즉시 영속. */
  loadState: (s: AppState) => void;
  /** 디바운스를 건너뛰고 지금 저장한다(창 닫기 가드 전용).
   *  `pagehide` 안전망과 달리 **호출 시점을 밖에서 정할 수 있어야** 닫기를 보류한 채
   *  비동기 SQL 쓰기까지 끝낼 수 있다(2단계-C 실측: 안 그러면 그 쓰기가 잘린다). */
  flushNow: () => void;
  /** 서버/외부 캐시 write-through — schedule() *입력*인 _knowState 전용(graphPriority).
   *  plan-무관 캐시(_ankiLive·_icsExport 등)는 useRuntime store가 소유 — state 참조를 갈지 않아
   *  selectSchedule 재계산이 없다(B1/B3). 영속 스코프(내보내기 제외·로컬 유지)는 두 경로 동일. */
  setRuntimeCache: (key: '_knowState', val: AppState['_knowState']) => void;
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
    /* 미저장 편집 recipe 큐(감사 2026-07-16 ②#24) — 디바운스 창에서 외부 스냅샷이 오면
       '건너뛰기(스냅샷 단위 LWW · 상대 탭 편집 통째 소실)' 대신 '채택 후 내 recipe 재적용(rebase)'.
       recipe는 상태 변형 의도(semantic op)라 새 베이스 위 재적용이 곧 필드 단위 병합이 된다. */
    let pending: Array<(s: AppState) => void> = [];
    const flush = () => {
      // 대기/만료 타이머 정리 — 만료된 핸들이 남으면 onSync의 '내 편집 대기 중' 가드가 영구 참이 돼
      // 첫 편집 이후 외부 스냅샷 채택(대시보드 모드)이 조용히 죽는다(감사 추가#3에서 테스트로 발견).
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // 런타임 캐시(useRuntime)는 저장 직전에만 병합 — 디스크 JSON 형태는 분리 이전과 동일(계약 불변).
      let json: string | null = null;
      try {
        json = persist(storage, mergeRuntime(get().state));
        // ⚠ 큐 소진은 **저장이 성공한 뒤에만**. 예전엔 persist 앞에서 비웠는데, 쿼터 초과로 저장이
        //   실패하면 토스트만 뜨고 큐는 이미 빈 상태였다 → 그 뒤 다른 탭 방송이 오면 onSync가
        //   디스크의 *옛* 스냅샷을 채택하고 재적용할 recipe가 없어, 저장 실패한 편집이 화면에서도
        //   조용히 사라졌다("저장 실패" 토스트 + 편집 롤백 = 이중 손실).
        //   실패 시 큐를 남기면 다음 flush나 onSync 재적용에서 그 편집이 다시 실린다.
        pending = [];
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
      // 2단계-D 양방향 검증 구간 — 같은 상태를 SQLite 에도 기록하고 되읽어 대조한다.
      // **정본은 아직 위의 localStorage** 이고 이건 나란히 도는 그림자 경로다. 그래서
      // (a) await 하지 않고 (b) 실패해도 flush 를 실패로 만들지 않는다. 브라우저에선 no-op.
      // 2단계-E 에서 정본이 뒤집히면 이 호출은 사라지고 위쪽이 그림자가 된다.
      void mirrorAndVerify(mergeRuntime(get().state));
    };
    /** 텍스트 입력마다 쓰지 않게 디바운스(설계도 §1-A). */
    const schedulePersist = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 400);
    };

    /* 언로드 안전망 — 디바운스(400ms) 대기 중 탭이 닫히면 마지막 편집이 유실됐다.
       pagehide(데스크톱 닫기/새로고침) + visibilitychange=hidden(모바일 스와이프 종료·앱 전환)에서
       대기 타이머를 즉시 비우고 동기 flush. 여러 번 불려도 flush는 멱등(같은 상태를 다시 쓸 뿐).
       dirty 조건(감사 2026-07-16 ②#27): 대기 편집이 없으면 이미 영속된 상태라 flush가 순수 낭비 —
       무편집 탭 전환마다 전체 직렬화+기록+방송(수신 탭 전체 re-boot)이 반복되던 것을 차단.
       안전망 목적은 그대로: 유실될 수 있는 건 '대기 중(timer)' 편집뿐이다. */
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        if (timer) flush();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && timer) flush();
      });

      /* 멀티탭 동기화(수신) — 다른 탭이 저장하면 그 스냅샷을 채택한다. 내 편집이 디바운스 대기
         중이면 '건너뛰기(스냅샷 LWW — 상대 편집 필드 무관 통째 소실 · ②#24)' 대신 **채택 후 내
         recipe 재적용(rebase)** — 서로 다른 필드의 동시 편집이 둘 다 살아남고, 곧 내 flush가
         병합 결과를 방송한다. 채택 자체는 영속하지 않아 메아리 루프가 없다(BroadcastChannel은
         발신 탭에 배달되지 않음 · 재적용분은 진행 중인 내 디바운스가 영속). */
      onSync((m) => {
        if (m.kind !== 'app') return;
        set((s) => {
          s.state = splitRuntime(refineItemColors(boot(storage)));
          for (const r of pending) r(s.state);
        });
      });
    }

    /** 편집 공통 경로 — 적용 + rebase 큐 기록(②#24) + 디바운스 영속. */
    const commit = (recipe: (s: AppState) => void) => {
      set((s) => {
        recipe(s.state);
      });
      pending.push(recipe);
      schedulePersist();
    };

    return {
      state: bootSafely(),
      mutate(recipe) {
        commit(recipe);
      },
      flushNow() {
        flush();
      },
      loadState(next) {
        pending = []; // 통째 교체 — 이전 편집 의도는 무효(가져오기/복구가 새 정본)
        set((s) => {
          s.state = splitRuntime(next); // 가져온 스냅샷에 남아있던 런타임 캐시도 분리(디스크 왕복 대칭)
        });
        flush(); // 통째 교체는 즉시 영속(디바운스 X) — 가져오기/복구 직후 새로고침해도 안전.
      },
      setRuntimeCache(key, val) {
        // _knowState는 schedule() 입력 — state 참조를 갈아 selectSchedule 무효화(정확성에 필요).
        // 저장은 스케줄하지 않는다: 값은 다음 mutate의 디바운스 flush에 묻어 로컬에 남는다.
        // rebase 큐에도 안 넣는다(재-fetch 가능한 write-through 캐시 — 편집 의도 아님).
        set((s) => {
          // 키가 '_knowState' 하나로 좁혀져 있어 동적 인덱싱 캐스트가 필요 없다
          // (예전엔 val이 unknown이라 state를 Record<string, unknown>으로 낮춰야 했다).
          s.state[key] = val;
        });
      },
      setTheme(t) {
        commit((s) => {
          s.theme = t;
        });
      },
      toggleDone(ds, sid, type, plannedMin, on) {
        commit((s) => {
          setDone(s, ds, sid, type, plannedMin, on);
        });
      },
      addCbms(ds, sid, name, chapter, code, note, conf) {
        commit((s) => {
          M.addCbms(s, ds, sid, name, chapter, code, note, conf);
        });
      },
      setBlankResult(ds, sid, name, passed, note, chapter) {
        commit((s) => {
          M.setBlankResult(s, ds, sid, name, passed, note, chapter);
        });
      },
    };
  }),
);
