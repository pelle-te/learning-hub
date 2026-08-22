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
/* ⚠ `isTauri` 는 **초소형 모듈**에서 가져온다(H7) — 여기서 `../tauri` 를 정적으로 물면 그
   503줄(백엔드 커맨드 전량 + zod)이 **두 엔트리의 초기 청크**에 들어간다. 폰은 그 표면을
   한 번도 안 부른다. `dbUrl()` 은 아래 Tauri 분기 안에서 동적으로 가져온다. */
import { isTauri } from '../isTauri';
import {
  coalesceStmts,
  diffRowsDetailed,
  TABLES,
  toTableData,
  type DbRows,
  type RemovedRow,
  type TableSpec,
  type TouchedRow,
} from './rows';
import type { PreImageRow } from './undoStack';

/** `writeRows` 의 결과 — 성공 여부 + **이번에 실제로 손댄 행**(되읽기 대조의 대상). */
export interface WriteResult {
  ok: boolean;
  touched: TouchedRow[];
  /** 이 쓰기가 **지운** 행들 — 되읽기 대조에서 *없어야 하는* 쪽(H6). `touched` 는 upsert 만 담는다. */
  removed: RemovedRow[];
  /** 손대기 **직전** 그 행들의 모습(전역 ⌘Z). 기준선이 없던 쓰기면 빈 배열(`rows.ts` 참조). */
  preImages: PreImageRow[];
  /** 이 쓰기가 발급한 **최대 스탬프**(동기화 행이 없었으면 0). 되돌리기의 툼스톤 기준선이 된다. */
  stamp: number;
}
import { chunkedStamp } from './stamp';

/** flush 한 번이 만드는 스탬프 그룹의 상한. `MAX_BATCH_ITEMS`(500) 아래로 여유를 둔다 —
 *  이유는 아래 `writeRows` 주석(C2). `boot.ts` 의 이관 청크와 같은 값. */
const WRITE_STAMP_CHUNK = 400;

/** plugin-sql 의 Database 인스턴스(타입만 최소로 — 전체 타입을 끌어오면 브라우저 번들에 샌다). */
interface Db {
  execute(query: string, values?: unknown[]): Promise<unknown>;
  select<T>(query: string, values?: unknown[]): Promise<T>;
  /** 여러 문장을 한 왕복으로(H-1). **폰(워커)만 구현**한다 — plugin-sql 은 배치 API 가 없어
   *  `undefined` 이고, `batchDb`/`writeRows` 가 순차 `execute` 로 폴백한다. 그쪽은 IPC 라
   *  왕복이 싸고, 무엇보다 sqlx 풀에서 트랜잭션(`BEGIN`)이 잠금으로 죽어 배치 이득이 작다. */
  batch?(stmts: { sql: string; args: unknown[] }[]): Promise<void>;
}

/* ⚠ 연결 문자열 상수는 **여기 없다**(SD-6). 폴더가 하네스 override 로 갈릴 수 있게 되면서,
   프런트가 값을 따로 들면 백엔드가 마이그레이션한 DB 와 다른 파일을 열 수 있다 —
   스키마 없는 빈 DB 가 열리고 앱은 "데이터가 없다"고 조용히 말한다. `lib/tauri.dbUrl()` 이
   Rust(`paths::db_url`)에게 묻는다. */

let _db: Promise<Db> | null = null;

/* ── 폰 백엔드(C-6a) ─────────────────────────────────────────────

   ⚠ **기본은 꺼져 있고, 폰 진입점만 켠다.** 브라우저에서 무조건 SQLite 를 열면
   `npm run dev` 와 **트랙 A 시각 베이스라인**이 통째로 저장 백엔드를 갈아탄다 — 그 둘은
   localStorage 경로를 쓰도록 **의도적으로 남겨 둔 것**이고(`db/boot.ts` 가 계약으로 명시),
   여기서 조용히 뒤집으면 시각 검증망과 개발 경로가 함께 죽는다.

   그래서 스위치를 둔다: `phone.tsx` 만 `enableBrowserDb()` 를 부른다. 켜지 않으면
   `getDb()` 의 거동은 C-6 이전과 **한 글자도 다르지 않다**. */
