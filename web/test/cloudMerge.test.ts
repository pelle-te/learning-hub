// @vitest-environment jsdom
/* ============================================================
   cloudMerge.test.ts — 받아온 변경의 로컬 병합(C-5).

   ## 여기서 잠그는 것은 **순서**다

   같은 데이터의 사본이 셋 있고(SQLite · `_last` 기준선 · 메모리 상태), 하나만 갱신하면
   나머지가 그걸 되돌린다. 특히:

   · **기준선을 안 세우면** 다음 저장의 diff 가 받아온 변경을 되돌리는 문장을 만든다.
   · **상태를 안 돌려주면** 낡은 메모리가 다음 flush 에서 정본을 덮는다
     — 0단계-E 에서 이미 물린 부류다(*낡은 메모리가 복원본을 덮는다*).

   그리고 서버에서 실측으로 잡은 **삭제 부활** 결함이 로컬 병합에도 그대로 있으므로
   같은 시나리오를 여기서도 돌린다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/* 가짜 SQLite — 실행된 SQL 을 기록하고, 최소한의 상태를 흉내낸다.
   실제 SQL 의미론(툼스톤 가드·LWW)은 `server/test/contract.test.ts` 가 진짜 엔진으로 검증한다.
   여기서 볼 것은 **어떤 문장을 어떤 순서로 내는가**다. */
const exec = vi.fn(async () => undefined);
const select = vi.fn(async () => [] as unknown[]);
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => ({ execute: exec, select }) },
}));

/* 에코 억제표에 **적히는가**만 본다(C1). 표 자체의 좁음은 `cloudOutbox.test.ts` 가 잠근다. */
const noteMergedRows = vi.fn();
vi.mock('@/lib/cloud/outbox', async (orig) => {
  const m = await orig<typeof import('@/lib/cloud/outbox')>();
  return { ...m, noteMergedRows: (...a: Parameters<typeof m.noteMergedRows>) => noteMergedRows(...a) };
});

import { applyPull } from '@/lib/cloud/merge';
import { currentStamp, _resetStamp } from '@/lib/db/stamp';
import type { OutboxBatch } from '@/lib/cloud/contract';

const sqls = (): string[] => exec.mock.calls.map((c) => String((c as unknown[])[0]));

const batch = (over: Partial<OutboxBatch> = {}): OutboxBatch => ({
  since: 0,
  upto: 1000,
  rows: [{ tbl: 'settings', key: ['theme'], data: ['"dark"'], updatedAt: 500 }],
  tombstones: [],
  ...over,
});

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  exec.mockClear();
  select.mockClear();
  select.mockResolvedValue([]);
  noteMergedRows.mockClear();
  _resetStamp();
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('병합 SQL', () => {
  it('행을 upsert 한다', async () => {
    await applyPull(batch());
    expect(sqls().some((s) => /INSERT INTO settings/.test(s))).toBe(true);
  });

  it('⚠ 툼스톤 가드가 들어간다 — 없으면 삭제가 부활한다(서버에서 실측된 결함)', async () => {
    await applyPull(batch());
    const upsert = sqls().find((s) => /INSERT INTO settings/.test(s))!;
    expect(upsert, 'WHERE NOT EXISTS 툼스톤 가드가 없다').toMatch(/NOT EXISTS[\s\S]*tombstones[\s\S]*deleted_at >= \?/);
  });

  it('⚠ LWW 조건이 들어간다 — 없으면 옛 편집이 새 편집을 덮는다', async () => {
    await applyPull(batch());
    const upsert = sqls().find((s) => /INSERT INTO settings/.test(s))!;
    expect(upsert).toMatch(/excluded\.updated_at > settings\.updated_at/);
  });

  it('툼스톤은 기록하고 그보다 오래된 행을 지운다', async () => {
    await applyPull(batch({ rows: [], tombstones: [{ tbl: 'settings', k1: 'theme', k2: '', deletedAt: 600 }] }));
    expect(sqls().some((s) => /INSERT INTO tombstones/.test(s))).toBe(true);
    const del = sqls().find((s) => /DELETE FROM settings/.test(s));
    /* ⚠ `<=` 여야 한다(H3) — 부활 가드가 `deleted_at >= updatedAt`(동점 삭제 승)이므로 이 DELETE 도
       동점을 지워야 방향이 맞는다. `<` 였을 때 같은 ms 삭제↔편집이 기기별로 반대로 판정돼 영구
       분기했다. 서버(`server/src/index.ts`)의 DELETE 와도 같은 값이어야 한다. */
    expect(del, '오래된 행 삭제가 없다').toMatch(/updated_at <= \?/);
  });

  it('모르는 테이블은 건너뛴다(스키마가 이미 걸렀어야 하지만 방어적으로)', async () => {
    await applyPull(batch({ rows: [{ tbl: '이상한테이블', key: ['x'], data: ['y'], updatedAt: 1 }] }));
    expect(sqls().some((s) => /이상한테이블/.test(s))).toBe(false);
  });
});

