/*! 클라우드 HTTP 중계 — C-5 후속(전송 경로 교정).

## 왜 웹뷰가 직접 `fetch` 하지 않는가

C-5 가 처음엔 `lib/cloud/client.ts` 에서 생 `fetch` 로 워커를 불렀다. **셸에선 동작하지
않았다** — C-3 이 CSP 를 `connect-src 'self' ipc:` 로 잠갔기 때문이다. 트랙 A(Chromium,
CSP 없음)도 트랙 B(클라우드 경로 미주행)도 못 잡았고, 트랙 B 로 실측해서야 나왔다:

```text
violations: ["connect-src :: https://cloudflare.com/cdn-cgi/trace"]
```

CSP 를 푸는 대신 요청을 Rust 로 내린 이유는 **이 앱의 기존 규약이 그것**이기 때문이다 —
뉴스·Ollama·Anki 가 전부 Rust 중계이고, 그래서 CLAUDE.md 가 "셸에서 외부로 나가는 연결이
하나도 없다"고 적을 수 있었다. 예외를 하나 남기면 다음 사람이 그걸 선례로 삼는다.

부수 효과 둘: **CORS 가 데스크톱에선 통째로 사라진다**(브라우저가 아니라 `Origin` 이 없다).
그리고 CSP 를 한 글자도 안 푼다.

⚠ **폰(C-6)은 진짜 브라우저라 그대로 `fetch` 를 쓴다.** 전송 분기는 `client.ts` 안에 있고,
그건 `api.ts` 가 이미 하는 방식이다.

## 방어

- **https 강제.** 예외는 루프백뿐이다(`wrangler dev` 로컬 루프). 평문으로 토큰이 나가는
  경로를 만들지 않는다 — 런북 §7-3 의 평문 폴백 검증이 요구하는 것과 같은 속성.
- **리다이렉트 추적 금지.** reqwest 기본은 최대 10회 따라가는데, 그러면 서버가 준 3xx 하나로
  `Authorization` 헤더가 **다른 호스트로 실려 간다**. 이 커맨드는 `Bearer` 토큰을 나르므로
  기본값을 그대로 두면 자격증명 유출 경로가 된다.
- **응답 크기 상한.** 서버가 무한 스트림을 주면 웹뷰로 올리기 전에 메모리가 터진다.
  ⚠⚠ **그 약속이 지켜지지 않고 있었다(H17 · 2026-08-01).** 구현은 `res.bytes().await` 로
  **전부 버퍼링한 뒤** 길이를 봤다 — 즉 무한 스트림이면 **OOM 이 검사보다 먼저** 난다.
  상한의 목적이 자원 보호인데 방어가 그 자원을 먼저 다 쓰는 형태였다. 지금은 청크를 세다
  넘는 순간 응답을 **버리고** 끝낸다(정상 응답은 읽는 바이트가 종전과 같다).
  같은 형태의 옳은 구현이 `server/src/index.ts` 의 본문 계량(M2)에 이미 있었다.
*/
use serde::Serialize;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

/// pull 응답이 이보다 크면 계약 위반이다(서버가 커서 페이지네이션으로 자른다 — 런북 §8-2).
const MAX_BYTES: usize = 8 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Serialize)]
pub struct CloudResponse {
    pub status: u16,
    /// 본문은 문자열 그대로 올린다 — 파싱·검증은 프런트의 `cloud/schema.ts` 가 소유한다.
    /// 여기서 JSON 으로 풀면 검증 경계가 둘로 갈린다.
    pub body: String,
}

/// URL 이 이 중계로 나가도 되는지 판정한다. 순수 함수라 테스트로 잠근다.
pub fn is_allowed(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else {
        return false;
    };
    let scheme_ok = match u.scheme() {
        "https" => true,
        // 루프백 평문만 허용 — `wrangler dev` 를 로컬에서 칠 때 필요하다.
        "http" => matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        _ => false,
    };
    scheme_ok && is_allowed_path(u.path())
}

