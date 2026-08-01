/*! 진로 지도(atlas) 동향 — 4단계-F. `serve.js` L531-612 · L663-674 대체.

Google 뉴스 RSS 를 라이브 프록시한다. **고정 호스트에 `q` 만 바꿔 붙이므로 SSRF 표면이 없다**
(serve.js L532 의 근거를 그대로 승계). 분야 상세를 열 때 온디맨드로 부르고 5분 캐시가 재호출을
흡수한다. 실패는 빈 목록 → 프런트가 시드 동향으로 우아 폴백.

XML 파싱은 의존성 없이 문자열로 한다 — serve.js 와 같은 판단이다. 이 피드는 구조가 안정적이고,
필요한 필드가 다섯 개뿐이라 XML 파서를 하나 들일 값이 없다.
*/
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const TTL: Duration = Duration::from_secs(5 * 60);
const MAX_ITEMS: usize = 8;
/// 응답 폭주 방어(serve.js L598 의 800KB 상한).
const MAX_BYTES: usize = 800_000;
/// ⚠ serve.js 의 `NEWS_CACHE` 는 **상한이 없었다** — 검색어 종류만큼 무한히 자란다.
/// 실사용에선 분야 수가 유계라 터지지 않았지만, 캐시에 상한이 없는 건 그 자체로 결함이다.
const MAX_CACHE: usize = 64;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NewsItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub source: String,
    pub published: String,
}

struct Entry {
    at: Instant,
    items: Vec<NewsItem>,
}

fn cache() -> &'static Mutex<HashMap<String, Entry>> {
    static C: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/* ── 파싱(순수) ────────────────────────────────────────────────── */

