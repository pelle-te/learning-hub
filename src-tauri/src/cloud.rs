/*! 클라우드 HTTP 중계 — C-5 후속(전송 경로 교정).

## 왜 웹뷰가 직접 `fetch` 하지 않는가

C-5 가 처음엔 `lib/cloud/client.ts` 에서 생 `fetch` 로 워커를 불렀다. **셸에선 동작하지
않았다** — C-3 이 CSP 를 `connect-src 'self' ipc:` 로 잠갔기 때문이다. 트랙 A(Chromium,
CSP 없음)도 트랙 B(클라우드 경로 미주행)도 못 잡았고, 트랙 B 로 실측해서야 나왔다:

```
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
*/
use serde::Serialize;
use std::collections::HashMap;
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
    match u.scheme() {
        "https" => true,
        // 루프백 평문만 허용 — `wrangler dev` 를 로컬에서 칠 때 필요하다.
        "http" => matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        _ => false,
    }
}

#[tauri::command]
pub async fn cloud_http(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<CloudResponse, String> {
    if !is_allowed(&url) {
        return Err(format!("허용되지 않는 주소입니다(https 만 가능): {url}"));
    }

    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        // ⚠ 3xx 를 따라가면 Authorization 이 다른 호스트로 샌다. 위 머리주석 참조.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("알 수 없는 메서드: {method}"))?;
    let mut req = client.request(m, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err(format!("응답이 너무 큽니다({} bytes)", bytes.len()));
    }
    Ok(CloudResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
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
}