/* ⚠⚠ **경로·메서드·헤더를 좁힌다(M-5 · 2026-08-06 감사).**

종전 판정은 스킴 하나였다 — 즉 이 커맨드는 **임의의 https 주소로 임의의 메서드와 임의의
헤더를 보내는 범용 HTTP 클라이언트**였고, CSP 밖에 있다(그게 존재 이유다). 오늘 그것을
악용할 경로는 없지만(웹뷰가 원격 콘텐츠를 안 싣는다), 이 커맨드의 성질은 "웹뷰가 못 하게
막아 둔 일을 대신 해 주는 창"이라 **창의 폭 자체가 위험의 크기**다.

호스트로 못 좁히는 이유는 등록(onboarding)이다 — 사용자가 주소를 **처음 입력하는 순간**이
그 호스트를 아는 유일한 시점이고, 그 전에 핀을 걸 근거가 없다. 그래서 호스트 대신 **모양**을
좁힌다: 이 앱이 실제로 쓰는 것은 `/api/…` 뿐이고(등록·토큰·기기·동기화·텔레메트리 전부),
메서드는 GET·POST, 헤더는 `authorization`·`content-type` 둘이다. 그 밖은 정당한 용도가 없다.

⚠ **화이트리스트가 아니라 블랙리스트로 쓰지 말 것.** 새 헤더가 필요해지면 여기 추가하는 것이
맞다 — 목록이 짧다는 사실이 곧 이 창이 좁다는 증거이고, 조용히 넓히면 그 증거가 사라진다. */
fn is_allowed_path(path: &str) -> bool {
    path == "/api" || path.starts_with("/api/")
}

/// 이 중계가 나르는 메서드. 프런트가 쓰는 것은 이 둘뿐이다(`cloud/client.ts`).
fn is_allowed_method(m: &str) -> bool {
    matches!(m.to_ascii_uppercase().as_str(), "GET" | "POST")
}

/// 이 중계가 나르는 헤더. `Authorization`(Bearer)·`Content-Type` 외엔 정당한 용도가 없다.
fn is_allowed_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "authorization" | "content-type"
    )
}

/// 공용 HTTP 클라이언트(M3) — **한 번 만들어 재사용**한다.
///
/// ⚠ 종전엔 요청마다 `Client::builder().build()` 했다. `reqwest::Client` 는 커넥션 풀과
/// TLS 세션 캐시를 **자기 안에** 들고 있어서, 매번 새로 만들면 그 둘이 매번 버려진다 —
/// 동기화는 push/pull 로 짧은 요청을 반복하는 패턴이라 **매 요청이 새 TLS 핸드셰이크**가 된다.
/// 기능은 같고 비용만 붙는 형태였다.
/// ⚠ 설정(타임아웃·리다이렉트 금지)은 그대로다. 리다이렉트 금지는 보안 계약이라(위 머리주석)
/// 공용화하면서도 절대 풀지 않는다.
fn shared_client() -> Result<&'static reqwest::Client, String> {
    static C: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(TIMEOUT)
            // ⚠ 3xx 를 따라가면 Authorization 이 다른 호스트로 샌다. 위 머리주석 참조.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())
    })
    .as_ref()
    .map_err(|e| e.clone())
}

