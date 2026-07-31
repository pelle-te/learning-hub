/*! 로컬 Ollama 프록시 — 4단계-E. `serve.js` L275-504 · L684-717 대체.

라우트 5종(읽을거리 코치·어휘 · 증시 브리핑 · 주간 회고 · 임베딩)을 옮긴다.
**이 서버는 원문을 요약/재작성하지 않는다** — 코치는 내가 쓴 요약을 원문과 대조해 채점하고,
어휘는 단어 뜻만 준다(serve.js L276 의 원칙을 그대로 승계).

## 스트리밍을 `Channel` 로 옮긴 이유

serve.js 는 NDJSON 을 HTTP 응답으로 중계했다(`{d:"…"}` 줄 → 마지막 `{done:true,…}` 줄).
IPC 엔 그런 응답 스트림이 없어서 **Tauri `ipc::Channel`** 로 델타를 보내고, **최종 결과는
커맨드의 반환값**으로 준다. 이 배치가 `api.ts` 의 기존 계약과 정확히 겹친다 —
`postStream` 이 하던 일이 "델타마다 `onDelta`, 끝나면 `T` 반환"이라, 소비 3곳
(`ArticlePractice`·`Markets`·`Review`)과 `previewFromJsonStream` 이 한 줄도 안 바뀐다.
그게 4-E 의 판정 기준이었다.

## 실패를 던지지 않고 봉투에 담는다

`{ok:false, error}` 를 **값으로** 돌려준다(serve.js 가 200 + `ok:false` 로 하던 것).
소비처가 `.ok` 로 분기하고 있어서, 여기서 throw 로 바꾸면 그 분기가 전부 죽고 사용자에겐
"눌렀는데 아무 일도 안 일어남"이 된다(4-D 에서 같은 함정을 봉투 되싸기로 막았다).
*/
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
// ⚠ `Channel<T>` 자체는 `Deserialize` 가 아니라 `CommandArg` 로 직접 구현돼 있어
//    **`Option<Channel<_>>` 으로는 못 받는다**(Option 의 CommandArg 가 Deserialize 를 거친다).
//    Tauri 가 그 경우를 위해 둔 게 `JavaScriptChannelId` 다 — 이건 Deserialize 라 Option 에 들어가고,
//    `channel_on(webview)` 로 실제 채널이 된다. 스트리밍/단발을 한 커맨드로 합치려면 이 우회가 필요하다.
use tauri::ipc::{Channel, JavaScriptChannelId};

use crate::tools::Cap;

/// 생성 4종이 공유하는 동시 캡(serve.js `MAX_OLLAMA = 2`). 8B 생성이 쌓이는 것을 막는다.
static CHAT_CAP: Cap = Cap::new(2);
/// 임베딩은 동시 1개(serve.js `EMBED_RUNNING >= 1`).
static EMBED_CAP: Cap = Cap::new(1);
/// 스트림 무소식 타임아웃 — **총 시간이 아니라 유휴**로 잰다(콜드 로드·긴 생성에도 안전).
const IDLE_TIMEOUT: Duration = Duration::from_secs(90);
/// 단발 생성/임베딩의 전체 타임아웃(serve.js L323·L399).
const CHAT_TIMEOUT: Duration = Duration::from_secs(120);
const EMBED_TIMEOUT: Duration = Duration::from_secs(60);

fn base_url() -> String {
    std::env::var("OLLAMA_BASE_URL").unwrap_or_else(|_| "http://localhost:11434".into())
}
fn chat_model() -> String {
    std::env::var("READS_OLLAMA_MODEL").unwrap_or_else(|_| "qwen3:8b".into())
}
fn markets_model() -> String {
    std::env::var("MARKETS_OLLAMA_MODEL").unwrap_or_else(|_| chat_model())
}
fn embed_model() -> String {
    std::env::var("OLLAMA_EMBED_MODEL").unwrap_or_else(|_| "bge-m3".into())
}

