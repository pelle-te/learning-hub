// @vitest-environment jsdom
/* ============================================================
   cloudUndo.test.ts — 전역 ⌘Z 의 **적용 배선**(근본① · 2026-08-01).

   ## 여기서 잠그는 것은 계약 넷이다

   ① **새 쓰기 경로를 만들지 않는다** — pre-image 를 합성 배치로 `applyPull` 에 먹인다.
      직접 SQL 을 짜면 툼스톤 가드·LWW 를 다시 구현하게 되고, 그건 이 저장소가 그 지점에서 이미
      낸 사고 넷(C1·C2·H4·H8)의 다섯 번째다.
   ② **`echo:false`** — 되돌린 값이 다른 기기로 가야 한다(참이면 억제표가 영구 제외한다).
   ③ **`keepUndo`** — pull 은 스택을 비우고, 되돌리기 자신은 안 비운다(안 그러면 1단계 언두).
   ④ **툼스톤 가드** — 다른 기기가 지운 행은 되살리지 않고 **그 사실을 말한다**.

   SQL 의 진짜 의미론은 `server/test/contract.test.ts`(실 엔진)와 `cloudMerge.test.ts` 가 본다.
   여기서 볼 것은 **무엇을 어떤 옵션으로 그 기계에 넘기는가**다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const exec = vi.fn(async () => undefined);
const select = vi.fn(async (q: string) => (/FROM settings/.test(q) ? [{ key: 'theme', value: '"dark"' }] : []));
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => ({ execute: exec, select }) },
}));

/* 에코 억제표에 **적히지 않는가**만 본다(C1) — 표 자체는 `cloudOutbox.test.ts` 가 잠근다. */
const noteMergedRows = vi.fn();
vi.mock('@/lib/cloud/outbox', async (orig) => {
  const m = await orig<typeof import('@/lib/cloud/outbox')>();
  return { ...m, noteMergedRows: (...a: Parameters<typeof m.noteMergedRows>) => noteMergedRows(...a) };
});

import { undoLastWrite } from '@/lib/cloud/undo';
import { applyPull } from '@/lib/cloud/merge';
import { clearUndo, pushUndo, undoDepth } from '@/lib/db/undoStack';
import { _resetStamp } from '@/lib/db/stamp';