#[tauri::command]
pub async fn cloud_http(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<CloudResponse, String> {
    if !is_allowed(&url) {
        return Err(format!(
            "허용되지 않는 주소입니다(https + `/api/…` 만 가능): {url}"
        ));
    }
    if !is_allowed_method(&method) {
        return Err(format!("허용되지 않는 메서드: {method}"));
    }

    let client = shared_client()?;

    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("알 수 없는 메서드: {method}"))?;
    let mut req = client.request(m, &url);
    for (k, v) in headers {
        /* ⚠ 모르는 헤더는 **조용히 버리지 않고 거절한다**(M-5). 버리면 호출부는 보냈다고 믿고
        서버는 못 받아 — 그 어긋남은 인증 헤더에서 특히 나쁘게 끝난다(401 을 네트워크 문제로
        읽는다). 좁히는 것과 삼키는 것은 다른 일이다. */
        if !is_allowed_header(&k) {
            return Err(format!("허용되지 않는 헤더: {k}"));
        }
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let bytes = read_capped(res, MAX_BYTES).await?;
    Ok(CloudResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// 응답 본문을 **상한까지만** 읽는다. 넘으면 그 자리에서 스트림을 버리고 오류(H17).
///
/// ⚠ `bytes()` 를 쓰면 안 되는 이유가 이 함수의 존재 이유다 — 그건 전량을 먼저 메모리에
/// 올린다. 여기서는 청크를 누적하다 상한을 넘는 순간 `res` 를 drop 해 연결을 끊는다.
///
/// ⚠ 상한을 **인자로 받는다.** 호출부마다 정당한 값이 다르다(클라우드 pull 8MB vs 뉴스 RSS
/// 800KB) — 한 상수로 묶으면 둘 중 하나는 반드시 헐거워진다. 공유하는 것은 *읽는 방식*이다.
pub(crate) async fn read_capped(res: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;
    let mut out: Vec<u8> = Vec::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let c = chunk.map_err(|e| e.to_string())?;
        if out.len() + c.len() > max {
            // ⚠ drop 이 곧 취소다 — 남은 바이트를 받지 않는다(그게 이 방어의 전부다).
            return Err(format!("응답이 너무 큽니다(상한 {max} bytes)"));
        }
        out.extend_from_slice(&c);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_는_허용한다() {
        assert!(is_allowed("https://hub.example.workers.dev/api/health"));
    }

    #[test]
    fn 평문_원격은_막는다() {
        // 토큰을 나르는 중계다 — 평문 원격이 열리면 P0-1 이 무너진다.
        assert!(!is_allowed("http://hub.example.workers.dev/api/health"));
    }

    #[test]
    fn 루프백_평문만_예외다() {
        assert!(is_allowed("http://localhost:8787/api/health"));
        assert!(is_allowed("http://127.0.0.1:8787/api/health"));
        // 겉보기만 루프백인 호스트에 속지 않는다.
        assert!(!is_allowed("http://localhost.evil.com/api/health"));
    }

    #[test]
    fn 다른_스킴은_전부_막는다() {
        assert!(!is_allowed("file:///C:/secrets.txt"));
        assert!(!is_allowed("ftp://example.com/x"));
        assert!(!is_allowed("주소가 아님"));
    }

    /* ── M-5: 창의 폭 ─────────────────────────────────────────────────────
    이 커맨드는 CSP 밖에 있다(그게 존재 이유다) → **폭 자체가 위험의 크기**다. 호스트로는
    못 좁히므로(등록 전에는 아는 주소가 없다) 모양으로 좁혔고, 아래가 그 계약이다. */

    #[test]
    fn api_밖_경로는_막는다() {
        // 이 앱이 이 중계로 부르는 것은 `/api/**` 뿐이다(등록·토큰·기기·동기화·텔레메트리).
        assert!(is_allowed(
            "https://hub.example.workers.dev/api/sync/pull?since=0"
        ));
        assert!(!is_allowed("https://evil.example.com/collect"));
        assert!(!is_allowed("https://hub.example.workers.dev/"));
        // 접두사 비교가 경계를 지킨다 — `/apiary` 는 `/api` 가 아니다.
        assert!(!is_allowed("https://hub.example.workers.dev/apiary"));
    }

    #[test]
    fn 메서드는_둘뿐이다() {
        assert!(is_allowed_method("GET"));
        assert!(is_allowed_method("post")); // 대소문자는 안 따진다
        assert!(!is_allowed_method("PUT"));
        assert!(!is_allowed_method("DELETE"));
    }

    #[test]
    fn 헤더는_둘뿐이다() {
        assert!(is_allowed_header("Authorization"));
        assert!(is_allowed_header("content-type"));
        // 쿠키·프록시 지시·임의 헤더를 이 창으로 실어 보내지 않는다.
        assert!(!is_allowed_header("Cookie"));
        assert!(!is_allowed_header("X-Forwarded-For"));
    }
}