let _browserDbEnabled = false;

/** 폰 진입점 전용 — 이 실행 경로에서 브라우저 SQLite 를 쓰겠다고 선언한다. */
export function enableBrowserDb(): void {
  _browserDbEnabled = true;
}

/**
 * 이 실행 경로에서 **SQLite 가 정본인가**(= 셸이거나 폰이다).
 *
 * ⚠ `isTauri()` 를 저장 경로의 조건으로 쓰던 자리를 이걸로 바꿔야 한다. 그 둘은 C-6 전까지
 * 같은 뜻이었지만 이제 아니다 — 폰은 Tauri 가 아닌데 SQLite 가 정본이다. 조건을 안 바꾸면
 * 폰의 편집이 localStorage 로 가고, **아웃박스는 SQLite 만 훑으므로 그 편집은 영원히
 * 동기화되지 않는다**(= 조용한 유실. C-1·§12-1 이 두 번 물린 실패 모드와 같은 형태).
 *
 * 동기 함수인 것이 의도다 — 호출부(`useApp` 의 `flush`)가 동기 경로다.
 */
export function isSqlitePrimary(): boolean {
  return isTauri() || _browserDbEnabled;
}

/* ── 가용성(C1 · 2026-07-26 감사) ────────────────────────────────

   ⚠ **`isSqlitePrimary()` 는 "가용성"이 아니다.** 그 둘을 한 술어가 겸직하던 것이 이 파일
   `getDb()` 의 catch 가 정확히 진단해 놓고도(아래 주석) 사용자 절반을 열어 둔 원인이다:
   연결이 실패하면 `getDb()` 는 null 을 주는데, 정본 쓰기 경로(`db/write.ts`)는 그 null 을
   **"브라우저라 SQL 을 안 쓴다"(정상)** 와 구분하지 못해 `skipped` 로 보고했고, 호출부
   (`useApp.flush`)는 그걸 성공으로 읽고 **localStorage 폴백도 타지 않은 채** 반환했다.
   결과: 그 세션의 편집이 메모리에만 살고, 재시작하면 낡은 localStorage 로 떠서
   사용자에겐 "저장한 게 사라졌다"가 된다.

   그래서 술어를 가른다 — **실행 경로**(`isSqlitePrimary`, 여기)와 **저장이 실제로 됐는가**
   (`db/write.ts` 의 `ParityReport.unavailable` → `useApp` → `db/fallback.ts` 의 신호).

   ⚠ 사용자에게 말하는 판단을 **연결 성공 여부**로 두지 않은 이유는 `db/fallback.ts` 머리주석이
   소유한다(트랙 A 가 그 차이를 즉시 드러냈다). 이 파일은 "열렸나"만 알고, "무엇을 잃었나"는
   쓰기 경로가 안다. */

