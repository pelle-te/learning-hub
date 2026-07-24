/* ============================================================
   store/syncController.ts — 동기화 **구동**의 단일 원천(C-1·H-2 통합 · 2026-07-24).

   `lib/cloud/run.ts` 의 `syncOnce()` 는 "무엇을 하나"(push→pull→merge)를 소유하고 **이미
   겹침 불가**다(재진입 가드가 거기 있다). 이 파일은 그 위에서 "**언제** 부르고, 병합 결과를
   **어떻게** 메모리에 싣나"만 정한다 — `lib/` 는 zustand 를 모르므로(레이어 단방향) 그 접합이
   store 층에 있어야 한다(`app → … → store → lib`).

   ## 왜 진입점마다 두지 않고 여기 하나로

   종전엔 폰(`phone/sync.ts`)과 데스크톱(`app/StorageGuard.tsx`)이 **같은 관심사를 두 벌로**
   구현했고 완성도가 갈렸다: 폰은 이벤트 기반(부팅·복귀·이탈·편집후), 데스크톱은 5분 폴링
   **단독**(편집후·이탈 push 없음)이라 편집→다른 기기 반영이 최대 5분 늦었다. 한 관심사의 두
   구현은 반드시 갈린다 — 실제로 갈렸다. 여기로 모아 두 진입점이 같은 트리거를 공유한다.

   ## ⚠ 폴링은 데스크톱의 보조일 뿐이다

   화면을 안 보는 동안의 최신성은 값이 0인데 Workers 무료 플랜의 일일 요청 한도는 그대로
   먹는다(설계서 §9-3b). 그래서 **기본은 이벤트 기반**이고, 폴링은 항상-켜짐 데스크톱에서만
   보조로 준다(`pollMs`). 폰은 폴링을 켜지 않는다.
============================================================ */
import { syncOnce, type SyncResult } from '@/lib/cloud/run';
import { applyPull } from '@/lib/cloud/merge';
import { nextStamp } from '@/lib/db/stamp';
import { endMergeApply } from '@/lib/db/write';
import { RUNTIME_CACHE_KEYS } from '@/lib/persistence';
import type { AppState } from '@/lib/types';
import type { ConflictShadow } from '@/lib/cloud/conflicts';
import { useApp } from './useApp';
import { useConflicts, shadowId } from './useConflicts';

/** 동기화에서 제외되는 런타임/휘발 캐시 키(내보내기·push 대상 아님 · `rows.ts` sync:false). */
const EPHEMERAL_SLICES = new Set<string>(RUNTIME_CACHE_KEYS);

/**
 * 두 상태에서 **동기화 대상 슬라이스**(런타임 캐시 제외)가 하나라도 참조가 바뀌었나(H3).
 *
 * immer 가 안 바뀐 슬라이스의 참조를 공유하므로 최상위 키 identity 비교로 충분하다 — 바뀐 것이
 * 런타임 캐시(`_knowState`·`_icsExport`·`_ankiLive`…)뿐이면 false 를 돌려 무의미한 동기화를 막는다.
 */
function syncedSliceChanged(next: AppState, prev: AppState): boolean {
  const a = next as unknown as Record<string, unknown>;
  const b = prev as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]); // 추가/삭제 키까지(삭제는 드물지만 정확성)
  for (const k of keys) {
    if (a[k] !== b[k] && !EPHEMERAL_SLICES.has(k)) return true;
  }
  return false;
}

/**
 * 동기화 1회 + 병합 결과를 메모리에 반영. `syncOnce` 는 lib 에서 이미 겹침 불가.
 *
 * ⚠ 병합 결과 적용이 **이 층의 책임**이다 — 안 하면 낡은 메모리가 다음 flush 에서 병합을
 * 덮는다(0단계-E 에서 물린 *낡은 메모리가 복원본을 덮는다*). `lib` 은 zustand 를 모른다.
 */
