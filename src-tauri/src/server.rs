/*! 5단계-A — LAN 읽기 전용 모바일 뷰의 **최소 스모크 서버**.

## 왜 이 파일이 `lib.rs` 의 "리슨하는 포트가 없다"를 되돌리는가

4단계-G 는 `serve.js` 를 지우며 **앱이 여는 포트를 0 으로** 만들었고, 그걸 성과로 기록했다
(HTTP 공격면 소멸 — Host 위조·CSRF·traversal 이 "그런 표면이 없다"로 닫혔다). 이 파일은 그
결정을 **의도적으로, 부분적으로** 되돌린다. 근거는 5단계의 목적 자체가 "폰에서 본다"이고
폰은 IPC 에 닿을 수 없기 때문이다. 되돌리는 대가를 다음 세 가지로 갚는다:

1. **기본 OFF.** 서버는 사용자가 설정에서 켤 때만 뜬다. `0.0.0.0` 바인딩을 기본값으로 두면
   4-G 가 없앤 공격면을 **사용자 동의 없이** 되살리는 것이다.
2. **쿠키를 쓰지 않는다.** 인증은 URL/헤더 토큰뿐이라 **주변 권한(ambient authority)이 없다** —
   공격자 페이지가 요청을 보낼 수는 있어도 토큰을 모르고, CORS 헤더를 안 주므로 응답도 못 읽는다.
   4-G 표의 "CSRF·DNS 리바인딩 부활 필수"가 *토큰 설계로* 대부분 상쇄되는 지점이다.
3. **쓰기 라우트가 없다.** 앱 데이터를 바꾸는 경로를 만들지 않는 것이 §5-0-5 의 1순위 방어다.

## 5-A 의 범위 (의도적으로 좁다)

서버·인증·LAN 도달 경로**만** 검증한다. 앱 데이터(sqlx 읽기 전용 풀)는 **5-B** 다 —
착수 전 결정 1 이 `database is locked` 위험을 안고 가기로 한 것이라, 전송 경로가 먼저
서 있어야 그 위험을 격리해서 관찰할 수 있다.

페이지는 `include_str!` 로 **바이너리에 박는다**. 파일시스템 경로를 조립하지 않으므로
**경로 traversal 이 원리적으로 불가능**하다(§5-0-5 의 "부활 필수" 항목을 코드가 아니라
구조로 닫는다). 5-B 가 진짜 번들을 서빙하게 되면 그때 traversal 방어가 실제로 필요해진다.
*/
use std::collections::HashMap;
use std::net::{IpAddr, TcpListener, UdpSocket};
use std::sync::{Arc, Mutex, OnceLock};

use axum::{
    extract::{DefaultBodyLimit, Query, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    response::Html,
    routing::get,
    Json, Router,
};
use serde::Serialize;
use tauri::AppHandle;

/// 5-B 가 이 파일을 진짜 모바일 번들로 대체한다. 그때까지의 스모크 화면.
const PAGE: &str = include_str!("mobile/index.html");

/// 기본 포트. 8000(옛 serve.js)·8765(AnkiConnect, `anki.rs`)·11434(Ollama)를 피했다 —
/// 은퇴한 백엔드의 포트를 재사용하면 "옛 서버가 떴나?"라는 오진을 부른다.
pub const DEFAULT_PORT: u16 = 8770;

struct Ctx {
    token: String,
    workspace: Option<String>,
    /// 5단계-B — 앱 DB 읽기 전용 풀. 열지 못했으면 `None`(서버는 뜨되 데이터 라우트가 503).
    db: Option<sqlx::SqlitePool>,
}

struct Running {
    port: u16,
    token: String,
    stop: tokio::sync::oneshot::Sender<()>,
    thread: std::thread::JoinHandle<()>,
}

fn slot() -> &'static Mutex<Option<Running>> {
    static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize, Clone)]
pub struct ServerInfo {
    running: bool,
    port: u16,
    /// 폰 주소창에 그대로 칠 수 있는 형태(토큰 포함). 꺼져 있으면 `None`.
    url: Option<String>,
    /// LAN IP 를 못 찾았을 때(랜선 없음·VPN 등) 이유를 프런트가 말할 수 있게 분리해서 준다.
    lan_ip: Option<String>,
}