/// XML 엔티티·CDATA·잔여 태그를 벗긴다(serve.js `decodeXML` L538-546).
/// 순서가 중요하다: `&amp;` 를 **맨 마지막**에 풀어야 `&amp;lt;` 가 `<` 로 이중 복호화되지 않는다.
pub fn decode_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    // CDATA 벗기기
    let mut rest = s;
    while let Some(a) = rest.find("<![CDATA[") {
        out.push_str(&rest[..a]);
        let after = &rest[a + 9..];
        match after.find("]]>") {
            Some(b) => {
                out.push_str(&after[..b]);
                rest = &after[b + 3..];
            }
            None => {
                out.push_str(after);
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);

    // 잔여 인라인 태그 제거(설명 HTML 등)
    let mut stripped = String::with_capacity(out.len());
    let mut depth = 0usize;
    for c in out.chars() {
        match c {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => stripped.push(c),
            _ => {}
        }
    }

    // 숫자 참조
    let mut t = decode_numeric(&stripped);
    for (from, to) in [
        ("&quot;", "\""),
        ("&apos;", "'"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&amp;", "&"), // 반드시 마지막
    ] {
        t = t.replace(from, to);
    }
    t.trim().to_string()
}

fn decode_numeric(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(a) = rest.find("&#") {
        out.push_str(&rest[..a]);
        let after = &rest[a + 2..];
        let Some(semi) = after.find(';') else {
            out.push_str(&rest[a..]);
            return out;
        };
        let body = &after[..semi];
        let parsed = if let Some(hex) = body.strip_prefix(['x', 'X']) {
            u32::from_str_radix(hex, 16).ok()
        } else {
            body.parse::<u32>().ok()
        };
        match parsed.and_then(char::from_u32) {
            Some(c) => out.push(c),
            // 해석 불가면 원문 그대로 둔다(정보를 지우는 것보다 낫다).
            None => out.push_str(&rest[a..a + 2 + semi + 1]),
        }
        rest = &after[semi + 1..];
    }
    out.push_str(rest);
    out
}

/// djb2 해시(serve.js `hashId` L548-552) — 같은 URL 이면 같은 id 가 나와야 프런트 리스트 키가 안정적이다.
pub fn hash_id(s: &str) -> String {
    let mut h: i32 = 5381;
    for c in s.encode_utf16() {
        // ⚠ JS 의 `(h << 5) + h + code | 0` 는 **32비트 wrapping** 이다. Rust 기본 산술은 오버플로에
        //   패닉하므로 wrapping 연산을 명시해야 같은 값이 나온다.
        h = h.wrapping_shl(5).wrapping_add(h).wrapping_add(c as i32);
    }
    format!("n{}", radix36(h as u32))
}

fn radix36(mut n: u32) -> String {
    if n == 0 {
        return "0".into();
    }
    const D: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut buf = Vec::new();
    while n > 0 {
        buf.push(D[(n % 36) as usize]);
        n /= 36;
    }
    buf.reverse();
    String::from_utf8(buf).unwrap_or_default()
}

fn pick(seg: &str, tag: &str) -> String {
    // `<tag>` 또는 `<tag 속성…>` 을 연다.
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let Some(a) = seg.find(&open) else {
        return String::new();
    };
    let after = &seg[a + open.len()..];
    // 여는 태그의 끝(`>`)까지 건너뛴다 — 속성이 있을 수 있다.
    let Some(gt) = after.find('>') else {
        return String::new();
    };
    let body_start = &after[gt + 1..];
    let Some(b) = body_start.find(&close) else {
        return String::new();
    };
    decode_xml(&body_start[..b])
}

/// RSS `<item>` 들을 정규화(serve.js `parseNewsRSS` L555-573).
/// title 이 "헤드라인 - 출처" 형태면 출처 접미를 떼어 낸다(Google 뉴스 관용).
pub fn parse_news_rss(xml: &str) -> Vec<NewsItem> {
    let mut items = Vec::new();
    for block in xml.split("<item>").skip(1) {
        if items.len() >= MAX_ITEMS {
            break;
        }
        let seg = block.split("</item>").next().unwrap_or("");
        let mut title = pick(seg, "title");
        let url = pick(seg, "link");
        let source = pick(seg, "source");
        let published = pick(seg, "pubDate");
        if !source.is_empty() {
            let suffix = format!(" - {source}");
            if let Some(t) = title.strip_suffix(&suffix) {
                title = t.trim().to_string();
            }
        }
        if !title.is_empty() && !url.is_empty() {
            items.push(NewsItem {
                id: hash_id(&url),
                title,
                url,
                source: if source.is_empty() {
                    "Google 뉴스".into()
                } else {
                    source
                },
                published,
            });
        }
    }
    items
}

/* ── 커맨드 ───────────────────────────────────────────────────── */

fn cached(q: &str) -> Option<Vec<NewsItem>> {
    let c = cache().lock().ok()?;
    let e = c.get(q)?;
    (e.at.elapsed() < TTL).then(|| e.items.clone())
}

fn store(q: String, items: &[NewsItem]) {
    let Ok(mut c) = cache().lock() else { return };
    // 상한을 넘으면 가장 오래된 것부터 버린다(serve.js 엔 없던 방어).
    if c.len() >= MAX_CACHE {
        if let Some(oldest) = c.iter().min_by_key(|(_, e)| e.at).map(|(k, _)| k.clone()) {
            c.remove(&oldest);
        }
    }
    c.insert(
        q,
        Entry {
            at: Instant::now(),
            items: items.to_vec(),
        },
    );
}

#[tauri::command]
pub async fn atlas_news(query: String) -> serde_json::Value {
    let q: String = query
        .chars()
        .take(120)
        .collect::<String>()
        .trim()
        .to_string();
    if q.is_empty() {
        return serde_json::json!({ "ok": true, "items": [] });
    }
    if let Some(items) = cached(&q) {
        return serde_json::json!({ "ok": true, "items": items });
    }

    let target = format!(
        "https://news.google.com/rss/search?q={}&hl=ko&gl=KR&ceid=KR:ko",
        urlencode(&q)
    );
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Mozilla/5.0 (LearningHub)")
        .build()
    {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "items": [], "error": e.to_string() }),
    };
    let resp = match client.get(&target).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            return serde_json::json!({ "ok": false, "items": [], "error": format!("news {}", r.status().as_u16()) })
        }
        Err(e) => return serde_json::json!({ "ok": false, "items": [], "error": e.to_string() }),
    };
    /* ⚠⚠ **`bytes()` 는 전량을 먼저 버퍼링한다**(H17 · 2026-08-01) — 상한을 넘는 응답도 일단
    메모리에 다 올린 뒤 거절하게 되어, 자원을 지키려는 검사가 그 자원을 먼저 쓴다.
    청크를 세다 넘으면 스트림을 버리는 구현을 `cloud::read_capped` 가 소유한다(상한 값도
    거기 하나 · **상한은 여기 값을 그대로 넘긴다** — RSS 에 8MB 를 허용할 이유가 없다). */
    let body = match crate::cloud::read_capped(resp, MAX_BYTES).await {
        Ok(b) => b,
        Err(e) => return serde_json::json!({ "ok": false, "items": [], "error": e }),
    };
    let items = parse_news_rss(&String::from_utf8_lossy(&body));
    store(q, &items);
    serde_json::json!({ "ok": true, "items": items })
}

