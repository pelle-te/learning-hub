//! rows.rs — `AppState` ↔ 행 표현의 **순수** 변환(플랫폼 개편 5단계-C).
//!
//! `web/src/lib/db/rows.ts` 의 Rust 이식이다. 5단계 재범위(v6)로 **정본이 Rust 로** 오면서
//! 쓰기 매퍼가 여기 있어야 하고, 읽기 매퍼도 함께 와야 왕복 동형을 한 언어에서 잠글 수 있다.
//!
//! **이 파일에는 IO 가 없다**(규율 11-2). `server.rs`/커맨드가 이 함수들을 부르고,
//! 검증은 Tauri 런타임 없이 `cargo test` 로 전량 돈다 — TS 원본이 vitest 로 그랬던 것과 같다.
//!
//! ## 원본에서 그대로 가져온 계약 (바꾸면 I1 백업 호환이 깨진다)
//!
//! · **행 하나의 값은 레코드 통째 JSON 문자열**이다. 필드별 열로 펼치지 않는 이유는
//!   `ItemSchema`·`AppStateSchema` 가 `.passthrough()` 라 **모르는 필드가 실재**하고,
//!   열로 펼치면 그것들이 왕복에서 소리 없이 증발하기 때문이다.
//! · **ROW_SLICES 에 없는 필드는 자동으로 settings 로** 간다 — 새 슬라이스가 생겨도
//!   매퍼를 안 고쳐도 보존된다(누락이 기본값이 되지 않게).
//! · **`present` 는 "행이 0개여도 있었다"는 사실**을 남긴다. 없으면 `completions: {}` 가
//!   되읽을 때 `undefined` 로 되살아나 `defaults()` 와 형태가 갈린다.
//! · **upsert 를 먼저, 삭제를 나중에.** 중간에 죽으면 남는 쪽이 "여분의 옛 행"이어야지
//!   "사라진 행"이면 안 된다. 여분은 다음 쓰기가 정리하지만 유실은 복구할 수 없다.
//!
//! ⚠ `serde_json` 의 `preserve_order` 피처가 **필수**다(Cargo.toml 주석 참조). 기본 BTreeMap 은
//! 객체 키를 사전순으로 재배열하는데, `present` 가 키 순회 순서를 그대로 싣고 그게 `meta` 에
//! JSON 문자열로 저장되므로 순서가 바뀌면 diff 가 매번 "변경됨"으로 판정한다.

/* ⚠ 5단계-C 는 **이식만** 하고 배선하지 않는다(단계가 독립 릴리스 가능해야 한다는 §4 원칙).
그래서 쓰기 쪽(`state_to_rows`·`diff_rows`)은 아직 호출자가 없다.
**제거 트리거: 5-E 가 저장 경로를 이 모듈로 돌리는 순간 이 allow 를 지운다.** 그때도 남는
심볼이 있으면 그건 진짜 죽은 코드다. 읽기 쪽 타입은 `server.rs` 가 이미 쓰고 있다. */
#![allow(dead_code)]

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// 날짜 키 맵 슬라이스 — `completions` 는 2단 중첩이라 따로 다룬다.
const DS_MAP_SLICES: [&str; 3] = ["dayOverrides", "dayPlans", "rituals"];
/// id 를 가진 배열 슬라이스. `retentionLog` 만 id 가 없어 순번을 id 로 쓴다.
const ARRAY_SLICES: [&str; 6] = [
    "cbms",
    "backlog",
    "blankResults",
    "retentionLog",
    "events",
    "tasks",
];

/// `persistence.ts:19` 와 일치해야 한다. 로컬 저장은 되지만 **내보내기에서 빠지는** 층.
const RUNTIME_CACHE_KEYS: [&str; 5] = [
    "_vaultScan",
    "_ankiFile",
    "_ankiLive",
    "_icsExport",
    "_knowState",
];
/// `persistence.ts:23` 와 일치. 그중 **로컬 persist 에서도** 빠지는 순수 휘발 캐시.
const EPHEMERAL_ONLY_KEYS: [&str; 2] = ["_vaultScan", "_ankiFile"];

