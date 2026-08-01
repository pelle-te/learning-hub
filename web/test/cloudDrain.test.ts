/* ============================================================
   cloudDrain.test.ts — **한 번의 동기화가 끝까지 비우는가**(H4 · 2026-08-01).

   두 축이 비대칭이었다. push 에는 드레인 루프가 있었지만 **조건이 거의 항상 거짓**이었고
   (`sent >= MAX_BATCH_ITEMS` vs `capBatch` 의 스탬프 그룹 경계), pull 에는 **루프 자체가
   없었다** — 다음 회차를 부르는 것이 `applyMerged` 의 부수효과(1200ms 디바운스)뿐이라
   두 번째 기기 온보딩이 수십 초 동안 갈린 상태로 돌았다.

   ⚠ 여기서 재는 것은 **회차 수**다. 값의 정확성(LWW·툼스톤·기준선)은 `cloudMerge`·
   `cloudOutbox`·서버 왕복 테스트가 이미 소유한다 — 그걸 여기서 또 재면 사본이 된다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxBatch } from '@/lib/cloud/contract';

const pushOutbox = vi.fn();
const pullChanges = vi.fn();
const applyPull = vi.fn();

vi.mock('@/lib/cloud/push', async (orig) => {
  const m = await orig<typeof import('@/lib/cloud/push')>();
  return { ...m, pushOutbox: (...a: unknown[]) => pushOutbox(...a) };
});
vi.mock('@/lib/cloud/client', () => ({
  readCloudConfig: async () => ({ baseUrl: 'https://x', deviceId: 'd', refresh: 'r' }),
  makeTransport: () => ({ push: async () => undefined }),
  pullChanges: (...a: unknown[]) => pullChanges(...a),
}));
vi.mock('@/lib/cloud/merge', () => ({ applyPull: (...a: unknown[]) => applyPull(...a) }));
vi.mock('@/lib/cloud/conflictScan', () => ({ scanConflicts: async () => [] }));

/** 마크는 인메모리로 — 여기서 재는 것은 SQL 이 아니라 **회차 수**다. */
let mark = 0;
vi.mock('@/lib/db/sqlite', () => ({
  selectDb: async () => [{ value: String(mark) }],
  execDb: async (_q: string, args: unknown[]) => {
    mark = Math.max(mark, Number(args[1]));
    return true;
  },
}));

import { syncOnce } from '@/lib/cloud/run';

const emptyPush = { status: 'idle' as const, sent: 0, attempts: 0, more: false };
/** `upto` 가 전진하는 한 배치 — 실제 pull 이 주는 모양(행 하나면 충분하다). */
const batch = (upto: number, rows: number): OutboxBatch => ({
  since: 0,
  upto,
  rows: Array.from({ length: rows }, (_, i) => ({
    tbl: 'settings',
    key: [`k${upto}_${i}`],
    data: ['1'],
    updatedAt: upto,
  })),
  tombstones: [],
});

beforeEach(() => {
  mark = 0;
  pushOutbox.mockReset();
  pullChanges.mockReset();
  applyPull.mockReset().mockImplementation(async (b: OutboxBatch) => ({ applied: b.rows.length, state: null }));
});

describe('push 드레인 — 판정은 `more` 다', () => {
  it('⚠⚠ 잘린 배치가 있으면 **한 동기화 안에서** 이어 비운다 — `sent` 가 상한 미만이어도', async () => {
    // 실측된 실패 모양: 그룹 경계 때문에 400건씩 나간다(상한 500). 옛 조건이면 여기서 멈췄다.
    pushOutbox
      .mockResolvedValueOnce({ status: 'pushed', sent: 400, attempts: 1, more: true })
      .mockResolvedValueOnce({ status: 'pushed', sent: 400, attempts: 1, more: true })
      .mockResolvedValueOnce({ status: 'pushed', sent: 120, attempts: 1, more: false });
    pullChanges.mockResolvedValue(batch(0, 0));

    const r = await syncOnce();
    expect(pushOutbox, '`sent >= 500` 조건이면 1회에서 멈춘다').toHaveBeenCalledTimes(3);
    expect(r.push?.sent, '합계로 보고한다').toBe(920);
  });

  it('`more:false` 면 한 번으로 끝난다 — 드레인이 헛돌지 않는다', async () => {
    pushOutbox.mockResolvedValue({ status: 'pushed', sent: 3, attempts: 1, more: false });
    pullChanges.mockResolvedValue(batch(0, 0));
    await syncOnce();
    expect(pushOutbox).toHaveBeenCalledTimes(1);
  });
});

describe('pull 드레인 — 빌 때까지 받는다(종전엔 루프 자체가 없었다)', () => {
  beforeEach(() => {
    pushOutbox.mockResolvedValue(emptyPush);
  });

  it('⚠⚠ 한 동기화가 **여러 페이지를 이어서** 받는다 — 종전엔 1페이지 뒤 1.2초를 기다렸다', async () => {
    pullChanges
      .mockResolvedValueOnce(batch(10, 200))
      .mockResolvedValueOnce(batch(20, 200))
      .mockResolvedValueOnce(batch(30, 40))
      .mockResolvedValueOnce(batch(30, 0));

    const r = await syncOnce();
    expect(pullChanges).toHaveBeenCalledTimes(4); // 마지막 빈 회차가 종료 신호다
    expect(r.pulled, '누적해서 보고한다 — 페이지 하나만 세면 원장이 거짓말한다').toBe(440);
  });

  it('⚠ 회차마다 **전진한 마크**로 묻는다 — 같은 구간을 다시 받으면 무한 루프다', async () => {
    pullChanges.mockResolvedValueOnce(batch(10, 5)).mockResolvedValueOnce(batch(10, 0));
    await syncOnce();
    expect(pullChanges.mock.calls.map((c) => c[1])).toEqual([0, 10]);
  });

  it('받을 게 없으면 1회로 끝난다(평시 동기화 비용이 안 는다)', async () => {
    pullChanges.mockResolvedValue(batch(7, 0));
    await syncOnce();
    expect(pullChanges).toHaveBeenCalledTimes(1);
  });

  it('⚠ 메모리에 싣는 상태는 **마지막 회차**의 것이다 — 중간 스냅샷을 실으면 UI 가 갈린다', async () => {
    const mid = { marker: 'mid' } as never;
    const last = { marker: 'last' } as never;
    applyPull.mockResolvedValueOnce({ applied: 1, state: mid }).mockResolvedValueOnce({ applied: 1, state: last });
    pullChanges
      .mockResolvedValueOnce(batch(10, 1))
      .mockResolvedValueOnce(batch(20, 1))
      .mockResolvedValueOnce(batch(20, 0));
    const r = await syncOnce();
    expect(r.state).toBe(last);
  });
});
