// @vitest-environment jsdom
/* ============================================================
   dbRowVerify.test.ts — 되읽기 대조의 **행축** 계약(2026-07-29).

   ## 이 파일이 잠그는 것

   대조는 세 세대를 거쳤다: ①매 flush 전량 → ②표본(첫 쓰기 + 20회당 1회 · H6) → ③행축(지금).
   ②의 대가는 **20회 중 19회가 무검증**이었다는 것이고, ③은 손댄 행만 되읽어 그 대가 없이
   더 싸게 **매 flush** 검증한다.

   여기서 단언하는 것은 성능이 아니라 **탐지력**이다: 값이 갈렸을 때 실제로 잡는가, 그리고
   잡지 말아야 할 것(SQLite 의 정상적인 타입 거동)에 오탐하지 않는가. 그 둘이 다 있어야
   경고가 신호로 남는다 — 오탐하는 경고는 곧 무시되고, 그러면 검증이 없는 것과 같다.

   ⚠ 모킹은 **얕게**: 진짜 `db/write.ts`·`db/rows.ts` 를 태우고 plugin-sql 의 `execute`/`select`
   만 가짜 저장소로 바꾼다. 판정 함수를 단위로 보면 "계산은 옳다"만 증명되고, 정작 미지인
   **쓰기→되읽기→대조 연결**이 안 보인다(`dbUnavailable.test.ts` 와 같은 규율).
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 가짜 SQLite — `INSERT OR REPLACE` 와 `SELECT … WHERE k IN (…)` 만 이해하면 충분하다. */
const store = new Map<string, Record<string, unknown>>();
/** 이 열의 값을 되읽을 때 일부러 망가뜨린다(반증용). null 이면 정상 동작. */
let corrupt: { table: string; col: string; to: unknown } | null = null;

const load = vi.fn(async () => ({
  execute: async (sql: string, args: unknown[] = []) => {
    const m = /^INSERT OR REPLACE INTO (\w+) \(([^)]+)\)/.exec(sql);
    if (m) {
      const [, table, colsRaw] = m;
      const cols = colsRaw!.split(',');
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => (row[c] = args[i]));
      store.set(`${table}\u0000${String(args[0])}\u0000${cols.length > 2 ? String(args[1]) : ''}`, {
        ...row,
        __t: table,
      });
    }
    return undefined;
  },
  select: async (sql: string, args: unknown[] = []) => {
    const m = /FROM (\w+) WHERE (\w+) IN/.exec(sql);
    if (!m) return [];
    const [, table] = m;
    const want = new Set(args.map(String));
    const out: Record<string, unknown>[] = [];
    for (const row of store.values()) {
      if (row.__t !== table) continue;
      const first = Object.values(row)[0];
      if (!want.has(String(first))) continue;
      const copy = { ...row };
      delete copy.__t;
      if (corrupt && corrupt.table === table) copy[corrupt.col] = corrupt.to;
      out.push(copy);
    }
    return out;
  },
}));

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load } }));
vi.mock('@/lib/isTauri', () => ({ isTauri: () => true }));
vi.mock('@/lib/tauri', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  dbUrl: async () => 'sqlite:test.db',
}));

import { defaults } from '@/lib/persistence';
import type { AppState } from '@/lib/types';

async function freshWrite() {
  vi.resetModules();
  const { writeAndVerify } = await import('@/lib/db/write');
  return writeAndVerify;
}

const seed = (over: Partial<AppState> = {}): AppState => ({ ...defaults(), ...over }) as AppState;

beforeEach(() => {
  store.clear();
  corrupt = null;
});

describe('되읽기 대조 — 행축', () => {
  it('정상 왕복이면 일치로 보고한다', async () => {
    const writeAndVerify = await freshWrite();
    const r = await writeAndVerify(seed({ moduleLen: 120 } as Partial<AppState>));
    expect(r.skipped).toBe(false);
    expect(r.unavailable).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.mismatched).toEqual([]);
  });

  it('⚠ 반증 — 되읽은 값이 갈리면 **그 테이블을** 불일치로 잡는다', async () => {
    const writeAndVerify = await freshWrite();
    await writeAndVerify(seed({ moduleLen: 120 } as Partial<AppState>));
    // 두 번째 쓰기부터는 손댄 행만 되읽는다 — 그 되읽기를 망가뜨린다.
    corrupt = { table: 'settings', col: 'value', to: '"엉뚱한 값"' };
    const r = await writeAndVerify(seed({ moduleLen: 90 } as Partial<AppState>));
    expect(r.ok).toBe(false);
    expect(r.mismatched).toContain('settings');
  });

  it('바뀐 행이 없으면 직전 결과를 그대로 둔다 — 안 잰 것을 "일치"라고 새로 쓰지 않는다', async () => {
    const writeAndVerify = await freshWrite();
    const st = seed({ moduleLen: 120 } as Partial<AppState>);
    const first = await writeAndVerify(st);
    expect(first.ok).toBe(true);
    const again = await writeAndVerify(st); // 같은 상태 = diff 0
    expect(again.ok).toBe(true);
    expect(again.mismatched).toEqual([]);
  });

  it('숫자/문자 표현 차이는 불일치가 아니다 — SQLite 열 친화성의 정상 거동이라 오탐하면 경고가 죽는다', async () => {
    const writeAndVerify = await freshWrite();
    await writeAndVerify(seed({ moduleLen: 120 } as Partial<AppState>));
    corrupt = { table: 'settings', col: 'key', to: 'moduleLen' }; // 같은 값, 타입만 문자열
    const r = await writeAndVerify(seed({ moduleLen: 90 } as Partial<AppState>));
    expect(r.mismatched).not.toContain('meta');
  });
});