/// `encodeURIComponent` 상당 — 쿼리 하나를 위해 url 크레이트를 들이지 않는다.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(*b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cdata_와_엔티티를_푼다() {
        assert_eq!(decode_xml("<![CDATA[삼성 &amp; LG]]>"), "삼성 & LG");
        assert_eq!(decode_xml("&lt;태그&gt;"), "<태그>");
        // 반=U+BC18(48152) · 도=U+B3C4(46020) · 체=U+CCB4(52404)
        assert_eq!(decode_xml("&#48152;&#46020;&#52404;"), "반도체");
        assert_eq!(decode_xml("&#xAC00;"), "가");
    }

    #[test]
    fn amp_를_마지막에_풀어_이중복호화를_막는다() {
        // 먼저 풀면 `&amp;lt;` 가 `&lt;` → `<` 로 두 번 풀려 원문이 왜곡된다.
        assert_eq!(decode_xml("&amp;lt;"), "&lt;");
    }

    #[test]
    fn 잔여_태그를_벗긴다() {
        assert_eq!(decode_xml("<b>굵게</b> 보통"), "굵게 보통");
    }

    #[test]
    fn hash_id_는_같은_url_에_같은_값을_준다() {
        let a = hash_id("https://example.com/a");
        assert_eq!(a, hash_id("https://example.com/a"));
        assert_ne!(a, hash_id("https://example.com/b"));
        assert!(a.starts_with('n'));
    }

    #[test]
    fn hash_id_는_오버플로에_패닉하지_않는다() {
        // JS 는 `| 0` 으로 32비트 wrapping 이지만 Rust 기본 산술은 패닉한다.
        // 긴 URL 이면 반드시 넘치므로, 이 테스트가 없으면 실사용 첫 뉴스에서 앱이 죽는다.
        let long = format!("https://news.google.com/{}", "가".repeat(500));
        let _ = hash_id(&long);
    }

    #[test]
    fn item_을_정규화하고_출처_접미를_뗀다() {
        let xml = r#"
        <rss><channel>
          <item>
            <title>반도체 수출 증가 - 한국경제</title>
            <link>https://ex.com/1</link>
            <source url="https://hankyung.com">한국경제</source>
            <pubDate>Fri, 18 Jul 2026 09:00:00 GMT</pubDate>
          </item>
        </channel></rss>"#;
        let items = parse_news_rss(xml);
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].title, "반도체 수출 증가",
            "출처 접미가 안 떨어졌다"
        );
        assert_eq!(items[0].source, "한국경제");
        assert_eq!(items[0].url, "https://ex.com/1");
    }

    #[test]
    fn 출처가_없으면_기본값을_쓴다() {
        let xml = "<item><title>제목</title><link>https://ex.com/2</link></item>";
        let items = parse_news_rss(xml);
        assert_eq!(items[0].source, "Google 뉴스");
    }

    #[test]
    fn 제목이나_링크가_없으면_버린다() {
        let xml = "<item><title>제목만</title></item><item><link>https://ex.com/3</link></item>";
        assert!(parse_news_rss(xml).is_empty());
    }

    #[test]
    fn 여덟_개에서_끊는다() {
        let one = "<item><title>t</title><link>https://ex.com/x</link></item>";
        let xml = one.repeat(20);
        assert_eq!(parse_news_rss(&xml).len(), MAX_ITEMS);
    }

    #[test]
    fn urlencode_는_한글과_공백을_퍼센트로_바꾼다() {
        assert_eq!(urlencode("a b"), "a%20b");
        assert_eq!(urlencode("가"), "%EA%B0%80");
        assert_eq!(urlencode("a-b_c.d"), "a-b_c.d");
    }
}
