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

/* ⚠ 연결 문자열은 여기 없다 — **`paths::db_url()`** 이 소유한다(SD-6).
폴더가 하네스 override 로 갈릴 수 있게 되면서 상수로는 표현이 안 되고, 무엇보다
`workspace.json`·`research-jobs.json` 과 **같은 폴더**를 봐야 해서 그 셋의 경로 해석이
한 곳에 있어야 한다. 프런트도 `db_url` 커맨드로 **같은 값**을 받아 연다. */

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
        /* v5(C-4) — **인증(기기 단위 주체 · 토큰 회전)**.

        ⚠ 이 두 테이블은 **서버(D1) 전용**이고 데스크톱 DB 에선 비어 있는 채로 남는다.
        마이그레이션 폴더가 로컬·서버 공유(§C-3)라 양쪽에 다 생기는데, 그걸 피하려면
        스키마를 갈래내야 한다 — 이 저장소가 두 번 물린 divergence 를 사는 것보다
        **잉여 테이블 두 개가 싸다**는 판단이다(런북 §3-2 가 meta·runtime_cache 를 두고
        내린 판정과 같은 사상: 필터하지 말고 전부 만들고 소비 측에서 거른다). */
        Migration {
            version: 5,
            description: "C-4 인증 — 기기 레코드 + 등록 코드",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/005_auth.sql"),
        },
        /* v6 — **레거시 행이 동기화에서 투명하게 배제되던 결함**을 고친다.

        v3 이 `updated_at` 을 `DEFAULT 0` 으로 추가했는데, 아웃박스는 `updated_at > watermark`
        로 수집하고 워터마크 초기값이 0 이다. `0 > 0` 이 거짓이라 **v3 이전에 쓰인 행은 영원히
        안 올라간다.** 앱은 그동안 "연결됨 · 최신 상태"라고 말한다 — 조용한 유실이다.

        첫 실기기 연결(2026-07-20)에서 실측으로 잡았다: 로컬 settings 17행 중 클라우드에 도착한
        것이 1행이었고, 그 1행만 C-1 이후에 건드려져 진짜 스탬프를 갖고 있었다.

        상수 1 을 쓰는 이유(시계 금지)는 SQL 파일 머리주석 참조. */
        Migration {
            version: 6,
            description: "레거시 updated_at=0 백필 — 동기화 수집에서 빠지던 행 복구",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/006_backfill_stamps.sql"),
        },
        /* v7(N-11) — **방문 원장**. 앱이 자기 사용을 관측하지 못하던 공백.

        25탭 중 무엇을 실제로 여는지 몰라 IA 결정 셋(탭 은퇴·폰 뷰 사용 여부·all-clear
        빈도)이 전부 코드 읽기 추론 위에 서 있었다. `via`(진입 경로)로 쪼개는 이유와
        동기화에서 구조적으로 빠지는 이유는 SQL 파일 머리주석이 SSOT.

        ⚠ **그 머리주석의 정정을 여기 둔다(2026-07-26 감사 H23).** 도입 시점에 셋 중
        "폰 뷰 사용 여부"는 **측정되지 않고 있었다** — 계수기가 `app/App.tsx` 에만 있었고
        폰은 `app/` 을 안 쓴다. 2026-07-26 에 폰 뷰 계측(`via='phone'`)과 소비처(설정 →
        진단의 원장 리드아웃)를 붙여 그 동기가 **실제로** 성립하게 됐다.

        ⚠⚠ 정정을 **SQL 파일에 쓰지 않은 이유**: 적용된 마이그레이션은 SHA-384 체크섬이
        `_sqlx_migrations` 에 남아 매 부팅에 대조된다 — **주석 한 글자만 바뀌어도 기존 DB 를
        못 연다**(이 파일 머리주석의 ⚠⚠ 절). 그 사고는 새 DB 에서 재현되지 않아 개발자에겐
        정상으로 보이고, 사용자 기계에서만 터진다. 감사가 "머리주석 정정"으로 적은 항목이지만
        그대로 실행하면 C2 가 막으려던 것과 같은 부류의 사고가 된다. */
        Migration {
            version: 7,
            description: "N-11 방문 원장 — 진입 경로별 라우트 카운터(동기화 대상 아님)",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/007_route_visits.sql"),
        },
        /* E23 — '정적(quiet)의 설계'가 기다리던 단 하나의 미지수(all-clear 빈도)를 잰다.
        007 과 같은 부류다: `updated_at` 이 없어 아웃박스 수집이 **구조적으로** 불가능하고,
        그래서 동기화 대상이 아니라는 사실이 플래그가 아니라 스키마로 표현된다. */
        Migration {
            version: 8,
            description: "E23 하루 신호 원장 — all-clear 빈도 계기(동기화 대상 아님)",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/008_day_signals.sql"),
        },
        /* C-3(2026-07-30 `/감사 근본`) — `summaries` 의 동기화 키를 **위치에서 정체성으로**.
        기본키가 `(sid, ord)` 였고 `ord` 는 배열 인덱스라, 두 기기의 동시 추가가 같은 키를 써서
        **하나가 툼스톤도 없이 사라졌다**(삭제+편집은 어느 기기에도 없던 목록을 만들었다).
        안정 id 는 `addSummary` 가 이미 넣고 있었고 동기화 계층만 위치를 쓰고 있었다.
        ⚠ 기본키 변경이라 표를 다시 만든다 → 기존 행의 id 는 JSON 본문에서 꺼낸다(그러지 않으면
          다음 부팅의 diff 가 전 요약을 "삭제+삽입"으로 보아 툼스톤이 대량 발생한다). */
        Migration {
            version: 9,
            description: "C-3 summaries 키를 (sid,ord)→(sid,id) — 위치 키가 동시 추가를 삼켰다",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/009_summaries_identity.sql"),
        },
    ]
}