/** DB 핸들(지연 로드·1회). 셸이면 plugin-sql, 폰이면 wasm, 그 외 브라우저는 null. */
export async function getDb(): Promise<Db | null> {
  if (!isTauri()) {
    if (!_browserDbEnabled) return null;
    const { getBrowserDb } = await import('./browserDb');
    return getBrowserDb(); // 자체 catch 로 null 을 준다(로그는 그쪽이 남긴다)
  }
  // ⚠ `dbUrl()` 도 여기서 동적으로 — 셸 분기 안이라 폰·브라우저는 이 청크를 아예 안 받는다(H7).
  _db ??= Promise.all([import('@tauri-apps/plugin-sql'), import('../tauri').then((m) => m.dbUrl())])
    .then(([m, url]) => m.default.load(url) as Promise<Db>)
    .then(async (db) => {
      /* WAL 로 올린다 — 기본 롤백 저널에선 **읽는 중엔 쓸 수 없어** `database is locked` 가 난다.
         plugin-sql 은 sqlx 커넥션 **풀**이라 읽기와 쓰기가 서로 다른 커넥션에서 겹치는 게 정상
         동작이고, 실제로 "닫기 직전에 상태를 읽으면 그 다음 쓰기가 통째로 실패"하는 형태로
         드러났다(트랙 B 에서 잡음). WAL 은 DB 파일에 영속되는 설정이라 한 번만 걸면 된다. */
      try {
        await db.execute('PRAGMA journal_mode=WAL');
      } catch (e) {
        console.error('[db] WAL 전환 실패 — 동시 읽기/쓰기에서 잠금 오류가 날 수 있습니다.', e);
      }
      return db;
    });
  try {
    return await _db;
  } catch (e) {
    // ⚠ 조용히 삼키지 않는다 — 정본이 SQLite 인데 연결 실패가 무음이면 앱은 "저장되는 것처럼"
    //   보이면서 아무것도 안 쓴다(2단계-E 에서 실제로 이 침묵 때문에 원인을 못 찾았다).
    //   ⚠ 로그는 **개발자 절반**만 닫는다. 사용자 절반은 쓰기 경로가 닫는다(C1) —
    //   `db/write.ts` 가 `unavailable` 로 보고하고, `useApp` 이 폴백 저장 + 지속 배너로 잇는다.
    console.error('[db] SQLite 연결 실패 — 저장이 되지 않습니다.', e);
    _db = null; // 다음 호출에서 재시도 — 한 번 실패가 영구 불능이 되지 않게
    return null;
  }
}

/* ── 범용 1문장 실행/조회(4단계-J) ────────────────────────────────
   `docs` 테이블(AppState 밖 사용자 저작물)이 쓰는 얇은 통로다. 아래 `readRows`/`writeRows` 는
   `AppState` 전용 매퍼와 짝이라 재사용할 수 없어서, **SQL 만 아는 층**의 규약(이 파일은 로직을
   두지 않는다)을 지킨 채 두 함수를 더 둔다. */

/** 1문장 실행. 성공 여부만 돌려주고 **실패를 삼키지 않는다**(로그를 남긴다). */
export async function execDb(query: string, values: unknown[] = []): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.execute(query, values);
    return true;
  } catch (e) {
    console.error('[db] execute 실패:', query, e);
    return false;
  }
}

/**
 * 여러 문장을 **한 배치**로 실행한다(H-1). 폰(워커)이면 한 왕복 + 트랜잭션(원자적),
 * 셸이면 순차 `execute` 폴백(plugin-sql 은 배치 API 가 없다). 성공 여부만 돌려주고 삼키지 않는다.
 *
 * ⚠ 폴백은 **비원자적**이다(중간에 죽으면 부분 적용) — 데스크톱은 이미 diff 쓰기가 그
 * 성질을 전제로 안전하고(`writeRows` 주석: "남는 건 여분의 옛 행이지 사라진 행이 아니다"),
 * 병합(`applyPull`)은 실패를 **던져** 워터마크 전진을 막는다(다음 pull 이 재개).
 */
export async function batchDb(stmts: { sql: string; args: unknown[] }[]): Promise<boolean> {
  if (!stmts.length) return true;
  const db = await getDb();
  if (!db) return false;
  /* ⚠ **접고 나서 보낸다**(H26). 셸은 문장마다 IPC 왕복이라 전량 쓰기 경로에서 수천 번이 됐다 —
     같은 SQL 의 연속 INSERT 를 다중 VALUES 한 문장으로 접으면 왕복이 두 자릿수로 떨어진다.
     의미는 동일하고 오히려 원자적이다(근거는 `rows.ts` 의 `coalesceStmts` 머리주석).
     폰(워커)도 접힌 편이 싸다 — 파싱·바인딩 횟수가 그만큼 준다. */
  const folded = coalesceStmts(stmts);
  try {
    if (db.batch) await db.batch(folded);
    else for (const s of folded) await db.execute(s.sql, s.args);
    return true;
  } catch (e) {
    console.error('[db] batch 실패:', e);
    return false;
  }
}