#[derive(Serialize)]
struct Health {
    ok: bool,
    workspace: Option<String>,
    version: &'static str,
}

/// 라우팅 테이블에 "8.8.8.8 로 나가려면 어느 인터페이스냐"를 묻는다.
/// UDP `connect` 는 **패킷을 보내지 않는다** — 커널 조회일 뿐이라 오프라인에서도 즉시 끝난다.
fn lan_ip() -> Option<IpAddr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    s.local_addr().ok().map(|a| a.ip())
}

fn new_token() -> Result<String, String> {
    let mut b = [0u8; 24];
    getrandom::getrandom(&mut b).map_err(|e| format!("난수 생성 실패: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

/// 길이가 같을 때 조기 종료하지 않는다 — 토큰 비교의 타이밍 누출 방지.
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// 토큰은 `Authorization: Bearer` 또는 `?t=` 로 받는다.
/// 후자가 필요한 이유: 폰 주소창에 처음 칠 때는 헤더를 붙일 방법이 없다.
/// (페이지가 뜨자마자 `history.replaceState` 로 주소창에서 지운다 — `mobile/index.html`)
fn authed(ctx: &Ctx, headers: &HeaderMap, q: &HashMap<String, String>) -> bool {
    let from_header = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if let Some(t) = from_header {
        return ct_eq(t, &ctx.token);
    }
    q.get("t").is_some_and(|t| ct_eq(t, &ctx.token))
}

async fn page(
    State(ctx): State<Arc<Ctx>>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Html<&'static str>, StatusCode> {
    if !authed(&ctx, &headers, &q) {
        // 토큰 없는 LAN 스캐너에게는 앱의 존재조차 알리지 않는다(본문 없는 401).
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(Html(PAGE))
}

async fn health(
    State(ctx): State<Arc<Ctx>>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Health>, StatusCode> {
    if !authed(&ctx, &headers, &q) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(Json(Health {
        ok: true,
        workspace: ctx.workspace.clone(),
        version: env!("CARGO_PKG_VERSION"),
    }))
}

/// 앱 DB 를 **읽기 전용**으로 연다.
///
/// `read_only(true)` 는 "쓰기 라우트를 안 만든다"와 **겹치는 방어**다(§5-0-5). 겹치게 둔 이유는
/// 5-C 가 라우트를 늘릴 때 실수로 쓰기를 열어도 SQLite 가 거부하기 때문 — 방어를 사람의
/// 기억에 맡기지 않는다.
///
/// `create_if_missing` 을 켜지 않는 것도 의도다. 경로가 틀리면 **빈 DB 를 새로 만들어**
/// 폰에 "데이터 없음"을 보여주는데, 그건 에러 없이 잘못 동작하는 전형이다. 없으면 없다고 한다.
async fn connect_ro(path: Option<&std::path::Path>) -> Result<Option<sqlx::SqlitePool>, String> {
    use sqlx::sqlite::SqliteConnectOptions;
    let Some(path) = path else {
        // 경로를 못 구한 것과 "DB 가 아직 없다"는 다르다 — 전자는 버그, 후자는 정상(첫 실행 전).
        return Err("앱 데이터 폴더를 찾지 못했습니다".into());
    };
    if !path.exists() {
        /* 아직 DB 가 없는 것은 정상이다(앱을 한 번도 안 썼거나 이관 전). 서버는 뜨되
        데이터 라우트가 503 을 준다 — 서버 자체를 못 켜게 막으면 사용자가 이유를 모른다. */
        log::warn!("앱 DB 가 아직 없습니다: {}", path.display());
        return Ok(None);
    }
    let opts = SqliteConnectOptions::new().filename(path).read_only(true);
    sqlx::SqlitePool::connect_with(opts)
        .await
        .map(Some)
        .map_err(|e| format!("앱 DB 열기 실패 — {e}"))
}

/* ── 5단계-B — 앱 데이터 읽기 ────────────────────────────────────────────────

`web/src/lib/db/sqlite.ts:98-130` 의 `readRows()` 를 **쿼리까지 그대로** 옮긴 것이다.
같은 모양(`DbRows`)을 JSON 으로 내보내고, 폰은 이미 순수·테스트된 `db/rows.ts` 의
`rowsToState()` 로 `AppState` 를 만든다.

**Rust 에 도메인 로직을 두지 않는 것이 핵심이다.** 매퍼를 Rust 로 다시 짜면 PC 경로와
폰 경로가 서로 다른 매퍼를 갖게 되고, 그 둘이 갈리는 순간 "폰에서만 값이 다르다"가
된다 — 진단이 가장 어려운 부류다. 여기는 SQL 만 안다(`sqlite.ts` 가 스스로에게 건 규약과
같은 규약이다). */

/// `key, value` 2열 테이블을 `[{key, json}]` 로.
async fn kv(pool: &sqlx::SqlitePool, table: &str) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    // table 은 아래 호출부의 **리터럴만** 온다(사용자 입력이 닿지 않는다) — SQL 주입 표면 없음.
    let q = format!("SELECT key, value FROM {table}");
    let rows: Vec<(String, String)> = sqlx::query_as(&q).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|(key, json)| serde_json::json!({ "key": key, "json": json }))
        .collect())
}

async fn read_rows(pool: &sqlx::SqlitePool) -> Result<serde_json::Value, sqlx::Error> {
    let meta: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM meta")
        .fetch_all(pool)
        .await?;
    let settings = kv(pool, "settings").await?;
    let runtime = kv(pool, "runtime_cache").await?;

    // settings 와 meta 가 둘 다 비면 "한 번도 안 썼다" — 기본값으로 부팅하지 말라는 신호.
    // `sqlite.ts:110` 이 null 을 돌려주는 것과 같은 계약이다.
    if settings.is_empty() && meta.is_empty() {
        return Ok(serde_json::Value::Null);
    }

    let present: serde_json::Value = meta
        .iter()
        .find(|(k, _)| k == "present")
        .and_then(|(_, v)| serde_json::from_str(v).ok())
        .unwrap_or_else(|| serde_json::json!([]));

    let completions: Vec<(String, String, String)> =
        sqlx::query_as("SELECT ds, k, value FROM completions")
            .fetch_all(pool)
            .await?;
    let ds_map: Vec<(String, String, String)> =
        sqlx::query_as("SELECT slice, ds, value FROM ds_map")
            .fetch_all(pool)
            .await?;
    let records: Vec<(String, String, i64, String)> =
        sqlx::query_as("SELECT slice, id, ord, value FROM records ORDER BY slice, ord")
            .fetch_all(pool)
            .await?;
    let summaries: Vec<(String, i64, String)> =
        sqlx::query_as("SELECT sid, ord, value FROM summaries ORDER BY sid, ord")
            .fetch_all(pool)
            .await?;
    let week_alloc: Vec<(String, String, String)> =
        sqlx::query_as("SELECT wk, sid, value FROM week_alloc")
            .fetch_all(pool)
            .await?;

    /* 빈 버킷을 **미리 만들어 둔다** — `rows.ts` 가 키의 존재를 전제하고, 없는 슬라이스는
    "빈 배열"이 아니라 `undefined` 가 돼 매퍼가 조용히 다르게 동작한다(`sqlite.ts:117-118`
    이 같은 이유로 리터럴을 먼저 깐다). 슬라이스 이름도 거기서 그대로 가져왔다. */
    let mut ds_maps = serde_json::json!({ "dayOverrides": [], "dayPlans": [], "rituals": [] });
    for (slice, ds, json) in ds_map {
        if let Some(b) = ds_maps.get_mut(&slice).and_then(|v| v.as_array_mut()) {
            b.push(serde_json::json!({ "ds": ds, "json": json }));
        }
    }
    let mut arrays = serde_json::json!({
        "cbms": [], "backlog": [], "blankResults": [],
        "retentionLog": [], "events": [], "tasks": []
    });
    for (slice, id, ord, json) in records {
        if let Some(b) = arrays.get_mut(&slice).and_then(|v| v.as_array_mut()) {
            b.push(serde_json::json!({ "id": id, "ord": ord, "json": json }));
        }
    }

    Ok(serde_json::json!({
        "present": present,
        "settings": settings,
        "runtime": runtime,
        "completions": completions.into_iter()
            .map(|(ds, k, json)| serde_json::json!({ "ds": ds, "k": k, "json": json }))
            .collect::<Vec<_>>(),
        "dsMaps": ds_maps,
        "arrays": arrays,
        "summaries": summaries.into_iter()
            .map(|(sid, ord, json)| serde_json::json!({ "sid": sid, "ord": ord, "json": json }))
            .collect::<Vec<_>>(),
        "weekAlloc": week_alloc.into_iter()
            .map(|(wk, sid, json)| serde_json::json!({ "wk": wk, "sid": sid, "json": json }))
            .collect::<Vec<_>>(),
    }))
}

/// `docs` 테이블(4단계-J — AppState 밖 사용자 저작물: 내 요약·독후감·진로 메모).
/// 폰에서 이게 없으면 읽을거리·진로 지도가 빈 껍데기로 뜬다(`db.rs:73-74` 가 예고한 그 이유).
async fn read_docs(pool: &sqlx::SqlitePool) -> Result<serde_json::Value, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM docs")
        .fetch_all(pool)
        .await?;
    let mut m = serde_json::Map::new();
    for (k, v) in rows {
        m.insert(k, serde_json::Value::String(v));
    }
    Ok(serde_json::Value::Object(m))
}

async fn state(
    State(ctx): State<Arc<Ctx>>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !authed(&ctx, &headers, &q) {
        return Err((StatusCode::UNAUTHORIZED, String::new()));
    }
    let Some(pool) = ctx.db.as_ref() else {
        // ⚠ 빈 상태를 200 으로 주지 않는다 — 폰이 "데이터가 없구나"로 오해한다.
        //    규율 11-3: 정본을 쥔 층은 침묵하지 않는다.
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "앱 DB 를 열지 못했습니다".into(),
        ));
    };
    let rows = read_rows(pool).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB 읽기 실패: {e}"),
        )
    })?;
    let docs = read_docs(pool).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("DB 읽기 실패: {e}"),
        )
    })?;
    Ok(Json(serde_json::json!({ "rows": rows, "docs": docs })))
}

