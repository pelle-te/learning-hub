/* ============================================================
   db/rows.ts — AppState ↔ 행 표현의 **순수** 변환(플랫폼 개편 2단계-B).

   왜 IO 와 분리하는가: `tauri-plugin-sql` 은 Tauri 런타임이 있어야 돌아서, SQL 을 섞어 짜면
   매퍼를 브라우저/vitest 에서 **검증할 수 없다**. 저장소 교체의 진짜 위험은 SQL 문법이 아니라
   **왕복에서 필드가 조용히 사라지는 것**이므로, 그 부분을 순수 함수로 떼어 전량 테스트한다.
   (`db/sqlite.ts` 가 이 행들을 실제 테이블에 넣고 빼는 얇은 층.)

   설계 계약(§4-2단계 A-1/A-2):
   · **성장 무제한 슬라이스만 행**으로 쪼갠다 — 5MB 절벽과 편집당 재직렬화 비용이 전부 여기서 난다.
   · 유계·저빈도(items·routine·degree·weekly)와 스칼라·마커는 `settings` 한 테이블에 JSON 값으로.
   · **행 하나의 값은 레코드 통째 JSON**이다. 필드별 열로 펼치지 않는 이유는 I1(백업 호환):
     `ItemSchema`·`AppStateSchema` 가 `.passthrough()` 라 **모르는 필드가 실재**하고, 열로 펼치면
     그것들이 왕복에서 소리 없이 증발한다. 질의가 필요해지면 FTS5 인덱스를 별도로 얹는다.
   · 그래서 ROW_SLICES 에 **없는 필드는 자동으로 settings 로 간다** — 새 슬라이스가 생겨도
     매퍼를 안 고쳐도 보존된다(누락이 기본값이 되지 않게).
============================================================ */
import { EPHEMERAL_ONLY_KEYS, RUNTIME_CACHE_KEYS } from '../persistence';
import type { AppState } from '../types';

/** 키 맵 슬라이스(`ds_map` 테이블 = `(slice, key, value)`) — completions 는 2단 중첩이라 따로 다룬다.
 *  ⚠ 열 이름은 역사적으로 `ds` 지만 **의미는 '그 슬라이스의 키'**다. N-7 의 `resume` 은 키가
 *  날짜가 아니라 **기기 id** 인 첫 슬라이스다 — 이 표에 날짜 가정이 없는 것을 확인하고 넣었다
 *  (정렬·프루닝 어디도 `ds` 를 파싱하지 않는다). 새 테이블 0 · 서버 DDL 0 으로 기기별 1행을
 *  얻는 자리가 여기뿐이라 중요하다: 각 기기가 **자기 행만 쓰므로 동기화 충돌이 원리적으로 없다**. */
const DS_MAP_SLICES = ['dayOverrides', 'dayPlans', 'rituals', 'resume'] as const;
/** 배열 슬라이스(`records` 테이블 = `(slice, id, ord, value)`).
 *  ⚠ 행 정체성은 `id` 필드 → `ARRAY_ROW_ID` → 순번 순으로 정한다. 옛 주석은 _"retentionLog 만
 *  id 가 없어 순번을 id 로 쓴다"_ 였는데, 순번은 동기화 키로 쓸 수 없다(C-3 · 아래 참조). */
export const ARRAY_SLICES = ['cbms', 'backlog', 'blankResults', 'retentionLog', 'events', 'tasks'] as const;
export type ArraySlice = (typeof ARRAY_SLICES)[number];

/** 행 테이블로 내려가는 최상위 필드 전부 — 나머지는 settings 로. */
const ROW_SLICES = new Set<string>([...DS_MAP_SLICES, ...ARRAY_SLICES, 'completions', 'summaries', 'weekAlloc']);

export interface CompletionRow {
  ds: string;
  k: string;
  json: string;
}
export interface DsRow {
  ds: string;
  json: string;
}
export interface OrdRow {
  id: string;
  ord: number;
  json: string;
}
export interface SummaryRow {
  sid: string;
  /** 요약의 **안정 id**(`addSummary` 의 `rid()`). ⚠ 동기화 키의 절반이다 — 순번이 아니다(C-3). */
  id: string;
  /** 표시 순서. **데이터 열**이다(v9 부터) — 정체성이 아니라 사용자에게 보이는 값. */
  ord: number;
  json: string;
}
export interface WeekAllocRow {
  wk: string;
  sid: string;
  json: string;
}
export interface KvRow {
  key: string;
  json: string;
}

