/*! 실시간 poke 소켓 — **데스크톱 실시간의 전송 계층**(Q-28 · 2026-08-02).

## 왜 Rust 인가

`lib/cloud/live.ts` 는 브라우저 `WebSocket` 으로 서버 `SyncHub` DO 에 붙는데, 데스크톱 웹뷰는
CSP 가 `connect-src 'self' ipc:` 라 **원리적으로 못 나간다**. 그래서 실시간은 폰에만 켜져 있었고
(`syncController` 의 `live` 옵션이 폰에서만 true), PC 는 다른 기기의 편집을 최대 5분(폴링) 또는
포커스 복귀까지 못 봤다.

CSP 를 푸는 대신 소켓을 Rust 로 내리는 것은 **새 예외가 아니라 기존 규약 그대로**다 —
뉴스·Ollama·Anki·업데이터·`cloud.rs`(HTTP)가 전부 같은 형태이고, 그래서 CLAUDE.md 가
_"셸에서 외부로 나가는 연결이 하나도 없다"_ 고 적을 수 있었다. 예외를 하나 남기면 다음 사람이
그걸 선례로 삼는다.

## ⚠⚠ 이 파일은 **정책을 갖지 않는다** — 소켓 하나의 수명만 안다

재연결 백오프·지터·"안정 연결" 판정·영구 실패 판별은 전부 `lib/cloud/live.ts` 에 있고, 그것들은
실사고 둘(H18 · H24)이 다듬은 값이다. 여기로 복제하면 **같은 정책이 두 벌**이 되고 폰과 PC 가
서로 다르게 재시도하게 된다 — 이 저장소가 반복해 물린 형태다(`syncLedger` 가 판정을 lib 에 둔
이유와 글자 그대로 같다). 그래서 이 파일이 하는 일은 정확히 셋이다:

1. 열어 달라면 **한 번** 붙는다(재시도 안 한다 — 실패는 그대로 보고한다).
2. 붙어 있는 동안 프레임을 `poke` 이벤트로 올린다.
3. 끊기면 사유와 함께 `close` 이벤트를 올린다. **다시 붙일지는 프런트가 정한다.**

## 인증

액세스 토큰을 **서브프로토콜**로 싣는다 — 브라우저 제약 때문에 서버가 이미 그렇게 받고 있고
(`live.ts` 머리주석 · §P0-2 연장), 여기서 `Authorization` 헤더를 쓰면 **서버 검증 경로가 둘**이
된다. 전송이 달라도 서버가 보는 형태는 같아야 한다.

## keep-alive 는 **값을 프런트에서 받는다**

서버 DO 는 클라가 보내는 `"ping"` 에 `"pong"` 으로 답하는 형태라(`server/src/syncHub.ts:96`)
keep-alive 가 **클라 주도**다. 그 주기를 여기 상수로 박으면 폰과 PC 가 서로 다른 간격으로 살아
있게 되므로, 값은 `live.ts` 의 `PING_MS` 를 **인자로 받는다** — 타이머를 도는 것은 전송 계층의
일이고, 얼마나 자주인가는 정책이다. 이 파일이 정책을 갖지 않는다는 위 규율의 연장이다.

## 방어

- **`cloud::is_allowed` 를 그대로 쓴다**(https/wss 강제 · 루프백 평문만 예외). 판정을 새로 쓰면
  HTTP 중계와 WS 중계의 허용 범위가 조용히 갈린다.
- **한 번에 하나만.** 두 번째 열기는 앞의 것을 닫는다 — 프런트가 재연결을 소유하므로 실수로
  겹치면 소켓이 누적되고, 그건 서버 쪽 DO 연결 수로 나타난다.
- **프레임 크기 상한.** poke 는 `"poke"` 한 단어다. 서버가 큰 것을 보내면 그건 계약 위반이고,
  버퍼링하기 전에 끊는다(`cloud.rs` 의 `MAX_BYTES` 와 같은 규율 · 훨씬 작은 상한).
*/

use futures_util::{SinkExt, StreamExt};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::Message;

/// 프런트가 듣는 이벤트 이름. 페이로드는 [`LiveEvent`].
pub const LIVE_EVENT: &str = "cloud-live";

/// poke 프레임은 한 단어다 — 이보다 크면 계약 위반이므로 읽지 않고 끊는다.
const MAX_FRAME: usize = 256;

/// 서버가 보내는 "변경 있음" 프레임. `live.ts` 와 **같은 문자열**이어야 한다.
const POKE: &str = "poke";