fn info_of(r: &Running) -> ServerInfo {
    let ip = lan_ip();
    /* ⚠ LAN IP 를 못 찾아도 **URL 은 반드시 준다**(127.0.0.1 폴백). 예전엔 `url` 이 `None` 이
    될 수 있었는데, 그러면 "서버는 켜졌는데 접근 수단이 화면 어디에도 없는" 상태가 된다 —
    토큰이 URL 안에만 있기 때문이다(조립 지점을 하나로 둔 대가). 폴백을 두면 그 대가를
    치르지 않고도 조립 지점은 여전히 여기 한 곳이다. LAN 여부는 `lan_ip` 로 따로 알린다. */
    let host = ip.map_or_else(|| "127.0.0.1".to_string(), |ip| ip.to_string());
    ServerInfo {
        running: true,
        port: r.port,
        url: Some(format!("http://{}:{}/?t={}", host, r.port, r.token)),
        lan_ip: ip.map(|ip| ip.to_string()),
    }
}

#[tauri::command]
pub fn server_status() -> ServerInfo {
    match slot().lock().ok().and_then(|g| g.as_ref().map(info_of)) {
        Some(i) => i,
        None => ServerInfo {
            running: false,
            port: DEFAULT_PORT,
            url: None,
            lan_ip: lan_ip().map(|ip| ip.to_string()),
        },
    }
}

