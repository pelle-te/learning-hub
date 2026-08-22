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
import { readCloudConfig } from '@/lib/cloud/client';
import { applyPull } from '@/lib/cloud/merge';
import { nextStamp } from '@/lib/db/stamp';
import { endMergeApply, withMergeSession } from '@/lib/db/write';
import { RUNTIME_CACHE_KEYS } from '@/lib/persistence';
import { onVisible } from '@/lib/visibility';
import type { AppState } from '@/lib/types';
import type { ConflictShadow } from '@/lib/cloud/conflicts';
import { toast } from '@/shell/toast'; // zustand 단독 모듈이라 store→shell 순환이 없다(useApp 과 같은 근거)
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
/* ⚠⚠ **병합 반영은 한 번에 하나다(H8 · 2026-07-31 `/감사 근본`).**

   `beginMergeApply`/`endMergeApply`(`db/write.ts`)는 **불리언**이라 중첩되지 않는다. 그런데
   `runSync` 와 `restoreConflict` 는 둘 다 창을 열고 둘 다 `finally` 에서 무조건 닫는데,
   `restoreConflict` 는 어느 겹침 가드에도 안 들어 있었다. 그래서 `runSync` 가 `commitPullMark`
   (체인 밖 IPC)를 기다리는 사이 사용자가 "되살리기"를 누르면:

     ① restore 의 `applyPull` 이 창을 다시 켠다 → ② restore 의 finally 가 **먼저** 닫는다
     → ③ 그 순간 디바운스 flush 가 통과해 *병합-후 기준선* vs *병합-전 메모리* 를 diff 한다
       (= `write.ts` 의 C-2 절이 기술한 소실 경로)
     → ④ 이어서 `runSync` 가 **되살리기 이전 스냅샷**으로 `applyMerged` 를 불러 복원값을 되돌리고,
       다음 flush 가 그 되돌림을 새 스탬프로 써서 **서버까지 밀어올린다.**

   처방으로 카운터를 고르지 않은 이유: 두 호출부가 **무조건 닫는 방어망**을 갖고 있어(그 자체가
   C1 의 안전장치다) 카운터로 바꾸면 방어망이 남의 창을 감산한다. 겹침을 *세는* 대신 **없앤다** —
   둘이 한 게이트를 공유하면 중첩이 성립하지 않고, 방어망의 의미도 그대로다.
   집행자는 `db/write.ts` 의 이중 열림 검출기다(이 게이트를 우회하는 새 경로가 생기면 시끄럽다). */
/* ⚠ **export 다 — 병합 창을 여는 새 경로는 반드시 이 게이트를 타야 한다.** 지금 호출자는 셋이다:
   `runSync` · `restoreConflict` · `undoController.undoLastEdit`(전역 ⌘Z). 되돌리기도 `applyPull` 을
   쓰므로 H8 의 중첩 조건에 그대로 해당한다 — 게이트 밖에 두면 그 사고가 세 번째 호출자로 재현된다.
   (집행자는 `db/write.ts` 의 이중 열림 검출기다: 우회 경로가 생기면 시끄럽게 보고한다.) */
/** 모르는 스키마 경고를 이 세션에 이미 말했나(M-10) — 아래 `runSyncInner` 가 읽는다. */
let _unknownToasted = false;

let _mergeGate: Promise<unknown> = Promise.resolve();
export function exclusiveMerge<T>(fn: () => Promise<T>): Promise<T> {
  /* ⚠ `withMergeSession` 은 직렬화가 아니라 **"게이트를 탔다"는 표식**이다(M-2). 직렬화는 위
     체인이 하고, 표식은 `lib` 의 우회 검출기(`beginMergeApply`)가 읽는다 — 그 검출기가
     *중첩*이 아니라 *게이트 밖*을 보게 되면서 드레인 다회차의 상시 오경보가 사라졌다.
     둘을 여기 한 문장에 묶어 두는 것이 요점이다: 게이트를 타면 표식도 반드시 선다. */
  const next = _mergeGate.catch(() => undefined).then(() => withMergeSession(fn));
  _mergeGate = next.catch(() => undefined);
  return next;
}

export async function runSync(): Promise<SyncResult> {
  return exclusiveMerge(runSyncInner);
}

