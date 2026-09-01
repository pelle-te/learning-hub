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

/* ⚠ **모의의 시그니처를 명시한다**(V068 · 2026-09-01). `vi.fn(async () => undefined)` 로 두면
   `mock.calls` 가 `[][]` 라 `c[1]` 을 읽는 자리마다 타입이 깨진다 — 그런데 이 파일은 **어느 타입
   검사에도 안 걸려 있어서** 그 사실이 드러난 적이 없었다(`tsconfig.app.json` 의 `include:["src"]`).
   실인자를 적어 두면 «이 모의가 무엇을 흉내내는가»가 서명 한 줄로 남는다. */
const exec = vi.fn(async (_q: string, _args?: unknown[]): Promise<unknown> => undefined);
const select = vi.fn(async (q: string, _args?: unknown[]): Promise<Record<string, unknown>[]> =>
  /FROM settings/.test(q) ? [{ key: 'theme', value: '"dark"' }] : [],
);
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => ({ execute: exec, select }) },
}));

/* 에코 억제표에 **적히지 않는가**만 본다(C1) — 표 자체는 `cloudOutbox.test.ts` 가 잠근다. */
const noteMergedRows = vi.fn();
vi.mock('@/lib/cloud/outbox', async (orig) => {
  const m = await orig<typeof import('@/lib/cloud/outbox')>();
  return { ...m, noteMergedRows: (...a: Parameters<typeof m.noteMergedRows>) => noteMergedRows(...a) };
});

import { redoLastWrite, undoLastWrite } from '@/lib/cloud/undo';
import { applyPull } from '@/lib/cloud/merge';
import { clearUndo, pushUndo, undoDepth } from '@/lib/db/undoStack';
import { _resetStamp } from '@/lib/db/stamp';