/** DB 한 벌의 행 표현. `settings`/`runtime` 은 2계층 스코프(아래 주석)로 갈라 담는다. */
export interface DbRows {
  /** 행 테이블로 내려간 슬라이스 중 **실제로 존재했던** 것들의 이름.
      ⚠ 이게 없으면 "비어 있음"과 "없음"을 구분할 수 없다 — `completions: {}` 는 행을 0개
      만들므로, 되읽을 때 슬라이스 자체가 `undefined` 로 되살아나 `defaults()` 와 형태가 갈린다.
      `dayPlans?`·`tasks?`·`events?`·`weekAlloc?` 는 진짜 옵셔널이라 그 구분이 의미를 가진다. */
  present: string[];
  settings: KvRow[];
  /** RUNTIME_CACHE_KEYS 중 로컬 저장은 되지만 **내보내기에서 빠지는** 것들. */
  runtime: KvRow[];
  completions: CompletionRow[];
  dsMaps: Record<(typeof DS_MAP_SLICES)[number], DsRow[]>;
  arrays: Record<ArraySlice, OrdRow[]>;
  summaries: SummaryRow[];
  weekAlloc: WeekAllocRow[];
}

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * `ARRAY_SLICES` 중 **`id` 필드가 없지만 다른 열이 이미 유일 키인** 슬라이스의 정체성(C-3).
 *
 * ⚠ 여기 없는 슬라이스는 `v.id` → 순번 순으로 폴백한다. **순번 폴백은 안전하지 않다** —
 * 동기화 키가 위치가 되어 두 기기의 동시 추가를 뭉개고, 앞을 잘라내는 로그에서는 전 행이
 * 밀린다. 그러니 새 배열 슬라이스를 추가할 때는 `id: rid()` 를 넣거나 여기 한 줄을 넣는다.
 */
const ARRAY_ROW_ID: Partial<Record<ArraySlice, (v: unknown) => string | undefined>> = {
  // 주 시작일. `methodology.ts` 가 `filter(x => x.wk !== wk)` 로 upsert 하므로 정의상 유일하다.
  retentionLog: (v) => (isRec(v) && typeof v.wk === 'string' ? v.wk : undefined),
};

/* ── 테이블 명세 + 증분 diff (2단계-E) ────────────────────────────────────────
   왜 증분인가: 처음엔 flush 마다 전량 DELETE + INSERT 였는데 두 가지가 동시에 틀렸다.
   ① **SQLITE_BUSY** — `tauri-plugin-sql` 은 sqlx **커넥션 풀**이라 별도 `execute` 로 부른
      `BEGIN` 은 다른 커넥션의 쓰기를 막아 `database is locked` 로 죽는다(실측).
   ② 트랜잭션을 그냥 빼면 **DB 가 비는 순간**이 생겨 그때 크래시하면 데이터가 통째로 날아간다.
   upsert + 사라진 키만 삭제로 바꾸면 둘 다 사라진다 — 트랜잭션이 필요 없고(각 문장이 독립적으로
   안전) DB 가 비는 창도 없다. 덤으로 "편집당 전량 재직렬화"가 실제로 해소된다. */