/* ── 모델 출력 파싱(순수) ──────────────────────────────────────── */

/// `<think>…</think>` 구간 제거. serve.js 의 `/<think>[\s\S]*?<\/think>/g` 와 같은 **비탐욕** 동작을
/// 손으로 쓴다(정규식 크레이트를 하나 들이는 대신 — 여는/닫는 태그 짝만 찾으면 되는 일이다).
fn strip_think(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(open) = rest.find("<think>") {
        out.push_str(&rest[..open]);
        match rest[open..].find("</think>") {
            Some(close) => rest = &rest[open + close + "</think>".len()..],
            // 닫는 태그가 없으면 열린 지점부터 통째로 버린다(잘린 사고 출력).
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// 모델이 뱉은 텍스트에서 JSON 객체를 꺼낸다.
/// serve.js `parseModelJSON`(L280-284)과 같은 순서: think 제거 → 첫 `{` ~ 마지막 `}` → 파싱.
/// 파싱 실패는 `None`(호출자가 '응답 파싱 실패'로 처리) · 객체가 아예 없으면 `{raw}` 로 감싼다.
pub fn parse_model_json(content: &str) -> Option<Value> {
    let cleaned = strip_think(content);
    let (Some(a), Some(b)) = (cleaned.find('{'), cleaned.rfind('}')) else {
        return Some(json!({ "raw": cleaned.trim() }));
    };
    if b < a {
        return Some(json!({ "raw": cleaned.trim() }));
    }
    serde_json::from_str::<Value>(&cleaned[a..=b]).ok()
}

/* ── 프롬프트 빌더 4종 ─────────────────────────────────────────── */

pub struct Spec {
    pub prompt: String,
    pub model: String,
    /// 최종 객체를 감쌀 키(`feedback`|`vocab`|`brief`|`coach`) — serve.js `wrap` 의 자리.
    wrap_key: &'static str,
    /// 코치·어휘만 `lang` 을 함께 돌려준다(serve.js 와 동일).
    lang: Option<String>,
}

impl Spec {
    /// serve.js 의 `wrap(obj)` — 라우트마다 다른 봉투를 만든다.
    pub fn wrap(&self, obj: Value) -> Value {
        let mut out = json!({ "ok": true });
        if let Some(l) = &self.lang {
            out["lang"] = json!(l);
        }
        out[self.wrap_key] = obj;
        out
    }
}

fn s(body: &Value, key: &str, max: usize) -> String {
    body.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

fn lang_of(body: &Value) -> String {
    if body.get("lang").and_then(Value::as_str) == Some("en") {
        "en".into()
    } else {
        "ko".into()
    }
}

/// 내 요약 채점 — 원문과 대조. 원문은 참조만, 새 요약을 대신 쓰지 않는다.
fn build_coach(body: &Value) -> Result<Spec, String> {
    let summary = s(body, "summary", 8000);
    let source = s(body, "source", 6000);
    let lang = lang_of(body);
    if summary.is_empty() {
        return Err("내 요약이 비어 있어요.".into());
    }
    if source.is_empty() {
        return Err("원문이 없어요.".into());
    }
    /* 프롬프트: 스키마를 '값이 든 템플릿'으로 주면 8B 가 그 예시 문자열을 그대로 베낀다 →
    키를 산문으로 설명(값 예시 없이)하고 실제 [원문]/[요약]만 뒤에 붙인다. */
    let prompt = if lang == "ko" {
        format!(
            "너는 국어 선생님이다. 학생이 아래 [원문]을 읽고 [학생요약]을 썼다.\n\
             학생요약이 원문의 핵심을 잘 담았는지 채점해라. 원문을 대신 요약하지 말고 학생요약을 평가만 해라.\n\
             아래 키를 가진 JSON 하나만 한국어로 출력해라(각 항목은 원문과 학생요약의 실제 내용으로 채운다):\n\
             - score: 0~100 정수(핵심 반영도)\n\
             - missing: 원문의 핵심인데 학생요약에 빠진 내용들의 배열\n\
             - redundant: 학생요약에서 불필요하거나 늘어진 부분들의 배열(없으면 [])\n\
             - accuracy: 학생요약에서 사실과 다른 부분들의 배열(없으면 [])\n\
             - model_summary: 원문 내용을 한두 문장으로 요약한 모범답안(문자열)\n\
             - comment: 학생에게 주는 격려 한 문장\n\n\
             [원문]\n{source}\n\n[학생요약]\n{summary}"
        )
    } else {
        format!(
            "You are an English tutor. The student read the [SOURCE] and wrote [NOTES] (comprehension/translation notes).\n\
             Do NOT summarize the source for them. Only evaluate their notes and help them learn.\n\
             Output ONE JSON object with these keys (fill each from the actual SOURCE and NOTES):\n\
             - score: integer 0-100 (comprehension quality)\n\
             - missing: array of key points from the source the student missed\n\
             - corrections: array of misunderstandings/mistranslations to fix (empty [] if none)\n\
             - key_expressions: array of {{\"en\": useful phrase from the source, \"ko\": its Korean meaning}}\n\
             - model_summary: a 1-2 sentence model summary of the SOURCE, in English (string)\n\
             - comment: one encouraging remark in Korean\n\n\
             [SOURCE]\n{source}\n\n[NOTES]\n{summary}"
        )
    };
    Ok(Spec {
        prompt,
        model: chat_model(),
        wrap_key: "feedback",
        lang: Some(lang),
    })
}

/// 어휘 도우미 — 지문에서 고른 단어 하나의 뜻·예문(원문 문맥 반영).
fn build_vocab(body: &Value) -> Result<Spec, String> {
    let word = s(body, "word", 80);
    let context = s(body, "context", 600);
    let lang = lang_of(body);
    if word.is_empty() {
        return Err("단어가 없어요.".into());
    }
    let prompt = if lang == "en" {
        format!(
            "Explain the English word/phrase below to a Korean learner, using the sentence context.\n\
             Output ONE JSON object with keys: word(the word), pos(품사 in Korean), \
             meaning(문맥에 맞는 한국어 뜻), example(a natural English example sentence), example_ko(그 예문의 한국어 해석).\n\n\
             WORD: {word}\nCONTEXT: {context}"
        )
    } else {
        format!(
            "아래 [문맥]에서 단어 \"{word}\"가 쓰인 의미를 국어사전 뜻에 근거해 정확히 설명해라.\n\
             JSON 하나만 출력: 키는 word(그 단어), meaning(문맥에 맞는 뜻), \
             synonyms(그 의미의 유의어 배열), example(그 단어를 같은 의미로 쓴 새 예문 문자열).\n\n\
             단어: {word}\n[문맥]\n{context}"
        )
    };
    Ok(Spec {
        prompt,
        model: chat_model(),
        wrap_key: "vocab",
        lang: Some(lang),
    })
}

/// 증시 브리핑 — 지수 등락 + 뉴스 헤드라인으로 "왜 이렇게 움직였나"를 해설.
/// ⚠ 숫자를 새로 지어내지 않는다(주어진 등락만 사용).
fn build_brief(body: &Value) -> Result<Spec, String> {
    let empty = vec![];
    let indices = body
        .get("indices")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let headlines = body
        .get("headlines")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    if indices.is_empty() && headlines.is_empty() {
        return Err("브리핑할 데이터가 없어요 — 먼저 수집하세요.".into());
    }
    let idx_lines = indices
        .iter()
        .take(20)
        .map(|i| {
            let name: String = i
                .get("name")
                .or_else(|| i.get("symbol"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(30)
                .collect();
            let pct = i
                .get("changePct")
                .and_then(Value::as_f64)
                .unwrap_or(f64::NAN);
            let price = i.get("price").cloned().unwrap_or(Value::Null);
            format!("- {name}: {pct:.2}% ({price})")
        })
        .collect::<Vec<_>>()
        .join("\n");
    let news_lines = headlines
        .iter()
        .take(25)
        .enumerate()
        .map(|(n, h)| {
            let title: String = h
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(160)
                .collect();
            let src = h.get("source").and_then(Value::as_str).map(|x| {
                let t: String = x.chars().take(20).collect();
                format!(" [{t}]")
            });
            format!("{}. {title}{}", n + 1, src.unwrap_or_default())
        })
        .collect::<Vec<_>>()
        .join("\n");
    let idx_block = if idx_lines.is_empty() {
        "(지수 데이터 없음)"
    } else {
        &idx_lines
    };
    let news_block = if news_lines.is_empty() {
        "(뉴스 없음)"
    } else {
        &news_lines
    };
    let prompt = format!(
        "너는 금융시장 브리핑 애널리스트다. 아래 [지수]의 오늘 등락과 [뉴스] 헤드라인이 주어진다.\n\
         주어진 숫자만 사용하고 새 수치를 지어내지 마라. 뉴스와 지수 움직임을 연결해 \"오늘 왜 이렇게 움직였나\"를 한국어로 해설해라.\n\
         아래 키를 가진 JSON 하나만 출력해라(실제 [지수]/[뉴스] 내용으로 채운다):\n\
         - overview: 오늘 시장을 2~3문장으로 요약(문자열)\n\
         - drivers: 오늘 움직임의 동인 배열, 각 항목은 {{\"title\": 짧은 제목, \"detail\": 한두 문장 설명}}\n\
         - watch: 앞으로 지켜볼 포인트들의 배열(문자열 배열)\n\
         - caveat: 이 해설은 지연·요약 데이터 기반 참고용이라는 한 문장 경고\n\n\
         [지수]\n{idx_block}\n\n[뉴스]\n{news_block}"
    );
    Ok(Spec {
        prompt,
        model: markets_model(),
        wrap_key: "brief",
        lang: None,
    })
}

/// 주간 회고 코치 — 앱이 이미 계산한 결정적 인사이트를 받아 '다음 주에 무엇을 바꿀지'를 구체화.
fn build_review(body: &Value) -> Result<Spec, String> {
    let take = |key: &str, n: usize, len: usize| -> Vec<String> {
        body.get(key)
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .take(n)
                    .map(|v| {
                        let t = v
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| v.to_string());
                        t.chars().take(len).collect::<String>()
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let facts = take("facts", 20, 300);
    let weak = take("weakSpots", 8, 120);
    if facts.is_empty() && weak.is_empty() {
        return Err("회고할 데이터가 없어요 — 이번 주 기록이 필요해요.".into());
    }
    let f = if facts.is_empty() {
        "(없음)".to_string()
    } else {
        facts.join("\n")
    };
    let w = if weak.is_empty() {
        "(없음)".to_string()
    } else {
        weak.join("\n")
    };
    let prompt = format!(
        "너는 학습 코치다. 아래 [사실]은 이번 주 학습 데이터에서 이미 계산된 관찰이고, [반복약점]은 여러 번 막힌 지점이다.\n\
         주어진 사실만 사용하고 새 수치를 지어내지 마라. 다음 주에 무엇을 어떻게 바꿀지 구체적·실행 가능한 조언을 한국어로 준다.\n\
         아래 키를 가진 JSON 하나만 출력해라:\n\
         - headline: 이번 주를 한 문장으로 요약(문자열)\n\
         - actions: 다음 주 실행 항목 배열(각 항목은 짧고 구체적인 문자열, 2~4개)\n\
         - focus: 가장 먼저 손봐야 할 개념/습관 하나(문자열)\n\
         - encourage: 격려 한 문장(문자열)\n\n\
         [사실]\n{f}\n\n[반복약점]\n{w}"
    );
    Ok(Spec {
        prompt,
        model: chat_model(),
        wrap_key: "coach",
        lang: None,
    })
}

/// serve.js `OLLAMA_ROUTES`(L499-504) — 경로 대신 kind 로 고른다.
pub fn build(kind: &str, body: &Value) -> Result<Spec, String> {
    match kind {
        "reads/coach" => build_coach(body),
        "reads/vocab" => build_vocab(body),
        "markets/brief" => build_brief(body),
        "review/coach" => build_review(body),
        _ => Err(format!("알 수 없는 AI 경로: {kind}")),
    }
}

/* ── 취소 ─────────────────────────────────────────────────────── */

fn canceled() -> &'static Mutex<HashSet<String>> {
    static C: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 프런트의 `AbortSignal` 이 이걸 부른다 — 4-C 에서 "취소가 아직 안 넘어간다"고 미뤄 둔 자리를
/// 여기서 갚는다. 업스트림 연결을 끊으므로 **생성 자체가 멈춘다**(serve.js 의 `res.on('close')` 와 같은 효과).
#[tauri::command]
pub fn ollama_cancel(request_id: String) {
    if let Ok(mut c) = canceled().lock() {
        c.insert(request_id);
    }
}

fn take_canceled(id: &str) -> bool {
    canceled().lock().map(|mut c| c.remove(id)).unwrap_or(false)
}

/// 요청 하나의 취소 표식 수명(M3) — 스트림이 **어떻게 끝나든** Drop 에서 지운다.
///
/// ⚠ 없으면 단조 증가한다: 취소 표식이 들어왔는데 아무도 소비하지 않으면 집합에 영구히 남는다
/// (`take_canceled` 는 실행 중에만 불린다). 앱을 며칠 켜 두는 것이 이 앱의 전제이므로
/// "언젠가 정리된다"가 성립하지 않는다.
///
/// ⚠⚠ **보장 범위를 정확히 적는다(G8 · 2026-07-31 `/감사 근본`).** 옛 주석은 존재 이유로
/// _"정상 종료한 **뒤에** 도착한 cancel"_ 을 들었는데, `Drop` 은 **드롭 시점까지 들어온 것만**
/// 지우므로 정확히 그 케이스는 여전히 남는다(창은 좁다 — 이 값이 드롭되는 순간부터 프런트
/// `lib/tauri.ts` 의 `finally` 가 abort 리스너를 떼기 전까지). 즉 이 RAII 가 닫는 것은
/// **"취소가 스트림보다 먼저·도중에 온 경우"** 이고, 실害는 문자열 1개다.
/// 결정적으로 만들려면 진행 중 `request_id` 집합을 따로 들고 그 안에 있을 때만 insert 해야
/// 한다 — 지금 그렇게 하지 않는 것은 판단이고, 주석이 그 판단을 **넘어서 약속하지 않게** 한다
/// (다음 사람이 "수명은 닫혔다"고 읽으면 그게 곧 다음 결함의 전제가 된다).
/// ⚠ RAII 인 이유는 반환 경로가 많아서다 — 타임아웃·연결 오류·파싱 실패·정상 종료가 각자
/// `return` 하는데, 그 자리마다 정리를 손으로 넣으면 새로 생기는 경로가 조용히 빠진다
/// (`tools.rs` 의 동시성 캡이 같은 이유로 RAII 다).
struct CancelSlot(String);
impl Drop for CancelSlot {
    fn drop(&mut self) {
        if let Ok(mut c) = canceled().lock() {
            c.remove(&self.0);
        }
    }
}

/* ── 실행 ─────────────────────────────────────────────────────── */

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delta {
    pub d: String,
}

fn err_envelope(msg: impl Into<String>) -> Value {
    json!({ "ok": false, "error": msg.into() })
}

fn conn_error(e: &reqwest::Error) -> Value {
    err_envelope(format!("Ollama 연결 실패 — 켜져 있나요? ({e})"))
}

/// 생성 4종. `on_delta` 가 있으면 스트리밍(토큰이 오는 대로 델타 전송), 없으면 단발.
///
/// 반환은 **항상 봉투**다 — 실패도 `{ok:false,error}` 로 준다(위 헤더 참조).
#[tauri::command]
pub async fn ollama_run<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    kind: String,
    body: Value,
    request_id: String,
    on_delta: Option<JavaScriptChannelId>,
) -> Value {
    let on_delta: Option<Channel<Delta>> = on_delta.map(|id| id.channel_on(webview));
    // M3 — 이 요청의 취소 표식은 함수를 벗어나는 순간 사라진다(늦게 온 취소가 영구 잔류하지 않게).
    let _cancel_slot = CancelSlot(request_id.clone());
    let spec = match build(&kind, &body) {
        Ok(s) => s,
        // 입력 검증 실패는 캡을 잡기 **전에** 걸러진다(serve.js L691 과 같은 순서).
        Err(e) => return err_envelope(e),
    };
    let Some(_slot) = CHAT_CAP.try_acquire() else {
        return err_envelope("AI가 이미 처리 중이에요 — 잠시 후 다시.");
    };

    let payload = json!({
        "model": spec.model,
        "messages": [{ "role": "user", "content": spec.prompt }],
        "stream": on_delta.is_some(),
        "format": "json",
        // 사고모드 OFF — 지연↓·JSON 혼동↓(qwen3).
        "think": false,
        "options": { "temperature": 0.3, "num_ctx": 8192 },
    });
    let url = format!("{}/api/chat", base_url().trim_end_matches('/'));
    let client = reqwest::Client::new();

    let Some(chan) = on_delta else {
        // 단발 — 전체 응답을 받고 한 번에 파싱(serve.js `ollamaChat`).
        let sent =
            tokio::time::timeout(CHAT_TIMEOUT, client.post(&url).json(&payload).send()).await;
        let resp = match sent {
            Err(_) => return err_envelope("Ollama 응답 시간 초과"),
            Ok(Err(e)) => return conn_error(&e),
            Ok(Ok(r)) => r,
        };
        let Ok(v) = resp.json::<Value>().await else {
            return err_envelope("Ollama 응답 파싱 실패");
        };
        let content = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("");
        return match parse_model_json(content) {
            Some(obj) => spec.wrap(obj),
            None => err_envelope("Ollama 응답 파싱 실패"),
        };
    };

    // 스트리밍 — NDJSON 을 줄 단위로 갈라 델타를 즉시 보낸다.
    let resp = match client.post(&url).json(&payload).send().await {
        Ok(r) => r,
        Err(e) => return conn_error(&e),
    };
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut full = String::new();
    loop {
        // ⚠ **총 시간이 아니라 유휴 시간**으로 잰다 — 콜드 로드나 긴 생성을 벽시계로 자르면
        //   정상 동작이 실패로 보인다(serve.js 가 120초 벽시계를 걷어내고 무소식 90초로 바꾼 이유).
        let next = match tokio::time::timeout(IDLE_TIMEOUT, stream.next()).await {
            Err(_) => return err_envelope("Ollama 응답 시간 초과(90초 무소식)"),
            Ok(None) => break,
            Ok(Some(Err(e))) => return conn_error(&e),
            Ok(Some(Ok(chunk))) => chunk,
        };
        if take_canceled(&request_id) {
            // stream 을 떨어뜨리면 연결이 끊겨 업스트림 생성도 멈춘다.
            return err_envelope("사용자가 중단했어요.");
        }
        buf.push_str(&String::from_utf8_lossy(&next));
        while let Some(i) = buf.find('\n') {
            let line = buf[..i].to_string();
            buf.drain(..=i);
            if line.trim().is_empty() {
                continue;
            }
            // 불완전한 줄은 조용히 넘긴다(다음 청크에서 완성된다).
            if let Ok(j) = serde_json::from_str::<Value>(&line) {
                let d = j
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if !d.is_empty() {
                    full.push_str(d);
                    let _ = chan.send(Delta { d: d.to_string() });
                }
            }
        }
    }
    match parse_model_json(&full) {
        Some(obj) => spec.wrap(obj),
        None => err_envelope("Ollama 응답 파싱 실패"),
    }
}

/// 임베딩 — 의미 검색·지식맵 자동 연결용. 텍스트만 받아 벡터만 돌려준다
/// (모델·대상 URL 이 고정이라 SSRF 표면이 없다 — serve.js L378 의 근거를 그대로 승계).
#[tauri::command]
pub async fn ollama_embed(texts: Vec<String>) -> Value {
    // 배치 32 × 3,000자 캡(serve.js L708).
    let texts: Vec<String> = texts
        .into_iter()
        .take(32)
        .map(|t| t.chars().take(3000).collect())
        .collect();
    if texts.is_empty() {
        return err_envelope("임베딩할 텍스트가 없어요.");
    }
    let Some(_slot) = EMBED_CAP.try_acquire() else {
        return err_envelope("임베딩이 이미 처리 중이에요 — 잠시 후 다시.");
    };
    let model = embed_model();
    let url = format!("{}/api/embed", base_url().trim_end_matches('/'));
    let payload = json!({ "model": model, "input": texts });

    let sent = tokio::time::timeout(
        EMBED_TIMEOUT,
        reqwest::Client::new().post(&url).json(&payload).send(),
    )
    .await;
    let resp = match sent {
        Err(_) => return err_envelope("임베딩 시간 초과"),
        Ok(Err(e)) => return err_envelope(format!("Ollama 연결 실패 ({e})")),
        Ok(Ok(r)) => r,
    };
    let Ok(v) = resp.json::<Value>().await else {
        return err_envelope("임베딩 응답 파싱 실패");
    };
    match v.get("embeddings") {
        Some(e) if e.is_array() => json!({ "ok": true, "model": model, "vectors": e }),
        _ => {
            let msg: String = v
                .get("error")
                .map(|e| e.to_string())
                .unwrap_or_else(|| "임베딩 응답 형식 오류".into());
            err_envelope(msg.chars().take(200).collect::<String>())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn think_구간을_비탐욕으로_제거한다() {
        // 탐욕이면 두 블록 사이의 본문("가운데")까지 통째로 먹는다.
        let s = "앞<think>사고1</think>가운데<think>사고2</think>뒤";
        assert_eq!(strip_think(s), "앞가운데뒤");
        assert_eq!(strip_think("사고 없음"), "사고 없음");
        // 닫는 태그가 없으면(생성이 잘림) 그 뒤는 버린다 — 사고 원문이 결과로 새면 안 된다.
        assert_eq!(strip_think("앞<think>잘림"), "앞");
    }

    #[test]
    fn 앞뒤_잡소리가_붙어도_json_을_건진다() {
        // 8B 는 JSON 앞뒤에 말을 붙이는 일이 잦다 — 첫 { 부터 마지막 } 까지 집는다.
        let v = parse_model_json("네 결과입니다: {\"score\": 80} 도움이 됐길!").unwrap();
        assert_eq!(v["score"], 80);
    }

    #[test]
    fn think_뒤의_json_을_건진다() {
        let v = parse_model_json("<think>음…{\"가짜\":1}</think>{\"score\":42}").unwrap();
        assert_eq!(v["score"], 42, "사고 구간 안의 JSON 을 집었다");
    }

    #[test]
    fn 객체가_없으면_raw_로_감싼다() {
        let v = parse_model_json("그냥 문장").unwrap();
        assert_eq!(v["raw"], "그냥 문장");
    }

    #[test]
    fn 중괄호는_있는데_파싱이_실패하면_none() {
        /* serve.js `parseModelJSON`(L282-283)의 두 경우를 구분해 잠근다. 헷갈리기 쉬운 자리다:
        정규식 `/\{[\s\S]*\}/` 가 **매치되지 않으면** `{raw}` 로 감싸고(=JSON 을 시도조차 안 함),
        매치됐는데 `JSON.parse` 가 던질 때만 `null` 이다. `null` 만 '응답 파싱 실패'로 올라간다. */
        assert!(
            parse_model_json("{\"a\": }").is_none(),
            "중괄호 짝이 있고 내용이 깨졌다 → 실패"
        );
        // 닫는 중괄호가 없으면 애초에 매치가 안 되므로 실패가 아니라 raw 다.
        assert_eq!(parse_model_json("{\"a\": ").unwrap()["raw"], "{\"a\":");
    }

    /* ── 빌더 — 검증과 봉투 ── */

    #[test]
    fn 코치는_요약과_원문이_둘_다_있어야_한다() {
        assert!(build_coach(&json!({ "source": "원문" })).is_err());
        assert!(build_coach(&json!({ "summary": "요약" })).is_err());
        let spec = build_coach(&json!({ "source": "원문", "summary": "요약" })).unwrap();
        assert!(spec.prompt.contains("[원문]") && spec.prompt.contains("원문"));
    }

    #[test]
    fn 영어_코치는_영어_프롬프트를_쓴다() {
        let spec =
            build_coach(&json!({ "source": "src", "summary": "sum", "lang": "en" })).unwrap();
        assert!(spec.prompt.contains("[SOURCE]"));
        assert_eq!(spec.lang.as_deref(), Some("en"));
    }

    #[test]
    fn 봉투가_라우트마다_다른_키를_쓴다() {
        // 이 키가 틀리면 소비처가 `r.feedback` 을 못 찾아 **에러 없이 빈 화면**이 된다.
        let coach = build_coach(&json!({ "source": "a", "summary": "b" })).unwrap();
        assert_eq!(coach.wrap(json!({"score":1}))["feedback"]["score"], 1);
        assert_eq!(coach.wrap(json!({}))["lang"], "ko");

        let brief =
            build_brief(&json!({ "indices": [{"name":"KOSPI","changePct":1.5,"price":2600}] }))
                .unwrap();
        assert_eq!(
            brief.wrap(json!({"overview":"x"}))["brief"]["overview"],
            "x"
        );
        assert!(
            brief.wrap(json!({})).get("lang").is_none(),
            "브리핑엔 lang 이 없다"
        );

        let review = build_review(&json!({ "facts": ["a"] })).unwrap();
        assert_eq!(
            review.wrap(json!({"headline":"h"}))["coach"]["headline"],
            "h"
        );

        let vocab = build_vocab(&json!({ "word": "apple" })).unwrap();
        assert_eq!(
            vocab.wrap(json!({"meaning":"사과"}))["vocab"]["meaning"],
            "사과"
        );
    }

    #[test]
    fn 브리핑은_등락률을_소수_둘째까지_찍는다() {
        // serve.js `toFixed(2)` 승계 — 자릿수가 흔들리면 모델이 숫자를 재해석한다.
        let spec =
            build_brief(&json!({ "indices": [{"name":"KOSPI","changePct":-1.234,"price":2600}] }))
                .unwrap();
        assert!(
            spec.prompt.contains("- KOSPI: -1.23% (2600)"),
            "{}",
            spec.prompt
        );
    }

    #[test]
    fn 데이터가_없으면_모델을_안_부른다() {
        // 빈 요청으로 8B 를 깨우는 건 순수 낭비 — serve.js 도 여기서 잘랐다.
        assert!(build_brief(&json!({})).is_err());
        assert!(build_review(&json!({})).is_err());
    }

    #[test]
    fn 알_수_없는_kind_는_거부한다() {
        assert!(build("../../etc", &json!({})).is_err());
    }

    #[test]
    fn 긴_입력은_상한에서_잘린다() {
        let long = "가".repeat(20_000);
        let spec = build_coach(&json!({ "source": long.clone(), "summary": long })).unwrap();
        // source 6,000 + summary 8,000 + 안내문 — 원문이 통째로 들어가면 num_ctx 를 넘겨 생성이 죽는다.
        assert!(
            spec.prompt.chars().count() < 16_000,
            "{}",
            spec.prompt.chars().count()
        );
    }
}
