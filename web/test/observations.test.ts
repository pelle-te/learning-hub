/* ============================================================
   observations.test.ts — **백업의 범위**를 잠근다(2026-08-20 리뷰 m-17).

   ## 왜 이 파일이 필요한가

   `lib/observations.ts` 는 H-14 가 *"관측 원장이 어떤 백업에도 없어서 재설치·오리진 이동 때
   0 이 됐다"* 를 고치려고 만든 층인데, **그 재발을 잡는 검사가 하나도 없었다**(테스트 트리
   전량에서 import 0건). 이 모듈이 조용히 빈 값을 주면 `러닝허브_*.json` 에 원장이 안 실리고
   사용자는 "저장했어요" 토스트를 받는다 — 실패가 조용한 부류다.

   ⚠ **분모를 먼저 단언한다.** 빈 결과를 성공으로 읽으면 이 파일이 정확히 그 결함을 통과시킨다
   (이 저장소가 "녹색인데 아무것도 안 쟀다"로 반복해 물린 형태).

   ## ⚠⚠ 이 파일에 `@vitest-environment jsdom` 을 다시 달지 마라 (O003 · 2026-08-22 운영 축)

   달려 있었고, **그것이 CI 를 이틀간 빨간불로 만든 원인이었다.** 프라그마는 이 파일을 vite 의
   *client* 환경으로 옮기는데, 그 환경은 `noExternal` 이라 아래 `node:sqlite` 를 **번들하려 든다**.
   그게 되느냐 마느냐는 러너의 Node 버전에 달려 있다 — `node:sqlite` 가 `builtinModules` 에
   들어온 24 에서는 외부화되고(로컬 통과), 22 에서는
   `Cannot bundle Node.js built-in "node:sqlite"` 로 죽는다(CI 실패). 즉 **로컬 게이트 녹색이
   CI 녹색을 보장하지 않는 통로**가 이 한 줄이었다.

   이 파일이 jsdom 에서 쓰던 DOM 은 `window` **하나뿐**이고 그것도 `isTauri()` 를 참으로
   만들려는 것이다(`lib/isTauri.ts` 는 `typeof window !== 'undefined'` 를 본다) — node 환경에서
   `globalThis.window` 를 세우면 같은 값을 얻는다. 환경을 통째로 바꿀 이유가 없었다.
   ⚠ 짝: `.nvmrc` 를 CI 가 읽게 한 것이 **근본** 처방이고(선언과 실행이 갈려 있었다), 이건
   그 통로 자체를 없앤 **국소** 처방이다. 둘 다 한다 — 이 저장소가 반복해 물린 형태라서.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/** 아주 작은 표 네 개짜리 가짜 DB — SQL 을 파싱하지 않고 **의도**만 흉내 낸다. */
const visits = new Map<string, { key: string; day: string; via: string; n: number }>();
const signals = new Map<string, Record<string, unknown>>();
const hops = new Map<string, { from_key: string; to_key: string; day: string; hour: number; n: number }>();
const idle = new Map<string, { day: string; hour: number; n: number; sec: number }>();
const exec = vi.fn(async (sql: string, args: unknown[] = []) => {
  if (/INSERT INTO route_visits/.test(sql)) {
    const [key, day, via, n] = args as [string, string, string, number];
    const k = `${key}|${day}|${via}`;
    const cur = visits.get(k);
    // ⚠ 실 SQL 의 `MAX(n, excluded.n)` 를 그대로 흉내 낸다 — 이 케이스의 핵심 계약이다.
    visits.set(k, { key, day, via, n: Math.max(cur?.n ?? 0, n) });
    return undefined;
  }
  if (/INSERT INTO day_signals/.test(sql)) {
    const [ds, pending, overdue, backlog, ankiDue, dueSoon] = args as [string, number, number, number, number, number];
    signals.set(ds, { ds, pending, overdue, backlog, anki_due: ankiDue, due_soon: dueSoon });
    return undefined;
  }
  if (/INSERT INTO route_hops/.test(sql)) {
    const [from_key, to_key, day, hour, n] = args as [string, string, string, number, number];
    const k = `${from_key}|${to_key}|${day}|${hour}`;
    hops.set(k, { from_key, to_key, day, hour, n: Math.max(hops.get(k)?.n ?? 0, n) });
    return undefined;
  }
  if (/INSERT INTO idle_spells/.test(sql)) {
    const [day, hour, n, sec] = args as [string, number, number, number];
    const k = `${day}|${hour}`;
    const cur = idle.get(k);
    idle.set(k, { day, hour, n: Math.max(cur?.n ?? 0, n), sec: Math.max(cur?.sec ?? 0, sec) });
    return undefined;
  }
  return undefined;
});
const select = vi.fn(async (q: string) => {
  if (/FROM route_visits/.test(q)) return [...visits.values()];
  if (/FROM day_signals/.test(q)) return [...signals.values()];
  if (/FROM route_hops/.test(q)) return [...hops.values()];
  if (/FROM idle_spells/.test(q)) return [...idle.values()];
  return [];
});
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => ({ execute: exec, select }) },
}));

