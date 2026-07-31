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
// ⚠ `isMergeApplyPending` 은 이제 여기서 읽지 않는다 — 판정이 `writeAndVerify` 안으로 갔다(C-2).
import { writeAndVerify, endMergeApply } from '@/lib/db/write';
import { preloadedState } from '@/lib/db/boot';
import { isSqlitePrimary } from '@/lib/db/sqlite';
import { markDbFallback, setSaveFallback } from '@/lib/db/fallback';
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

/* 정본(SQLite)이 죽었을 때의 **임시** 저장(C1 · 2026-07-26 감사). 이 사본이 그 세션에 남는
   유일한 사용자 데이터다 — 다음 부팅에 DB 가 여전히 죽어 있으면 `initAppStore` 가 폴백해 이걸
   읽고, 회복돼 있으면 배너가 파일로 회수시킨다(`lib/db/fallback.ts` 머리주석이 SSOT).
   ⚠ 성공/실패를 삼키지 않는 것이 요점이 아니다 — **폴백이 아예 없던 것**이 결함이었다. */
function persistFallback(merged: AppState): void {
  let json: string | null = null;
  try {
    json = persist(storage, merged);
    markDbFallback();
  } catch {
    /* 임시 저장마저 실패(쿼터 초과 등) — 사용자에게 남은 길은 내보내기뿐이고 배너가 그걸 요구한다. */
  }
  try {
    idbMirror(json ?? serialize(merged));
  } catch {
    /* 직렬화 자체 실패(비정상 상태) — 미러 불가 */
  }
}

/* 부팅 최후 방어선 — boot()는 JSON 파싱 실패를 이미 CORRUPT_KEY 보존 + defaults()로 덮지만,
   그 뒤의 refineItemColors/splitRuntime이 throw하면(예: items에 비객체 원소) 여기서 터진다.
   이 코드는 zustand create() 안, 즉 *모듈 평가 시점*이라 렌더 트리 밖이다 — main.tsx의 ShellFallback도
   App.tsx의 TabFallback도 못 잡아 앱이 영구 백지가 되고, 사용자가 localStorage를 손으로 지우기 전까지
   자가 복구 경로가 0이었다. 원본을 보존한 뒤 기본 상태로 부팅해 최소한 앱은 뜨게 한다. */