/** 1문장 조회. DB 미가용·실패는 **null**(빈 배열과 구분해야 한다 — 전자는 "모름", 후자는 "없음"). */
export async function selectDb<T>(query: string, values: unknown[] = []): Promise<T[] | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.select<T[]>(query, values);
  } catch (e) {
    console.error('[db] select 실패:', query, e);
    return null;
  }
}

/** SQLite 가 이 실행 경로에서 쓸 수 있는가(브라우저면 false). */
export async function isDbAvailable(): Promise<boolean> {
  return (await getDb()) !== null;
}

type Row = Record<string, string | number>;
const str = (v: string | number | undefined): string => (v == null ? '' : String(v));

/**
 * **방금 쓴 행만** 되읽는다 — 되읽기 대조의 행축 판(`write.ts` 참조).
 *
 * 왜: 종전 대조는 매번 8테이블을 **전량** 읽었고(2년 근사 상태에서 IPC 946KB + JS 9ms) 그래서
 * 20회에 1회만 돌렸다. 즉 **19회는 무검증**이었다. 이 층의 목적은 "SQL 층의 타입 강제변환·
 * NULL 처리 탐지"인데 그건 **행의 성질**이라, 손댄 행만 보면 비용이 O(변경행)으로 떨어지면서
 * 오히려 **매 flush 검증**이 된다 — 더 싸고 탐지력은 오른다.
 *
 * ⚠ 복합키(keyLen=2) 테이블은 **두 키 각각을 `IN`** 으로 건다(곱집합). 행 값 튜플
 * (`WHERE (a,b) IN (VALUES …)`)은 SQLite 가 지원하지만 plugin-sql → sqlx 경로에서 바인딩
 * 거동을 이 저장소가 검증한 적이 없다 — 정본 저장 경로에서 미검증 SQL 문법에 기대지 않는다.
 * 곱집합이라 **과소 인출이 원리적으로 불가능**하고(필요한 조합은 반드시 포함된다) 잉여 행은
 * 호출부가 완전키로 조회하므로 무해하다.
 *
 * ⚠⚠ **종전엔 첫 키만 걸었고, 그 주석이 상한을 잘못 말했다**(C045 · 2026-08-22). *"과다 인출의
 * 상한은 «이번에 손댄 서로 다른 첫 키 수»"* 라 적혀 있었는데 그건 **바인딩 개수의 상한이지
 * 반환 행 수의 상한이 아니다.** 그리고 하필 문제가 되는 두 표가 «성장 무제한 슬라이스만 행으로
 * 쪼갠다»로 선정된 표 전부였다: `records.cols[0] = 'slice'`(카디널리티 **9**) ·
 * `ds_map.cols[0] = 'slice'`(**4**). 즉 그 둘에서 첫-키 `IN` 은 **슬라이스 전량 인출**로 퇴화한다.
 * 나머지 넷은 안전했다(`completions`=`ds` · `week_alloc`=`wk` · `summaries`=`sid`).
 * 규모: 120일치 `dayPlans` 가 쌓인 상태에서 한 날의 블록 하나를 드래그하면 touched 1행(883B)인데
 * 질의는 `WHERE slice IN ('dayPlans')` → 120행 106KB 를 **400ms 마다** 인출했다.
 * H6 이 시간축 표본(20회당 1회)을 행축 매회로 바꾼 근거가 *"손댄 행만 보면 O(변경행)"* 이었는데
 * 이 두 표에서는 **O(슬라이스 전량)** 이라 그 전제가 성립하지 않았다.
 * ⚠ 바인딩 최악은 400+400=800 으로 `rows.ts` 의 여유선과 같다(호출부가 `probes.length <= 400`).
 * ⚠ 실측 당시 실 DB 는 `records` 0행·`ds_map` 2행이라 **현재 실비용은 0**이었다 — 고치는 이유는
 * 관측된 느림이 아니라 «분모가 자라면 조용히 제곱이 되는 형태»다.
 * ⚠ 반환은 `키 → 데이터 열 배열`(`spec.cols` 순서, `updated_at` 제외)이다. 없는 키는 없는
 * 채로 둔다 — 호출부가 "썼는데 안 읽힌다"를 불일치로 판정할 수 있어야 한다.
 */