import { exportObservations, importObservations, OBSERVATIONS_FIELD, OBSERVATION_TABLES } from '@/lib/observations';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

beforeEach(() => {
  /* ⚠ node 환경이다 — `window` 를 여기서 만든다(위 머리주석: jsdom 을 쓰지 않는 이유). */
  (globalThis as unknown as Record<string, unknown>).window ??= {};
  (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  visits.clear();
  signals.clear();
  hops.clear();
  idle.clear();
  exec.mockClear();
  select.mockClear();
});
afterEach(() => {
  delete (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('백업 범위 — 관측 원장이 실제로 실린다', () => {
  it('내보내기 → 가져오기 왕복에서 방문·신호가 보존된다 (H-14 가 만든 층의 존재 이유)', async () => {
    visits.set('today|2026-08-01|rail', { key: 'today', day: '2026-08-01', via: 'rail', n: 3 });
    signals.set('2026-08-01', {
      ds: '2026-08-01',
      pending: 2,
      overdue: 1,
      backlog: 4,
      anki_due: 7,
      due_soon: 5,
    });

    const out = await exportObservations();
    // ⚠ 분모 먼저 — 빈 페이로드를 성공으로 읽으면 이 케이스가 결함을 통과시킨다.
    expect(out.visits.length, '방문 원장이 백업에서 빠졌다').toBeGreaterThan(0);
    expect(out.signals.length, '신호 원장이 백업에서 빠졌다').toBeGreaterThan(0);

    const wire = JSON.parse(JSON.stringify({ [OBSERVATIONS_FIELD]: out })) as Record<string, unknown>;
    visits.clear();
    signals.clear();

    const n = await importObservations(wire[OBSERVATIONS_FIELD]);
    expect(n).toBe(2);
    const back = await exportObservations();
    expect(back.visits).toEqual(out.visits);
    expect(back.signals).toEqual(out.signals);
  });

  it('방문 수는 **깎이지 않는다** — 오래된 백업이 지금 기기의 관측을 되돌리면 그건 복원이 아니다', async () => {
    visits.set('today|2026-08-01|rail', { key: 'today', day: '2026-08-01', via: 'rail', n: 9 });
    await importObservations({ visits: [{ key: 'today', day: '2026-08-01', via: 'rail', n: 2 }], signals: [] });
    expect(visits.get('today|2026-08-01|rail')?.n, 'MAX 가 아니라 덮어쓰면 게이트가 영영 안 열린다').toBe(9);
  });

  it('키가 없는 행은 건너뛰고 나머지는 복원한다 — 파일 한 줄이 이상해도 통째로 버리지 않는다', async () => {
    const n = await importObservations({
      visits: [
        { day: '2026-08-01', via: 'rail', n: 1 },
        { key: 'items', day: '2026-08-02', via: 'palette', n: 5 },
      ],
      signals: [{ pending: 1 }, { ds: '2026-08-02', pending: 1, overdue: 0, backlog: 0, anki_due: 0, due_soon: 0 }],
    });
    expect(n).toBe(2);
    expect(visits.size).toBe(1);
    expect(signals.size).toBe(1);
  });

  it('수가 아닌 값은 0 으로 굳는다 — 손상 파일이 NaN 을 원장에 심지 않는다', async () => {
    await importObservations({
      visits: [{ key: 'today', day: '2026-08-01', via: 'rail', n: 'many' }],
      signals: [],
    });
    expect(visits.get('today|2026-08-01|rail')?.n).toBe(0);
  });

  it('객체가 아닌 입력은 0건 — 구 백업엔 `_obs` 가 없고, 그때 가져오기는 조용한 no-op 이어야 한다', async () => {
    expect(await importObservations(undefined)).toBe(0);
    expect(await importObservations('nope')).toBe(0);
    expect(await importObservations([1, 2])).toBe(0);
    expect(exec).not.toHaveBeenCalled();
  });
});

/* ============================================================
   D007(2026-08-21 데이터 축) — **논거가 아니라 목록이 낡았다.**

   이 모듈은 2026-08-06 에 쓰였고, `route_hops`(010)·`idle_spells`(011)는 **그 다음 날** 생겼다.
   둘 다 백업 목록에 안 들어갔고 아무도 몰랐다 — 실 DB 의 `route_hops` 는 67행 · 14일 누적이었다.
   재설치 왕복 한 번에 0 이 되고, 재축적에 2~12주가 걸린다(원리적으로 재생성 불가).

   ⚠ 아래 케이스가 이 회차 처방의 본체다. **목록을 스키마에서 역산**해 대조한다:
   `updated_at` 열이 없는 표 = 동기화 대상이 아님 = **백업이 유일한 연속성 수단**.
   그래서 새 관측 원장이 생기면 여기서 빨간불이 뜬다 — 사람 기억이 아니라 기계가 센다.

   ⚠ `meta`·`runtime_cache`·`sync_state`·`_sqlx_migrations` 는 그 규칙의 예외다: 파생 캐시이거나
   **기기 로컬 동기화 진행 상태**라 백업에 실으면 오히려 틀린다(`db.rs` v4 주석 · `client.ts`
   의 «내보내기·동기화 대상이 아니다»). 예외 표가 사문화하지 않도록 아래에서 함께 단언한다.
============================================================ */
describe('⚠⚠ 관측 원장 목록이 스키마에서 역산된다(D007)', () => {
  /** 백업 대상이 아닌 것 — 파생 캐시이거나 기기 로컬 진행 상태. */
  const 면제: Record<string, string> = {
    meta: '파생 캐시(rows 매퍼 소유)',
    runtime_cache: '파생 캐시(plan 무관)',
    sync_state: '기기 로컬 동기화 진행 — 실으면 남의 워터마크를 들여온다',
    _migrations: '폰 워커의 이행 기록(스키마 자신)',
    tombstones: '삭제 툼스톤 — 동기화 프로토콜의 일부다(`deleted_at` 을 쓴다)',
    devices: '서버(D1) 전용 — 로컬엔 빈 채로 만들어진다(005 머리주석)',
    enroll_codes: '서버(D1) 전용 — 동상',
  };

  /* ⚠ SQL 을 정규식으로 파싱하지 않고 **실제로 적용해서** 스키마를 읽는다. 이 폴더의 DDL 은
     한 줄짜리·들여쓴 것·`ALTER TABLE … ADD COLUMN`·표 재작성 후 `RENAME` 이 섞여 있어서,
     텍스트 매칭은 조용히 절반만 본다(첫 시도가 14표 중 5표만 찾았다). `dbMigrations.test.ts`
     가 같은 이유로 같은 엔진을 쓴다. */
  const 스키마표들 = (): { table: string; hasUpdatedAt: boolean }[] => {
    const dir = join(process.cwd(), '..', 'src-tauri', 'migrations');
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort())
      db.exec(readFileSync(join(dir, f), 'utf8'));
    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    const out = tables.map((t) => ({
      table: t,
      hasUpdatedAt: (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some(
        (c) => c.name === 'updated_at',
      ),
    }));
    db.close();
    return out;
  };

  it('스키마를 실제로 읽어 냈다 — 0개면 아래 케이스가 공허하게 통과한다', () => {
    expect(스키마표들().length).toBeGreaterThan(8);
  });

  it('⚠⚠ updated_at 없는 표는 전부 백업에 실리거나 면제 사유를 갖는다', () => {
    const 빠진것 = 스키마표들()
      .filter((t) => !t.hasUpdatedAt)
      .map((t) => t.table)
      .filter((t) => !OBSERVATION_TABLES.includes(t as (typeof OBSERVATION_TABLES)[number]) && !(t in 면제));

    expect(
      빠진것,
      '동기화도 안 되고 백업에도 없다 = 재설치 한 번에 영구 소실. 백업에 싣거나 면제 사유를 적어라',
    ).toEqual([]);
  });

  it('면제 표가 사문화하지 않았다 — 없는 표에 사유가 붙어 있으면 실패', () => {
    const 실존 = new Set(스키마표들().map((t) => t.table));
    // `_migrations` 는 폰 워커가 코드로 만든다(마이그레이션 SQL 밖) — 그것만 예외.
    expect(Object.keys(면제).filter((t) => t !== '_migrations' && !실존.has(t))).toEqual([]);
  });

  it('OBSERVATION_TABLES 가 전부 실존하고, 전부 동기화 대상이 아니다', () => {
    const 표 = new Map(스키마표들().map((t) => [t.table, t.hasUpdatedAt]));
    for (const t of OBSERVATION_TABLES) {
      expect(표.has(t), `${t} 가 스키마에 없다`).toBe(true);
      expect(표.get(t), `${t} 에 updated_at 이 생겼다 — 그럼 동기화 대상이고 여기 있으면 안 된다`).toBe(false);
    }
  });
});

describe('D007 왕복 — 홉·유휴도 보존된다', () => {
  it('네 원장이 전부 실리고 되돌아온다', async () => {
    visits.set('today|2026-08-01|rail', { key: 'today', day: '2026-08-01', via: 'rail', n: 3 });
    signals.set('2026-08-01', { ds: '2026-08-01', pending: 1, overdue: 0, backlog: 0, anki_due: 0, due_soon: 0 });
    hops.set('today|items|2026-08-01|9', {
      from_key: 'today',
      to_key: 'items',
      day: '2026-08-01',
      hour: 9,
      n: 4,
    });
    idle.set('2026-08-01|14', { day: '2026-08-01', hour: 14, n: 2, sec: 900 });

    const out = await exportObservations();
    expect(out.hops.length, '홉 원장이 백업에서 빠졌다 — 실 DB 67행이 그렇게 사라진다').toBe(1);
    expect(out.idle.length, '유휴 원장이 백업에서 빠졌다').toBe(1);

    const wire = JSON.parse(JSON.stringify(out)) as unknown;
    hops.clear();
    idle.clear();
    expect(await importObservations(wire)).toBe(4);

    const back = await exportObservations();
    expect(back.hops).toEqual(out.hops);
    expect(back.idle).toEqual(out.idle);
  });

  it('홉·유휴도 깎이지 않는다 — 방문과 같은 MAX 규칙', async () => {
    hops.set('a|b|2026-08-01|9', { from_key: 'a', to_key: 'b', day: '2026-08-01', hour: 9, n: 9 });
    idle.set('2026-08-01|9', { day: '2026-08-01', hour: 9, n: 5, sec: 600 });
    await importObservations({
      hops: [{ from_key: 'a', to_key: 'b', day: '2026-08-01', hour: 9, n: 2 }],
      idle: [{ day: '2026-08-01', hour: 9, n: 1, sec: 60 }],
    });
    expect(hops.get('a|b|2026-08-01|9')?.n).toBe(9);
    expect(idle.get('2026-08-01|9')).toEqual({ day: '2026-08-01', hour: 9, n: 5, sec: 600 });
  });
});
