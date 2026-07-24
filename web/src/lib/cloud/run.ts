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

   이 함수는 **메모리 상태를 건드리지 않는다.** 병합된 상태를 돌려주기만 하고, `loadState()` 를
   부르는 것은 호출부다 — `lib/` 는 zustand 를 모른다(I2 레이어 단방향).
============================================================ */
import { execDb, selectDb } from '../db/sqlite';
import { pushOutbox, type PushResult } from './push';
import { makeTransport, pullChanges, readCloudConfig } from './client';
import { applyPull } from './merge';
import { batchSize } from './contract';
import { PULL_MARK_KEY as PULL_MARK } from './outbox';
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
  status: 'ok' | 'disconnected' | 'failed';
  push?: PushResult;
  /** 받아서 적용한 변경 수. */
  pulled: number;
  /** 병합 결과 상태. **null 이 아니면 호출부가 `loadState()` 를 불러야 한다.** */
  state: AppState | null;
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

async function runSyncOnce(): Promise<SyncResult> {
  const cfg = await readCloudConfig();
  if (!cfg) return { status: 'disconnected', pulled: 0, state: null };

  try {
    // ① 내 편집을 먼저 올린다.
    const push = await pushOutbox(makeTransport(cfg));

    // ② 그다음 받아온다. `since` 는 **받기 전용** 워터마크다(머리주석 참조).
    const since = await readPullMark();
    const incoming = await pullChanges(cfg, since);
    const n = batchSize(incoming);
    if (n === 0) {
      /* 받을 게 없어도 마크는 전진시킨다 — 안 그러면 매번 같은 구간을 다시 묻는다.
         C-1 의 빈 배치 처리와 같은 판단이고, 받은 것이 없으니 유실 위험도 없다. */
      await commitPullMark(incoming.upto);
      return { status: 'ok', push, pulled: 0, state: null };
    }

    // ③ 병합. 기준선 정리까지 `applyPull` 이 하고, 메모리 반영은 호출부 몫이다.
    const merged = await applyPull(incoming);
    /* ⚠ **병합이 끝난 뒤에만** 마크를 전진시킨다. 순서가 반대면 병합 실패 시 그 구간을
       영영 다시 안 받는다 — C-1 의 "전송 성공 뒤에만 워터마크" 계약과 같은 규율이다. */
    await commitPullMark(incoming.upto);
    return { status: 'ok', push, pulled: merged.applied, state: merged.state };
  } catch (e) {
    return { status: 'failed', pulled: 0, state: null, error: e instanceof Error ? e.message : String(e) };
  }
}
