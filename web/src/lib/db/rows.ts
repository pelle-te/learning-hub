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

/** 날짜 키 맵 슬라이스 — completions 는 2단 중첩이라 따로 다룬다. */
const DS_MAP_SLICES = ['dayOverrides', 'dayPlans', 'rituals'] as const;
/** id 를 가진 배열 슬라이스. retentionLog 만 id 가 없어 순번을 id 로 쓴다. */
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
    dsMaps: { dayOverrides: [], dayPlans: [], rituals: [] },
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
        list.forEach((v, ord) => rows.summaries.push({ sid, ord, json: JSON.stringify(v) }));
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
        // retentionLog 엔 id 가 없다 — 순번을 id 로 쓴다(순서가 곧 정체성인 로그).
        const id = isRec(v) && typeof v.id === 'string' ? v.id : String(ord);
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
