//! db.rs — SQLite 스키마 선언(플랫폼 개편 2단계 · C-3 에서 SQL 을 파일로 분리).
//!
//! 마이그레이션을 **Rust 에 두는 이유**: 프런트가 DDL 을 좌우하면 배포본마다 스키마가 갈릴 수
//! 있다. 여기 선언된 버전만이 진리이고, 프런트(`web/src/lib/db/`)는 데이터만 넣고 뺀다.
//!
//! ## ⚠ SQL 본문은 `../migrations/*.sql` 에 있다 — **그 파일이 SSOT 다**
//!
//! 호스트가 Cloudflare D1 로 정해지면서(설계서 §9-3b) **같은 스키마를 서버도 쓴다.** D1 이
//! SQLite 라 스키마가 그대로 가는데, 그러면 "로컬용 한 벌 · 서버용 한 벌"이 생길 자리가 만들어
//! 진다 — 이 저장소가 `rows.ts` ↔ `rows.rs` 로 이미 두 번 물린 병이다.
//! 그래서 SQL 을 파일로 내리고 **양쪽이 같은 파일을 가리키게** 한다(wrangler 는
//! `migrations_dir` 로 이 폴더를 본다). 생성기·`codegen:check` 를 쓰지 않은 이유는
//! **원본을 공유할 수 있으면 생성하지 않는다**는 것 — 생성은 원본 공유가 불가능할 때의 차선책
//! 이다(`gen-artifacts.mjs` 가 그 경우다. 원본이 부모 저장소에 있어 공유가 안 된다).
//!
//! ## ⚠⚠ 이미 적용된 마이그레이션의 SQL 은 **절대 수정하지 마라**
//!
//! sqlx 마이그레이터가 **SHA-384 체크섬**을 `_sqlx_migrations` 에 저장하고 매 부팅에 대조한다.
//! 1바이트만 달라져도 "적용된 마이그레이션이 수정됐다"로 판정해 **기존 DB 를 못 연다.**
//! 들여쓰기 한 칸·CRLF 변환·주석 한 줄이면 충분하고, **새 DB 에선 재현되지 않아** 개발자는
//! 정상으로 보고 커밋한다. 스키마를 바꾸려면 **새 버전을 추가**한다.
//! 방어 2겹: `.gitattributes` 의 `*.sql text eol=lf` · `web/test/dbMigrations.test.ts` 의 체크섬 핀.
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
            sql: include_str!("../migrations/001_initial.sql"),
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
            sql: include_str!("../migrations/002_user_docs.sql"),
        },
        /* v3(5단계-D) — **동기화 가능한 데이터 모델**.

        5단계 재범위 v7: 앱 데이터가 클라우드로 가고 폰과 PC 가 각자 편집한다. 그러려면
        레코드마다 "언제 바뀌었나"와 "지워졌나"를 알아야 한다.

        ⚠ **툼스톤이 없으면 삭제가 부활한다.** 행을 그냥 지우면 다른 기기 입장에서
        "없는 행"과 "지워진 행"이 구분되지 않아, 병합할 때 상대가 아직 들고 있는
        옛 행을 되살린다 — 폰에서 지운 할일이 PC 동기화 때 돌아오는 형태다.
        v6 이 "툼스톤 불필요"라고 적은 것은 **집 안 전용(단일 writer) 전제에서만** 참이었다.

        **동기화 대상이 아닌 두 테이블**:
        · `runtime_cache` — 내보내기에서 빠지는 로컬 낙관적 캐시다(persistence.ts 2계층
          스코프). 기기마다 다시 계산하면 되므로 유선으로 나를 이유가 없다.
        · `meta` — `present` 는 상태에서 **파생**된다(rows 매퍼가 매번 다시 만든다).
          파생값을 LWW 로 병합하면 원본과 어긋날 수 있다.

        `updated_at`·`deleted_at` 은 **epoch 밀리초**다. 기존 행에 0 이 들어가는 것은
        의도다 — "아주 오래된 것"으로 취급돼 첫 동기화에서 상대 값이 이긴다. */
        Migration {
            version: 3,
            description: "sync — updated_at + tombstones",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/003_sync.sql"),
        },
        /* v4(C-1) — **오프라인 큐가 물어볼 질문을 대답 가능하게 만든다.**

        v3 이 `updated_at` 을 심었지만 **그걸로 질의할 수단은 안 만들었다.** 오프라인 큐의
        유일한 질문은 "마지막으로 보낸 뒤 바뀐 게 뭔가"(`updated_at > ?`)인데, 인덱스가
        툼스톤에만 있어 나머지 7테이블은 **전체 스캔**이었다. 지금 데이터가 작아 체감이 없는
        것이지 설계가 맞아서가 아니다 — 그리고 이 질의는 앞으로 **주기적으로** 돈다.

        `sync_state` 를 **별도 테이블로** 두는 이유는 `docs`(v2)와 똑같다: `settings` 는
        `rows.ts` 매퍼가 통째로 소유해 **모르는 키를 지운다**(전량 대조가 그 계약). 워터마크를
        거기 얹으면 매퍼가 남의 데이터를 청소한다. 게다가 워터마크는 **기기 로컬**이라
        (내 PC 가 어디까지 보냈나) 내보내기·동기화 대상이 되어선 안 된다 — 별도 테이블이면
        그 배제가 **구조적으로** 보장된다(`runtime_cache` 에 넣으면 매퍼가 다시 소유한다). */
        Migration {
            version: 4,
            description: "C-1 오프라인 큐 — updated_at 인덱스 + 기기 로컬 동기화 상태",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/004_outbox.sql"),
        },
    ]
}
