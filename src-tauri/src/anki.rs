/*! AnkiConnect 중계 — 4단계-F. `web/src/lib/anki.ts:42` 의 `fetch('http://localhost:8765')` 대체.

AnkiConnect 는 **브라우저 요청의 `Origin` 을 검사**한다(기본 화이트리스트 `http://localhost`).
셸의 오리진은 `http://tauri.localhost` 라(실측) 그 목록에 없다 → 브라우저에서 직접 부르면 막힌다.
Rust 에서 부르면 `Origin` 헤더가 붙지 않고, AnkiConnect 는 오리진이 없는 요청(비-브라우저 클라이언트)을
허용하므로 통한다.

⚠ **이 예측은 아직 실측으로 확인하지 못했다.** 프로브를 돌린 시점에 Anki 가 꺼져 있어
브라우저에서도 `Failed to fetch` 가 났는데, 그건 CORS 거부와 연결 거부가 **같은 오류로 보이기**
때문에 둘을 구분할 수 없다(브라우저는 의도적으로 이 둘을 구분해 주지 않는다).
근거는 AnkiConnect 의 문서화된 동작이지 이 기계에서의 관측이 아니다 — 트랙 B 케이스가 Anki 가
떠 있을 때만 돌도록 해 두었으니, 다음에 Anki 를 켠 채 게이트를 돌리면 그때 확정된다.
*/
use std::time::Duration;

/// AnkiConnect 액션 1건을 중계한다. **액션 이름과 파라미터는 프런트가 정한다** —
/// serve.js 시절에도 이 경로는 프록시가 아니라 브라우저 직통이었으므로 화이트리스트가 없었고,
/// 대상이 `127.0.0.1:8765` 로 고정이라 SSRF 표면도 없다(URL 을 인자로 받지 않는다).
#[tauri::command]
pub async fn anki_connect(action: String, params: serde_json::Value) -> serde_json::Value {
    let payload = serde_json::json!({ "action": action, "version": 6, "params": params });
    let client = match reqwest::Client::builder()
        // anki.ts:39-40 의 3초 AbortController 를 승계 — Anki 가 꺼져 있을 때
        // 사용자를 오래 기다리게 하지 않는다(연동 탭이 매번 이 경로를 탄다).
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "error": e.to_string() }),
    };
    match client
        .post("http://127.0.0.1:8765")
        .json(&payload)
        .send()
        .await
    {
        Ok(r) => match r.json::<serde_json::Value>().await {
            Ok(v) => v,
            Err(e) => serde_json::json!({ "error": format!("Anki 응답 파싱 실패: {e}") }),
        },
        // 형태를 AnkiConnect 의 실패 응답과 맞춘다(`{result, error}`) — 호출부가 이미 그 모양을 읽는다.
        Err(e) => serde_json::json!({ "error": format!("Anki 연결 실패 — 켜져 있나요? ({e})") }),
    }
}