export interface TableSpec {
  name: string;
  cols: string[];
  /** 이 앞쪽 n개 열이 기본키 — diff 의 동일성 판정 키. */
  keyLen: number;
  /** 동기화 대상인가(5단계-D) — `updated_at` 을 싣고 삭제 시 툼스톤을 남긴다.
   *  · `meta` 는 파생값(`present`)이라 제외 — 파생을 LWW 로 병합하면 원본과 어긋난다.
   *  · `runtime_cache` 는 내보내기에서 빠지는 로컬 낙관적 캐시라 제외(기기마다 재계산). */
  sync: boolean;
}
export const TABLES: TableSpec[] = [
  { name: 'meta', cols: ['key', 'value'], keyLen: 1, sync: false },
  { name: 'settings', cols: ['key', 'value'], keyLen: 1, sync: true },
  { name: 'runtime_cache', cols: ['key', 'value'], keyLen: 1, sync: false },
  { name: 'completions', cols: ['ds', 'k', 'value'], keyLen: 2, sync: true },
  { name: 'ds_map', cols: ['slice', 'ds', 'value'], keyLen: 2, sync: true },
  { name: 'records', cols: ['slice', 'id', 'ord', 'value'], keyLen: 2, sync: true },
  /* ⚠ 키가 `(sid, id)` 다 — `ord`(배열 인덱스)를 키로 쓰던 것이 C-3 였다(v9 마이그레이션).
     위치를 동기화 정체성으로 쓰면 두 기기의 동시 추가가 같은 키를 써서 하나가 소실된다. */
  { name: 'summaries', cols: ['sid', 'id', 'ord', 'value'], keyLen: 2, sync: true },
  { name: 'week_alloc', cols: ['wk', 'sid', 'value'], keyLen: 2, sync: true },
];

/** 행 표현 → 테이블별 {키 → 열 값 배열}. diff 와 SQL 생성이 공유하는 중간 표현. */
export function toTableData(rows: DbRows): Record<string, Map<string, unknown[]>> {
  const t: Record<string, Map<string, unknown[]>> = {};
  for (const spec of TABLES) t[spec.name] = new Map();
  const put = (table: string, vals: unknown[], keyLen: number): void => {
    t[table]!.set(vals.slice(0, keyLen).join(''), vals);
  };
  put('meta', ['present', JSON.stringify(rows.present)], 1);
  for (const r of rows.settings) put('settings', [r.key, r.json], 1);
  for (const r of rows.runtime) put('runtime_cache', [r.key, r.json], 1);
  for (const r of rows.completions) put('completions', [r.ds, r.k, r.json], 2);
  for (const [slice, rs] of Object.entries(rows.dsMaps)) for (const r of rs) put('ds_map', [slice, r.ds, r.json], 2);
  for (const slice of ARRAY_SLICES) for (const r of rows.arrays[slice]) put('records', [slice, r.id, r.ord, r.json], 2);
  for (const r of rows.summaries) put('summaries', [r.sid, r.id, r.ord, r.json], 2);
  for (const r of rows.weekAlloc) put('week_alloc', [r.wk, r.sid, r.json], 2);
  return t;
}

/** 실행할 SQL 한 문장. */
export interface Stmt {
  sql: string;
  args: unknown[];
}

/**
 * 이전 상태 → 다음 상태의 최소 문장 목록.
 * ⚠ **upsert 를 먼저, 삭제를 나중에** 낸다 — 중간에 죽으면 남는 쪽이 "여분의 옛 행"이어야지
 * "사라진 행"이면 안 된다. 여분은 다음 쓰기가 정리하지만 유실은 복구할 수 없다.
 */
/** 이번 쓰기가 **실제로 손댄 행** 하나 — 되읽기 대조의 단위. */
export interface TouchedRow {
  /** 테이블 이름(`TABLES[].name`). */
  table: string;
  /** 기본키 값들(`keyLen` 개). */
  key: unknown[];
  /** 우리가 쓴 데이터 열 전량(키 포함 · `spec.cols` 순서). 되읽은 값과 이걸 대조한다. */
  vals: unknown[];
}

/**
 * `diffRows` 의 상세판 — 문장과 **접촉 행**을 **한 번의 순회**에서 함께 낸다.
 *
 * ⚠ 두 함수로 나눠 각자 순회하게 만들면 언젠가 한쪽만 고쳐져 **검증이 엉뚱한 행을 본다** —
 * 그때 증상은 "대조는 통과하는데 저장이 틀렸다"이고, 그건 이 층이 막으려던 바로 그것이다.
 * `diffRows` 는 이 함수의 얇은 래퍼다.
 */
