//! db.rs — SQLite 스키마 선언(플랫폼 개편 2단계).
//!
//! 마이그레이션을 **Rust 에 두는 이유**: 프런트가 DDL 을 좌우하면 배포본마다 스키마가 갈릴 수
//! 있다. 여기 선언된 버전만이 진리이고, 프런트(`web/src/lib/db/`)는 데이터만 넣고 뺀다.
//!
//! 설계 계약(§4-2단계 A-1): **성장 무제한 슬라이스만 행**으로 쪼갠다. 유계·저빈도(items·
//! routine·degree·weekly)와 스칼라·마커는 `settings` 에 JSON 값 한 행씩.
//!
//! ⚠ 값이 레코드 통째 JSON 인 것은 의도다. 필드별 열로 펼치면 `.passthrough()` 스키마의
//! 모르는 필드가 왕복에서 증발해 I1(백업 호환)이 깨진다. 질의가 필요해지면 FTS5 인덱스를
//! 별도로 얹는다(원본 훼손 없이 파생만 추가).

use tauri_plugin_sql::{Migration, MigrationKind};

/// 앱 DB 파일명 — `tauri-plugin-sql` 이 app data 폴더 기준으로 연다.
pub const DB_URL: &str = "sqlite:learning-hub.db";

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "2단계 초기 스키마 — 행 슬라이스 + settings/runtime KV",
            kind: MigrationKind::Up,
            sql: "
            -- 행 슬라이스 중 '실제로 존재했던' 것들. 비어 있음과 없음을 구분하려면 필요하다
            -- (completions:{} 는 행을 0개 만든다 → 이게 없으면 undefined 로 되살아난다).
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

            -- 내보내기에 **포함**되는 스칼라·마커·유계 문서(items·routine·degree·weekly).
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

            -- 로컬 저장은 하되 내보내기에서 **빠지는** 층(RUNTIME_CACHE_KEYS).
            -- persistence.ts 의 2계층 스코프를 테이블 경계로 직역한 것.
            CREATE TABLE runtime_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL);

            -- completions[ds][sid|type] — 2단 중첩이라 전용 테이블.
            CREATE TABLE completions (
                ds TEXT NOT NULL, k TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (ds, k)
            );

            -- 날짜 키 맵(dayOverrides·dayPlans·rituals) — slice 로 구분.
            CREATE TABLE ds_map (
                slice TEXT NOT NULL, ds TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (slice, ds)
            );

            -- id 배열 슬라이스(cbms·backlog·blankResults·retentionLog·events·tasks).
            -- ord 는 순서가 의미를 갖는 슬라이스(로그·정렬) 때문에 필수.
            CREATE TABLE records (
                slice TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (slice, id)
            );
            CREATE INDEX idx_records_slice_ord ON records (slice, ord);

            CREATE TABLE summaries (
                sid TEXT NOT NULL, ord INTEGER NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (sid, ord)
            );

            CREATE TABLE week_alloc (
                wk TEXT NOT NULL, sid TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (wk, sid)
            );
        ",
        },
        /* v2(4단계-J) — **AppState 에 속하지 않는 사용자 저작물**.

        내 요약·독후감(`lh:reads`)과 진로 메모·즐겨찾기(`atlas.*`)는 앱 상태가 아니라서 위 테이블
        어디에도 안 들어가고, 2단계까지 localStorage 에 남아 있었다. 2단계가 "사용자 저작물이라
        정본과 같은 곳에 있는 게 맞다"고 적고 4단계로 미뤄 둔 항목이다.

        지금 갚는 이유는 5단계다: 모바일 뷰는 **폰이 PC 의 SQLite 를 직접 읽는** 모델이라,
        localStorage 에 남은 저작물은 폰에서 **원리적으로 안 보인다**.

        `settings` 를 재사용하지 않고 테이블을 나눈 이유: 저기는 `AppState` 매퍼(`rows.ts`)가
        통째로 소유해서 **모르는 키를 지운다**(전량 대조가 그 계약이다). 성격이 다른 값을 얹으면
        매퍼가 남의 데이터를 청소하게 된다. */
        Migration {
            version: 2,
            description: "user_docs",
            kind: MigrationKind::Up,
            sql: "CREATE TABLE docs (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        },
    ]
}