describe('⚠ 순서 계약 — 사본 셋이 어긋나지 않게', () => {
  it('받아온 스탬프를 발급기에 심는다 — 안 하면 다음 로컬 편집이 묻힌다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100); // 로컬 시계가 한참 뒤
    await applyPull(batch({ rows: [{ tbl: 'settings', key: ['k'], data: ['v'], updatedAt: 99_999 }] }));
    expect(currentStamp(), '원격 스탬프가 씨앗으로 안 심겼다').toBeGreaterThanOrEqual(99_999);
  });

  it('툼스톤 스탬프도 심는다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    await applyPull(batch({ rows: [], tombstones: [{ tbl: 'settings', k1: 'a', k2: '', deletedAt: 88_888 }] }));
    expect(currentStamp()).toBeGreaterThanOrEqual(88_888);
  });

  it('적용 후 DB 를 되읽어 기준선을 세운다 — 안 하면 다음 저장이 병합을 되돌린다', async () => {
    select.mockResolvedValue([{ key: 'x', value: '1' }]);
    await applyPull(batch());
    // 되읽기(readRows)가 일어났는지 — settings 를 SELECT 했는가
    expect(select.mock.calls.some((c) => /SELECT key, value FROM settings/.test(String((c as unknown[])[0])))).toBe(
      true,
    );
  });

  it('빈 배치는 아무것도 하지 않는다(되읽기도 없다)', async () => {
    const r = await applyPull(batch({ rows: [], tombstones: [] }));
    expect(r.applied).toBe(0);
    expect(r.state).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });
});

/* ============================================================
   ⚠⚠ C1(2026-07-31 `/감사 근본`) — **합성 배치는 에코 억제표에 적히면 안 된다.**

   `restoreConflict`(충돌 되살리기)는 검증된 병합 기계를 재사용하려고 *로컬 편집*을 한 행짜리
   합성 배치로 만들어 `applyPull` 에 먹인다. 그런데 `applyPull` 이 `noteMergedRows` 를 **무조건**
   불렀기 때문에, 억제표가 `키 → 방금 발급한 로컬 스탬프` 를 갖게 되고 다음 아웃박스 스캔이
   그 행을 **키·스탬프 정확 일치**로 건너뛰었다. 워터마크는 fence 까지 전진하므로 **재시작 후에도
   영구 제외** — 로컬은 복원값, 다른 기기는 옛 승자, 양쪽 다 "동기화 완료"라 말한다.

   그리고 그 되살리기가 이 저장소가 CRDT 를 기각하며 내세운 **유일한 보상 경로**다. 즉 이 한 줄이
   빠지면 §150 이 약속한 보상이 반쪽만 동작한다.
============================================================ */
describe('C1 — 에코 억제는 **원격에서 온 것에만** 적용된다', () => {
  it('기본(원격 pull)은 억제표에 적는다 — 유선 절약(H31-②)은 그대로다', async () => {
    await applyPull(batch());
    expect(noteMergedRows).toHaveBeenCalledTimes(1);
  });

  it('⚠ `echo:false`(되살리기)는 적지 않는다 — 적으면 그 값이 다른 기기에 영원히 안 간다', async () => {
    await applyPull(batch(), { echo: false });
    expect(noteMergedRows, '되살린 행이 다음 배치에서 빠지면 조용한 영구 분기다').not.toHaveBeenCalled();
  });

  it('억제를 꺼도 나머지 계약은 그대로다 — 씨앗·기준선은 원격 경로와 동일', async () => {
    select.mockResolvedValue([{ key: 'x', value: '1' }]);
    await applyPull(batch(), { echo: false });
    expect(currentStamp(), '씨앗을 안 심으면 다음 로컬 편집이 묻힌다').toBeGreaterThanOrEqual(500);
    expect(select.mock.calls.some((c) => /SELECT key, value FROM settings/.test(String((c as unknown[])[0])))).toBe(
      true,
    );
  });
});
