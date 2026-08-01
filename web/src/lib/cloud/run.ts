/* ============================================================
   cloud/run.ts — 동기화 1회를 조립한다(C-5). **밀어올리고 → 받아오고 → 병합한다.**

   ## ⚠ 워터마크가 **둘**이다

   C-1 의 `watermark` 는 "**내가 어디까지 보냈나**"이고, 여기서 쓰는 `cloud:pullMark` 는
   "**내가 어디까지 받았나**"다. 같은 값으로 겸하게 하면 안 된다 — 두 방향의 진행이 서로
   다르고(내가 밀어올린 뒤에도 상대는 그 앞에 있을 수 있다), 겸직시키면 한쪽 진행이 다른 쪽
   기록을 덮어 **받지 않은 변경을 받았다고 표시**하거나 그 반대가 된다.

   이건 C-1 이 "LWW 비교용 타임스탬프와 '보냈나' 표시를 같은 값으로 겸하게 하면 안 된다"고
   적은 것과 같은 종류의 실수다. 값이 싸다고 겸직시키면 나중에 조용히 틀린다.

   ## 순서: push 를 먼저

   내 편집을 먼저 올리고 나서 받는다. 반대로 하면 방금 받은 것이 내 아웃박스에 섞여
   되돌아갈 여지가 생긴다(LWW 라 결과는 같지만 유선 낭비이고 추적이 어려워진다).

   ## 호출부 계약

   이 함수는 **메모리 상태를 건드리지 않는다.** 병합된 상태를 돌려주기만 하고, `applyMerged()` 를
   부르는 것은 호출부다(⚠ `loadState` 아님 · C1) — `lib/` 는 zustand 를 모른다(I2 레이어 단방향).
============================================================ */
import { execDb, selectDb } from '../db/sqlite';
import { pushOutbox, isPermanent, type PushResult, type CloudTransport } from './push';
import { makeTransport, pullChanges, readCloudConfig } from './client';
import { applyPull } from './merge';
import { scanConflicts } from './conflictScan';
import { batchSize } from './contract';
import { PULL_MARK_KEY as PULL_MARK } from './outbox';
import type { ConflictShadow } from './conflicts';
import type { AppState } from '../types';

async function readPullMark(): Promise<number> {
  const r = await selectDb<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [PULL_MARK]);
  return Number(r?.[0]?.value ?? 0) || 0;
}

/** ⚠ 뒤로 가지 않는다 — C-1 의 push 워터마크와 같은 이유(전진 기록을 잃으면 안 된다). */
async function commitPullMark(upto: number): Promise<boolean> {
  return execDb(
    `INSERT INTO sync_state (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = MAX(CAST(value AS INTEGER), CAST(?2 AS INTEGER))`,
    [PULL_MARK, String(upto)],
  );
}

export interface SyncResult {
  /**
   * ⚠ `blocked` 는 **스스로 낫지 않는 실패**다(H5 · 2026-07-31). push 축은 `push.status` 가
   * 이미 그 구분을 갖고 있었는데 pull 축엔 없어서, 아웃박스가 빈 상태에서 한도가 소진되면
   * `failed`(= "다음 시도에 다시 올려요")로 보고됐다. 원장은 `blocked` 를 오프라인보다 위로
   * 올려 말한다(`lib/syncLedger.ts`).
   */
  status: 'ok' | 'disconnected' | 'failed' | 'blocked';
  push?: PushResult;
  /** 받아서 적용한 변경 수. */
  pulled: number;
  /** 병합 결과 상태. **null 이 아니면 호출부가 `applyMerged()` 를 불러야 한다**(⚠ `loadState` 아님 · C1). */
  state: AppState | null;
  /** 이번 pull 이 LWW 로 덮은 **동시 로컬 편집**(있으면). 병합에는 영향 없는 관측 결과다(§150 보완). */
  conflicts?: ConflictShadow[];
  error?: string;
}