/* ── 다운그레이드 가드(C2 · 2026-07-26 감사) ─────────────────────────────────────

⚠ **이 앱은 다운그레이드를 지원하지 않는다.** 판정이고, 그 판정을 여기서 코드로 만든다.

근거는 sqlx 의 거동이다: `validate_applied_migrations`(sqlx-core 0.8 `migrate/migrator.rs`)가
**DB 에 적용됐는데 번들에 없는 버전**을 `VersionMissing` 으로 거부한다. `tauri-plugin-sql` 은
`Migrator::new` 기본값을 쓰므로 `ignore_missing:false` 다 → v7 을 적용한 DB 를 v6 만 아는 exe 가
열면 `load()` 가 Err 를 낸다.

그 다음이 문제였다. `load()` Err → `getDb()` null → **C1 경로에 그대로 착지**한다. 즉 증상이
"앱이 안 뜬다"가 아니라 **"뜨는데 데이터가 옛날 것"** 이고, 그게 더 나쁘다 — 사용자는 정상으로
보이는 앱에서 낡은 상태를 편집하고, 그 편집이 임시 사본으로 갈라진다.

⚠ 지금은 안전하다(릴리스 0건 = 다운그레이드할 대상이 없다). **첫 업데이트를 내는 순간 무장된다** —
그래서 지금 심는다. 처방은 조용한 폴백이 아니라 **명시적 화면**이고, 그 판정에 필요한 값은
"DB 에 적용된 최대 버전"과 "이 빌드가 아는 최대 버전" 둘뿐이다.

⚠ 규율 11-2 — 커맨드는 `AppHandle` 을 로직에 섞지 않는다. 아래 두 함수는 경로·값만 받는 순수
/준순수 함수라 그 자리가 곧 통합 테스트 진입점이다. */

/// 이 빌드가 아는 마지막 마이그레이션 버전.
pub fn bundled_max_version() -> i64 {
    migrations().iter().map(|m| m.version).max().unwrap_or(0)
}

/// DB 에 **이미 적용된** 최대 버전. 파일이 없거나(첫 실행) `_sqlx_migrations` 가 아직 없으면 `None`.
///
/// ⚠ 읽기 전용으로 연다 — 판정하러 온 길에 파일을 만들거나 고치면 안 된다(read_only 는
/// 없는 파일을 만들지도 않는다).
pub async fn applied_max_version_at(path: &std::path::Path) -> Result<Option<i64>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let opts = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .read_only(true);
    let pool = sqlx::SqlitePool::connect_with(opts)
        .await
        .map_err(|e| format!("DB 열기 실패: {e}"))?;
    // 테이블 부재(= 아직 한 번도 마이그레이션 안 됨)는 오류가 아니라 `None` 이다.
    let got: Option<(Option<i64>,)> = sqlx::query_as("SELECT MAX(version) FROM _sqlx_migrations")
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();
    pool.close().await;
    Ok(got.and_then(|(v,)| v))
}

/// 다운그레이드 판정 — 값 둘만 보는 순수 술어(그래서 테스트가 앱 없이 붙는다).
pub fn is_downgrade(applied: Option<i64>, bundled: i64) -> bool {
    applied.is_some_and(|a| a > bundled)
}

/// 부팅 가드 결과 — 프런트가 이 값으로 **명시적 화면**을 띄운다(조용한 폴백 금지).
#[derive(serde::Serialize)]
pub struct DbVersionGuard {
    /// DB 에 적용된 최대 버전(아직 없으면 null).
    pub applied: Option<i64>,
    /// 이 빌드가 아는 최대 버전.
    pub bundled: i64,
    /// 다운그레이드인가 — 참이면 **DB 를 열어선 안 된다**.
    pub downgraded: bool,
}