/// 지금 살아 있는 연결의 취소 신호. `None` 이면 연결 없음.
static CURRENT: Mutex<Option<tokio::sync::oneshot::Sender<()>>> = Mutex::new(None);

#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LiveEvent {
    /// 붙었다. 프런트의 "안정 연결" 시계가 여기서 시작한다.
    Open,
    /// 변경 있음 — 프런트가 pull 을 돌린다.
    Poke,
    /// 끊겼다. `reason` 은 사람이 읽을 사유(프런트가 영구 실패 판별에 쓴다).
    Close { reason: String },
}

/// ws/wss URL 을 허용 판정에 태우기 위해 http/https 로 되돌린다.
///
/// ⚠ 스킴만 바꿔 [`cloud::is_allowed`] 에 넘기는 것이 요점이다 — 허용 규칙(호스트 루프백 예외
/// 포함)을 여기서 다시 쓰면 두 중계의 범위가 갈린다. 순수 함수라 테스트로 잠근다.
pub fn ws_to_http(url: &str) -> Option<String> {
    if let Some(rest) = url.strip_prefix("wss://") {
        Some(format!("https://{rest}"))
    } else if let Some(rest) = url.strip_prefix("ws://") {
        Some(format!("http://{rest}"))
    } else {
        None
    }
}

/// URL 이 이 소켓으로 나가도 되는가 — HTTP 중계와 **같은 판정**을 쓴다.
pub fn is_allowed_ws(url: &str) -> bool {
    ws_to_http(url).is_some_and(|u| crate::cloud::is_allowed(&u))
}

/// 지금 열려 있는 연결을 닫는다(있으면). 되돌림값은 "닫을 것이 있었나".
fn take_current() -> bool {
    let prev = CURRENT.lock().ok().and_then(|mut g| g.take());
    match prev {
        Some(tx) => {
            let _ = tx.send(()); // 수신측이 이미 죽었어도 무해하다
            true
        }
        None => false,
    }
}

/**
실시간 소켓을 연다. **한 번만 시도한다** — 재시도는 프런트의 몫이다(머리주석).

즉시 돌아오고, 결과는 [`LIVE_EVENT`] 이벤트로 온다. 열기 자체가 실패하면 `Close { reason }` 이
한 번 나간다(`Open` 없이) — 프런트에서 "못 붙었다"와 "붙었다 끊겼다"가 같은 경로로 다뤄지게 하기
위해서다. 그 둘을 가르는 것은 `Open` 을 봤는가이고, 그건 프런트가 이미 하는 판정이다.
*/
#[tauri::command]
pub async fn cloud_live_open(
    app: tauri::AppHandle,
    url: String,
    token: String,
    ping_ms: u64,
) -> Result<(), String> {
    if !is_allowed_ws(&url) {
        return Err(format!("허용되지 않은 주소: {url}"));
    }
    take_current(); // 겹침 금지 — 앞의 것을 먼저 닫는다
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Ok(mut g) = CURRENT.lock() {
        *g = Some(tx);
    }
    tauri::async_runtime::spawn(async move {
        let reason = run_socket(&app, &url, &token, ping_ms, rx).await;
        emit(&app, LiveEvent::Close { reason });
    });
    Ok(())
}

/// 실시간 소켓을 끊는다. 프런트가 백오프 재연결을 소유하므로 **여기서 다시 붙지 않는다**.
#[tauri::command]
pub fn cloud_live_close() {
    take_current();
}

fn emit(app: &tauri::AppHandle, ev: LiveEvent) {
    /* ⚠ 실패를 삼키지 않는다 — `hotkey.rs` 가 세운 규율. 다만 여기서 할 수 있는 일은 로그뿐이다
    (창이 이미 사라졌다면 알릴 대상도 없다). */
    if let Some(w) = app.get_webview_window("main") {
        if let Err(e) = w.emit(LIVE_EVENT, ev) {
            log::warn!("cloud-live emit 실패: {e}");
        }
    }
}