/* ⚠⚠ **재진입 가드는 여기, 공유층에 있다**(C-1 후속 · 2026-07-24).

   종전엔 겹침 방지가 `phone/sync.ts` 에만 있었다 — 그런데 `syncOnce` 를 부르는 곳은 폰만이
   아니다: 데스크톱은 `StorageGuard`(5분 틱)·`CloudCard`("지금 동기화"·연결 직후)에서 부르고,
   그 셋은 서로 겹칠 수 있었다(설정에서 버튼을 누르는 순간 틱이 겹치는 등). 겹치면 두 동기화가
   모듈 전역 가변 상태(`sqlite.ts` 의 diff 기준선 `_last`·스탬프 발급기·워터마크)를 **경합**하고,
   그건 `merge.ts` 머리주석이 경고한 "낡은 기준선이 받아온 변경을 되돌리는 문장을 만든다"의
   재현 경로다. 가드가 소비자 레이어(폰)에 있으면 다른 소비자가 상속받지 못한다 —
   그래서 겹침 방지를 **`syncOnce` 자체의 불변식**으로 끌어올린다. 이제 어느 경로로 불러도
   동시에 둘이 돌지 않는다. */
let _inflight: Promise<SyncResult> | null = null;

/**
 * 동기화 1회. 클라우드에 연결돼 있지 않으면 아무것도 하지 않는다(`disconnected`).
 *
 * ⚠ **겹쳐 돌지 않는다** — 이미 도는 중이면 그 약속을 돌려준다(위 주석 참조).
 *
 * 실패를 삼키지 않는다 — 호출부가 사용자에게 알릴 수 있어야 한다. 다만 **던지지도 않는다**:
 * 동기화 실패가 앱을 멈추면 안 되고(로컬은 멀쩡히 동작한다), 다음 시도가 재개한다.
 */
