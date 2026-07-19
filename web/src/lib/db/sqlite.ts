/* ============================================================
   db/sqlite.ts — 행 표현 ↔ SQLite 의 **얇은** IO(플랫폼 개편 2단계-B).

   불변식 I2: Tauri 로 나가는 호출은 `lib/` 가 소유한다. `@tauri-apps/plugin-sql` 은 자체 invoke 를
   쓰지만 **이 파일 안에서만** import 되므로 경계는 유지된다(features/ 는 이 표면만 본다).

   의도적으로 로직이 없다 — 변환은 전부 `db/rows.ts`(순수, Tauri 없이 테스트됨)에 있고
   여기는 SQL 문장만 있다. 저장소 교체의 위험은 SQL 문법이 아니라 매퍼의 필드 누락이라,
   테스트 가능한 쪽에 로직을 몰아둔 것이다.

   ⚠ 스키마(DDL)는 여기 없다 — `src-tauri/src/db.rs` 가 단일 원천이다. 프런트가 DDL 을 들고
   있으면 배포본마다 스키마가 갈릴 수 있다.
============================================================ */
import { isTauri } from '../tauri';
import { ARRAY_SLICES, type DbRows, type KvRow } from './rows';

/** plugin-sql 의 Database 인스턴스(타입만 최소로 — 전체 타입을 끌어오면 브라우저 번들에 샌다). */
interface Db {
  execute(query: string, values?: unknown[]): Promise<unknown>;
  select<T>(query: string, values?: unknown[]): Promise<T>;
}

const DB_URL = 'sqlite:learning-hub.db'; // src-tauri/src/db.rs 의 DB_URL 과 일치해야 한다

let _db: Promise<Db> | null = null;

/** DB 핸들(지연 로드·1회). 브라우저에선 null — 셸 전용 경로다. */
export async function getDb(): Promise<Db | null> {
  if (!isTauri()) return null;
  _db ??= import('@tauri-apps/plugin-sql').then((m) => m.default.load(DB_URL) as Promise<Db>);
  try {
    return await _db;
  } catch {
    _db = null; // 다음 호출에서 재시도 — 한 번 실패가 영구 불능이 되지 않게
    return null;
  }
}

/** SQLite 가 이 실행 경로에서 쓸 수 있는가(브라우저면 false). */
export async function isDbAvailable(): Promise<boolean> {
  return (await getDb()) !== null;
}

type Row = Record<string, string | number>;
const str = (v: string | number | undefined): string => (v == null ? '' : String(v));

/** 전체 상태를 읽어 행 표현으로. 빈 DB 면 null(= 아직 이관 전). */
export async function readRows(): Promise<DbRows | null> {
  const db = await getDb();
  if (!db) return null;

  const [meta, settings, runtime, completions, dsMap, records, summaries, weekAlloc] = await Promise.all([
    db.select<Row[]>('SELECT key, value FROM meta'),
    db.select<Row[]>('SELECT key, value FROM settings'),
    db.select<Row[]>('SELECT key, value FROM runtime_cache'),
    db.select<Row[]>('SELECT ds, k, value FROM completions'),
    db.select<Row[]>('SELECT slice, ds, value FROM ds_map'),
    db.select<Row[]>('SELECT slice, id, ord, value FROM records ORDER BY slice, ord'),
    db.select<Row[]>('SELECT sid, ord, value FROM summaries ORDER BY sid, ord'),
    db.select<Row[]>('SELECT wk, sid, value FROM week_alloc'),
  ]);

  // settings 가 통째로 비었으면 "한 번도 안 썼다" — 기본값으로 부팅하지 말고 호출부가 판단하게.
  if (!settings.length && !meta.length) return null;

  const rows: DbRows = {
    present: JSON.parse(str(meta.find((m) => m.key === 'present')?.value) || '[]'),
    settings: settings.map((r) => ({ key: str(r.key), json: str(r.value) })),
    runtime: runtime.map((r) => ({ key: str(r.key), json: str(r.value) })),
    completions: completions.map((r) => ({ ds: str(r.ds), k: str(r.k), json: str(r.value) })),
    dsMaps: { dayOverrides: [], dayPlans: [], rituals: [] },
    arrays: { cbms: [], backlog: [], blankResults: [], retentionLog: [], events: [], tasks: [] },
    summaries: summaries.map((r) => ({ sid: str(r.sid), ord: Number(r.ord), json: str(r.value) })),
    weekAlloc: weekAlloc.map((r) => ({ wk: str(r.wk), sid: str(r.sid), json: str(r.value) })),
  };
  for (const r of dsMap) {
    const bucket = rows.dsMaps[str(r.slice) as keyof DbRows['dsMaps']];
    if (bucket) bucket.push({ ds: str(r.ds), json: str(r.value) });
  }
  for (const r of records) {
    const bucket = rows.arrays[str(r.slice) as keyof DbRows['arrays']];
    if (bucket) bucket.push({ id: str(r.id), ord: Number(r.ord), json: str(r.value) });
  }
  return rows;
}