const sqls = (): string[] => exec.mock.calls.map((c) => String(c[0]));

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

  /* ⚠⚠ H2 회귀 — **⌘Z 가 실패하면 그 항목이 남아 있어야 한다.** 종전 순서는 `pop → apply` 라
     적용이 던지면 항목은 이미 사라진 뒤였고, 호출부에 `.catch` 도 없어 화면은 아무 말도 안 했다:
     누를 때마다 스택이 한 칸씩 조용히 파괴됐다. 지금은 `peek → apply → drop` 이다. */
  it('⚠⚠ 되돌리기 **적용이 실패하면** 항목이 스택에 남는다 — 재시도가 성립한다(H2)', async () => {
    pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);
    exec.mockRejectedValueOnce(new Error('boom'));
    await expect(undoLastWrite()).rejects.toThrow();
    expect(undoDepth(), 'pop-먼저 순서면 여기가 0 이 되고 되돌릴 것이 조용히 사라진다').toBe(1);
    // 그리고 다시 누르면 이번엔 성공한다.
    const r = await undoLastWrite();
    expect(r.restored).toBe(1);
    expect(undoDepth()).toBe(0);
  });

  it('툼스톤에 전부 막혀 쓸 것이 없어도 **항목은 소비된다** — 안 그러면 같은 경고가 영원히 반복된다', async () => {
    select.mockImplementation(async (q: string) =>
      /FROM tombstones/.test(q) ? [{ tbl: 'settings', k1: 'theme', k2: '' }] : [],
    );
    pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);
    const r = await undoLastWrite();
    expect(r).toMatchObject({ restored: 0, skipped: 1 });
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

/* ============================================================
   ⑤ **되돌리기의 되돌리기**(⇧⌘Z · 2026-08-20 리뷰 M-6).

   이 describe 가 생기기 전까지 이 파일에는 `redo` 라는 문자열이 **한 번도 없었다**(케이스 13개
   전부 `undoLastWrite` 축). 그래서 "추가 → ⌘Z → ⇧⌘Z" 가 **항상 실패**하는데 게이트가 녹색이었다.

   ⚠ **툼스톤 표를 진짜로 흉내 내야 이 결함이 보인다.** 위 `tombs()` 는 고정 배열을 돌려주므로
   *역연산이 방금 쓴* 툼스톤이 다음 조회에 안 나타난다 — 그러면 버그가 재현되지 않는다.
   여기서는 `exec` 로 들어온 `INSERT INTO tombstones` 를 모아 두고 `deleted_at > ?` 로 걸러
   돌려준다. 그게 실제 DB 가 하는 일이고, 이 결함의 본질이 정확히 "내가 쓴 툼스톤이 내 다음
   단계의 가드에 걸린다"이기 때문이다.
============================================================ */
describe('⑤ redo — 되돌리기가 만든 툼스톤이 자기 재실행을 막지 않는다', () => {
  /** 실 DB 흉내: `INSERT INTO tombstones` 를 누적하고 `deleted_at > ?` 질의에 그대로 답한다. */
  const liveTombstones = (): void => {
    const rows: { tbl: string; k1: string; k2: string; deleted_at: number }[] = [];
    exec.mockImplementation(async (...a: unknown[]) => {
      const sql = String(a[0]);
      const args = (a[1] ?? []) as unknown[];
      if (/INSERT INTO tombstones/.test(sql)) {
        rows.push({
          tbl: String(args[0]),
          k1: String(args[1]),
          k2: String(args[2]),
          deleted_at: Number(args[3]),
        });
      }
      return undefined;
    });
    select.mockImplementation(async (q: string, v?: unknown[]) => {
      if (/FROM tombstones/.test(q)) {
        const since = Number((v ?? [])[0] ?? 0);
        return rows.filter((r) => r.deleted_at > since);
      }
      if (/FROM settings/.test(q)) return [{ key: 'theme', value: '"dark"' }];
      /* ⚠ 이 행이 **있어야** redo 가 의미를 갖는다 — `currentImages` 는 `applyPull`(삭제) *앞*
         에서 돌므로 그 시점의 DB 에는 아직 행이 있다. 여기서 빈 배열을 주면 redo 항목의
         pre-image 가 `null` 이 되어 "되살리기"가 아니라 "또 삭제"가 되고, 그러면 이 케이스가
         결함을 통과시킨다(모의가 결함을 가리는 전형적인 형태). */
      /* ⚠ `WHERE` 가 있는 것만 — 그게 `currentImages` 의 단건 조회다. `readRows()` 의 전량
         조회(WHERE 없음)까지 이 행을 주면 `rowsToState` 가 다른 열 이름을 기대해 죽는다. */
      if (/FROM week_alloc/.test(q) && /WHERE/.test(q)) return [{ wk: '2026-08-03', sid: 'sid1', json: '{"m":60}' }];
      return [];
    });
  };

  it('추가 → ⌘Z → ⇧⌘Z 가 실제로 행을 되살린다 (종전엔 100% 실패했다)', async () => {
    liveTombstones();
    // "행을 만든 편집" — pre-image 가 null 이다(그 행은 이 쓰기 전에 없었다).
    pushUndo([{ table: 'week_alloc', key: ['2026-08-03', 'sid1'], vals: null }], 100);

    const undone = await undoLastWrite();
    expect(undone.restored, '⌘Z 는 그 행을 삭제한다(툼스톤 + DELETE)').toBe(1);
    expect(sqls().some((s) => /INSERT INTO tombstones/.test(s))).toBe(true);

    exec.mockClear();
    const redone = await redoLastWrite();
    expect(
      redone.skipped,
      '되돌리기가 방금 찍은 툼스톤이 자기 재실행을 막으면 안 된다 — 그때의 사유 문구는 ' +
        '"다른 기기가 지웠다"인데 다른 기기는 관여한 적이 없다',
    ).toBe(0);
    expect(redone.restored, '⇧⌘Z 가 행을 되살려야 한다').toBe(1);
    expect(sqls().some((s) => /INSERT INTO week_alloc/.test(s))).toBe(true);
  });

  it('redo 항목의 툼스톤 가드 기준선은 **역연산의 스탬프**다(원본 쓰기의 것이 아니라)', async () => {
    liveTombstones();
    vi.spyOn(Date, 'now').mockReturnValue(9_000);
    pushUndo([{ table: 'week_alloc', key: ['2026-08-03', 'sid1'], vals: null }], 100);
    await undoLastWrite();

    // ⌘Z 가 쓴 툼스톤의 스탬프
    const tombStamp = Number(
      (exec.mock.calls.find((c) => /INSERT INTO tombstones/.test(String(c[0])))![1] as unknown[])[3],
    );
    select.mockClear();
    await redoLastWrite();

    const guard = select.mock.calls.find((c) => /FROM tombstones/.test(String(c[0])))!;
    expect(
      Number((guard[1] as unknown[])[0]),
      '기준선이 원본 스탬프(100)면 방금 쓴 툼스톤이 언제나 걸린다',
    ).toBeGreaterThanOrEqual(tombStamp);
  });

  it('그래도 **다른 기기가 그 뒤에 지운** 행은 되살리지 않는다 — 가드의 원래 의미는 유지된다', async () => {
    liveTombstones();
    pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);
    await undoLastWrite(); // 값 복원(툼스톤 안 씀)

    // 역연산 뒤에 다른 기기의 삭제가 도착한 상황을 만든다.
    await exec('INSERT INTO tombstones (tbl,k1,k2,deleted_at) VALUES (?,?,?,?)', [
      'settings',
      'theme',
      '',
      Number.MAX_SAFE_INTEGER,
    ]);
    exec.mockClear();
    const redone = await redoLastWrite();
    expect(redone.skipped, '역연산 *이후*의 삭제는 여전히 이겨야 한다').toBe(1);
    expect(redone.restored).toBe(0);
  });
});