#[tauri::command]
pub fn server_start(app: AppHandle, port: Option<u16>) -> Result<ServerInfo, String> {
    use tauri::Manager;
    let workspace = crate::workspace::resolve(&app).map(|p| p.display().to_string());
    /* DB 는 `tauri-plugin-sql` 이 app data 폴더 기준으로 여는 것과 **같은 파일**이어야 한다
    (`db.rs:16` 의 `sqlite:learning-hub.db`). 여기서 경로를 틀리면 서버가 빈 DB 를 새로
    만들어 폰에 "데이터 없음"을 보여준다 — 에러 없이 잘못 동작하는 전형이라, 아래
    `connect_ro` 가 **존재하지 않는 파일을 만들지 않게**(create_if_missing 기본 false) 둔다. */
    let db_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("learning-hub.db"));
    start_with(workspace, db_path, port.unwrap_or(DEFAULT_PORT))
}

/* `AppHandle` 을 안 받는다(규율 11-2). 이유는 두 가지다:
① 통합 테스트가 **진짜 소켓으로** 서버를 띄워 401/200 을 확인할 수 있다 — `authed` 단위
   테스트는 함수만 보지 "바인딩이 됐는가·라우터가 붙었는가"는 원리적으로 못 본다.
② 5-B 에서 서버가 DB 핸들을 받게 되면 여기가 그 주입 지점이 된다. */
fn start_with(
    workspace: Option<String>,
    db_path: Option<std::path::PathBuf>,
    port: u16,
) -> Result<ServerInfo, String> {
    let mut guard = slot()
        .lock()
        .map_err(|_| "서버 상태 잠금 실패".to_string())?;
    if let Some(r) = guard.as_ref() {
        return Ok(info_of(r));
    }

    let token = new_token()?;
    let token_for_ctx = token.clone();

    /* ⚠ 바인딩을 **동기로 먼저** 한다. 런타임 스레드 안에서 바인딩하면 EADDRINUSE 가
    로그로만 흘러 커맨드는 "켜졌다"를 돌려준다 — 규율 11-3 이 지목한 "정본을 쥔 층이
    조용히 실패"하는 정확한 형태다. 여기서 묶어야 사용자가 즉시 이유를 본다. */
    let listener = TcpListener::bind(("0.0.0.0", port))
        .map_err(|e| format!("포트 {port} 바인딩 실패 — {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("소켓 논블로킹 전환 실패 — {e}"))?;
    /* 요청 포트가 아니라 **실제로 잡힌 포트**를 기록한다. port=0(임시 포트 위임)일 때
    0 을 그대로 들고 있으면 URL 이 `http://ip:0/` 이 되어 조용히 틀린 주소를 안내한다. */
    let port = listener
        .local_addr()
        .map_err(|e| format!("바인딩 주소 조회 실패 — {e}"))?
        .port();

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    /* 풀 생성은 async 라 런타임 안에서만 할 수 있는데, 그러면 실패가 로그로만 흘러
    커맨드는 "켜졌다"를 돌려준다(5-A 에서 바인딩으로 한 번 물린 바로 그 형태).
    → 준비 결과를 채널로 **동기 회수**한다. 커맨드 스레드에서 `block_on` 을 쓰지 않는 이유는
    Tauri 가 이 스레드에 런타임 컨텍스트를 걸어 두면 중첩 런타임으로 패닉하기 때문. */
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

    let thread = std::thread::Builder::new()
        .name("lh-mobile-server".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("런타임 생성 실패: {e}")));
                    return;
                }
            };
            rt.block_on(async move {
                let listener = match tokio::net::TcpListener::from_std(listener) {
                    Ok(l) => l,
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("리스너 전환 실패: {e}")));
                        return;
                    }
                };
                let db = match connect_ro(db_path.as_deref()).await {
                    Ok(db) => db,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                let ctx = Arc::new(Ctx {
                    token: token_for_ctx,
                    workspace,
                    db,
                });
                let _ = ready_tx.send(Ok(()));
                let router = Router::new()
                    .route("/", get(page))
                    .route("/api/health", get(health))
                    // 5단계-B — 앱 데이터. 행 표현 그대로 내보내고 매퍼는 클라이언트가 돈다.
                    .route("/api/state", get(state))
                    // 쓰기 라우트는 없지만 상한은 건다 — 5-B 가 라우트를 늘릴 때
                    // 방어를 "그때 기억해서 추가"에 맡기지 않기 위함(serve.js L-13 계약 승계).
                    .layer(DefaultBodyLimit::max(1024 * 1024))
                    .with_state(ctx);
                if let Err(e) = axum::serve(listener, router)
                    .with_graceful_shutdown(async {
                        let _ = rx.await;
                    })
                    .await
                {
                    log::error!("모바일 서버 오류: {e}");
                }
            });
        })
        .map_err(|e| format!("서버 스레드 생성 실패 — {e}"))?;

    /* 준비 결과를 동기로 회수한다. 여기서 기다리지 않으면 커맨드가 "켜졌다"를 돌려준 뒤
    DB 열기가 실패해도 사용자는 모른다. 타임아웃을 두는 이유는 스레드가 어떤 이유로든
    응답하지 않을 때 UI 가 영영 멈추지 않게 하기 위함(그 경우도 실패로 취급한다). */
    match ready_rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            let _ = tx.send(());
            let _ = thread.join();
            return Err(e);
        }
        Err(e) => {
            let _ = tx.send(());
            let _ = thread.join();
            return Err(format!("서버가 응답하지 않습니다 — {e}"));
        }
    }

    let running = Running {
        port,
        token,
        stop: tx,
        thread,
    };
    let info = info_of(&running);
    *guard = Some(running);
    log::info!("모바일 서버 시작 — 포트 {port}");
    Ok(info)
}