function bootSafely(): AppState {
  try {
    // 2단계-E: 셸에선 `initAppStore()`(main.tsx가 마운트 전에 await)가 SQLite에서 읽어 둔다.
    // 없으면(브라우저·dev·트랙 A·이관 실패) 기존 localStorage 경로 — 폴백을 남기는 게 계약이다.
    const pre = preloadedState();
    return splitRuntime(refineItemColors(pre ?? boot(storage)));
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
  /** 백그라운드 동기화 병합 결과를 메모리에 반영한다 — `loadState` 와 **다르다**(C1).
   *  `loadState` 는 가져오기 의미론이라 `pending`(미flush 편집)을 비우고 통째 교체 후 즉시
   *  flush 하는데, 병합에 그걸 쓰면 병합 진행 중 들어온 로컬 편집이 조용히 소실된다. 이 진입점은
   *  병합 스냅샷 위에 `pending` 을 **재적용(rebase)** 해 진행 중 편집을 보존한다. */
  applyMerged: (s: AppState) => void;
  /** 디바운스를 건너뛰고 지금 저장한다(창 닫기 가드 전용).
   *  `pagehide` 안전망과 달리 **호출 시점을 밖에서 정할 수 있어야** 닫기를 보류한 채
   *  비동기 SQL 쓰기까지 끝낼 수 있다(2단계-C 실측: 안 그러면 그 쓰기가 잘린다). */
  flushNow: () => void;
  /** 서버/외부 캐시 write-through — schedule() *입력*인 _knowState 전용(graphPriority).
   *  plan-무관 캐시(_ankiLive·_icsExport 등)는 useRuntime store가 소유 — state 참조를 갈지 않아
   *  selectSchedule 재계산이 없다(B1/B3). 영속 스코프(내보내기 제외·로컬 유지)는 두 경로 동일. */
  setRuntimeCache: (key: '_knowState', val: AppState['_knowState']) => void;
  setTheme: (t: Theme) => void;
  /** 블록 완료 토글. `actualMin` 은 **실제로 집중한 분**(G-1) — 집중 세션이 끝나 그것을 아는
   *  경로만 넘긴다. 손으로 체크한 경우엔 실측이 없으므로 안 넘기고, 회고는 계획 분으로 폴백한다. */
  toggleDone: (ds: string, sid: string, type: SessionType, plannedMin: number, on: boolean, actualMin?: number) => void;
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
      /* ⚠⚠ **병합 반영 중이면 쓰지 않고 미룬다(C1) — 그 판정은 이제 `writeAndVerify` 안에 있다(C-2).**

         종전엔 여기서 `isMergeApplyPending()` 을 보고 `return` 했다. 그 판정은 `runExclusive` 체인
         **밖**이라, 창을 켜는 `beginMergeApply()` 가 `applyPull` 콜백 *마지막 줄*에 있는 동안(=그
         콜백이 도는 수백 ms) 플래그가 아직 false 여서 **가드를 통과했다**. 통과한 쓰기는 체인 뒤에
         줄을 서서 *병합-후 기준선* 과 *병합-전 메모리* 를 diff 하고, 그것이 곧 받아온 행을 되돌리는
         문장이다 — 가드가 막으려던 결과 그대로다. 상세 논증은 `db/write.ts` 의 C-2 절이 SSOT.

         → 판정을 체인 안 한 곳으로 옮기고, 여기서는 그 결과(`r.deferred`)를 **받아서** 큐를
           되살리고 재예약한다. 판정이 두 곳이면 언젠가 한쪽만 고쳐진다. */
      // 런타임 캐시(useRuntime)는 저장 직전에만 병합 — 디스크 JSON 형태는 분리 이전과 동일(계약 불변).
      const merged = mergeRuntime(get().state);

      /* 2단계-E — 셸에선 **SQLite 가 정본**이다. 여기서 localStorage 를 안 쓰는 것이 이 단계의
         전부다: 5MB 절벽은 "상태 1벌"이 아니라 KEY + BACKUP_KEY + reads 가 동시에 상주해서
         생기는데(2단계-0 실측 ≈3.04MB), 가장 크고 항상 있는 KEY 가 빠지면 절벽에서 멀어진다.
         IDB 미러도 안 건다 — 그 층의 존재 이유가 "사이트 데이터 삭제로 localStorage 전소"인데
         셸에는 그 위협이 없다. (브라우저 경로에선 아래 else 로 그대로 유지된다.) */
      /* ⚠ C-6 — 조건이 `isTauri()` 에서 `isSqlitePrimary()` 로 바뀌었다. 폰은 Tauri 가
         아니지만 SQLite 가 정본이다. 여기를 안 바꾸면 폰 편집이 localStorage 로 가는데
         **아웃박스는 SQLite 만 훑으므로 그 편집은 영원히 동기화되지 않는다**(조용한 유실). */
      if (isSqlitePrimary()) {
        /* ⚠⚠ **큐를 버리지 말고 이 회차가 빌린다(C-2).** 옛 주석은 _"셸·폰 모두 단일 윈도우 —
           rebase 상대가 없으므로 큐를 들고 있을 이유가 없다"_ 였는데, **rebase 상대가 있다**:
           `applyMerged` 가 클라우드 병합 스냅샷 위에 `pending` 을 재적용한다(그 함수 주석이 그것을
           자기 존재 이유로 든다). 즉 여기서 비우면 병합창에 걸린 편집이 메모리·큐·타이머 어디에도
           남지 않아 **영구 소실**된다 — C-2 의 두 번째 절반이다.
           같은 파일 아래 브라우저 경로는 이 규율을 이미 지킨다(_"큐 소진은 저장이 성공한 뒤에만"_). */
        const borrowed = pending;
        pending = [];
        void writeAndVerify(merged).then((r) => {
          /* 미뤘다면 실패가 아니다 — 빌린 큐를 **그 사이 쌓인 것보다 앞에** 돌려놓고(시간 순서
             보존) 재예약한다. `applyMerged` 가 창을 닫으며 이 recipe 들을 병합 스냅샷에 재적용한다. */
          /* ⚠ **쓰기 실패도 큐를 돌려준다(H10 · 2026-07-31 `/감사 근본`).** 종전엔 `deferred` 만
             복구해서, 쓰기 실패(`!ok` — 되읽기 불일치·SQL 실패)면 빌린 recipe 가 사라졌다. 그 뒤
             클라우드 병합이 도착하면 `applyMerged` 가 재적용할 것이 없어 **저장 실패한 편집이
             화면에서도 사라진다** — 바로 아래 브라우저 경로 주석이 "이중 손실"이라 부른 그 형태다.
             ⚠ `unavailable` 은 **제외한다**: 그 경로는 `persistFallback` 이 전체 스냅샷을 임시
             사본으로 남기므로 재적용할 것이 이미 있고, 넣으면 DB 가 죽어 있는 동안 400ms 마다
             재시도하는 **뜨거운 루프**가 되고 큐도 무한히 자란다(막으려던 것보다 나쁘다). */
          const writeFailed = !r.ok && !r.unavailable;
          if (r.deferred || writeFailed) {
            pending = [...borrowed, ...pending];
            schedulePersist();
            if (r.deferred) return;
          }
          /* ⚠⚠ **정본이 죽었으면 여기서 끝내지 않는다(C1 · 2026-07-26 감사).** 예전엔 연결 실패가
             `skipped`(= "브라우저라 정상")로 와서 이 콜백이 아무것도 안 했고, 위 `return` 때문에
             아래 localStorage 폴백도 안 탔다. 결과: 그 세션 편집이 **메모리에만** 살고 재시작하면
             낡은 데이터로 떠서 사용자에겐 "저장한 게 사라졌다"가 됐다(무음 유실).
             지금은 임시 사본을 남기고(다음 부팅에 DB 가 여전히 죽어 있으면 `boot(storage)` 가
             이걸 읽는다) 마커를 찍는다 — 지속 배너(`app/StorageBanner`)가 그 사실을 말한다.
             토스트가 아니라 배너인 이유: 30초 스로틀 토스트는 자리를 비운 사이 통째로 놓친다. */
          setSaveFallback(r.unavailable);
          if (r.unavailable) persistFallback(merged);
          else if (!r.ok && !r.skipped) warnSaveFailure();
        });
        return;
      }

      let json: string | null = null;
      try {
        json = persist(storage, merged);
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
      applyMerged(next) {
        /* ⚠ C1 — 병합 반영 전용. `loadState` 와 갈라 두는 이유가 이 함수의 존재 이유다.

           `syncController.runSync` 가 병합 스냅샷을 여기로 싣는다. 병합은 네트워크 왕복(push→pull)
           동안 진행되고, 그 사이 사용자가 로컬 편집을 하면 `commit` 이 메모리 반영 + `pending.push`
           + 400ms flush 예약을 한다. 그 편집이 아직 DB 에 flush 되기 전이면 병합 스냅샷(`merge.ts`
           의 `readRows()` 시점 고정)에는 **없다**. 여기서 `loadState` 를 쓰면 그 편집이 메모리·큐·
           타이머에서 모두 지워져 **영구 소실**된다(fence·`runExclusive` 가 못 막는 별개 벡터).

           그래서 스냅샷 위에 `pending` 을 **재적용(rebase)** 한다 — 멀티탭 `onSync`(위)와 동형이다.
           recipe 는 편집 *의도*라 새 베이스 위 재적용이 곧 필드 단위 병합이 된다. 재적용된 편집은
           `pending` 에 남아 이어지는 flush 가 정본에 쓰고 아웃박스로 올린다(유실도 역전파도 없다).
           병합 자체는 이미 `applyPull` 이 정본·기준선을 세웠으므로, 진행 중 편집이 없으면 여기서
           flush 하지 않는다(기준선=스냅샷이라 어차피 빈 diff). */
        set((s) => {
          s.state = splitRuntime(next);
          for (const r of pending) r(s.state);
        });
        /* ⚠ 메모리 반영이 끝났으니 **C1 창을 닫는다** — 이제 기준선(병합-후)과 메모리(병합-후+재적용
           편집)가 일치하므로 이후 flush 는 재적용 편집만 diff 로 쓴다(받아온 행 되돌림 없음). 이 호출과
           `set()` 사이엔 await 가 없어 창 종료도 원자적이다. `runSync` finally 가 실패 경로를 방어한다. */
        endMergeApply();
        if (pending.length) schedulePersist();
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
      toggleDone(ds, sid, type, plannedMin, on, actualMin) {
        commit((s) => {
          setDone(s, ds, sid, type, plannedMin, on, actualMin);
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