const sqls = (): string[] => exec.mock.calls.map((c) => String((c as unknown[])[0]));

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  exec.mockClear();
  select.mockClear();
  clearUndo();
  _resetStamp();
  noteMergedRows.mockClear();
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('되돌릴 것이 없을 때', () => {
  it('스택이 비면 아무것도 안 하고 `empty` 로 말한다 — 침묵하면 "눌렸는데 안 됐다"와 구분이 안 된다', async () => {
    const r = await undoLastWrite();
    expect(r).toEqual({ state: null, restored: 0, skipped: 0, empty: true });
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('① 검증된 병합 기계를 재사용한다', () => {
  it('바뀐 행은 **옛 값**을 upsert 한다 — 문장 모양이 병합과 같다(툼스톤 가드 + LWW)', async () => {
    pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);
    const r = await undoLastWrite();
    expect(r.restored).toBe(1);
    const upsert = sqls().find((s) => /INSERT INTO settings/.test(s))!;
    expect(upsert, '병합과 다른 문장을 쓰면 부활 가드가 빠진다').toMatch(
      /NOT EXISTS[\s\S]*tombstones[\s\S]*deleted_at >= \?/,
    );
    expect(upsert).toMatch(/excluded\.updated_at > settings\.updated_at/);
    const args = exec.mock.calls.find((c) => /INSERT INTO settings/.test(String(c[0])))![1] as unknown[];
    expect(args.slice(0, 2)).toEqual(['theme', '"dark"']);
  });

  it('새로 생긴 행(`vals:null`)의 되돌리기는 **삭제**다 — 툼스톤을 남겨 다른 기기에도 간다', async () => {
    pushUndo([{ table: 'week_alloc', key: ['2026-08-03', 'sid1'], vals: null }], 100);
    const r = await undoLastWrite();
    expect(r.restored).toBe(1);
    expect(sqls().some((s) => /INSERT INTO tombstones/.test(s))).toBe(true);
    expect(sqls().find((s) => /DELETE FROM week_alloc/.test(s))).toMatch(/updated_at <= \?/);
  });

  it('되돌린 값에는 **fresh 스탬프**가 붙는다 — 안 그러면 LWW 에서 지금 값을 못 이긴다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);
    await undoLastWrite();
    const args = exec.mock.calls.find((c) => /INSERT INTO settings/.test(String(c[0])))![1] as unknown[];
    expect(Number(args[2]), '되돌린 행의 updated_at 이 옛 스탬프면 아무 일도 안 일어난다').toBeGreaterThan(100);
  });
});

describe('② 에코 억제 — 되돌린 값은 다른 기기로 가야 한다', () => {
  it('⚠⚠ 억제표에 **안 적는다**(`echo:false`) — 적으면 되살린 값이 다른 기기에 영원히 안 간다', async () => {
    pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);
    await undoLastWrite();
    expect(noteMergedRows, '조용한 영구 분기(로컬=되돌린 값 · 상대=옛 값)가 된다').not.toHaveBeenCalled();
  });
});

describe('③ 스택 무효화 계약', () => {
  it('⚠ pull 병합은 스택을 **비운다** — 받아온 행 위에서는 pre-image 가 더 이상 직전이 아니다', async () => {
    pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);
    await applyPull({
      since: 0,
      upto: 1,
      rows: [{ tbl: 'settings', key: ['theme'], data: ['"light"'], updatedAt: 500 }],
      tombstones: [],
    });
    expect(undoDepth(), '안 비우면 되돌리기가 다른 기기 편집을 LWW 로 이겨 서버까지 지운다').toBe(0);
  });

  it('⚠ 되돌리기 자신은 **안 비운다** — 비우면 한 번 누르고 나머지가 사라진다(1단계 언두)', async () => {
    pushUndo([{ table: 'settings', key: ['a'], vals: ['a', '1'] }], 100);
    pushUndo([{ table: 'settings', key: ['b'], vals: ['b', '2'] }], 200);
    await undoLastWrite();
    expect(undoDepth(), '연속 ⌘Z 가 성립해야 한다').toBe(1);
    await undoLastWrite();
    expect(undoDepth()).toBe(0);
  });

  it('병합 쓰기가 실패하면 스택을 안 비운다 — 로컬이 안 바뀌었으므로 pre-image 는 여전히 유효하다', async () => {
    pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);
    exec.mockRejectedValueOnce(new Error('boom'));
    await expect(
      applyPull({
        since: 0,
        upto: 1,
        rows: [{ tbl: 'settings', key: ['theme'], data: ['"light"'], updatedAt: 500 }],
        tombstones: [],
      }),
    ).rejects.toThrow();
    expect(undoDepth()).toBe(1);
  });
});

describe('④ 툼스톤 가드 — 다른 기기가 지운 행', () => {
  const tombs = (rows: { tbl: string; k1: string; k2: string }[]): void => {
    select.mockImplementation(async (q: string) => {
      if (/FROM tombstones/.test(q)) return rows;
      return /FROM settings/.test(q) ? [{ key: 'theme', value: '"dark"' }] : [];
    });
  };

  it('내 쓰기 **뒤에** 생긴 툼스톤이 있으면 그 행은 되살리지 않고 센다', async () => {
    tombs([{ tbl: 'settings', k1: 'theme', k2: '' }]);
    pushUndo(
      [
        { table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] },
        { table: 'settings', key: ['other'], vals: ['other', '1'] },
      ],
      100,
    );
    const r = await undoLastWrite();
    expect(r.skipped).toBe(1);
    expect(r.restored).toBe(1);
    expect(sqls().some((s) => /INSERT INTO settings/.test(s))).toBe(true);
    const args = exec.mock.calls.filter((c) => /INSERT INTO settings/.test(String(c[0])));
    expect(
      args.map((c) => (c[1] as unknown[])[0]),
      '지워진 행이 되살아났다',
    ).toEqual(['other']);
  });

  it('질의는 **내 쓰기 스탬프보다 뒤**만 본다 — 그 앞의 툼스톤은 내 삭제이고 되돌려야 한다', async () => {
    tombs([]);
    pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);
    await undoLastWrite();
    const call = select.mock.calls.find((c) => /FROM tombstones/.test(String(c[0])))!;
    expect(String(call[0])).toMatch(/deleted_at > \?/);
    expect((call[1] as unknown[])[0]).toBe(100);
  });

  it('전부 걸리면 쓰기를 아예 안 하고 `empty:false` 로 온다 — "되돌릴 게 없었다"와 다른 사건이다', async () => {
    tombs([{ tbl: 'settings', k1: 'theme', k2: '' }]);
    pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);
    const r = await undoLastWrite();
    expect(r).toMatchObject({ restored: 0, skipped: 1, empty: false });
    expect(exec).not.toHaveBeenCalled();
  });
});