/* ============================================================
   P027(2026-08-22) — **`currentImages` 가 행마다 질의를 순차로 냈다.**

   되돌릴 배치가 클수록 IPC 왕복이 그만큼 늘었고(폰은 워커 왕복이다), 그건 사용자가 ⌘Z 를 누른
   **직후**의 지연이라 가장 눈에 띄는 자리다. 같은 형태를 `C045` 가 `readTouched` 에서 이미
   고쳤으므로 그 함수를 재사용했다 — 표마다 질의 하나, 키 열마다 `IN`.

   ⚠ 여기서 재는 것은 **모양**이다(시간이 아니라 질의 수). 실 DB 가 작아 시간으로는 아무것도
   안 보이고, 보이는 것은 «행 수에 비례하는가»다 — `C055` 가 세운 것과 같은 축이다.
============================================================ */
describe('P027 되돌리기 pre-image 읽기가 행 수에 비례하지 않는다', () => {
  it('⚠⚠ 같은 표의 행 여럿이면 질의는 **하나**다 — 종전엔 행마다 하나였다', async () => {
    const 질의: string[] = [];
    select.mockImplementation(async (q: string) => {
      질의.push(q);
      if (/FROM tombstones/.test(q)) return [];
      return [];
    });

    /* 같은 표(week_alloc)의 행 여섯을 되돌린다. */
    pushUndo(
      Array.from({ length: 6 }, (_, i) => ({
        table: 'week_alloc',
        key: ['2026-08-03', `sid${i}`],
        vals: null,
      })),
      100,
    );
    await undoLastWrite();

    const 대상질의 = 질의.filter((q) => /FROM week_alloc/.test(q) && /WHERE/.test(q));
    expect(대상질의.length, `행마다 질의가 나갔다(${대상질의.length}건) — ⌘Z 직후 지연이 행 수에 비례한다`).toBe(1);
  });

  it('⚠ 표가 둘이면 둘 — 표마다 하나이지 전체 하나가 아니다(스키마가 다르다)', async () => {
    const 질의: string[] = [];
    select.mockImplementation(async (q: string) => {
      질의.push(q);
      return [];
    });

    pushUndo(
      [
        { table: 'week_alloc', key: ['2026-08-03', 'sid1'], vals: null },
        { table: 'week_alloc', key: ['2026-08-03', 'sid2'], vals: null },
        { table: 'settings', key: ['theme'], vals: null },
      ],
      100,
    );
    await undoLastWrite();

    const 표별 = new Set(질의.filter((q) => /WHERE/.test(q)).map((q) => /FROM (\w+)/.exec(q)?.[1] ?? ''));
    expect(표별.has('week_alloc')).toBe(true);
    expect(표별.has('settings')).toBe(true);
    expect(질의.filter((q) => /FROM week_alloc/.test(q) && /WHERE/.test(q)).length, '표 안에서 또 쪼개졌다').toBe(1);
  });
});