export async function runSync(): Promise<SyncResult> {
  try {
    const r = await syncOnce();
    // ⚠ `loadState` 가 아니라 `applyMerged`(C1). `loadState` 는 `pending`(미flush 편집)을 비우고
    // 통째 교체 후 flush 라, 병합 진행 중 들어온 로컬 편집을 조용히 소실시킨다 — 병합 스냅샷 위에
    // 그 편집을 재적용(rebase)하는 진입점을 써야 한다(useApp `applyMerged` 주석).
    if (r.state) useApp.getState().applyMerged(r.state); // 이 안에서 endMergeApply() 로 C1 창을 닫는다
    // ⚠ 병합이 덮은 동시 편집을 기록한다(Phase 4 · 관측만 — 병합 결과는 이미 위에서 확정됐다).
    // 로컬 전용 store 라 여기(store 층)가 접합점이다(`lib` 은 zustand 를 모른다 · run.ts 가 결과만 실어 온다).
    if (r.conflicts?.length) useConflicts.getState().add(r.conflicts);
    // 관측성(설계서 §14 발전 #4) — 마지막 시도 기록. `disconnected`(연결 안 됨)는 "시도"가
    // 아니라 남기지 않는다. 설정 카드가 "마지막 동기화 N분 전"으로 읽는다.
    if (r.status !== 'disconnected') _lastSync = { at: Date.now(), result: r };
    return r;
  } finally {
    /* ⚠ **C1 방어망.** `applyPull` 이 병합 창을 켰는데(`beginMergeApply`) 이후 `commitPullMark`
       실패로 `runSyncOnce` catch 가 state=null 을 돌려주면 `applyMerged` 가 안 불려 창이 영영 안
       닫히고 flush 가 영구 정지한다. `runSync` 가 병합 반영의 유일한 진입점이므로 여기서 무조건
       닫는다 — `applyMerged` 가 이미 닫았으면 no-op, 실패 경로면 여기서 푼다. */
    endMergeApply();
  }
}

/**
 * 충돌 그림자의 **패배한 로컬 값을 되살린다**(Phase 4 완결 — 관측→행동).
 *
 * 되살리기 = 그 값을 **fresh 스탬프로 다시 쓰는 것**이다. 검증된 병합 기계(`applyPull`)에 한 행짜리
 * 합성 배치를 먹여 재사용한다 — 정본 쓰기·기준선 세우기·메모리 반영·에코 방지가 전부 그 안에
 * 있어(merge.ts) **테이블 무관하게** 안전하다. 손으로 테이블별 mutate 를 짜면 그 불변식을 다시
 * 구현해야 하고, 그건 이 저장소가 divergence 로 반복해 물린 실수다.
 *
 * `nextStamp()` 는 단조 최대라 원격 승자(remoteUpdatedAt · 원 병합에서 이미 seed됨)보다 크다 →
 * 되살린 값이 LWW 로 이기고, `syncSoon()` 이 다른 기기로도 밀어올린다.
 */
export async function restoreConflict(shadow: ConflictShadow): Promise<void> {
  const merged = await applyPull({
    since: 0,
    upto: 0,
    rows: [{ tbl: shadow.tbl, key: shadow.key, data: shadow.localData, updatedAt: nextStamp() }],
    tombstones: [],
  });
  try {
    if (merged.state) useApp.getState().applyMerged(merged.state);
  } finally {
    endMergeApply(); // C1 방어망 — applyPull 이 연 병합-적용 창을 반드시 닫는다(실패 경로 포함)
  }
  useConflicts.getState().dismiss(shadowId(shadow)); // 해소됨
  syncSoon(); // 되살린 값을 다른 기기로 전파
}

/** 마지막 동기화 시도 기록(연결됐을 때만). 관측성 readout 이 읽는다. */
export interface LastSync {
  at: number;
  result: SyncResult;
}
let _lastSync: LastSync | null = null;
export function lastSync(): LastSync | null {
  return _lastSync;
}

/** 편집 뒤 동기화까지의 유예. `useApp` 영속 디바운스(400ms)보다 **길어야** 아웃박스가 아직
 *  SQLite 에 안 쓰인 편집을 놓치지 않는다(놓치면 다음 회차로 밀린다). */
const AFTER_EDIT_MS = 1200;
let _editTimer: ReturnType<typeof setTimeout> | null = null;

/** 설치된 트리거 세트의 실행기(`beforeSync`(산출물 미러)+겹침 가드 포함). 없으면 맨 `runSync`.
 *  ⚠ `syncSoon` 이 이걸 거쳐야 편집 트리거 동기화도 미러를 함께 올린다(H5) — 종전엔 `runSync` 를
 *  직접 불러 `beforeSync`·`_running` 을 우회했다. */
let _activeRun: (() => void) | null = null;

/** 편집 뒤 한 박자 쉬고 동기화. 연속 편집은 마지막 하나로 합쳐진다(디바운스). */
export function syncSoon(): void {
  if (_editTimer) clearTimeout(_editTimer);
  _editTimer = setTimeout(() => {
    _editTimer = null;
    if (_activeRun) _activeRun();
    else void runSync();
  }, AFTER_EDIT_MS);
}