export async function readTouched(
  touched: readonly { table: string; key: unknown[] }[],
): Promise<Map<string, unknown[]> | null> {
  const db = await getDb();
  if (!db || !touched.length) return db ? new Map() : null;
  const bySpec = new Map<TableSpec, { table: string; key: unknown[] }[]>();
  for (const t of touched) {
    const spec = TABLES.find((x) => x.name === t.table);
    if (!spec) continue;
    const list = bySpec.get(spec);
    if (list) list.push(t);
    else bySpec.set(spec, [t]);
  }
  const out = new Map<string, unknown[]>();
  await Promise.all(
    [...bySpec.entries()].map(async ([spec, list]) => {
      /* 키 열마다 `IN` 하나. `keyLen=1` 이면 종전과 같은 질의이고, `keyLen=2` 면 둘째 열이
         더해져 슬라이스 전량 인출이 사라진다(위 ⚠⚠). */
      const binds: string[] = [];
      const where = spec.cols
        .slice(0, spec.keyLen)
        .map((col, i) => {
          const vals = [...new Set(list.map((t) => String(t.key[i])))];
          binds.push(...vals);
          return `${col} IN (${vals.map(() => '?').join(',')})`;
        })
        .join(' AND ');
      const rows = await db.select<Row[]>(`SELECT ${spec.cols.join(',')} FROM ${spec.name} WHERE ${where}`, binds);
      for (const r of rows) {
        const vals = spec.cols.map((c) => r[c as keyof Row]);
        out.set(touchedKey(spec.name, vals.slice(0, spec.keyLen)), vals);
      }
    }),
  );
  return out;
}