#[tauri::command]
pub fn server_stop() -> ServerInfo {
    stop_inner();
    server_status()
}

fn stop_inner() {
    let taken = slot().lock().ok().and_then(|mut g| g.take());
    if let Some(r) = taken {
        let _ = r.stop.send(());
        // graceful shutdown 이 끝날 때까지 기다린다 — 안 기다리면 곧바로 재시작할 때
        // 옛 리스너가 아직 포트를 물고 있어 EADDRINUSE 가 난다(토글이 한 번 걸러 실패).
        let _ = r.thread.join();
        log::info!("모바일 서버 정지");
    }
}

/// 창이 닫힐 때 함께 내린다(`lib.rs` 의 `Destroyed` 훅).
pub fn shutdown() {
    stop_inner();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_eq_는_길이와_내용을_모두_본다() {
        assert!(ct_eq("abc", "abc"));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "ab"));
        assert!(!ct_eq("", "a"));
        assert!(ct_eq("", ""));
    }

    #[test]
    fn 토큰은_48자_16진수이고_매번_다르다() {
        let a = new_token().unwrap();
        let b = new_token().unwrap();
        assert_eq!(a.len(), 48);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "CSPRNG 가 같은 값을 두 번 냈다");
    }

    #[test]
    fn 인증은_헤더와_쿼리를_모두_받고_틀리면_거부한다() {
        let ctx = Ctx {
            token: "sekret".into(),
            workspace: None,
            db: None,
        };
        let empty = HashMap::new();

        let mut h = HeaderMap::new();
        h.insert(AUTHORIZATION, "Bearer sekret".parse().unwrap());
        assert!(authed(&ctx, &h, &empty));

        let mut wrong = HeaderMap::new();
        wrong.insert(AUTHORIZATION, "Bearer nope".parse().unwrap());
        assert!(!authed(&ctx, &wrong, &empty));

        let q: HashMap<String, String> = [("t".to_string(), "sekret".to_string())].into();
        assert!(!authed(&ctx, &HeaderMap::new(), &empty));
        assert!(authed(&ctx, &HeaderMap::new(), &q));
    }

    /* ⚠ 헤더가 있으면 쿼리로 **넘어가지 않는다** — 틀린 헤더를 들고 온 요청이
    URL 에 맞는 토큰을 붙여 우회하는 경로를 막는다. 이 케이스가 없으면
    `authed` 를 "둘 중 하나만 맞으면 통과"로 리팩터해도 테스트가 녹색이다. */
    /* ── 통합: 진짜 소켓으로 띄워 본다 ───────────────────────────────────────
    위 단위 테스트들은 `authed` 라는 **함수**를 검증할 뿐이라, 라우터에 그 검사를 붙이는
    걸 잊어도 전부 녹색이다(4단계에서 반복적으로 물린 "에러 없이 잘못 동작"의 형태).
    여기서는 실제 TCP 로 요청을 보내 **401 이 진짜 나가는지**를 본다.

    포트 0 으로 띄워 OS 에 임시 포트를 위임한다 — 고정 포트를 쓰면 개발자가 앱을 켜 둔
    채 테스트를 돌릴 때 EADDRINUSE 로 실패한다(규율 11-7: 검증이 검증 대상을 망가뜨리지
    않게 한다). 전역 슬롯을 쓰므로 이 테스트는 하나뿐이고, 끝나면 반드시 반납한다. */
    /// `db.rs` 의 v1·v2 스키마를 그대로 만든 임시 DB. 여기 DDL 이 `db.rs` 와 갈리면
    /// 이 테스트는 통과하는데 실제 앱에서 실패한다 — 그래서 컬럼명을 문자 그대로 옮겼다.
    fn seed_db() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("lh-server-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("learning-hub.db");
        let _ = std::fs::remove_file(&path);

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let opts = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true);
            let pool = sqlx::SqlitePool::connect_with(opts).await.unwrap();
            for sql in [
                "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                "CREATE TABLE runtime_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                "CREATE TABLE completions (ds TEXT NOT NULL, k TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (ds, k))",
                "CREATE TABLE ds_map (slice TEXT NOT NULL, ds TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (slice, ds))",
                "CREATE TABLE records (slice TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (slice, id))",
                "CREATE TABLE summaries (sid TEXT NOT NULL, ord INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (sid, ord))",
                "CREATE TABLE week_alloc (wk TEXT NOT NULL, sid TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (wk, sid))",
                "CREATE TABLE docs (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                r#"INSERT INTO meta VALUES ('present', '["cbms","tasks"]')"#,
                r#"INSERT INTO settings VALUES ('theme', '"dark"')"#,
                r#"INSERT INTO settings VALUES ('items', '[{"id":"a"}]')"#,
                r#"INSERT INTO runtime_cache VALUES ('_ankiLive', '{"n":1}')"#,
                r#"INSERT INTO completions VALUES ('2026-07-19', 'sid1', '{"done":true}')"#,
                r#"INSERT INTO ds_map VALUES ('dayPlans', '2026-07-19', '{"blocks":[]}')"#,
                r#"INSERT INTO records VALUES ('cbms', 'c2', 1, '{"n":2}')"#,
                r#"INSERT INTO records VALUES ('cbms', 'c1', 0, '{"n":1}')"#,
                r#"INSERT INTO records VALUES ('tasks', 't1', 0, '{"t":"x"}')"#,
                r#"INSERT INTO summaries VALUES ('s1', 0, '{"txt":"요약"}')"#,
                r#"INSERT INTO week_alloc VALUES ('2026-W29', 'sid1', '{"min":30}')"#,
                r#"INSERT INTO docs VALUES ('lh:reads', '{"내 요약":1}')"#,
            ] {
                sqlx::query(sql).execute(&pool).await.unwrap();
            }
            pool.close().await;
        });
        path
    }

    #[test]
    fn 실제_소켓에서_토큰_없는_요청은_401_이고_있는_요청은_200_이다() {
        let db = seed_db();
        let info = start_with(Some("D:/테스트".into()), Some(db), 0).expect("서버 시작 실패");
        assert!(info.running);
        assert_ne!(info.port, 0, "임시 포트가 실제 포트로 해석되지 않았다");

        let token = slot().lock().unwrap().as_ref().unwrap().token.clone();
        let base = format!("http://127.0.0.1:{}", info.port);

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let out = rt.block_on(async {
            let c = reqwest::Client::new();
            let no_token = c.get(&base).send().await.unwrap().status();
            let bad = c
                .get(&base)
                .header("Authorization", "Bearer 아님")
                .send()
                .await
                .unwrap()
                .status();
            let with_query = c
                .get(format!("{base}/?t={token}"))
                .send()
                .await
                .unwrap()
                .status();
            let health = c
                .get(format!("{base}/api/health"))
                .header("Authorization", format!("Bearer {token}"))
                .send()
                .await
                .unwrap();
            let health_status = health.status();
            let body: serde_json::Value = health.json().await.unwrap();
            let st = c
                .get(format!("{base}/api/state"))
                .header("Authorization", format!("Bearer {token}"))
                .send()
                .await
                .unwrap();
            let st_status = st.status();
            let st_body: serde_json::Value = st.json().await.unwrap();
            let st_denied = c
                .get(format!("{base}/api/state"))
                .send()
                .await
                .unwrap()
                .status();
            (
                no_token,
                bad,
                with_query,
                health_status,
                body,
                st_status,
                st_body,
                st_denied,
            )
        });
        // 슬롯이 전역이라 실패하든 말든 반납이 먼저다.
        stop_inner();

        let (no_token, bad, with_query, health_status, body, st_status, st, st_denied) = out;
        assert_eq!(no_token, 401, "토큰 없는 요청이 페이지를 받았다");
        assert_eq!(bad, 401, "틀린 토큰이 통과했다");
        assert_eq!(with_query, 200, "맞는 토큰이 거부됐다");
        assert_eq!(health_status, 200);
        assert_eq!(body["ok"], true);
        assert_eq!(body["workspace"], "D:/테스트");
        assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));

        // ── 5단계-B — /api/state 가 `DbRows` 모양 그대로인가 ──────────────────
        assert_eq!(st_denied, 401, "데이터 라우트가 토큰 없이 열렸다");
        assert_eq!(st_status, 200);
        let rows = &st["rows"];
        assert_eq!(rows["present"], serde_json::json!(["cbms", "tasks"]));
        // 값은 **레코드 통째 JSON 문자열**이다(db.rs:9-11) — 파싱해서 넘기면 매퍼 계약이 깨진다.
        assert_eq!(rows["settings"][0]["key"], "theme");
        assert_eq!(rows["settings"][0]["json"], "\"dark\"");
        assert_eq!(rows["runtime"][0]["key"], "_ankiLive");
        assert_eq!(rows["completions"][0]["ds"], "2026-07-19");
        assert_eq!(rows["completions"][0]["k"], "sid1");
        assert_eq!(rows["dsMaps"]["dayPlans"][0]["ds"], "2026-07-19");
        /* 빈 버킷이 **키로 존재**해야 한다 — 없으면 `rows.ts` 에서 undefined 가 되어
        "빈 슬라이스"와 "모르는 슬라이스"가 뒤섞인다(sqlite.ts:117-118 과 같은 계약). */
        assert!(rows["dsMaps"]["rituals"].is_array());
        assert!(rows["arrays"]["backlog"].is_array());
        // ord 순서가 보존돼야 한다 — 삽입 순서가 아니라 ORDER BY slice, ord 다.
        assert_eq!(rows["arrays"]["cbms"][0]["id"], "c1");
        assert_eq!(rows["arrays"]["cbms"][1]["id"], "c2");
        assert_eq!(rows["arrays"]["tasks"][0]["id"], "t1");
        assert_eq!(rows["summaries"][0]["sid"], "s1");
        assert_eq!(rows["weekAlloc"][0]["wk"], "2026-W29");
        // docs(4단계-J) — 없으면 폰에서 읽을거리·진로 지도가 빈 껍데기가 된다.
        assert_eq!(st["docs"]["lh:reads"], "{\"내 요약\":1}");

        assert!(!server_status().running, "정지 후에도 running 이 참이다");
        // 같은 포트를 곧바로 다시 잡을 수 있어야 graceful shutdown 이 실제로 끝난 것이다.
        TcpListener::bind(("0.0.0.0", info.port)).expect("정지 후 포트가 반납되지 않았다");
    }

    #[test]
    fn 틀린_헤더는_맞는_쿼리로_구제되지_않는다() {
        let ctx = Ctx {
            token: "sekret".into(),
            workspace: None,
            db: None,
        };
        let mut h = HeaderMap::new();
        h.insert(AUTHORIZATION, "Bearer nope".parse().unwrap());
        let q: HashMap<String, String> = [("t".to_string(), "sekret".to_string())].into();
        assert!(!authed(&ctx, &h, &q));
    }
}