/// 프런트가 `load()` **앞에** 부른다. 여기서 참이면 프런트는 DB 를 열지 않고 화면으로 말한다.
#[tauri::command]
pub async fn db_version_guard(app: tauri::AppHandle) -> Result<DbVersionGuard, String> {
    let path = crate::paths::db_path(&app)?;
    let applied = applied_max_version_at(&path).await?;
    let bundled = bundled_max_version();
    Ok(DbVersionGuard {
        applied,
        bundled,
        downgraded: is_downgrade(applied, bundled),
    })
}

#[cfg(test)]
mod tests {
    /// 동기화 대상 테이블 — 전부 `updated_at` 을 갖는다(v3). `runtime_cache`·`meta` 는
    /// 동기화 대상이 아니라 제외(위 v3 주석 참조).
    const SYNCED: [&str; 7] = [
        "settings",
        "completions",
        "ds_map",
        "records",
        "summaries",
        "week_alloc",
        "docs",
    ];

    /* ▶ C2(2026-07-26 감사) — **이 케이스가 단언하는 것은 우리 코드가 아니라 sqlx 의 거동이다.**

    그게 요점이다: 처방("다운그레이드는 지원하지 않는다 · 열지 말고 화면으로 말한다")이
    *"구버전 exe 는 신버전 DB 를 못 연다"* 는 외부 라이브러리의 성질 위에 서 있다. 그 전제가
    조용히 바뀌면(플러그인이 `ignore_missing` 을 켜거나 sqlx 가 정책을 바꾸면) 가드는 남는데
    근거가 사라져, 있지도 않은 위험을 막느라 앱을 세우게 된다. 전제는 테스트가 붙들어야 한다.

    ⚠ 임시 DB 로만 돈다 — 사용자의 실 DB 를 마이그레이션하는 검사는 만들지 않는다. */
    #[test]
    fn 구버전은_신버전_db_를_못_연다_그래서_가드가_먼저_말해야_한다() {
        use super::{applied_max_version_at, bundled_max_version, is_downgrade, migrations};
        use sqlx::migrate::{Migration as SqlxMigration, MigrationType, Migrator};
        use std::borrow::Cow;

        let dir = std::env::temp_dir().join("lh-downgrade-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("임시 폴더 생성 실패");
        let path = dir.join("learning-hub.db");

        /* `tauri-plugin-sql` 이 자기 `Migration` 을 sqlx 로 옮기는 것과 **같은 변환**이다
        (`lib.rs:91` — `MigrationKind::Up` → `MigrationType::ReversibleUp`, `no_tx:false`).
        여기서 어긋나면 체크섬이 달라져 다른 실패를 검사하게 된다. */
        let migrator = |upto: i64| Migrator {
            migrations: Cow::Owned(
                migrations()
                    .into_iter()
                    .filter(|m| m.version <= upto)
                    .map(|m| {
                        SqlxMigration::new(
                            m.version,
                            Cow::Borrowed(m.description),
                            MigrationType::ReversibleUp,
                            Cow::Borrowed(m.sql),
                            false,
                        )
                    })
                    .collect::<Vec<_>>(),
            ),
            ignore_missing: false, // 플러그인이 쓰는 `Migrator::new` 기본값(commands.rs:22)
            locking: true,
            no_tx: false,
        };

        let newest = bundled_max_version();
        assert!(newest >= 2, "버전이 하나뿐이면 이 검사가 성립하지 않는다");

        crate::testkit::rt().block_on(async {
            // ① 최신 앱이 만든 DB.
            let pool = sqlx::SqlitePool::connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .expect("임시 DB 열기 실패");
            migrator(newest)
                .run(&pool)
                .await
                .expect("최신 마이그레이션 적용 실패");
            pool.close().await;

            // ② 가드가 판정에 쓰는 값 — 실제로 읽힌다(읽기 전용 · 파일 훼손 없음).
            let applied = applied_max_version_at(&path)
                .await
                .expect("적용 버전 조회 실패");
            assert_eq!(applied, Some(newest), "적용된 최대 버전을 못 읽었다");
            assert!(
                is_downgrade(applied, newest - 1),
                "구버전 빌드에서 다운그레이드로 판정돼야 한다"
            );
            assert!(
                !is_downgrade(applied, newest),
                "같은 버전은 다운그레이드가 아니다"
            );

            // ③ 구버전 exe 흉내 — 하나 적은 집합으로 같은 DB 를 열면 **거부된다**.
            let pool = sqlx::SqlitePool::connect_with(
                sqlx::sqlite::SqliteConnectOptions::new().filename(&path),
            )
            .await
            .expect("임시 DB 재열기 실패");
            let err = migrator(newest - 1)
                .run(&pool)
                .await
                .expect_err("구버전이 신버전 DB 를 열었다 — C2 가드의 전제가 깨졌다");
            assert!(
                matches!(err, sqlx::migrate::MigrateError::VersionMissing(v) if v == newest),
                "기대한 거부 사유가 아니다: {err:?}"
            );
            pool.close().await;
        });

        let _ = std::fs::remove_dir_all(&dir);
    }

    /* ▶ 트랙 B 의 `C-5 — 실 DB 에 updated_at = 0 인 행이 없다` 를 여기로 내렸다.

    ⚠ 이 검사는 **실물이어야만 의미가 있다.** 마이그레이션 단위 테스트는 깨끗한 임시 DB 에
    적용해 보므로 늘 녹색이고, 정작 이번 결함은 *실제 사용자의 DB* 에서 났다(v3 이전에 쓰인
    행이 0 스탬프로 남아 아웃박스의 `updated_at > watermark` 에서 영원히 빠졌다 — 앱은 그동안
    "연결됨 · 최신 상태"라고 말했다. 조용한 유실이다).

    옛 케이스는 이걸 재려고 앱을 띄워 웹뷰에서 SQL 을 쐈다. 그런데 이건 **SQL 질의 하나**다 —
    `examples/probe_counts.rs` 가 이미 같은 일을 하고 있었고(일회성으로 만들어 두고 일반화하지
    않았다), 창은 처음부터 필요 없었다.

    ⚠ 읽기 전용으로 연다 — 사용자의 정본 DB 다. 앱이 켜져 있어도 WAL 이라 읽기는 막히지 않는다. */
    #[test]
    fn 실_db_에_updated_at_0_인_행이_없다() {
        let Some(path) = crate::testkit::real_db() else {
            crate::testkit::skip!("앱 DB 가 아직 없습니다(앱을 한 번도 안 켠 기계) — 검사 생략");
        };

        let zeros = crate::testkit::rt().block_on(async {
            let opts = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .read_only(true);
            let pool = sqlx::SqlitePool::connect_with(opts)
                .await
                .expect("실 DB 열기 실패");
            let mut out = Vec::new();
            for t in SYNCED {
                let (n,): (i64,) =
                    sqlx::query_as(&format!("SELECT COUNT(*) FROM {t} WHERE updated_at = 0"))
                        .fetch_one(&pool)
                        .await
                        .unwrap_or_else(|e| panic!("{t} 질의 실패(스키마가 갈렸나): {e}"));
                out.push((t, n));
            }
            pool.close().await;
            out
        });

        for (t, n) in zeros {
            /* ⚠⚠ **`settings` 는 면제다 — C-1(2026-07-30 `/감사 근본`) 이후 0 이 의도된 값이다.**

            C-1 은 "아직 아무것도 안 한 기기"의 `defaults()` 를 **스탬프 0** 으로 쓴다. 그 0 이
            세 경로를 동시에 닫아(수집에 안 걸림 · 서버 LWW 에서 못 이김 · 병합에서 짐) 새 PC 의
            시드 기본값이 계정을 덮는 것을 막는다 — 근거는 `web/src/lib/db/boot.ts` 의
            `PRISTINE_STAMP` 주석이 SSOT.

            그런 행은 **`settings` 에만** 생긴다: pristine 이란 곧 활동 표가 비어 있다는 뜻이고
            (`completions`·`records`·`summaries`·`ds_map`·`week_alloc` 는 행이 0개), `routine`·
            `degree`·`startDate` 같은 시드는 전부 `settings` 로 간다.

            ⚠ 잃는 것을 정직하게 적는다: 이 면제 때문에 *실제 편집이 실수로 0 을 받는* 경우를
              `settings` 에서는 이 검사가 더 못 잡는다. 그 자리를 대신 지키는 것은
              `web/test/dbBoot.test.ts` 의 C-1 케이스 셋이다(pristine→0 · 실데이터→청크 스탬프 ·
              시드에 속지 않음). 활동 표 5개에서는 검사가 **종전 강도 그대로** 남는다 —
              v6 이 고친 조용한 유실이 자라는 곳이 거기다. */
            if t == "settings" {
                continue;
            }
            assert_eq!(
                n, 0,
                "{t} 에 0 스탬프 행이 {n}개 — v6 백필이 안 돌았거나 새로 생겼다(동기화에서 영원히 빠진다)"
            );
        }
    }
}
