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
  unknownDroppedTotal: () => unknownTotal,
}));
/** 모르는 테이블 누계(M-10) — 케이스가 세운 값을 `run.ts` 가 앞뒤로 재서 델타를 만든다. */
let unknownTotal = 0;
vi.mock('@/lib/cloud/merge', () => ({ applyPull: (...a: unknown[]) => applyPull(...a) }));
const scanConflicts = vi.fn(async () => []);
vi.mock('@/lib/cloud/conflictScan', () => ({ scanConflicts: (...a: unknown[]) => scanConflicts(...(a as [])) }));

/** 마크는 인메모리로 — 여기서 재는 것은 SQL 이 아니라 **회차 수**다. */
let mark = 0;
const setDiffBaseline = vi.fn();
vi.mock('@/lib/db/sqlite', () => ({
  selectDb: async () => [{ value: String(mark) }],
  execDb: async (_q: string, args: unknown[]) => {
    mark = Math.max(mark, Number(args[1]));
    return true;
  },
  setDiffBaseline: (...a: unknown[]) => setDiffBaseline(...a),
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
  unknownTotal = 0;
  pushOutbox.mockReset();
  pullChanges.mockReset();
  setDiffBaseline.mockReset();
  scanConflicts.mockClear();
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

  /* ⚠⚠ H-16(2026-08-06 감사) — 그림자의 기준선은 **동기화 시작 시점**이다.
     `detectConflicts` 는 `cur.updatedAt <= pullMark` 를 "정상 최신화"로 접는다. 회차마다 전진한
     마크를 넘기면 2회차부터 *이번 동기화 도중의* 값이 기준이 되어, 이 동기화 전에 한 로컬
     편집이 전부 접히고 **그림자가 안 잡힌다**(200행 초과 pull 에서만 나타나 조용하다).
     §150 이 CRDT 를 기각하며 내세운 유일한 보상 경로가 이것이라 절반이 새면 그 논거가 무효다. */
  it('⚠⚠ 충돌 스캔은 **모든 회차에 같은 기준선**을 쓴다 — 전진한 마크를 쓰면 2회차부터 과소 탐지', async () => {
    pullChanges
      .mockResolvedValueOnce(batch(10, 1))
      .mockResolvedValueOnce(batch(20, 1))
      .mockResolvedValueOnce(batch(30, 1))
      .mockResolvedValueOnce(batch(30, 0));

    await syncOnce();
    const 기준선들 = scanConflicts.mock.calls.map((c) => (c as unknown as [unknown, number])[1]);
    expect(기준선들, '전진한 마크를 넘기면 [0,10,20] 이 된다').toEqual([0, 0, 0]);
    // 반면 pull 질의는 계속 전진해야 한다 — 두 값의 의미가 다르다(겸직 금지).
    expect(pullChanges.mock.calls.map((c) => c[1])).toEqual([0, 10, 20, 30]);
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

/* ============================================================
   C-1 — **드레인 중간에 죽었을 때 기준선이 DB 보다 앞서 있으면 안 된다**(2026-08-06 감사).

   ⚠ 이 축은 이 파일에 **원리적으로 없었다**: 위 케이스들은 `applyPull` 을 통째로 mock 해
   *회차 수*만 재므로, 병합에 성공한 회차 뒤에 실패하는 경로가 만드는 **기준선↔메모리 어긋남**을
   볼 수 없다. 그리고 그 경로를 정상 경로로 만든 것이 바로 H4 의 드레인 루프다 — 즉 C-1 은
   이 파일이 검증한 그 변경이 낳은 결함이고, 여기에 축이 없어서 잡히지 않았다.

   ⚠⚠ 단언 대상을 기준선 **값**으로 잡지 않는다 — `sqlite.ts` 에는 `setDiffBaseline` 만 있고
   게터가 없다(실측). 게터를 새로 export 하면 테스트만 쓰는 표면이 하나 늘고 `knip` 도 그것을
   본다. 대신 **무효화가 일어났는가**(= 다음 쓰기가 DB 를 재독하게 되는 유일한 신호)를 본다.
============================================================ */
describe('C-1 — 드레인 중 실패는 기준선을 무효화한다', () => {
  beforeEach(() => {
    pushOutbox.mockResolvedValue(emptyPush);
  });

  it('ⓐ 병합에 성공한 회차 **뒤** 요청이 실패하면 기준선을 무효화한다 — 안 하면 다음 편집이 받아온 행을 되돌린다', async () => {
    applyPull.mockResolvedValue({ applied: 1, state: { marker: 'r1' } as never });
    // 종료조건이 `n===0` 이라 데이터가 있는 pull 뒤엔 **항상 한 번 더** 묻는다. 그게 실패하는 경로.
    pullChanges.mockResolvedValueOnce(batch(10, 1)).mockRejectedValueOnce(new Error('네트워크'));

    const r = await syncOnce();
    expect(r.status, '재시도 가능한 실패다').toBe('failed');
    expect(r.state, '호출부가 applyMerged 를 부르지 않는다 = 메모리는 병합-전으로 남는다').toBeNull();
    expect(setDiffBaseline, '기준선(병합-후)만 남으면 flush 가 되돌리는 문장을 만든다').toHaveBeenCalledWith(null);
  });

  it('ⓑ `applyPull` 이 되읽기 실패로 `state:null` 을 돌려줘도 **앞 회차의 유효 스냅샷을 덮지 않는다**', async () => {
    const first = { marker: 'r1' } as never;
    applyPull.mockResolvedValueOnce({ applied: 1, state: first }).mockResolvedValueOnce({ applied: 1, state: null }); // 되읽기 실패 — 던지지 않는다
    // 종료조건이 `n===0` 이라 데이터가 있는 회차 뒤엔 빈 회차가 하나 더 온다(드레인은 정상 종료).
    pullChanges
      .mockResolvedValueOnce(batch(10, 1))
      .mockResolvedValueOnce(batch(20, 1))
      .mockResolvedValueOnce(batch(20, 0));

    const r = await syncOnce();
    expect(r.state, 'null 로 덮으면 applyMerged 가 안 불려 ⓐ 와 같은 어긋남이 된다').toBe(first);
    expect(setDiffBaseline, 'DB 는 앞서 갔으므로 재독을 강제한다').toHaveBeenCalledWith(null);
  });

  it('정상 드레인은 기준선을 건드리지 않는다 — 무효화가 상시 발생하면 매 동기화가 전량 재독이 된다', async () => {
    applyPull.mockResolvedValue({ applied: 1, state: { marker: 'ok' } as never });
    pullChanges.mockResolvedValueOnce(batch(10, 1)).mockResolvedValueOnce(batch(10, 0));
    await syncOnce();
    expect(setDiffBaseline).not.toHaveBeenCalled();
  });
});

/* ============================================================
   M-10 — **모르는 스키마를 버린 사실이 호출부까지 올라오는가**(2026-08-06 감사).

   관용 파서(`schema.ts` H16)가 버리는 것 자체는 정상이다. 결함은 그 사실이 `console.warn`
   에서 끝나 **배포된 앱에서는 아무에게도 안 갔다**는 것이었다 — 그래서 여기서 재는 것은
   "버렸는가"가 아니라 **"버린 수가 결과에 실리는가"**(= store 층이 말을 걸 수 있는가)다.
============================================================ */
describe('M-10 — 모르는 항목을 버렸다는 사실이 결과에 실린다', () => {
  beforeEach(() => {
    pushOutbox.mockResolvedValue(emptyPush);
    pullChanges.mockResolvedValue(batch(0, 0));
  });

  it('버린 것이 있으면 이번 동기화의 **델타**로 실린다', async () => {
    unknownTotal = 3; // 파서가 세션 누계를 올려 둔 상태에서 시작
    pullChanges.mockImplementationOnce(async () => {
      unknownTotal = 5; // 이번 pull 이 2건을 더 버렸다
      return batch(10, 1);
    });
    const r = await syncOnce();
    expect(r.unknownDropped, '누계(5)가 아니라 이번 회차의 델타(2)여야 한다').toBe(2);
  });

  it('버린 것이 없으면 필드를 만들지 않는다 — 0 을 실으면 호출부가 매번 판정해야 한다', async () => {
    unknownTotal = 7;
    const r = await syncOnce();
    expect(r.unknownDropped).toBeUndefined();
  });
});