async function runSyncInner(): Promise<SyncResult> {
  try {
    const r = await syncOnce();
    // ⚠ `loadState` 가 아니라 `applyMerged`(C1). `loadState` 는 `pending`(미flush 편집)을 비우고
    // 통째 교체 후 flush 라, 병합 진행 중 들어온 로컬 편집을 조용히 소실시킨다 — 병합 스냅샷 위에
    // 그 편집을 재적용(rebase)하는 진입점을 써야 한다(useApp `applyMerged` 주석).
    if (r.state) useApp.getState().applyMerged(r.state); // 이 안에서 endMergeApply() 로 C1 창을 닫는다
    // ⚠ 병합이 덮은 동시 편집을 기록한다(Phase 4 · 관측만 — 병합 결과는 이미 위에서 확정됐다).
    // 로컬 전용 store 라 여기(store 층)가 접합점이다(`lib` 은 zustand 를 모른다 · run.ts 가 결과만 실어 온다).
    if (r.conflicts?.length) useConflicts.getState().add(r.conflicts);
    /* ⚠ **서버가 이 빌드보다 새 스키마를 안다**(M-10 · 2026-08-06). 관용 파서가 버린 것은 실패가
       아니지만 사용자가 알아야 하는 사실이다 — 지금 화면이 **전부가 아닐 수 있다**는 뜻이고,
       처방은 앱 업데이트다. `lib` 은 토스트를 모르므로 그 말은 이 층이 한다(H2 와 같은 배치).
       ⚠ 세션 1회다: 이 상태는 업데이트 전까지 계속 참이라 매번 말하면 소음이 되고, 소음이 된
       경고는 곧 무시된다(같은 이유로 텔레메트리도 세션 1회 · `client.ts`). */
    if (r.unknownDropped && !_unknownToasted) {
      _unknownToasted = true;
      toast(`서버에 이 버전이 모르는 항목 ${r.unknownDropped}건이 있어요 — 앱을 업데이트해 주세요.`, 'warn', 8000);
    }
    // 관측성(설계서 §14 발전 #4) — 마지막 시도 기록. `disconnected`(연결 안 됨)는 "시도"가
    // 아니라 남기지 않는다. 설정 카드가 "마지막 동기화 N분 전"으로 읽는다.
    if (r.status !== 'disconnected') {
      _lastSync = { at: Date.now(), result: r };
      // 구독자에게 알린다(원장 갱신 등). 구독자 하나가 던져도 다른 구독자와 동기화를 막지 않는다.
      for (const cb of _resultSubs) {
        try {
          cb(r);
        } catch {
          /* 관측이 동기화를 해치지 않는다 */
        }
      }
    }
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
/* ⚠⚠ **실패 보고는 이 층이 소유한다 — 호출부 넷에 흩지 않는다**(H2 · 2026-08-01).

   종전엔 `restoreConflict` 도 `undoLastEdit` 도 던지기만 했고 호출부(`ConflictsNotice` ·
   `phone/ConflictsView` · `App.tsx` ⌘Z · `palette.ts`) 어디에도 `.catch` 가 없었다. 결과는
   **확인창까지 눌러 놓고 토스트 0 · 라이브리전 0** — 사용자에게는 "눌렀는데 아무 일도 안
   일어났다"이고, 그건 성공과 구분되지 않는다(그래서 다시 누른다).

   호출부마다 `.catch` 를 다는 대신 여기에 두는 이유는 `useCommitOnChange` 와 같다(E15):
   **입구가 여럿인 사건은 값 쪽에 붙이면 한 번에 전부 덮인다.** 새 호출부가 생겨도 상속된다. */
function reportFailure(what: string, e: unknown): void {
  toast(`${what} — ${e instanceof Error ? e.message : String(e)}`, 'bad', 8000);
}

export async function restoreConflict(shadow: ConflictShadow): Promise<void> {
  /* ⚠ `runSync` 와 **같은 게이트**를 탄다(H8) — 위 `exclusiveMerge` 주석이 이유를 갖는다. */
  try {
    await exclusiveMerge(async () => {
      /* ⚠⚠ **`applyPull` 자신이 `try` 안이어야 한다(H1 · 2026-08-01).** 종전엔 이 호출이 `try` 밖에
       있어, `beginMergeApply()` 를 켠 **뒤** 던지는 경로(정본 쓰기 실패·되읽기 대조 실패)에서
       아래 `finally` 에 도달하지 못했다. 그러면 병합-적용 창이 영영 열린 채로 굳고, 이후 flush 가
       전부 `deferred`(= `ok:true`)로 돌아와 **경고 하나 없이 그 세션의 편집이 하나도 저장되지
       않는다.** `merge.ts` 의 계약은 두 closer 를 명시하는데 `runSync` 쪽만 바깥 `finally` 로
       덮여 있어서 이 구멍이 안 보였다 — 열림과 닫힘은 **같은 try 로** 묶는다. */
      try {
        const merged = await applyPull(
          {
            since: 0,
            upto: 0,
            rows: [{ tbl: shadow.tbl, key: shadow.key, data: shadow.localData, updatedAt: nextStamp() }],
            tombstones: [],
          },
          /* ⚠⚠ **`echo:false` 가 이 함수의 정합성 전부다(C1).** 이건 원격 수신이 아니라 *로컬 편집*을
           검증된 병합 기계에 태운 것이다. 에코 억제표에 적히면 바로 다음 아웃박스 스캔이 이 행을
           **키·스탬프 정확 일치**로 건너뛰고 워터마크가 그 위로 전진해, 되살린 값이 다른 기기에
           **영원히 안 간다**(재시작해도 안 낫는다). 근거·실패 시나리오는 `merge.ts` 의
           `ApplyPullOptions.echo` 주석이 소유한다. */
          { echo: false },
        );
        if (merged.state) useApp.getState().applyMerged(merged.state);
      } finally {
        endMergeApply(); // C1 방어망 — applyPull 이 연 병합-적용 창을 반드시 닫는다(실패 경로 포함)
      }
    });
  } catch (e) {
    /* ⚠ 해소 표시(`dismiss`)를 **안 한다** — 실패했는데 목록에서 지우면 되살릴 기회가 사라진다. */
    reportFailure('되살리기에 실패했어요', e);
    return;
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

/* ⚠⚠ **결과 구독 — 원장이 동기화 뒤에 다시 읽히지 않고 있었다**(H3 · 2026-07-30).

   `useSyncLedger` 는 자기 주석에 _"대기 건수는 **동기화 시도 직후**에만 다시 센다"_ 고 적어
   뒀는데, 실제로 등록한 것은 `visibilitychange`·`online`·`offline` **뿐**이었다 — 동기화가
   끝났다는 사실을 알 방법이 없었다. 그래서 편집→동기화 뒤에도 헤더는 화면을 떠났다 돌아오기
   전까지 옛 대기 건수를 들고 있었고, 중단(`blocked`)은 **영원히** 안 보였다.

   구독을 `runSync` 에 두는 것이 요점이다: 동기화 진입점은 여럿이지만(`installSyncTriggers` 의
   트리거 · `syncSoon` · `CloudCard` 의 "지금 동기화" · 폰) `_lastSync` 를 쓰는 곳은 여기 하나다.
   `onResult` 옵션에 얹으면 그 옵션을 안 준 소비자(폰)가 상속받지 못한다 — 실제로 그랬다. */
const _resultSubs = new Set<(r: SyncResult) => void>();

/** 동기화 1회가 끝날 때마다(연결됐을 때만) 부른다. 해제 함수를 돌려준다. */
export function onSyncResult(cb: (r: SyncResult) => void): () => void {
  _resultSubs.add(cb);
  return () => {
    _resultSubs.delete(cb);
  };
}

/** 편집 뒤 동기화까지의 유예. `useApp` 영속 디바운스(400ms)보다 **길어야** 아웃박스가 아직
 *  SQLite 에 안 쓰인 편집을 놓치지 않는다(놓치면 다음 회차로 밀린다). */
const AFTER_EDIT_MS = 1200;

/** 창 복귀(`focus`) 동기화의 최소 간격(W24) — alt-tab 마다 돌면 Workers 일일 요청 예산을 태운다.
 *  값이 옛 폴링 주기와 같은 것은 우연이 아니다: **같은 구간을 덮는 장치**라 예산 성격이 같다. */
const FOCUS_MIN_GAP_MS = 5 * 60 * 1000;
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
  /** 실시간 poke 채널(Phase 2)을 켠다. **폰만** true — 데스크톱 Tauri 웹뷰는 CSP 로 WS 가 막힌다.
  /* ⚠ `live?: boolean`(실시간 poke 채널)이 여기 있었다 — 은퇴했다(I051 · 2026-08-22).
     남은 최신성 장치는 복귀·편집후 트리거와 `pollMs` 다(그 셋이 원래 정확성의 전제였다). */
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
  /* ⚠⚠ **도는 중에 온 트리거를 «한 번»으로 접어 뒤에 잇는다**(C044 · 2026-08-22).
     종전엔 `if (_running) return;` 하나였고, 그 반환이 **트리거를 버렸다**: `syncSoon` 은
     타이머가 뛰는 순간 `_editTimer = null` 로 자기를 소비하고 `_activeRun()` 을 부르므로,
     그 호출이 `_running` 에 막히면 **그 편집의 예약이 어디에도 안 남는다.**
     폴백 폴링도 없다(`pollMs` 는 호환용이고 데스크톱은 더 이상 주지 않는다 · W24) → 남는 것은
     `focus`(최소 간격 **5분**) · `online`(전이 이벤트라 안 온다) · 다음 편집뿐이다.
     실제 구간: 두 번째 기기 온보딩처럼 드레인이 도는 동기화(이 파일이 *"27라운드 × 1.2초 ≈
     30초"* 라 실측을 적어 뒀다) 중에 편집하면, 이 파일 머리주석이 결함으로 지목한
     *"편집→다른 기기 반영이 최대 5분 늦었다"* 가 그대로 재현된다.
     ⚠ **유실이 아니라 지연이다**(워터마크 기반이라 다음 스캔이 반드시 집는다) — 그래서 Minor.
     ⚠ 큐가 아니라 **부울**인 것이 의도다: 도는 동안 편집이 열 번 와도 뒤에 붙는 실행은 한 번이면
     충분하고(동기화는 «지금 상태 전부»를 보낸다) 큐로 두면 30초 드레인 뒤에 열 번이 줄 선다. */
  let _again = false;
  const run = (): void => {
    if (_running) {
      _again = true; // 이미 도는 중 — 겹쳐 돌지 않되 **버리지도 않는다**
      return;
    }
    _running = (async () => {
      /* ⚠⚠ **미연결 사용자도 편집마다 이걸 돌리고 있었다**(H-20 · 2026-08-06 감사).
         `beforeSync` 는 산출물 미러(파일 6종 IPC 읽기 + 해시 대조)인데, 그 뒤의 `runSync` 는
         설정이 없으면 즉시 `disconnected` 로 빠진다 — 즉 **클라우드를 안 쓰는 사람이 편집할
         때마다** 아무 데도 안 갈 미러를 돌았다(디바운스가 1.2초라 타이핑 중에도 걸린다).
         비용이 조용하고(화면에 아무 표시가 없다) 셸에서만 돌아 개발 중에 안 보인다.
         → 연결돼 있을 때만 돈다. 판정은 `readCloudConfig()` 하나이고 그건 `syncOnce` 가 쓰는
         것과 **같은 함수**다(사본을 두면 둘이 갈린다). 읽기 1회(sync_state 3키)는 미러보다 싸다. */
      if (beforeSync && (await readCloudConfig())) await beforeSync();
      const r = await runSync();
      onResult?.(r);
    })()
      .catch(() => {
        /* 동기화 실패는 조용히 넘긴다 — 로컬은 멀쩡히 동작하고 다음 트리거가 재개한다. */
      })
      .finally(() => {
        _running = null;
        /* 도는 동안 접어 둔 트리거를 지금 잇는다. ⚠ `_again` 을 **먼저** 내린다 — 안 그러면
           재실행이 자기 플래그를 다시 보고 무한히 이어진다. */
        if (_again) {
          _again = false;
          run();
        }
      });
  };
  // 편집 디바운스(`syncSoon`)가 이 실행기를 거치게 한다 — beforeSync·겹침 가드를 함께 상속(H5).
  _activeRun = run;

  const offVisible = onVisible(run);

  /* ── ⚠⚠ **창 복귀(`focus`) 트리거 — W24 의 실측 질문을 없앤다**(2026-07-31) ─────────────
     W24 는 "5분 폴링을 은퇴시키자"였고 선행 조건이 **실측 1건**이었다: WebView2 에서 *다른 앱으로
     포커스를 뺏겼다 돌아올 때* `visibilitychange` 가 발화하는가. 답은 플랫폼 계약상 **아니오**에
     가깝다 — `document.hidden` 은 창이 가려지거나 최소화될 때 바뀌고, **보이는 채로 포커스만
     잃는 것**은 그 상태를 안 바꾼다. 즉 폴링이 덮던 구간(“PC 를 열어 둔 채 폰에서 편집하고 다시
     PC 로 돌아오는 순간”)은 `visibilitychange` 로는 원리적으로 안 잡힌다.

     그래서 **베팅 대신 구간을 직접 덮는다**: `window` 의 `focus` 는 정확히 "이 앱으로 돌아왔다"에
     발화한다. 실측이 필요했던 이유(그 이벤트가 오는지 모른다)가 사라지므로 폴링을 은퇴시킬 수 있다.
     ⚠ alt-tab 마다 동기화하면 Workers 일일 요청 예산을 태운다 → **최소 간격**을 둔다. 그 값은
       옛 폴링 주기와 같게 잡았다(같은 구간을 덮는 장치라 예산 성격이 같다).
     ⚠ `run()` 자체가 겹침 가드를 갖지만 그건 *동시 실행*만 막는다 — 빈도는 여기서 정한다. */
  let lastFocusRun = 0;
  const onFocus = (): void => {
    const now = Date.now();
    if (now - lastFocusRun < FOCUS_MIN_GAP_MS) return;
    lastFocusRun = now;
    run();
  };
  window.addEventListener('focus', onFocus);

  /* ── ⚠⚠ **온라인 복귀 트리거(H1 · 2026-07-31 `/감사 근본`)** ─────────────────────────────
     W24 가 5분 폴백 폴링을 은퇴시키면서 **"네트워크가 스스로 돌아오는 구간"을 덮던 마지막
     장치가 사라졌다.** 남은 트리거는 전부 *사람이 뭔가 해야* 발화한다 — 창을 다시 보거나(`focus`,
     게다가 최소 간격 5분) 편집을 하거나. 그래서 이런 상태가 성립했다:

       PC 를 켜 둔 채 wifi 가 끊긴다 → 편집한다(로컬 저장 OK · push 실패) → wifi 가 돌아온다
       → 창 포커스를 잃었다 돌아오지 않고 추가 편집도 없다 → **push 재시도가 0회**

     그리고 화면이 서로 모순된 두 문장을 동시에 말했다: `OnlineStatus` 는 "온라인으로 돌아왔어요",
     원장은 "동기화 실패 — 편집 N건이 대기 중이에요". 앱 전체에서 `online` 을 듣던 두 곳
     (`components/OnlineStatus`·`store/useSyncLedger`)은 **표시 전용**이라 아무것도 재개하지 않았다.

     ⚠ 최소 간격을 두지 않는다 — `focus` 와 성격이 다르다. 이건 **전이 이벤트**라 연결이 실제로
       끊겼다 붙을 때만 발화한다(alt-tab 처럼 반복되지 않는다) → W24 가 지키려던 Workers 일일
       요청 예산을 사실상 안 쓴다. 겹침은 `run()` 자신의 `_running` 가드가 막는다. */
  const onOnline = (): void => run();
  window.addEventListener('online', onOnline);

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

  /* ⚠ `pollMs` 는 **호환을 위해 남았고 데스크톱은 더 이상 주지 않는다**(W24). 값이 나오는 유일한
     구간을 위 `focus` 트리거가 이벤트로 덮으므로, 5분마다 깨어나 대개 아무것도 안 하는 타이머는
     순수 비용이다(항상-켜짐 환경이라는 전제 자체가 실측과 어긋났다 — 켜 놓고 살지 않는다). */
  let pollId: ReturnType<typeof setInterval> | null = null;
  if (pollMs) pollId = setInterval(run, pollMs);

  /* ⚠⚠ **여기 실시간 poke 채널 연결이 있었다 — 은퇴했다**(I051 · 2026-08-22 발상 축).
     그 채널은 스스로 «점진적 향상»이라 적었다: *"클라이언트가 붙지 못해도 앱은 기존 이벤트/폴링
     동기화로 그대로 돈다 — 연결은 최신성을 빠르게 할 뿐 정확성의 전제가 아니다."* 그 문장이
     은퇴의 근거이기도 하다. 실측: 8일간 동기화할 편집이 **0건**(`tombstones` 0행)이고,
     비용은 `live.rs` + Durable Object + 클라 648줄이었다. 남은 지연은 **최대 폴링 주기**다. */

  run(); // 설치 즉시 1회 — 열었다 = 최신을 보고 싶다.

  return () => {
    offVisible();
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
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