export function syncOnce(): Promise<SyncResult> {
  _inflight ??= runSyncOnce().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

/* ⚠ **가득 찬 push 배치를 이어서 비운다(H2 · 2026-07-24 감사).** `capBatch` 로 `MAX_BATCH_ITEMS`
   에서 잘린 배치는 워터마크만 전진시키고 끝나는데, push 는 pull 과 달리 **메모리 상태를 안 바꿔**
   편집 구독(`syncController`)을 못 깨운다 — 즉 남은 아웃박스를 이어받을 에코가 없다. 폴링 없는 폰에서
   사용자가 편집·전환을 안 하면 초기 대량 push 가 다음 앱 열기까지 정체한다(유실 아님, 수렴 지연).
   가득 찬 배치가 나오는 동안 이어 돌려 한 번에 비운다. 각 회가 워터마크를 전진시켜 아웃박스는 단조
   감소하므로 종료가 보장되고, 폭주 방지로 상한도 둔다. `sent` 는 합계로 돌려준다. */
const MAX_PUSH_DRAIN = 50; // 50 × MAX_BATCH_ITEMS(500) = 25,000 행 — 현실적 초기 동기화를 전부 덮는다
async function drainPush(transport: CloudTransport): Promise<PushResult> {
  let res = await pushOutbox(transport);
  let sent = res.sent;
  /* ⚠⚠ **판정은 `more` 다 — `sent >= MAX_BATCH_ITEMS` 가 아니다**(H4 · 2026-08-01).
     `capBatch` 는 **스탬프 그룹 경계**에서 자르므로 보낸 건수가 상한과 정확히 같아지는 일은
     사실상 없다(상한 500에 400건 그룹이면 `sent=400`). 즉 위 주석이 약속한 드레인은 **한 번도
     안 돌았고**, 실측 5,348행을 비우는 데 사용자 트리거가 **14회** 필요했다("한 번에 비운다"가
     문서에만 있었다). 잘렸는지는 스캔한 쪽만 안다 → `outbox.OutboxScan.more` 가 그걸 실어 온다. */
  for (let i = 0; res.status === 'pushed' && res.more && i < MAX_PUSH_DRAIN; i++) {
    res = await pushOutbox(transport);
    sent += res.sent;
  }
  return { ...res, sent };
}

/* ⚠⚠ **`drainPull` 은 존재하지 않았다 — push 만 드레인했다**(H4 · 2026-08-01).

   비대칭의 대가가 컸다: 서버 pull 은 `limit`(200) + 다중 소스 천장으로 한 회에 일부만 준다.
   그런데 다음 회차를 부르는 것이 **`applyMerged` 의 부수효과**뿐이었다 — 상태가 바뀌니 편집
   구독이 깨어나 `syncSoon()` 이 걸리고, 그건 `AFTER_EDIT_MS`(1200ms) 뒤다. 두 번째 기기
   온보딩(≈5,300행)이면 **27라운드 × 1.2초 ≈ 30초 동안 UI 가 갈린 상태**로 돈다(중간 상태가
   화면에 계속 보인다). push 는 "한 번에 비운다"고 적어 놓고 pull 은 우연에 맡긴 셈이다.

   ⚠ 종료 조건이 **`n === 0`** 인 이유(그리고 `n < limit` 이 왜 틀렸는가): 서버는 소스마다
   `LIMIT` 을 걸고 **가장 보수적인 천장**으로 자른다(`index.ts` 의 `ceilingOf`). 그래서 어떤
   소스가 잘렸는데도 다른 소스의 낮은 천장 때문에 **총 건수가 limit 미만**으로 나올 수 있다 —
   그 조건으로 끊으면 남은 것을 두고 조용히 멈춘다. 대가는 데이터가 있던 동기화마다 빈 pull
   **1회**이고, 그건 "수렴을 다음 트리거에 맡긴다"보다 싸다.
   ⚠ 마크 전진(`commitPullMark`)이 매 회차 안에 있으므로 `since` 는 단조 증가한다 → 종료가
   보장된다. 그래도 상한을 둔다(서버가 같은 구간을 반복해 주는 병리 상황의 폭주 방지). */
const MAX_PULL_DRAIN = 50;

async function runSyncOnce(): Promise<SyncResult> {
  const cfg = await readCloudConfig();
  if (!cfg) return { status: 'disconnected', pulled: 0, state: null };

  try {
    // ① 내 편집을 먼저 올린다.
    const push = await drainPush(makeTransport(cfg));

    // ② 그다음 받아온다 — **빌 때까지**. `since` 는 **받기 전용** 워터마크다(머리주석 참조).
    let pulled = 0;
    let state: SyncResult['state'] = null;
    const conflicts: NonNullable<SyncResult['conflicts']> = [];
    for (let i = 0; i < MAX_PULL_DRAIN; i++) {
      const since = await readPullMark();
      const incoming = await pullChanges(cfg, since);
      if (batchSize(incoming) === 0) {
        /* 받을 게 없어도 마크는 전진시킨다 — 안 그러면 매번 같은 구간을 다시 묻는다.
           C-1 의 빈 배치 처리와 같은 판단이고, 받은 것이 없으니 유실 위험도 없다. */
        await commitPullMark(incoming.upto);
        break;
      }

      /* ③ 병합 **직전** 충돌 스캔 — 이 시점 로컬은 아직 병합-전이라 "덮이기 직전 값"을 본다.
         읽기 전용이라 병합의 LWW 불변식(merge.ts)에 손대지 않는다(§150 조용한 손실 보완). */
      const round = await scanConflicts(incoming, since);
      if (round?.length) conflicts.push(...round);

      // ④ 병합. 기준선 정리까지 `applyPull` 이 하고, 메모리 반영은 호출부 몫이다.
      const merged = await applyPull(incoming);
      /* ⚠ **병합이 끝난 뒤에만** 마크를 전진시킨다. 순서가 반대면 병합 실패 시 그 구간을
         영영 다시 안 받는다 — C-1 의 "전송 성공 뒤에만 워터마크" 계약과 같은 규율이다. */
      await commitPullMark(incoming.upto);
      pulled += merged.applied;
      /* ⚠ **마지막 회차의 상태만 쓴다.** `applyPull` 은 매번 정본 전량을 다시 읽어 오므로
         마지막 것이 곧 누적 결과다 — 중간 스냅샷을 메모리에 싣지 않는 것이 요점이다(그게
         "UI 가 갈린 중간 상태로 30초"의 원인이었다). */
      state = merged.state;
    }
    return { status: 'ok', push, pulled, state, conflicts: conflicts.length ? conflicts : undefined };
  } catch (e) {
    /* 재시도가 무의미한 실패(한도 소진·인증 폐기·계약 위반)는 **`blocked`** 다 — `failed` 로
       접으면 원장이 "다음 시도에 다시 올려요"라 말하는데 그건 거짓이다(H5). */
    const status = isPermanent(e) ? 'blocked' : 'failed';
    return { status, pulled: 0, state: null, error: e instanceof Error ? e.message : String(e) };
  }
}