export function diffRowsDetailed(
  prev: DbRows | null,
  next: DbRows,
  now: number | (() => number) = Date.now(),
): { stmts: Stmt[]; touched: TouchedRow[] } {
  /* 스탬프는 **동기화 행마다** 배급한다. 상수(일반 flush)면 모든 행·툼스톤이 같은 값을 받아
     종전과 한 글자도 다르지 않고(한 flush = 한 스탬프 그룹), 함수(최초 이관의 `chunkedStamp`)면
     청크마다 값이 갈려 단일 그룹이 배치 상한을 넘지 않는다(C1 · `stamp.ts` 참조). */
  const stampFor = typeof now === 'function' ? now : (): number => now;
  const a = prev ? toTableData(prev) : null;
  const b = toTableData(next);
  const upserts: Stmt[] = [];
  const tombs: Stmt[] = [];
  const deletes: Stmt[] = [];
  const touched: TouchedRow[] = [];
  /** 툼스톤 기본키 — 단일키 테이블은 k2 를 빈 문자열로 채운다(db.rs v3 와 같은 규약). */
  const tomb = (spec: TableSpec, vals: unknown[]): unknown[] => [spec.name, vals[0], spec.keyLen === 2 ? vals[1] : ''];

  for (const spec of TABLES) {
    const before = a?.[spec.name] ?? new Map<string, unknown[]>();
    const after = b[spec.name]!;
    for (const [key, vals] of after) {
      const old = before.get(key);
      /* ⚠ 비교는 **데이터 열만** 본다. `updated_at` 은 우리가 매번 새로 찍는 값이라
         비교에 넣으면 모든 행이 항상 "변경됨"이 되어 증분 쓰기가 전량 쓰기로 퇴화한다. */
      if (old && old.length === vals.length && old.every((v, i) => v === vals[i])) continue;
      const cols = spec.sync ? [...spec.cols, 'updated_at'] : spec.cols;
      const args = spec.sync ? [...vals, stampFor()] : vals;
      upserts.push({
        sql: `INSERT OR REPLACE INTO ${spec.name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        args,
      });
      // ⚠ `vals` 는 **데이터 열만**이다(`updated_at` 제외) — 그 값은 우리가 매번 새로 찍으므로
      //    되읽기 대조에 넣으면 항상 불일치가 된다(위 비교가 같은 이유로 제외한다).
      touched.push({ table: spec.name, key: vals.slice(0, spec.keyLen), vals });
      /* ⚠ **부활(지웠다가 같은 키로 다시 만들기)을 여기서 처리하지 않는다.**
         처음엔 툼스톤을 지우는 문장을 같이 냈는데, 그러면 ① 이 목록에 DELETE 가 섞여
         "삭제는 upsert 뒤" 계약이 형식적으로 깨지고 ② 기준선이 없는 첫 쓰기에서 전 행에
         대해 쓸모없는 DELETE 가 N개 붙고 ③ 무엇보다 **정리 문장이 실행돼야만 맞는**
         설계가 된다(중간에 죽으면 행과 툼스톤이 공존).
         → 대신 병합이 `updated_at` vs `deleted_at` 을 **비교**하게 한다(5-E). 다시 만든
         행은 updated_at 이 더 크므로 이긴다. 정리는 correctness 가 아니라 청소이므로
         나중에 오래된 툼스톤을 일괄 GC 하면 된다. */
    }
    for (const [key, vals] of before) {
      if (after.has(key)) continue;
      const where = spec.cols
        .slice(0, spec.keyLen)
        .map((c) => `${c} = ?`)
        .join(' AND ');
      /* 삭제 사실을 **먼저** 남긴다 — 없으면 다른 기기에서 "없는 행"과 구분이 안 돼
         삭제가 부활한다. 툼스톤을 데이터 삭제보다 앞에 두는 게 안전한 방향이다:
         중간에 죽으면 "행은 남았는데 툼스톤이 있는" 상태가 되고, 병합은
         deleted_at > updated_at 이므로 **지워진 것으로 올바르게** 판정한다.
         반대 순서면 "행은 지웠는데 툼스톤이 없는" 상태 — 상대 기기가 되살린다. */
      if (spec.sync) {
        tombs.push({
          sql: `INSERT OR REPLACE INTO tombstones (tbl,k1,k2,deleted_at) VALUES (?,?,?,?)`,
          args: [...tomb(spec, vals), stampFor()],
        });
      }
      deletes.push({ sql: `DELETE FROM ${spec.name} WHERE ${where}`, args: vals.slice(0, spec.keyLen) });
    }
  }
  return { stmts: [...upserts, ...tombs, ...deletes], touched };
}

/** 상태 두 벌 → 증분 SQL. 접촉 행이 필요하면 `diffRowsDetailed`. */
export function diffRows(prev: DbRows | null, next: DbRows, now: number | (() => number) = Date.now()): Stmt[] {
  return diffRowsDetailed(prev, next, now).stmts;
}

/** AppState → 행. `persistence.ts` 의 2계층 스코프를 **테이블 정책으로 직역**한다:
    · EPHEMERAL_ONLY_KEYS(_vaultScan·_ankiFile) = 저장 자체를 안 한다
    · 나머지 RUNTIME_CACHE_KEYS(_ankiLive·_icsExport·_knowState) = runtime 테이블(내보내기 제외)
    · 그 외 전부 = settings 또는 행 테이블(내보내기 포함) */
export function stateToRows(state: AppState): DbRows {
  const s = state as unknown as Record<string, unknown>;
  const rows: DbRows = {
    present: [],
    settings: [],
    runtime: [],
    completions: [],
    dsMaps: { dayOverrides: [], dayPlans: [], rituals: [], resume: [] },
    arrays: { cbms: [], backlog: [], blankResults: [], retentionLog: [], events: [], tasks: [] },
    summaries: [],
    weekAlloc: [],
  };
  const ephemeral = new Set<string>(EPHEMERAL_ONLY_KEYS);
  const runtimeOnly = new Set<string>(RUNTIME_CACHE_KEYS);

  for (const [key, value] of Object.entries(s)) {
    if (value === undefined) continue; // 옵셔널 미설정 — 행을 만들면 왕복에서 null 로 되살아난다
    if (ephemeral.has(key)) continue;
    if (runtimeOnly.has(key)) {
      rows.runtime.push({ key, json: JSON.stringify(value) });
      continue;
    }
    if (!ROW_SLICES.has(key)) {
      rows.settings.push({ key, json: JSON.stringify(value) });
      continue;
    }
    rows.present.push(key); // 행이 0개여도 "있었다"는 사실은 남긴다

    if (key === 'completions' && isRec(value)) {
      for (const [dsKey, day] of Object.entries(value)) {
        if (!isRec(day)) continue;
        for (const [k, entry] of Object.entries(day))
          rows.completions.push({ ds: dsKey, k, json: JSON.stringify(entry) });
      }
      continue;
    }
    if (key === 'summaries' && isRec(value)) {
      for (const [sid, list] of Object.entries(value)) {
        if (!Array.isArray(list)) continue;
        /* ⚠ 행 정체성은 요약 자신의 `id` 다(C-3). `addSummary` 가 `rid()` 로 넣는다.
           없는 레거시 행만 순번으로 폴백한다 — v9 마이그레이션의 `COALESCE` 와 **같은 규칙**이어야
           한다(어긋나면 다음 부팅 diff 가 전 요약을 삭제+삽입으로 본다). */
        list.forEach((v, ord) =>
          rows.summaries.push({
            sid,
            id: isRec(v) && typeof v.id === 'string' ? v.id : String(ord),
            ord,
            json: JSON.stringify(v),
          }),
        );
      }
      continue;
    }
    if (key === 'weekAlloc' && isRec(value)) {
      for (const [wk, bySid] of Object.entries(value)) {
        if (!isRec(bySid)) continue;
        for (const [sid, mins] of Object.entries(bySid)) rows.weekAlloc.push({ wk, sid, json: JSON.stringify(mins) });
      }
      continue;
    }
    if ((DS_MAP_SLICES as readonly string[]).includes(key) && isRec(value)) {
      const bucket = rows.dsMaps[key as (typeof DS_MAP_SLICES)[number]];
      for (const [dsKey, v] of Object.entries(value)) bucket.push({ ds: dsKey, json: JSON.stringify(v) });
      continue;
    }
    if ((ARRAY_SLICES as readonly string[]).includes(key) && Array.isArray(value)) {
      const bucket = rows.arrays[key as ArraySlice];
      value.forEach((v, ord) => {
        /* ⚠⚠ **순번을 id 로 쓰지 않는다(C-3).** 옛 주석은 _"retentionLog 엔 id 가 없다 — 순번을
           id 로 쓴다(순서가 곧 정체성인 로그)"_ 였는데, 그 로그는 `slice(-26)` 으로 앞을 잘라낸다
           (`methodology.ts`) → **매주 전 행의 순번이 한 칸씩 밀려** 26행이 통째로 재기입·재전송된다.
           그리고 순번 키는 두 기기의 동시 추가를 같은 행으로 뭉갠다(summaries 와 같은 결함).
           `wk`(주 시작일)가 **이미 유일 키**다 — 같은 파일이 `x.wk !== wk` 로 dedupe 한다. */
        const id = ARRAY_ROW_ID[key as ArraySlice]?.(v) ?? (isRec(v) && typeof v.id === 'string' ? v.id : String(ord));
        bucket.push({ id, ord, json: JSON.stringify(v) });
      });
      continue;
    }
    // 선언된 행 슬라이스인데 형태가 예상과 다르다(손상 저장본 등) — 통째로 settings 에 보존한다.
    // 떨구면 왕복이 데이터 유실이 된다. 행으로 안 갔으니 present 에서도 빼야
    // 되읽을 때 settings 의 원본을 빈 컨테이너가 덮지 않는다.
    rows.present.splice(rows.present.indexOf(key), 1);
    rows.settings.push({ key, json: JSON.stringify(value) });
  }
  return rows;
}

/** 순번대로 정렬해 값만 뽑는다 — 배열 슬라이스의 순서는 의미를 가진다(로그·정렬 기대). */
function ordered<T extends { ord: number; json: string }>(rows: readonly T[]): unknown[] {
  return [...rows].sort((a, b) => a.ord - b.ord).map((r) => JSON.parse(r.json));
}

/** 행 → AppState. `stateToRows` 의 역이며, 둘의 왕복이 **동형**이어야 한다(테스트가 잠금). */
export function rowsToState(rows: DbRows): AppState {
  const out: Record<string, unknown> = {};
  for (const r of rows.settings) out[r.key] = JSON.parse(r.json);
  for (const r of rows.runtime) out[r.key] = JSON.parse(r.json);

  // 존재했던 행 슬라이스를 **먼저 빈 컨테이너로** 깔아 둔다 — 아래 블록들은 행이 있을 때만
  // 채우므로, 이게 없으면 `completions: {}` 같은 빈 슬라이스가 undefined 로 되살아난다.
  const present = new Set(rows.present);
  for (const k of present) out[k] = (ARRAY_SLICES as readonly string[]).includes(k) ? [] : {};

  if (rows.completions.length) {
    const comp: Record<string, Record<string, unknown>> = {};
    for (const r of rows.completions) (comp[r.ds] ??= {})[r.k] = JSON.parse(r.json);
    out.completions = comp;
  }
  for (const slice of DS_MAP_SLICES) {
    const bucket = rows.dsMaps[slice];
    if (!bucket.length) continue;
    const m: Record<string, unknown> = {};
    for (const r of bucket) m[r.ds] = JSON.parse(r.json);
    out[slice] = m;
  }
  for (const slice of ARRAY_SLICES) {
    const bucket = rows.arrays[slice];
    if (bucket.length) out[slice] = ordered(bucket);
  }
  if (rows.summaries.length) {
    const bySid: Record<string, unknown[]> = {};
    for (const r of [...rows.summaries].sort((a, b) => a.ord - b.ord)) (bySid[r.sid] ??= []).push(JSON.parse(r.json));
    out.summaries = bySid;
  }
  if (rows.weekAlloc.length) {
    const byWk: Record<string, Record<string, unknown>> = {};
    for (const r of rows.weekAlloc) (byWk[r.wk] ??= {})[r.sid] = JSON.parse(r.json);
    out.weekAlloc = byWk;
  }
  return out as unknown as AppState;
}