/** 접촉 행 식별자 — 테이블 + 기본키. 구분자는 값에 안 나오는 NUL 이다(`join('')` 충돌 방지). */
export function touchedKey(table: string, key: unknown[]): string {
  return [table, ...key.map((k) => String(k))].join('\u0000');
}

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
    // ⚠ `id` 가 키의 절반이다(C-3 · v9). 정렬은 여전히 `ord` — 표시 순서는 데이터 열이다.
    db.select<Row[]>('SELECT sid, id, ord, value FROM summaries ORDER BY sid, ord'),
    db.select<Row[]>('SELECT wk, sid, value FROM week_alloc'),
  ]);

  // settings 가 통째로 비었으면 "한 번도 안 썼다" — 기본값으로 부팅하지 말고 호출부가 판단하게.
  if (!settings.length && !meta.length) return null;

  const rows: DbRows = {
    present: JSON.parse(str(meta.find((m) => m.key === 'present')?.value) || '[]'),
    settings: settings.map((r) => ({ key: str(r.key), json: str(r.value) })),
    runtime: runtime.map((r) => ({ key: str(r.key), json: str(r.value) })),
    completions: completions.map((r) => ({ ds: str(r.ds), k: str(r.k), json: str(r.value) })),
    dsMaps: { dayOverrides: [], dayPlans: [], rituals: [], resume: [] },
    arrays: {
      cbms: [],
      backlog: [],
      blankResults: [],
      retentionLog: [],
      events: [],
      tasks: [],
      questions: [],
      jolAsks: [],
      retrievals: [],
    },
    summaries: summaries.map((r) => ({ sid: str(r.sid), id: str(r.id), ord: Number(r.ord), json: str(r.value) })),
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

/**
 * DB 에 이미 존재하는 **가장 큰 동기화 타임스탬프**(부팅 시 `seedStamp` 의 씨앗).
 * 없거나 DB 미가용이면 0.
 *
 * ⚠ 툼스톤의 `deleted_at` 도 함께 본다 — 삭제도 같은 발급기를 쓰므로 여기서 빼면 재시작
 * 직후에 **이미 쓴 값을 다시 발급**할 수 있다(단조성이 끊긴다).
 */
export async function readMaxStamp(): Promise<number> {
  const rows = await selectDb<{ m: number | null }>(
    `SELECT MAX(m) AS m FROM (
        SELECT MAX(updated_at) AS m FROM settings
        UNION ALL SELECT MAX(updated_at) FROM completions
        UNION ALL SELECT MAX(updated_at) FROM ds_map
        UNION ALL SELECT MAX(updated_at) FROM records
        UNION ALL SELECT MAX(updated_at) FROM summaries
        UNION ALL SELECT MAX(updated_at) FROM week_alloc
        UNION ALL SELECT MAX(updated_at) FROM docs
        UNION ALL SELECT MAX(deleted_at) FROM tombstones
     )`,
  );
  return Number(rows?.[0]?.m ?? 0) || 0;
}

/** 마지막으로 DB 에 반영된 행 표현 — 증분 diff 의 기준. 읽기/쓰기 성공 때마다 갱신된다. */
let _last: DbRows | null = null;
/** `_last` 의 테이블 표현 캐시(m-5) — 지연 생성하고 쓰기 성공 시 다음 회차 것으로 교체한다. */
let _lastTables: Record<string, Map<string, unknown[]>> | null = null;

/** 부팅 읽기가 끝난 뒤 기준선을 세운다(그래야 첫 쓰기가 전량 쓰기가 되지 않는다). */
export function setDiffBaseline(rows: DbRows | null): void {
  _last = rows;
  _lastTables = null; // 다음 diff 가 지연 생성한다(m-5).
}

/**
 * 상태를 DB 에 반영한다 — **변경된 행만** upsert 하고 사라진 행만 삭제한다.
 *
 * ⚠ 트랜잭션을 쓰지 않는 것이 의도다. `tauri-plugin-sql` 은 sqlx **커넥션 풀**이라 별도
 * `execute` 로 부른 `BEGIN` 은 다른 커넥션의 쓰기를 막아 `database is locked` 로 죽는다(실측).
 * 대신 diff 방식이 트랜잭션 없이도 안전하다 — DELETE-후-INSERT 와 달리 **DB 가 비는 순간이
 * 없고**, 중간에 죽어도 남는 건 "여분의 옛 행"이지 "사라진 행"이 아니다(다음 쓰기가 정리한다).
 */
export async function writeRows(rows: DbRows, stamp?: number | (() => number)): Promise<WriteResult> {
  const db = await getDb();
  if (!db) return { ok: false, touched: [], removed: [], preImages: [], stamp: 0 };
  // 기준선이 없으면(첫 쓰기·이관 직후) DB 를 한 번 읽어 세운다 — 없다고 전량 삭제하면
  // 위에 적은 안전 속성이 그대로 깨진다.
  if (!_last) _last = await readRows();
  /* ⚠ `diffRows` 의 기본값(`Date.now()`)에 맡기지 않는다 — 시계가 뒤로 점프하면 그 뒤 편집이
     워터마크에 영영 안 걸린다(`stamp.ts` 머리주석). 발급을 한 지점으로 모으는 게 그 방어다.

     ⚠⚠ 기본을 `nextStamp()`(단일 스탬프)에서 **`chunkedStamp(400)`** 로 바꾼다(C2 · 2026-07-24).
     `chunkedStamp` 는 첫 400건까지 **같은 스탬프**를 내므로 일반 flush(≤400 변경 행)는 종전과
     한 글자도 다르지 않다(한 flush = 한 스탬프 그룹). 그런데 `loadState`(가져오기·복구·되돌리기
     — `shell/actions.ts` 4곳)는 상태를 **통째로** 써서 sync 행이 500 을 넘을 수 있고, 그러면 단일
     스탬프 그룹이 `capBatch` 가 못 쪼개는 `oversized` 가 되어 스키마 상한에 걸려 **아웃박스가
     영구 차단**된다(그 사용자의 이후 모든 편집이 조용히 동기화 안 됨). 최초 이관(`boot.ts`)만
     `chunkedStamp` 로 막고 런타임 import 경로는 안 막던 비대칭이 결함이었다. 여기서 기본을 청크로
     바꾸면 **어느 호출자든** 단일 그룹이 상한을 못 넘어 그 차단이 원천 봉쇄된다(호출자 무관 방어). */
  /* ⚠ `diffRowsDetailed` 로 문장과 **접촉 행**을 한 순회에서 함께 받는다 — 되읽기 대조(`write.ts`)가
     "방금 쓴 행"만 확인할 수 있게. 두 번 순회해 따로 만들면 언젠가 한쪽만 고쳐져 **검증이 엉뚱한
     행을 본다**(그때 증상은 "대조는 통과하는데 저장이 틀렸다"다). */
  /* ⚠ 발급을 한 겹 감싸 **이번 쓰기가 쓴 최대 스탬프**를 안다(전역 ⌘Z). 되돌리기는 그 값으로
     "이 쓰기 뒤에 생긴 툼스톤"을 가려낸다 — 없으면 다른 기기가 지운 행을 조용히 되살린다.
     `currentStamp()` 로 대신 읽지 않는 이유: 그건 *전역* 최대라 이 쓰기가 안 쓴 값(병합 씨앗
     등)까지 포함하고, 그러면 가려내기가 실제보다 관대해진다(= 가드가 헐거워진다). */
  const issuer = stamp ?? chunkedStamp(WRITE_STAMP_CHUNK);
  const provider = typeof issuer === 'function' ? issuer : (): number => issuer;
  let maxStamp = 0;
  const issue = (): number => {
    const v = provider();
    if (v > maxStamp) maxStamp = v;
    return v;
  };
  /* ⚠ 기준선의 테이블 표현을 재사용한다(m-5) — `_lastTables` 가 없으면 여기서 한 번 만든다.
     `_last === null`(기준선 없음 = 전량 쓰기)이면 `null` 을 명시로 넘겨야 한다: `undefined` 는
     "안 넘겼다"는 뜻이라 `diffRowsDetailed` 가 자기 경로로 되돌아간다. */
  _lastTables ??= _last ? toTableData(_last) : null;
  const { stmts, touched, removed, preImages, nextTables } = diffRowsDetailed(_last, rows, issue, _lastTables);
  try {
    /* 한 배치로(H-1). 폰은 한 왕복 + 트랜잭션이라 매 flush(400ms)의 N 왕복이 1 로 접힌다.
       셸은 순차 `execute` 폴백 — 트랜잭션 없이도 diff 방식이 안전하다(머리주석). */
    const folded = coalesceStmts(stmts); // H26 — 왕복 수를 문장 수에서 줄인다(rows.ts 머리주석)
    if (db.batch) await db.batch(folded);
    else for (const s of folded) await db.execute(s.sql, s.args);
    _last = rows;
    _lastTables = nextTables; // 방금 만든 표현을 다음 회차 기준선으로 그대로 넘긴다(m-5)
    return { ok: true, touched, removed, preImages, stamp: maxStamp };
  } catch (e) {
    console.error('[db] 쓰기 실패', e);
    _last = null; // 부분 적용됐을 수 있다 — 다음 쓰기가 DB 를 다시 읽어 기준선을 세우게 한다
    _lastTables = null;
    /* ⚠ 실패한 쓰기의 pre-image 는 **주지 않는다.** 부분 적용됐을 수 있어 "직전"이 무엇인지
       모르는 상태이고, 그걸 스택에 얹으면 되돌리기가 실제로 없던 상태를 만들어 낸다. */
    return { ok: false, touched: [], removed: [], preImages: [], stamp: 0 };
  }
}
