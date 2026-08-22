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
import type { PreImageRow } from './undoStack';

/** 키 맵 슬라이스(`ds_map` 테이블 = `(slice, key, value)`) — completions 는 2단 중첩이라 따로 다룬다.
 *  ⚠ 열 이름은 역사적으로 `ds` 지만 **의미는 '그 슬라이스의 키'**다. N-7 의 `resume` 은 키가
 *  날짜가 아니라 **기기 id** 인 첫 슬라이스다 — 이 표에 날짜 가정이 없는 것을 확인하고 넣었다
 *  (정렬·프루닝 어디도 `ds` 를 파싱하지 않는다). 새 테이블 0 · 서버 DDL 0 으로 기기별 1행을
 *  얻는 자리가 여기뿐이라 중요하다: 각 기기가 **자기 행만 쓰므로 동기화 충돌이 원리적으로 없다**. */
const DS_MAP_SLICES = ['dayOverrides', 'dayPlans', 'rituals', 'resume'] as const;
/** 배열 슬라이스(`records` 테이블 = `(slice, id, ord, value)`).
 *  ⚠ 행 정체성은 `id` 필드 → `ARRAY_ROW_ID` → 순번 순으로 정한다. 옛 주석은 _"retentionLog 만
 *  id 가 없어 순번을 id 로 쓴다"_ 였는데, 순번은 동기화 키로 쓸 수 없다(C-3 · 아래 참조). */
