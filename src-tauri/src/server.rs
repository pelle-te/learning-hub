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
    let workspace = crate::workspace::resolve(&app).map(|p| p.display().to_string());
    start_with(workspace, port.unwrap_or(DEFAULT_PORT))
}

/* `AppHandle` 을 안 받는다(규율 11-2). 이유는 두 가지다:
① 통합 테스트가 **진짜 소켓으로** 서버를 띄워 401/200 을 확인할 수 있다 — `authed` 단위
   테스트는 함수만 보지 "바인딩이 됐는가·라우터가 붙었는가"는 원리적으로 못 본다.
② 5-B 에서 서버가 DB 핸들을 받게 되면 여기가 그 주입 지점이 된다. */
fn start_with(workspace: Option<String>, port: u16) -> Result<ServerInfo, String> {
    let mut guard = slot()
        .lock()
        .map_err(|_| "서버 상태 잠금 실패".to_string())?;
    if let Some(r) = guard.as_ref() {
        return Ok(info_of(r));
    }

    let token = new_token()?;

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

    let ctx = Arc::new(Ctx {
        token: token.clone(),
        workspace,
    });
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();

    let thread = std::thread::Builder::new()
        .name("lh-mobile-server".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    log::error!("모바일 서버 런타임 생성 실패: {e}");
                    return;
                }
            };
            rt.block_on(async move {
                let listener = match tokio::net::TcpListener::from_std(listener) {
                    Ok(l) => l,
                    Err(e) => {
                        log::error!("모바일 서버 리스너 전환 실패: {e}");
                        return;
                    }
                };
                let router = Router::new()
                    .route("/", get(page))
                    .route("/api/health", get(health))
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
    #[test]
    fn 실제_소켓에서_토큰_없는_요청은_401_이고_있는_요청은_200_이다() {
        let info = start_with(Some("D:/테스트".into()), 0).expect("서버 시작 실패");
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
            (no_token, bad, with_query, health_status, body)
        });
        // 슬롯이 전역이라 실패하든 말든 반납이 먼저다.
        stop_inner();

        let (no_token, bad, with_query, health_status, body) = out;
        assert_eq!(no_token, 401, "토큰 없는 요청이 페이지를 받았다");
        assert_eq!(bad, 401, "틀린 토큰이 통과했다");
        assert_eq!(with_query, 200, "맞는 토큰이 거부됐다");
        assert_eq!(health_status, 200);
        assert_eq!(body["ok"], true);
        assert_eq!(body["workspace"], "D:/테스트");
        assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));

        assert!(!server_status().running, "정지 후에도 running 이 참이다");
        // 같은 포트를 곧바로 다시 잡을 수 있어야 graceful shutdown 이 실제로 끝난 것이다.
        TcpListener::bind(("0.0.0.0", info.port)).expect("정지 후 포트가 반납되지 않았다");
    }

    #[test]
    fn 틀린_헤더는_맞는_쿼리로_구제되지_않는다() {
        let ctx = Ctx {
            token: "sekret".into(),
            workspace: None,
        };
        let mut h = HeaderMap::new();
        h.insert(AUTHORIZATION, "Bearer nope".parse().unwrap());
        let q: HashMap<String, String> = [("t".to_string(), "sekret".to_string())].into();
        assert!(!authed(&ctx, &h, &q));
    }
}