/// 연결 한 번의 수명. 끝난 사유를 문자열로 돌려준다(정상 종료 포함).
async fn run_socket(
    app: &tauri::AppHandle,
    url: &str,
    token: &str,
    ping_ms: u64,
    mut cancel: tokio::sync::oneshot::Receiver<()>,
) -> String {
    /* 서브프로토콜로 토큰을 싣는다 — 브라우저 경로와 **같은 형태**여야 서버 검증이 하나다. */
    let mut req = match url.into_client_request() {
        Ok(r) => r,
        Err(e) => return format!("주소 오류: {e}"),
    };
    let Ok(proto) = HeaderValue::from_str(token) else {
        return "토큰에 헤더로 실을 수 없는 문자가 있어요".into();
    };
    req.headers_mut().insert("Sec-WebSocket-Protocol", proto);

    let (mut ws, _res) = match tokio_tungstenite::connect_async(req).await {
        Ok(v) => v,
        Err(e) => return format!("연결 실패: {e}"),
    };
    emit(app, LiveEvent::Open);

    /* keep-alive — 주기는 프런트가 준 값이다(머리주석). 0 이면 안 보낸다(테스트·서버가 자기 쪽에서
    챙기는 구성). ⚠ 첫 tick 은 즉시 오므로 한 번 흘린다 — 붙자마자 ping 을 쏠 이유가 없다. */
    let mut ping = tokio::time::interval(std::time::Duration::from_millis(ping_ms.max(1)));
    ping.tick().await;

    loop {
        tokio::select! {
            _ = &mut cancel => return "닫음".into(),
            _ = ping.tick(), if ping_ms > 0 => {
                /* 서버 DO 는 클라 주도 keep-alive 를 기대한다(`syncHub.ts` 가 'ping'→'pong').
                브라우저 경로와 **같은 문자열**이라 서버가 전송을 구분할 필요가 없다. */
                if ws.send(Message::Text("ping".into())).await.is_err() {
                    return "keep-alive 전송 실패".into();
                }
            }
            msg = ws.next() => match msg {
                None => return "서버가 연결을 닫았어요".into(),
                Some(Err(e)) => return format!("연결 오류: {e}"),
                Some(Ok(Message::Close(_))) => return "서버가 연결을 닫았어요".into(),
                Some(Ok(Message::Ping(p))) => {
                    // 라이브러리가 자동 응답하지 않는 구성이라 직접 돌려준다(유휴 연결 유지).
                    if ws.send(Message::Pong(p)).await.is_err() {
                        return "pong 전송 실패".into();
                    }
                }
                Some(Ok(Message::Text(t))) => {
                    if t.len() > MAX_FRAME {
                        return "서버 프레임이 계약보다 큽니다".into();
                    }
                    if t == POKE {
                        emit(app, LiveEvent::Poke);
                    }
                }
                // 바이너리·Pong·Frame 은 이 채널의 계약에 없다 — 무시하되 끊지는 않는다
                // (서버가 keep-alive 로 무엇을 보내든 실시간성이 깨질 이유는 없다).
                Some(Ok(_)) => {}
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /* ⚠ 여기서 잠그는 것은 **허용 판정이 HTTP 중계와 갈리지 않는다**는 것 하나다. 소켓 수명은
    실물이 필요하고(트랙 B·실 워커), 순수하게 뗄 수 있는 부분은 URL 변환뿐이다 —
    `testkit` 의 규율대로 "잴 수 있는 것만 재고, 못 재는 것은 조용히 통과시키지 않는다". */

    #[test]
    fn ws_스킴만_되돌린다() {
        assert_eq!(ws_to_http("wss://x.dev/api/sync/live").as_deref(), Some("https://x.dev/api/sync/live"));
        assert_eq!(ws_to_http("ws://localhost:8787/l").as_deref(), Some("http://localhost:8787/l"));
        // ws/wss 가 아니면 이 채널의 주소가 아니다 — http 를 그대로 통과시키면 안 된다.
        assert_eq!(ws_to_http("https://x.dev"), None);
        assert_eq!(ws_to_http("file:///etc/passwd"), None);
    }

    #[test]
    fn 허용_판정이_http_중계와_같다() {
        assert!(is_allowed_ws("wss://hub.example.workers.dev/api/sync/live"));
        // 평문은 루프백만 — cloud.rs 의 규칙을 그대로 물려받는다.
        assert!(is_allowed_ws("ws://localhost:8787/api/sync/live"));
        assert!(is_allowed_ws("ws://127.0.0.1:8787/api/sync/live"));
        assert!(!is_allowed_ws("ws://evil.example.com/api/sync/live"));
        assert!(!is_allowed_ws("wss://"));
    }

    #[test]
    fn 닫을_것이_없으면_false() {
        // 전역 상태를 쓰는 유일한 관측점 — "없는데 닫았다"고 보고하지 않는다.
        take_current();
        assert!(!take_current());
    }
}