export const ARRAY_SLICES = [
  'cbms',
  'backlog',
  'blankResults',
  'retentionLog',
  'events',
  'tasks',
  /* T-7 문항 원장(2026-08-02). ⚠ **여기 이름을 더하는 것은 DDL 이 아니다** — `records` 는
     `(slice, id, ord, value)` 이고 슬라이스는 *데이터 열*이다. 그래서 D1 마이그레이션 0 ·
     서버 zod 0 · 폰 전파 0 이고, `value` 는 불투명 JSON 이라 서버가 안을 안 본다. */
  'questions',
  /* T-9 지연 JOL 의 예측 원장. 위 `questions` 와 같은 이유로 DDL 0 이고, 같은 이유로
     `dbRows.test.ts` 의 누락 감지 케이스를 **의도적으로** 갱신해야 한다. */
  'jolAsks',
  /* A-2 인출 지연 원장(발산 6회차 · 2026-08-07). 위 둘과 같은 이유로 DDL 0.
     ⚠ 이 슬라이스가 여기 온 것은 **숙주를 한 번 잘못 골랐기 때문**이다 — `blankResults` 에
     필드로 달았다가 되돌렸다(그 배열은 백지 복습 전용이고 러너가 안 쓴다). 근거는 `schema.ts`
     의 `retrievals` 머리주석. 순수 로직은 `lib/retrievalLatency.ts`(파일명이 다른 이유는
     그 파일 머리주석 — `lib/retrieval.ts` 는 **회상 카드 선택**이라는 다른 것이 이미 쓰고 있다). */
  'retrievals',
] as const;
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
  /* ⚠ 맵 키는 **JSON 튜플**이다(H31-③ · 2026-07-30). 종전엔 `join('')` 이라 복합키가
     구분자 없이 붙었다 — `summaries` 는 `[sid, id]` 라 `('a','bc')` 와 `('ab','c')` 가 같은
     `'abc'` 로 접힌다. 접히면 한 행이 **조용히 사라진다**(뒤가 앞을 덮는다). 지금 안 터진
     이유는 id 길이가 우연히 균일해서일 뿐이고, 그건 아무 데도 안 적힌 전제였다.
     `cloud/conflicts.snapKey` 가 같은 문제에 이미 JSON 튜플을 쓰고 그 이유까지 적어 뒀다 —
     같은 저장소 안에서 한쪽만 안전한 관용구를 쓰고 있었다.
     ⚠ 이 키는 **메모리 안에서만** 산다(diff 계산용) — 저장되지도 전송되지도 않으므로 형식을
     바꾸는 데 마이그레이션이 없다. */
  const put = (table: string, vals: unknown[], keyLen: number): void => {
    t[table]!.set(JSON.stringify(vals.slice(0, keyLen)), vals);
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
/** 이번 쓰기가 **지운 행** 하나 — 되읽기 대조에서 *없어야 하는* 쪽(H6 · 2026-08-01).
 *  ⚠ `TouchedRow` 와 나눈 이유: 지운 행에는 대조할 `vals` 가 없다. 한 타입에 옵셔널로 접으면
 *  "값이 없는 upsert"라는 표현 불가능한 상태가 생긴다. */
export interface RemovedRow {
  table: string;
  key: unknown[];
}

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
 * `diffRows` 의 상세판 — 문장·**접촉 행**·**pre-image** 를 **한 번의 순회**에서 함께 낸다.
 *
 * ⚠ 두 함수로 나눠 각자 순회하게 만들면 언젠가 한쪽만 고쳐져 **검증이 엉뚱한 행을 본다** —
 * 그때 증상은 "대조는 통과하는데 저장이 틀렸다"이고, 그건 이 층이 막으려던 바로 그것이다.
 * `diffRows` 는 이 함수의 얇은 래퍼다.
 *
 * ## ⚠ pre-image 를 여기서 내는 이유 (착수 계획을 실측이 정정했다)
 *
 * 계획은 _"`diffRowsDetailed` 를 고칠 필요가 없다 — `writeRows` 가 `_last` 와 `touched` 를 둘 다
 * 손에 쥐고 있다"_ 였는데 **`touched` 는 upsert 만 담는다.** 삭제된 행(할일·요약·보충 제거)은
 * 거기 없으므로, 그것만으로 만든 되돌리기는 **"지운 것"을 영원히 못 살린다** — 되돌리기가 가장
 * 필요한 바로 그 부류다. 두 축(전/후)을 한 번에 보는 자리가 여기뿐이라 여기서 낸다.
 */
/* ── diff 의 두 국면 (2026-08-20 리뷰 M-14 원장 축소) ────────────────────────────
   ⚠ **동작은 안 바뀐다.** 종전엔 `diffRowsDetailed` 안에 테이블 루프 하나와 그 안의 루프 둘이
   중첩돼 있었고, 각 루프 몸통이 다시 조건 서넛을 품었다 — 그게 인지복잡도의 전부였다.
   두 국면은 서로를 모른다: 하나는 *생겼거나 바뀐 행*, 하나는 *사라진 행*만 본다.
   ⚠ **문장 순서 계약은 호출부가 소유한다**(`[...upserts, ...tombs, ...deletes]`) — 여기서는
   각자 자기 배열에만 담는다. 그 순서가 왜 중요한지는 아래 `diffRemovals` 의 ⚠ 가 적는다. */
interface DiffAcc {
  upserts: Stmt[];
  tombs: Stmt[];
  deletes: Stmt[];
  touched: TouchedRow[];
  removed: RemovedRow[];
  preImages: PreImageRow[];
  /** 기준선이 있는가 — 없으면 pre-image 를 만들지 않는다(근거는 호출부 ⚠). */
  capture: boolean;
  stampFor: () => number;
}

/** 툼스톤 기본키 — 단일키 테이블은 k2 를 빈 문자열로 채운다(db.rs v3 와 같은 규약). */
const tombKeyOf = (spec: TableSpec, vals: unknown[]): unknown[] => [
  spec.name,
  vals[0],
  spec.keyLen === 2 ? vals[1] : '',
];

/** 생겼거나 값이 바뀐 행 → upsert. */
function diffUpserts(
  acc: DiffAcc,
  spec: TableSpec,
  before: Map<string, unknown[]>,
  after: Map<string, unknown[]>,
): void {
  for (const [key, vals] of after) {
    const old = before.get(key);
    /* ⚠ 비교는 **데이터 열만** 본다. `updated_at` 은 우리가 매번 새로 찍는 값이라
       비교에 넣으면 모든 행이 항상 "변경됨"이 되어 증분 쓰기가 전량 쓰기로 퇴화한다. */
    if (old && old.length === vals.length && old.every((v, i) => v === vals[i])) continue;
    /* ⚠ **동기화 테이블만 담는다.** 되돌리기는 `applyPull`(병합 기계)로 적용하는데 그것은
       `OUTBOX_TABLES`(= `sync:true` + docs)만 안다 — `meta`(파생 `present`)·`runtime_cache`
       (기기별 재계산 캐시)를 담아 봐야 조용히 버려진다. **버려질 것을 담으면 스택 바이트만
       먹고 "N건 되돌렸다"는 수가 거짓이 된다.** */
    if (acc.capture && spec.sync)
      acc.preImages.push({ table: spec.name, key: vals.slice(0, spec.keyLen), vals: old ?? null });
    const cols = spec.sync ? [...spec.cols, 'updated_at'] : spec.cols;
    const args = spec.sync ? [...vals, acc.stampFor()] : vals;
    acc.upserts.push({
      sql: `INSERT OR REPLACE INTO ${spec.name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      args,
    });
    // ⚠ `vals` 는 **데이터 열만**이다(`updated_at` 제외) — 그 값은 우리가 매번 새로 찍으므로
    //    되읽기 대조에 넣으면 항상 불일치가 된다(위 비교가 같은 이유로 제외한다).
    acc.touched.push({ table: spec.name, key: vals.slice(0, spec.keyLen), vals });
    /* ⚠ **부활(지웠다가 같은 키로 다시 만들기)을 여기서 처리하지 않는다.**
       처음엔 툼스톤을 지우는 문장을 같이 냈는데, 그러면 ① 이 목록에 DELETE 가 섞여
       "삭제는 upsert 뒤" 계약이 형식적으로 깨지고 ② 기준선이 없는 첫 쓰기에서 전 행에
       대해 쓸모없는 DELETE 가 N개 붙고 ③ 무엇보다 **정리 문장이 실행돼야만 맞는**
       설계가 된다(중간에 죽으면 행과 툼스톤이 공존).
       → 대신 병합이 `updated_at` vs `deleted_at` 을 **비교**하게 한다(5-E). 다시 만든
       행은 updated_at 이 더 크므로 이긴다. 정리는 correctness 가 아니라 청소이므로
       나중에 오래된 툼스톤을 일괄 GC 하면 된다. */
  }
}

/** 사라진 행 → 툼스톤 + DELETE.
 *  ⚠ 삭제 사실을 **먼저** 남긴다 — 없으면 다른 기기에서 "없는 행"과 구분이 안 돼 삭제가
 *  부활한다. 툼스톤을 데이터 삭제보다 앞에 두는 게 안전한 방향이다: 중간에 죽으면 "행은
 *  남았는데 툼스톤이 있는" 상태가 되고, 병합은 `deleted_at > updated_at` 이므로 **지워진
 *  것으로 올바르게** 판정한다. 반대 순서면 "행은 지웠는데 툼스톤이 없는" 상태 — 상대 기기가
 *  되살린다. (그 순서는 호출부의 `[...upserts, ...tombs, ...deletes]` 가 최종적으로 보장한다.) */
function diffRemovals(
  acc: DiffAcc,
  spec: TableSpec,
  before: Map<string, unknown[]>,
  after: Map<string, unknown[]>,
): void {
  for (const [key, vals] of before) {
    if (after.has(key)) continue;
    // 삭제의 pre-image = 그 행 자체. 되돌리기는 이걸 다시 넣는다(부활 가드는 `cloud/undo.ts` 참조).
    if (acc.capture && spec.sync) acc.preImages.push({ table: spec.name, key: vals.slice(0, spec.keyLen), vals });
    const where = spec.cols
      .slice(0, spec.keyLen)
      .map((c) => `${c} = ?`)
      .join(' AND ');
    if (spec.sync) {
      acc.tombs.push({
        sql: `INSERT OR REPLACE INTO tombstones (tbl,k1,k2,deleted_at) VALUES (?,?,?,?)`,
        args: [...tombKeyOf(spec, vals), acc.stampFor()],
      });
    }
    acc.deletes.push({ sql: `DELETE FROM ${spec.name} WHERE ${where}`, args: vals.slice(0, spec.keyLen) });
    acc.removed.push({ table: spec.name, key: vals.slice(0, spec.keyLen) });
  }
}

export function diffRowsDetailed(
  prev: DbRows | null,
  next: DbRows,
  now: number | (() => number) = Date.now(),
  /* ⚠ **기준선의 테이블 표현을 이미 갖고 있으면 넘긴다**(2026-08-20 리뷰 m-5).
     `toTableData` 는 행마다 `JSON.stringify(키)` 로 Map 키를 만든다. 그런데 `prev` 는 직전
     flush 가 방금 쓴 바로 그 `rows` 이고(`sqlite.writeRows` 가 `_last = rows` 로 들고 있다),
     그 표현은 그때 이미 만들어졌다 — 즉 flush 마다 **절반이 바이트 동일한 재계산**이었다.
     편집 하나가 바꾸는 행은 한 자릿수인데 diff 준비만 O(전체 × 2) 였다.
     기본값이 있어 기존 호출부·테스트는 한 글자도 안 바뀐다. */
  prevTables?: Record<string, Map<string, unknown[]>> | null,
): {
  stmts: Stmt[];
  touched: TouchedRow[];
  removed: RemovedRow[];
  preImages: PreImageRow[];
  /** `next` 의 테이블 표현 — 호출부가 다음 회차의 `prevTables` 로 재사용한다. */
  nextTables: Record<string, Map<string, unknown[]>>;
} {
  /* 스탬프는 **동기화 행마다** 배급한다. 상수(일반 flush)면 모든 행·툼스톤이 같은 값을 받아
     종전과 한 글자도 다르지 않고(한 flush = 한 스탬프 그룹), 함수(최초 이관의 `chunkedStamp`)면
     청크마다 값이 갈려 단일 그룹이 배치 상한을 넘지 않는다(C1 · `stamp.ts` 참조). */
  const stampFor = typeof now === 'function' ? now : (): number => now;
  const a = prevTables !== undefined ? prevTables : prev ? toTableData(prev) : null;
  const b = toTableData(next);
  const upserts: Stmt[] = [];
  const tombs: Stmt[] = [];
  const deletes: Stmt[] = [];
  const touched: TouchedRow[] = [];
  /* ⚠⚠ **삭제도 검증 대상이다**(H6 · 2026-08-01). `touched` 는 upsert 만 담는데(바로 위 pre-image
     절이 그 사실을 이미 적었다) `write.ts` 의 되읽기 대조는 그것만 봤다 → 삭제만 있는 flush 는
     `touched.length === 0` 이라 **직전 결과를 그대로 재사용**했다: 직전이 `unavailable` 이면
     성공한 삭제가 실패로 보고되고, 직전이 `ok` 면 **삭제 반영을 한 번도 확인하지 않고** "일치"라
     말한다. 후자가 이 파일이 반복해 거부해 온 형태다(안 잰 것을 결과로 보고). */
  const removed: RemovedRow[] = [];
  /* ⚠ **기준선이 없으면 pre-image 도 없다.** `prev === null` 은 첫 쓰기(부팅 이관·기준선 유실 복구)라
     "직전"이 존재하지 않는다 — 그때 전 행을 "없었다"로 담으면 ⌘Z 한 번이 **DB 를 통째로 비운다.**
     빈 목록을 내면 `undoStack` 이 항목 자체를 안 만든다(그쪽 `pushUndo` 계약). */
  const preImages: PreImageRow[] = [];
  const capture = prev !== null;

  const acc: DiffAcc = { upserts, tombs, deletes, touched, removed, preImages, capture, stampFor };
  for (const spec of TABLES) {
    const before = a?.[spec.name] ?? new Map<string, unknown[]>();
    const after = b[spec.name]!;
    diffUpserts(acc, spec, before, after);
    diffRemovals(acc, spec, before, after);
  }
  return { stmts: [...upserts, ...tombs, ...deletes], touched, removed, preImages, nextTables: b };
}

/** 상태 두 벌 → 증분 SQL. 접촉 행이 필요하면 `diffRowsDetailed`. */
export function diffRows(prev: DbRows | null, next: DbRows, now: number | (() => number) = Date.now()): Stmt[] {
  return diffRowsDetailed(prev, next, now).stmts;
}

/* ============================================================
   문장 접기(H26 · 2026-07-30 `/감사 근본`)

   ## 무엇이 문제였나

   셸(`tauri-plugin-sql`)에는 배치 API 가 없어 `writeRows`·`batchDb` 가 **문장마다 `execute`** 로
   폴백한다 — 즉 문장 하나당 IPC 왕복 하나다. 일반 flush(수십 행)에서는 안 보이지만
   **가져오기·복구·되돌리기·첫 전량 동기화**는 상태를 통째로 쓰므로 수천 왕복이 된다
   (`writeRows` 가 `chunkedStamp(400)` 를 기본으로 삼은 이유가 바로 그 "전량 쓰기" 경로다).
   폰은 워커라 이미 1왕복이었다 — 같은 코드가 두 백엔드에서 100배 다르게 돌고 있었다.

   **실측**(보충·일정·할일 각 500건의 전량 쓰기): 문장 **1518 → 12**(126배). 셸에서 그대로
   IPC 왕복 수다.

   ## 왜 Rust 커맨드가 아닌가 (검토하고 **버린** 길)

   `db_batch` 커맨드를 만들면 왕복은 1이 되지만, **플러그인의 sqlx 풀은 프런트가 소유한다**
   (`Cargo.toml` 의 그 주석이 SSOT). Rust 가 자기 풀을 하나 더 열면 같은 파일에 쓰는 이가 둘이
   되고, 그건 이 저장소가 이미 실측으로 물린 `database is locked` 의 재현 경로다
   (`writeRows` 머리주석 — 그래서 트랜잭션도 안 쓴다). **왕복이 아니라 문장 수를 줄이는 쪽**이
   같은 이득을 잠금 위험 0 으로 얻는다.

   ## 안전한 이유

   `INSERT OR REPLACE INTO t (c…) VALUES (a),(b),(c)` 는 같은 문장 셋과 **의미가 동일**하다
   (같은 키가 그룹 안에 두 번 나와도 뒤가 이기는 것까지 같다). 그리고 한 문장이므로 오히려
   **원자적**이다 — 폴백의 비원자성이 그만큼 줄어든다. 순서 계약("upsert 먼저, 삭제 나중")도
   **연속된 같은 SQL 만** 접으므로 그대로 보존된다.
   ⚠ DELETE 는 접지 않는다. 복합키를 `(a,b) IN ((?,?),…)` 로 바꾸면 되지만, 전량 쓰기 경로에서
   삭제는 거의 안 나오고(가져오기는 행을 **추가**한다) 위험 대비 이득이 없다.
============================================================ */

/** 한 문장이 들 수 있는 바인딩 파라미터 상한. SQLite 기본은 32766(구버전 999)이라 넉넉히 아래로
 *  잡는다 — 상한을 넘기면 조용히 느려지는 게 아니라 **문장이 통째로 실패**한다. */
const MAX_PARAMS_PER_STMT = 800;

/** `INSERT [OR REPLACE] INTO t (…) VALUES (?,?,…)` 형태만 접는다 — 그 밖은 손대지 않는다. */
const INSERT_VALUES = /^(INSERT(?: OR REPLACE)? INTO \w+ \([^)]*\) VALUES )(\((?:\?,)*\?\))$/;

/**
 * 연속된 **같은 SQL** 의 단일행 INSERT 를 다중 VALUES 한 문장으로 접는다(순수).
 *
 * 접힌 결과의 실행 의미는 원본과 같고(위 머리주석), 문장 수만 줄어든다. 접을 수 없는 문장은
 * 순서를 유지한 채 그대로 통과한다.
 */
export function coalesceStmts(stmts: Stmt[], maxParams: number = MAX_PARAMS_PER_STMT): Stmt[] {
  const out: Stmt[] = [];
  let i = 0;
  while (i < stmts.length) {
    const s = stmts[i]!;
    const m = INSERT_VALUES.exec(s.sql);
    const perRow = s.args.length;
    // 접을 수 없거나(형태 불일치·인자 0) 한 행만으로 상한을 넘으면 그대로 둔다.
    if (!m || perRow === 0 || perRow > maxParams) {
      out.push(s);
      i++;
      continue;
    }
    const maxRows = Math.max(1, Math.floor(maxParams / perRow));
    let j = i;
    const args: unknown[] = [];
    // 같은 SQL 이고 인자 개수도 같은 것만 이어 붙인다(열 수가 다르면 다른 문장이다).
    while (j < stmts.length && stmts[j]!.sql === s.sql && stmts[j]!.args.length === perRow && j - i < maxRows) {
      args.push(...stmts[j]!.args);
      j++;
    }
    const rows = j - i;
    out.push(rows === 1 ? s : { sql: m[1]! + Array.from({ length: rows }, () => m[2]!).join(','), args });
    i = j;
  }
  return out;
}

/** AppState → 행. `persistence.ts` 의 2계층 스코프를 **테이블 정책으로 직역**한다:
    · EPHEMERAL_ONLY_KEYS(_vaultScan·_ankiFile) = 저장 자체를 안 한다
    · 나머지 RUNTIME_CACHE_KEYS(_ankiLive·_icsExport·_knowState) = runtime 테이블(내보내기 제외)
    · 그 외 전부 = settings 또는 행 테이블(내보내기 포함) */
/* ── `stateToRows` 의 슬라이스 확장기 (2026-08-20 리뷰 M-14 원장 축소) ─────────────
   ⚠ **동작은 안 바뀐다.** 종전엔 슬라이스별 `if (key === …)` 블록 다섯이 한 함수 안에 중첩
   루프째로 늘어서 있었고, 그게 `stateToRows` 인지복잡도의 전부였다. 각 블록은 서로를 모르고
   *한 슬라이스를 어떻게 행으로 펴는가* 만 안다 — 절단면이 이미 데이터 모양에 있었다.
   ⚠ 행 정체성 규칙(C-3)은 각 확장기가 그대로 들고 간다. 그 규칙이 갈리면 다음 부팅 diff 가
   전 행을 삭제+삽입으로 보므로, 옮기면서 한 글자도 바꾸지 않았다. */

/** `completions` — 2단 중첩(`ds → key → entry`)이라 다른 슬라이스와 모양이 다르다. */
function expandCompletions(rows: DbRows, value: Record<string, unknown>): void {
  for (const [dsKey, day] of Object.entries(value)) {
    if (!isRec(day)) continue;
    for (const [k, entry] of Object.entries(day)) rows.completions.push({ ds: dsKey, k, json: JSON.stringify(entry) });
  }
}

/** `summaries` — 행 정체성은 요약 자신의 `id` 다(C-3). `addSummary` 가 `rid()` 로 넣는다.
 *  없는 레거시 행만 순번으로 폴백한다 — v9 마이그레이션의 `COALESCE` 와 **같은 규칙**이어야
 *  한다(어긋나면 다음 부팅 diff 가 전 요약을 삭제+삽입으로 본다). */
function expandSummaries(rows: DbRows, value: Record<string, unknown>): void {
  for (const [sid, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    list.forEach((v, ord) =>
      rows.summaries.push({
        sid,
        id: isRec(v) && typeof v.id === 'string' ? v.id : String(ord),
        ord,
        json: JSON.stringify(v),
      }),
    );
  }
}

/** `weekAlloc` — `(주, 과목) → 7요일 분배`. */
function expandWeekAlloc(rows: DbRows, value: Record<string, unknown>): void {
  for (const [wk, bySid] of Object.entries(value)) {
    if (!isRec(bySid)) continue;
    for (const [sid, mins] of Object.entries(bySid)) rows.weekAlloc.push({ wk, sid, json: JSON.stringify(mins) });
  }
}

/** 배열 슬라이스 — ⚠⚠ **순번을 id 로 쓰지 않는다(C-3).** 옛 주석은 *"retentionLog 엔 id 가 없다 —
 *  순번을 id 로 쓴다(순서가 곧 정체성인 로그)"* 였는데, 그 로그는 `slice(-26)` 으로 앞을 잘라낸다
 *  (`methodology.ts`) → **매주 전 행의 순번이 한 칸씩 밀려** 26행이 통째로 재기입·재전송된다.
 *  그리고 순번 키는 두 기기의 동시 추가를 같은 행으로 뭉갠다(summaries 와 같은 결함).
 *  `wk`(주 시작일)가 **이미 유일 키**다 — 같은 파일이 `x.wk !== wk` 로 dedupe 한다. */
function expandArray(rows: DbRows, key: ArraySlice, value: unknown[]): void {
  const bucket = rows.arrays[key];
  value.forEach((v, ord) => {
    const id = ARRAY_ROW_ID[key]?.(v) ?? (isRec(v) && typeof v.id === 'string' ? v.id : String(ord));
    bucket.push({ id, ord, json: JSON.stringify(v) });
  });
}

/** 한 슬라이스를 행으로 편다. **처리했으면 `true`** — 아니면 호출부가 settings 폴백으로 보낸다.
 *  ⚠ 각 확장기는 서로를 모른다: 여기는 *어느 확장기를 부를지*만 정한다. */
function expandSlice(rows: DbRows, key: string, value: unknown): boolean {
  if (isRec(value)) {
    if (key === 'completions') {
      expandCompletions(rows, value);
      return true;
    }
    if (key === 'summaries') {
      expandSummaries(rows, value);
      return true;
    }
    if (key === 'weekAlloc') {
      expandWeekAlloc(rows, value);
      return true;
    }
    if ((DS_MAP_SLICES as readonly string[]).includes(key)) {
      const bucket = rows.dsMaps[key as (typeof DS_MAP_SLICES)[number]];
      for (const [dsKey, v] of Object.entries(value)) bucket.push({ ds: dsKey, json: JSON.stringify(v) });
      return true;
    }
    return false;
  }
  if (Array.isArray(value) && (ARRAY_SLICES as readonly string[]).includes(key)) {
    expandArray(rows, key as ArraySlice, value);
    return true;
  }
  return false;
}

export function stateToRows(state: AppState): DbRows {
  const s = state as unknown as Record<string, unknown>;
  const rows: DbRows = {
    present: [],
    settings: [],
    runtime: [],
    completions: [],
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

    if (expandSlice(rows, key, value)) continue;

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

  /* 존재했던 행 슬라이스를 **먼저 빈 컨테이너로** 깔아 둔다 — 아래 블록들은 행이 있을 때만
     채우므로, 이게 없으면 `completions: {}` 같은 빈 슬라이스가 undefined 로 되살아난다.

     ⚠⚠ **모르는 이름은 버린다**(D023 · 2026-08-22). `present` 는 DB 에 **문자열로** 저장되므로
     슬라이스를 개명·제거해도 옛 이름이 그 배열에 남는다. 걸러 내지 않으면 그 이름이
     `out[k] = {}` 로 **유령 슬라이스**가 되어 `AppState` 에 들어오고, 다음 쓰기에서
     `stateToRows` 가 그것을 `ROW_SLICES` 밖으로 보아 **`settings` 한 행**으로 만든다 —
     그 순간 유령이 `sync:true` 표에 올라 **D1 과 모든 기기로 영구히 퍼진다.** 자기 증식이라
     한 번 생기면 안 사라지고, 화면에는 아무 증상이 없다.
     ⚠ 읽는 쪽에서 거르므로 **이미 오염된 DB 도 다음 부팅에 스스로 낫는다**(쓰기가 다시 담지
     않는다). 실측(2026-08-22): 실 DB `present` 11개 전부 정상 — 지금은 예방이다.
     ⚠ 집행자는 `test/dbRows.test.ts` 의 D023 절이다(왕복 성질). */
  const present = new Set(rows.present.filter((k) => ROW_SLICES.has(k)));
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