fn is_row_slice(k: &str) -> bool {
    DS_MAP_SLICES.contains(&k)
        || ARRAY_SLICES.contains(&k)
        || matches!(k, "completions" | "summaries" | "weekAlloc")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KvRow {
    pub key: String,
    pub json: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionRow {
    pub ds: String,
    pub k: String,
    pub json: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DsRow {
    pub ds: String,
    pub json: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrdRow {
    pub id: String,
    pub ord: i64,
    pub json: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SummaryRow {
    pub sid: String,
    pub ord: i64,
    pub json: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WeekAllocRow {
    pub wk: String,
    pub sid: String,
    pub json: String,
}

/* 버킷을 `HashMap` 이 아니라 **구조체**로 둔 것은 의도다 — 슬라이스가 빠지면 컴파일이 깨진다.
"빈 버킷이 키로 존재해야 한다"는 계약(5-B 테스트가 잠근 것)을 런타임이 아니라 타입이 보장한다. */
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DsMaps {
    pub day_overrides: Vec<DsRow>,
    pub day_plans: Vec<DsRow>,
    pub rituals: Vec<DsRow>,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Arrays {
    pub cbms: Vec<OrdRow>,
    pub backlog: Vec<OrdRow>,
    pub blank_results: Vec<OrdRow>,
    pub retention_log: Vec<OrdRow>,
    pub events: Vec<OrdRow>,
    pub tasks: Vec<OrdRow>,
}

impl DsMaps {
    pub(crate) fn bucket_mut(&mut self, slice: &str) -> Option<&mut Vec<DsRow>> {
        match slice {
            "dayOverrides" => Some(&mut self.day_overrides),
            "dayPlans" => Some(&mut self.day_plans),
            "rituals" => Some(&mut self.rituals),
            _ => None,
        }
    }
    pub(crate) fn bucket(&self, slice: &str) -> Option<&Vec<DsRow>> {
        match slice {
            "dayOverrides" => Some(&self.day_overrides),
            "dayPlans" => Some(&self.day_plans),
            "rituals" => Some(&self.rituals),
            _ => None,
        }
    }
}
impl Arrays {
    pub(crate) fn bucket_mut(&mut self, slice: &str) -> Option<&mut Vec<OrdRow>> {
        match slice {
            "cbms" => Some(&mut self.cbms),
            "backlog" => Some(&mut self.backlog),
            "blankResults" => Some(&mut self.blank_results),
            "retentionLog" => Some(&mut self.retention_log),
            "events" => Some(&mut self.events),
            "tasks" => Some(&mut self.tasks),
            _ => None,
        }
    }
    pub(crate) fn bucket(&self, slice: &str) -> Option<&Vec<OrdRow>> {
        match slice {
            "cbms" => Some(&self.cbms),
            "backlog" => Some(&self.backlog),
            "blankResults" => Some(&self.blank_results),
            "retentionLog" => Some(&self.retention_log),
            "events" => Some(&self.events),
            "tasks" => Some(&self.tasks),
            _ => None,
        }
    }
}

/// DB 한 벌의 행 표현. 필드명은 TS `DbRows` 와 **1:1**(5-B 라우트가 이 모양을 이미 내보낸다).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbRows {
    pub present: Vec<String>,
    pub settings: Vec<KvRow>,
    pub runtime: Vec<KvRow>,
    pub completions: Vec<CompletionRow>,
    pub ds_maps: DsMaps,
    pub arrays: Arrays,
    pub summaries: Vec<SummaryRow>,
    pub week_alloc: Vec<WeekAllocRow>,
}

/// 실행할 SQL 한 문장.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Stmt {
    pub sql: String,
    pub args: Vec<Value>,
}

struct TableSpec {
    name: &'static str,
    cols: &'static [&'static str],
    /// 앞쪽 n개 열이 기본키 — diff 의 동일성 판정 키.
    key_len: usize,
    /// 동기화 대상인가(5단계-D) — `updated_at` 을 싣고 삭제 시 툼스톤을 남긴다.
    /// `meta` 는 파생값(`present`)이라, `runtime_cache` 는 로컬 전용 캐시라 제외.
    sync: bool,
}
const TABLES: [TableSpec; 8] = [
    TableSpec {
        name: "meta",
        cols: &["key", "value"],
        key_len: 1,
        sync: false,
    },
    TableSpec {
        name: "settings",
        cols: &["key", "value"],
        key_len: 1,
        sync: true,
    },
    TableSpec {
        name: "runtime_cache",
        cols: &["key", "value"],
        key_len: 1,
        sync: false,
    },
    TableSpec {
        name: "completions",
        cols: &["ds", "k", "value"],
        key_len: 2,
        sync: true,
    },
    TableSpec {
        name: "ds_map",
        cols: &["slice", "ds", "value"],
        key_len: 2,
        sync: true,
    },
    TableSpec {
        name: "records",
        cols: &["slice", "id", "ord", "value"],
        key_len: 2,
        sync: true,
    },
    TableSpec {
        name: "summaries",
        cols: &["sid", "ord", "value"],
        key_len: 2,
        sync: true,
    },
    TableSpec {
        name: "week_alloc",
        cols: &["wk", "sid", "value"],
        key_len: 2,
        sync: true,
    },
];

type TableData = IndexMap<&'static str, IndexMap<String, Vec<Value>>>;

/// 행 표현 → 테이블별 {키 → 열 값 배열}. diff 와 SQL 생성이 공유하는 중간 표현.
fn to_table_data(rows: &DbRows) -> TableData {
    let mut t: TableData = IndexMap::new();
    for spec in &TABLES {
        t.insert(spec.name, IndexMap::new());
    }
    fn put(t: &mut TableData, table: &'static str, vals: Vec<Value>, key_len: usize) {
        let key = vals
            .iter()
            .take(key_len)
            .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string))
            .collect::<Vec<_>>()
            .join(" ");
        t.get_mut(table).expect("선언된 테이블").insert(key, vals);
    }
    let s = |v: &str| Value::String(v.to_string());

    put(
        &mut t,
        "meta",
        vec![s("present"), json!(rows.present).to_string().into()],
        1,
    );
    for r in &rows.settings {
        put(&mut t, "settings", vec![s(&r.key), s(&r.json)], 1);
    }
    for r in &rows.runtime {
        put(&mut t, "runtime_cache", vec![s(&r.key), s(&r.json)], 1);
    }
    for r in &rows.completions {
        put(
            &mut t,
            "completions",
            vec![s(&r.ds), s(&r.k), s(&r.json)],
            2,
        );
    }
    for slice in DS_MAP_SLICES {
        for r in rows.ds_maps.bucket(slice).expect("선언된 슬라이스") {
            put(&mut t, "ds_map", vec![s(slice), s(&r.ds), s(&r.json)], 2);
        }
    }
    for slice in ARRAY_SLICES {
        for r in rows.arrays.bucket(slice).expect("선언된 슬라이스") {
            put(
                &mut t,
                "records",
                vec![s(slice), s(&r.id), json!(r.ord), s(&r.json)],
                2,
            );
        }
    }
    for r in &rows.summaries {
        put(
            &mut t,
            "summaries",
            vec![s(&r.sid), json!(r.ord), s(&r.json)],
            2,
        );
    }
    for r in &rows.week_alloc {
        put(
            &mut t,
            "week_alloc",
            vec![s(&r.wk), s(&r.sid), s(&r.json)],
            2,
        );
    }
    t
}

/// 이전 상태 → 다음 상태의 최소 문장 목록.
///
/// ⚠ **upsert 를 먼저, 삭제를 나중에** 낸다(원본 `rows.ts:129-131` 의 계약).
pub fn diff_rows(prev: Option<&DbRows>, next: &DbRows, now: i64) -> Vec<Stmt> {
    let a = prev.map(to_table_data);
    let b = to_table_data(next);
    let empty = IndexMap::new();
    let mut upserts = Vec::new();
    let mut tombs = Vec::new();
    let mut deletes = Vec::new();

    for spec in &TABLES {
        let before = a.as_ref().and_then(|m| m.get(spec.name)).unwrap_or(&empty);
        let after = b.get(spec.name).expect("선언된 테이블");

        for (key, vals) in after {
            /* ⚠ 비교는 **데이터 열만** 본다. `updated_at` 은 매번 새로 찍는 값이라
            비교에 넣으면 모든 행이 항상 "변경됨"이 되어 증분이 전량 쓰기로 퇴화한다. */
            if before.get(key).is_some_and(|old| old == vals) {
                continue;
            }
            let mut cols: Vec<&str> = spec.cols.to_vec();
            let mut args = vals.clone();
            if spec.sync {
                cols.push("updated_at");
                args.push(json!(now));
            }
            upserts.push(Stmt {
                sql: format!(
                    "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
                    spec.name,
                    cols.join(","),
                    vec!["?"; cols.len()].join(",")
                ),
                args,
            });
            /* 부활(지웠다가 같은 키로 다시 만들기)은 여기서 처리하지 않는다 — 병합이
            `updated_at` vs `deleted_at` 을 비교하므로 다시 만든 행이 이긴다(5-E).
            "정리 문장이 실행돼야만 맞는" 설계를 피한다. 근거는 `rows.ts` 의 같은 자리. */
        }
        for (key, vals) in before {
            if after.contains_key(key) {
                continue;
            }
            /* 툼스톤을 데이터 삭제보다 **먼저** 낸다: 중간에 죽으면 "행은 남았는데 툼스톤이
            있는" 상태가 되고 병합이 deleted_at > updated_at 으로 올바르게 판정한다.
            반대 순서면 "행은 지웠는데 툼스톤이 없는" 상태 — 상대 기기가 되살린다. */
            if spec.sync {
                tombs.push(Stmt {
                    sql:
                        "INSERT OR REPLACE INTO tombstones (tbl,k1,k2,deleted_at) VALUES (?,?,?,?)"
                            .to_string(),
                    args: vec![
                        json!(spec.name),
                        vals[0].clone(),
                        // 단일키 테이블은 k2 를 빈 문자열로(db.rs v3 규약).
                        if spec.key_len == 2 {
                            vals[1].clone()
                        } else {
                            json!("")
                        },
                        json!(now),
                    ],
                });
            }
            let where_ = spec.cols[..spec.key_len]
                .iter()
                .map(|c| format!("{c} = ?"))
                .collect::<Vec<_>>()
                .join(" AND ");
            deletes.push(Stmt {
                sql: format!("DELETE FROM {} WHERE {}", spec.name, where_),
                args: vals[..spec.key_len].to_vec(),
            });
        }
    }
    upserts.extend(tombs);
    upserts.extend(deletes);
    upserts
}

/// `AppState` → 행. `persistence.ts` 의 2계층 스코프를 **테이블 정책으로 직역**한다.
pub fn state_to_rows(state: &Value) -> DbRows {
    let mut rows = DbRows::default();
    let Some(obj) = state.as_object() else {
        return rows;
    };

    for (key, value) in obj {
        // ⚠ `null` 은 건너뛰지 않는다. TS 원본이 거르는 건 `undefined` 인데 JSON 에는 그 값이
        //    없다(직렬화에서 키 자체가 사라진다) — null 은 실제 값이라 보존해야 한다.
        if EPHEMERAL_ONLY_KEYS.contains(&key.as_str()) {
            continue;
        }
        if RUNTIME_CACHE_KEYS.contains(&key.as_str()) {
            rows.runtime.push(KvRow {
                key: key.clone(),
                json: value.to_string(),
            });
            continue;
        }
        if !is_row_slice(key) {
            rows.settings.push(KvRow {
                key: key.clone(),
                json: value.to_string(),
            });
            continue;
        }
        rows.present.push(key.clone()); // 행이 0개여도 "있었다"는 사실은 남긴다

        let handled = match key.as_str() {
            "completions" => value.as_object().map(|days| {
                for (ds, day) in days {
                    let Some(day) = day.as_object() else { continue };
                    for (k, entry) in day {
                        rows.completions.push(CompletionRow {
                            ds: ds.clone(),
                            k: k.clone(),
                            json: entry.to_string(),
                        });
                    }
                }
            }),
            "summaries" => value.as_object().map(|by_sid| {
                for (sid, list) in by_sid {
                    let Some(list) = list.as_array() else {
                        continue;
                    };
                    for (ord, v) in list.iter().enumerate() {
                        rows.summaries.push(SummaryRow {
                            sid: sid.clone(),
                            ord: ord as i64,
                            json: v.to_string(),
                        });
                    }
                }
            }),
            "weekAlloc" => value.as_object().map(|by_wk| {
                for (wk, by_sid) in by_wk {
                    let Some(by_sid) = by_sid.as_object() else {
                        continue;
                    };
                    for (sid, mins) in by_sid {
                        rows.week_alloc.push(WeekAllocRow {
                            wk: wk.clone(),
                            sid: sid.clone(),
                            json: mins.to_string(),
                        });
                    }
                }
            }),
            k if DS_MAP_SLICES.contains(&k) => value.as_object().map(|m| {
                let bucket = rows.ds_maps.bucket_mut(k).expect("선언된 슬라이스");
                for (ds, v) in m {
                    bucket.push(DsRow {
                        ds: ds.clone(),
                        json: v.to_string(),
                    });
                }
            }),
            k if ARRAY_SLICES.contains(&k) => value.as_array().map(|list| {
                let bucket = rows.arrays.bucket_mut(k).expect("선언된 슬라이스");
                for (ord, v) in list.iter().enumerate() {
                    // retentionLog 엔 id 가 없다 — 순번을 id 로 쓴다(순서가 곧 정체성인 로그).
                    let id = v
                        .get("id")
                        .and_then(Value::as_str)
                        .map_or_else(|| ord.to_string(), str::to_string);
                    bucket.push(OrdRow {
                        id,
                        ord: ord as i64,
                        json: v.to_string(),
                    });
                }
            }),
            _ => None,
        };

        if handled.is_none() {
            /* 선언된 행 슬라이스인데 형태가 예상과 다르다(손상 저장본 등) — 통째로 settings 에
            보존한다. 떨구면 왕복이 데이터 유실이 된다. 행으로 안 갔으니 present 에서도 빼야
            되읽을 때 settings 의 원본을 빈 컨테이너가 덮지 않는다. */
            if let Some(i) = rows.present.iter().position(|p| p == key) {
                rows.present.remove(i);
            }
            rows.settings.push(KvRow {
                key: key.clone(),
                json: value.to_string(),
            });
        }
    }
    rows
}

fn parse(json: &str) -> Result<Value, String> {
    serde_json::from_str(json).map_err(|e| format!("행 값 JSON 파싱 실패: {e} — {json:.80}"))
}

/// 행 → `AppState`. `state_to_rows` 의 역이며, 둘의 왕복이 **동형**이어야 한다(테스트가 잠금).
///
/// ⚠ TS 원본은 파싱 실패 시 throw 하고 `boot.ts` 가 받아 `_preloaded=null` 로 떨어뜨린다.
/// 여기서는 `Result` 로 올린다 — 조용히 `null` 을 채우면 손상 행 하나가 슬라이스 전체를
/// 기본값으로 만들면서 아무도 모른다(규율 11-3).
pub fn rows_to_state(rows: &DbRows) -> Result<Value, String> {
    let mut out = Map::new();
    for r in &rows.settings {
        out.insert(r.key.clone(), parse(&r.json)?);
    }
    for r in &rows.runtime {
        out.insert(r.key.clone(), parse(&r.json)?);
    }

    /* 존재했던 행 슬라이스를 **먼저 빈 컨테이너로** 깔아 둔다 — 아래 블록들은 행이 있을 때만
    채우므로, 이게 없으면 `completions: {}` 같은 빈 슬라이스가 undefined 로 되살아난다. */
    for k in &rows.present {
        let empty = if ARRAY_SLICES.contains(&k.as_str()) {
            json!([])
        } else {
            json!({})
        };
        out.insert(k.clone(), empty);
    }

    if !rows.completions.is_empty() {
        let mut comp = Map::new();
        for r in &rows.completions {
            let day = comp
                .entry(r.ds.clone())
                .or_insert_with(|| Value::Object(Map::new()));
            day.as_object_mut()
                .expect("방금 만든 객체")
                .insert(r.k.clone(), parse(&r.json)?);
        }
        out.insert("completions".into(), Value::Object(comp));
    }
    for slice in DS_MAP_SLICES {
        let bucket = rows.ds_maps.bucket(slice).expect("선언된 슬라이스");
        if bucket.is_empty() {
            continue;
        }
        let mut m = Map::new();
        for r in bucket {
            m.insert(r.ds.clone(), parse(&r.json)?);
        }
        out.insert(slice.into(), Value::Object(m));
    }
    for slice in ARRAY_SLICES {
        let bucket = rows.arrays.bucket(slice).expect("선언된 슬라이스");
        if bucket.is_empty() {
            continue;
        }
        // 순번대로 정렬해 값만 뽑는다 — 배열 슬라이스의 순서는 의미를 가진다(로그·정렬 기대).
        let mut sorted: Vec<&OrdRow> = bucket.iter().collect();
        sorted.sort_by_key(|r| r.ord);
        let mut list = Vec::with_capacity(sorted.len());
        for r in sorted {
            list.push(parse(&r.json)?);
        }
        out.insert(slice.into(), Value::Array(list));
    }
    if !rows.summaries.is_empty() {
        let mut sorted: Vec<&SummaryRow> = rows.summaries.iter().collect();
        sorted.sort_by_key(|r| r.ord);
        let mut by_sid = Map::new();
        for r in sorted {
            let list = by_sid
                .entry(r.sid.clone())
                .or_insert_with(|| Value::Array(Vec::new()));
            list.as_array_mut()
                .expect("방금 만든 배열")
                .push(parse(&r.json)?);
        }
        out.insert("summaries".into(), Value::Object(by_sid));
    }
    if !rows.week_alloc.is_empty() {
        let mut by_wk = Map::new();
        for r in &rows.week_alloc {
            let m = by_wk
                .entry(r.wk.clone())
                .or_insert_with(|| Value::Object(Map::new()));
            m.as_object_mut()
                .expect("방금 만든 객체")
                .insert(r.sid.clone(), parse(&r.json)?);
        }
        out.insert("weekAlloc".into(), Value::Object(by_wk));
    }
    Ok(Value::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Value {
        json!({
            "schemaVersion": 3,
            "theme": "dark",
            "items": [{"id": "a", "name": "미적분"}],
            "completions": {"2026-07-19": {"a": {"done": true}}},
            "dayPlans": {"2026-07-19": {"blocks": []}},
            "rituals": {},
            "cbms": [{"id": "c1"}, {"id": "c2"}],
            "retentionLog": [{"v": 1}, {"v": 2}],
            "summaries": {"a": ["첫", "둘"]},
            "weekAlloc": {"2026-W29": {"a": 30}},
            "_knowState": {"cached": 1},
            "_vaultScan": {"버려질": true}
        })
    }

    #[test]
    fn 왕복이_동형이다() {
        let state = sample();
        let rows = state_to_rows(&state);
        let back = rows_to_state(&rows).unwrap();

        // 휘발 키만 빠지고 나머지는 전부 그대로여야 한다.
        let mut expect = state.as_object().unwrap().clone();
        expect.remove("_vaultScan");
        assert_eq!(back, Value::Object(expect));
    }

    #[test]
    fn 휘발_키는_저장하지_않고_런타임_캐시는_분리한다() {
        let rows = state_to_rows(&sample());
        assert!(
            !rows.runtime.iter().any(|r| r.key == "_vaultScan"),
            "_vaultScan 은 저장 자체를 하지 않는다"
        );
        assert!(
            rows.runtime.iter().any(|r| r.key == "_knowState"),
            "_knowState 는 runtime 테이블로"
        );
        assert!(
            !rows.settings.iter().any(|r| r.key == "_knowState"),
            "런타임 캐시가 settings(내보내기 포함)로 새면 2계층 스코프가 깨진다"
        );
    }

    #[test]
    fn 빈_슬라이스도_present_로_살아남는다() {
        let rows = state_to_rows(&json!({ "completions": {}, "tasks": [] }));
        assert!(rows.present.contains(&"completions".to_string()));
        assert!(rows.present.contains(&"tasks".to_string()));
        let back = rows_to_state(&rows).unwrap();
        // 빈 컨테이너로 되살아나야 한다 — undefined 가 되면 defaults() 와 형태가 갈린다.
        assert_eq!(back["completions"], json!({}));
        assert_eq!(back["tasks"], json!([]));
    }

    #[test]
    fn 모르는_최상위_필드는_settings_로_보존된다() {
        let rows = state_to_rows(&json!({ "미래슬라이스": {"x": 1} }));
        assert!(rows.settings.iter().any(|r| r.key == "미래슬라이스"));
        let back = rows_to_state(&rows).unwrap();
        assert_eq!(back["미래슬라이스"], json!({"x": 1}));
    }

    #[test]
    fn 형태가_어긋난_행_슬라이스는_settings_로_보존되고_present_에서_빠진다() {
        // completions 가 객체가 아니라 배열인 손상 저장본.
        let rows = state_to_rows(&json!({ "completions": [1, 2] }));
        assert!(
            !rows.present.contains(&"completions".to_string()),
            "행으로 안 갔으면 present 에서도 빠져야 빈 컨테이너가 원본을 덮지 않는다"
        );
        assert!(rows.settings.iter().any(|r| r.key == "completions"));
        let back = rows_to_state(&rows).unwrap();
        assert_eq!(
            back["completions"],
            json!([1, 2]),
            "손상본도 유실되지 않는다"
        );
    }

    #[test]
    fn retention_log_는_순번을_id_로_쓴다() {
        let rows = state_to_rows(&sample());
        let ids: Vec<&str> = rows
            .arrays
            .retention_log
            .iter()
            .map(|r| r.id.as_str())
            .collect();
        assert_eq!(ids, vec!["0", "1"]);
    }

    #[test]
    fn 배열_순서는_ord_로_복원된다() {
        let mut rows = state_to_rows(&sample());
        rows.arrays.cbms.reverse(); // 저장 순서가 뒤집혀도
        let back = rows_to_state(&rows).unwrap();
        assert_eq!(back["cbms"], json!([{"id": "c1"}, {"id": "c2"}]));
    }

    #[test]
    fn diff_는_바뀐_행만_내고_upsert_가_삭제보다_먼저다() {
        let prev = state_to_rows(&json!({ "theme": "dark", "tasks": [{"id": "t1"}] }));
        let next = state_to_rows(&json!({ "theme": "light" }));
        let stmts = diff_rows(Some(&prev), &next, 1_700_000_000_000);

        let first_delete = stmts.iter().position(|s| s.sql.starts_with("DELETE"));
        let last_upsert = stmts.iter().rposition(|s| s.sql.starts_with("INSERT"));
        if let (Some(d), Some(u)) = (first_delete, last_upsert) {
            assert!(
                u < d,
                "삭제가 upsert 보다 먼저 나오면 중간 크래시에서 유실된다"
            );
        }
        assert!(
            stmts.iter().any(|s| s.sql.contains("DELETE FROM records")),
            "사라진 tasks 행이 삭제되지 않았다"
        );
        assert!(
            stmts
                .iter()
                .any(|s| s.sql.contains("INSERT OR REPLACE INTO settings")),
            "바뀐 theme 이 upsert 되지 않았다"
        );
    }

    #[test]
    fn 안_바뀌면_문장이_하나도_안_나온다() {
        let rows = state_to_rows(&sample());
        assert!(
            diff_rows(Some(&rows), &rows, 1_700_000_000_000).is_empty(),
            "동일 상태인데 쓰기가 발생한다 — preserve_order 가 꺼졌거나 직렬화가 불안정하다"
        );
    }

    /* ⚠ 이 케이스가 `preserve_order` 피처를 잠근다. 기본 BTreeMap 이면 키가 사전순으로
    재배열돼 `present` 순서가 원본과 달라지고, 그러면 meta 행이 매 저장마다 "변경됨"이 된다. */
    #[test]
    fn present_순서가_상태의_키_순서를_따른다() {
        let rows = state_to_rows(&json!({ "tasks": [], "completions": {}, "cbms": [] }));
        assert_eq!(rows.present, vec!["tasks", "completions", "cbms"]);
    }

    #[test]
    fn 손상된_행_값은_조용히_넘어가지_않는다() {
        let rows = DbRows {
            settings: vec![KvRow {
                key: "theme".into(),
                json: "{깨진".into(),
            }],
            ..Default::default()
        };
        assert!(rows_to_state(&rows).is_err(), "파싱 실패가 조용히 삼켜졌다");
    }

    /* ── 5단계-D — 동기화 가능한 데이터 모델 ─────────────────────────────
    `rows.ts` 의 같은 이름 케이스들과 **짝**이다. 두 구현이 갈리면 폰과 PC 가 서로
    다른 규칙으로 병합해 "한쪽에서만 삭제가 부활하는" 형태가 된다. */
    const NOW: i64 = 1_700_000_000_000;

    #[test]
    fn 동기화_대상_테이블만_updated_at_을_싣는다() {
        let rows = state_to_rows(&json!({ "theme": "dark", "_knowState": {"c": 1} }));
        let stmts = diff_rows(None, &rows, NOW);

        let settings = stmts
            .iter()
            .find(|s| s.sql.contains("INTO settings"))
            .unwrap();
        assert!(settings.sql.contains("updated_at"));
        assert_eq!(settings.args.last().unwrap(), &json!(NOW));

        // 내보내기에서 빠지는 로컬 캐시라 유선으로 나를 이유가 없다.
        let runtime = stmts
            .iter()
            .find(|s| s.sql.contains("INTO runtime_cache"))
            .unwrap();
        assert!(!runtime.sql.contains("updated_at"));
        // meta.present 는 파생값 — LWW 로 병합하면 원본과 어긋난다.
        let meta = stmts.iter().find(|s| s.sql.contains("INTO meta")).unwrap();
        assert!(!meta.sql.contains("updated_at"));
    }

    #[test]
    fn 삭제는_툼스톤을_남기고_데이터_삭제보다_먼저_나온다() {
        let prev = state_to_rows(&json!({ "tasks": [{"id": "t1"}, {"id": "t2"}] }));
        let next = state_to_rows(&json!({ "tasks": [{"id": "t1"}] }));
        let stmts = diff_rows(Some(&prev), &next, NOW);

        let tomb_at = stmts.iter().position(|s| s.sql.contains("INTO tombstones"));
        let del_at = stmts
            .iter()
            .position(|s| s.sql.starts_with("DELETE FROM records"));
        assert!(
            tomb_at.is_some(),
            "t2 를 지웠는데 툼스톤이 없다 — 다른 기기가 되살린다"
        );
        assert!(
            del_at.unwrap() > tomb_at.unwrap(),
            "툼스톤이 데이터 삭제보다 뒤에 있다"
        );

        let tomb = &stmts[tomb_at.unwrap()];
        assert_eq!(
            tomb.args,
            vec![json!("records"), json!("tasks"), json!("t2"), json!(NOW)]
        );
    }

    #[test]
    fn 단일키_테이블의_툼스톤은_k2_가_빈_문자열이다() {
        let prev = state_to_rows(&json!({ "theme": "dark", "startDate": "2026-01-01" }));
        let next = state_to_rows(&json!({ "theme": "dark" }));
        let stmts = diff_rows(Some(&prev), &next, NOW);
        let tomb = stmts
            .iter()
            .find(|s| s.sql.contains("INTO tombstones"))
            .unwrap();
        assert_eq!(
            tomb.args,
            vec![json!("settings"), json!("startDate"), json!(""), json!(NOW)]
        );
    }
}