export interface SyncTriggerOptions {
  /** 폴백 폴링 주기(ms). 데스크톱처럼 항상-켜짐 환경만 준다. 폰은 생략(폴링 금지 — 머리주석). */
  pollMs?: number;
  /** 편집(상태 변경) 뒤 자동 동기화 예약. 기본 true. */
  onEdit?: boolean;
  /** 앱 이탈(`pagehide`) 시 마지막 push. 폰은 스와이프 종료가 정상 종료라 true, 데스크톱은
   *  창 닫기 가드가 로컬을 확정하고 다음 부팅이 재개하므로 false(닫기 중 네트워크 동기화를
   *  띄우지 않는다 — 창 파괴에 잘려 낭비다). */
  onPagehide?: boolean;
  /** 매 동기화 **직전** 준비(예: 산출물 미러 — 이번 배치에 함께 올라가야 하는 로컬 쓰기). */
  beforeSync?: () => Promise<void>;
  /** 각 동기화 결과 콜백(예: `blocked` 토스트). */
  onResult?: (r: SyncResult) => void;
}

/**
 * 부팅 시 1회 설치. 복귀·(옵션)이탈·(옵션)편집·(옵션)폴링에서 동기화한다. 해제 함수를 돌려준다.
 *
 * ⚠ `beforeSync`+`runSync` 를 **한 단위로 겹침 방지**한다(`_running`). `syncOnce` 자체는 lib 에서
 * 이미 겹침 불가지만, 그 앞의 `beforeSync`(미러 등)는 그 가드 밖이라 트리거가 몰리면 중복
 * 실행될 수 있다 — 이 가드가 그 창을 닫는다.
 */
export function installSyncTriggers(opts: SyncTriggerOptions = {}): () => void {
  const { pollMs, onEdit = true, onPagehide = false, beforeSync, onResult } = opts;

  let _running: Promise<void> | null = null;
  const run = (): void => {
    if (_running) return; // 이미 도는 중 — 겹쳐 미러/동기화하지 않는다
    _running = (async () => {
      if (beforeSync) await beforeSync();
      const r = await runSync();
      onResult?.(r);
    })()
      .catch(() => {
        /* 동기화 실패는 조용히 넘긴다 — 로컬은 멀쩡히 동작하고 다음 트리거가 재개한다. */
      })
      .finally(() => {
        _running = null;
      });
  };
  // 편집 디바운스(`syncSoon`)가 이 실행기를 거치게 한다 — beforeSync·겹침 가드를 함께 상속(H5).
  _activeRun = run;

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') run();
  };
  document.addEventListener('visibilitychange', onVisible);

  const onHide = (): void => run();
  if (onPagehide) window.addEventListener('pagehide', onHide);

  let unsub: (() => void) | undefined;
  if (onEdit) {
    // immer 가 편집마다 새 state 참조를 만든다 → 참조가 갈리면 진짜 편집이다.
    // ⚠ **동기화 대상 슬라이스가 바뀔 때만** 예약한다(H3 · 2026-07-24 감사). 종전엔 `s.state` 참조가
    //    갈리기만 하면 예약해서, `setRuntimeCache`(_knowState·_icsExport·_ankiLive — sync:false·절대 push
    //    안 됨)까지 **살아 있는 네트워크 pull** 을 유발했다. 스케줄 재계산 한 번이 무의미한 동기화 한 번이
    //    되어 Workers 일일 요청 한도를 태웠다(설계서 §9-3b 가 명시 제약으로 두는 그 예산). immer 는 안 바뀐
    //    슬라이스의 참조를 공유하므로, 최상위 키별 identity 비교로 **바뀐 슬라이스가 런타임 캐시뿐이면 건너뛴다**.
    unsub = useApp.subscribe((s, prev) => {
      if (s.state !== prev.state && syncedSliceChanged(s.state, prev.state)) syncSoon();
    });
  }

  let pollId: ReturnType<typeof setInterval> | null = null;
  if (pollMs) pollId = setInterval(run, pollMs);

  run(); // 설치 즉시 1회 — 열었다 = 최신을 보고 싶다.

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    if (onPagehide) window.removeEventListener('pagehide', onHide);
    unsub?.();
    if (pollId) clearInterval(pollId);
    if (_editTimer) {
      clearTimeout(_editTimer);
      _editTimer = null;
    }
    if (_activeRun === run) _activeRun = null; // 이 세트가 소유한 실행기만 거둔다
  };
}
