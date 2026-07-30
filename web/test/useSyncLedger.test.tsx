// @vitest-environment jsdom
/* ============================================================
   useSyncLedger.test.tsx — 원장의 **읽기**(H3 · 2026-07-30 `/감사 근본`).

   판정(`lib/syncLedger`)은 `syncLedger.test.ts` 가 잠근다. 여기서 잠그는 것은 그 판정에
   **무엇을 먹이는가**이고, H3 의 결함이 정확히 거기 있었다:

   ① `blocked` 는 `SyncResult.status` 가 아니라 **`push.status`** 에서 온다. `runSyncOnce` 는
      push 가 막혀도 pull 이 되면 `'ok'` 를 돌려주므로, 바깥 status 만 보면 중단이 통째로
      안 보인다. 판정을 아무리 잘 고쳐도 입력이 틀리면 화면은 그대로 거짓말한다.
   ② 동기화가 끝났다는 사실을 **받는 경로가 없었다.** 이 훅은 자기 주석에 "동기화 시도 직후에만
      다시 센다"고 적어 뒀는데 실제로 등록한 것은 `visibilitychange`·`online`/`offline` 뿐이라,
      화면을 떠났다 돌아오기 전까지 원장이 낡은 채였다.
============================================================ */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

/** 구독 콜백을 붙잡아 두는 가짜 컨트롤러 — 실제 동기화(SQLite·네트워크) 없이 두 계약만 본다. */
const subs = new Set<(r: unknown) => void>();
let last: unknown = null;
vi.mock('@/store/syncController', () => ({
  lastSync: () => last,
  onSyncResult: (cb: (r: unknown) => void) => {
    subs.add(cb);
    return () => subs.delete(cb);
  },
}));
vi.mock('@/lib/cloud/outbox', () => ({ collectOutbox: () => Promise.resolve({ rows: [], tombstones: [] }) }));
vi.mock('@/lib/cloud/contract', () => ({ batchSize: () => 3 }));

const { useSyncLedger } = await import('@/store/useSyncLedger');

beforeEach(() => {
  subs.clear();
  last = null;
});
afterEach(cleanup);

test('⚠ H3: 중단을 `push.status` 에서 읽는다 — 바깥 status 는 push 가 막혀도 ok 다', async () => {
  last = {
    at: 1_700_000_000_000,
    result: {
      status: 'ok',
      pulled: 0,
      state: null,
      push: { status: 'blocked', sent: 0, attempts: 1, error: 'D1 한도 초과' },
    },
  };
  const { result } = renderHook(() => useSyncLedger());
  await waitFor(() => expect(result.current.led.blocked).toBe('D1 한도 초과'));
  // 중단됐으면 "언제 성공했나"를 말하지 않는다 — 내 편집은 하나도 안 올라갔다.
  expect(result.current.led.at, '성공 시각과 중단이 동시에 참이면 원장이 자기모순이다').toBeNull();
});

test('막히지 않았으면 종전대로 성공 시각을 든다', async () => {
  last = {
    at: 1_700_000_000_000,
    result: { status: 'ok', pulled: 0, state: null, push: { status: 'pushed', sent: 3, attempts: 1 } },
  };
  const { result } = renderHook(() => useSyncLedger());
  await waitFor(() => expect(result.current.led.at).toBe(1_700_000_000_000));
  expect(result.current.led.blocked).toBeNull();
});

test('⚠ H3: 동기화가 끝나면 **구독으로** 다시 읽는다 — 종전엔 화면 복귀 전까지 낡아 있었다', async () => {
  const { result } = renderHook(() => useSyncLedger());
  await waitFor(() => expect(result.current.led.pending).toBe(3));
  expect(result.current.led.blocked).toBeNull();

  // 동기화 1회가 중단으로 끝났다고 알린다(가시성·네트워크 이벤트 없이).
  last = {
    at: 2,
    result: {
      status: 'ok',
      pulled: 0,
      state: null,
      push: { status: 'blocked', sent: 0, attempts: 1, error: '기기가 폐기됨' },
    },
  };
  act(() => {
    for (const cb of subs) cb(last);
  });
  await waitFor(() => expect(result.current.led.blocked).toBe('기기가 폐기됨'));
});
