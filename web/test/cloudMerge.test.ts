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
    expect(del, '오래된 행 삭제가 없다').toMatch(/updated_at < \?/);
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