/** 다중 행 INSERT 를 한 문장으로 — 행마다 왕복하면 대용량(수천 행)에서 눈에 띄게 느리다. */
function bulk(table: string, cols: string[], values: unknown[][]): { sql: string; args: unknown[] } | null {
  if (!values.length) return null;
  const ph = `(${cols.map(() => '?').join(',')})`;
  return {
    sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.map(() => ph).join(',')}`,
    args: values.flat(),
  };
}

const kv = (rows: readonly KvRow[]): unknown[][] => rows.map((r) => [r.key, r.json]);

/** 전체 상태를 통째로 쓴다(스냅샷 교체).
    ⚠ 이건 **정확성 우선**의 1차 구현이다 — 편집당 증분 쓰기(변경 행만 UPSERT)는 2단계-D 가
    양방향 대조로 동등성을 증명한 뒤에 얹는다. 순서를 뒤집으면 "빨라졌는데 맞는지 모르는"
    상태가 되고, 그때 회귀를 잡을 대조 장치가 아직 없다. */
export async function writeRows(rows: DbRows): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const stmts: { sql: string; args: unknown[] }[] = [];
  const push = (s: { sql: string; args: unknown[] } | null): void => void (s && stmts.push(s));

  for (const t of ['meta', 'settings', 'runtime_cache', 'completions', 'ds_map', 'records', 'summaries', 'week_alloc'])
    stmts.push({ sql: `DELETE FROM ${t}`, args: [] });

  stmts.push({ sql: 'INSERT INTO meta (key, value) VALUES (?, ?)', args: ['present', JSON.stringify(rows.present)] });
  push(bulk('settings', ['key', 'value'], kv(rows.settings)));
  push(bulk('runtime_cache', ['key', 'value'], kv(rows.runtime)));
  push(
    bulk(
      'completions',
      ['ds', 'k', 'value'],
      rows.completions.map((r) => [r.ds, r.k, r.json]),
    ),
  );
  push(
    bulk(
      'ds_map',
      ['slice', 'ds', 'value'],
      Object.entries(rows.dsMaps).flatMap(([slice, rs]) => rs.map((r) => [slice, r.ds, r.json])),
    ),
  );
  push(
    bulk(
      'records',
      ['slice', 'id', 'ord', 'value'],
      ARRAY_SLICES.flatMap((slice) => rows.arrays[slice].map((r) => [slice, r.id, r.ord, r.json])),
    ),
  );
  push(
    bulk(
      'summaries',
      ['sid', 'ord', 'value'],
      rows.summaries.map((r) => [r.sid, r.ord, r.json]),
    ),
  );
  push(
    bulk(
      'week_alloc',
      ['wk', 'sid', 'value'],
      rows.weekAlloc.map((r) => [r.wk, r.sid, r.json]),
    ),
  );

  try {
    // 트랜잭션으로 감싼다 — 중간에 죽으면 DELETE 만 적용돼 **데이터가 통째로 사라진다**.
    await db.execute('BEGIN');
    for (const s of stmts) await db.execute(s.sql, s.args);
    await db.execute('COMMIT');
    return true;
  } catch {
    try {
      await db.execute('ROLLBACK');
    } catch {
      /* 이미 끊긴 트랜잭션 — 롤백 실패는 원 오류를 가리지 않게 삼킨다 */
    }
    return false;
  }
}
