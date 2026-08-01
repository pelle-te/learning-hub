/*! 산출물(아티팩트) 읽기 — 4단계-B. `serve.js` `/api/artifact/:name`(L625-635) 대체.

파이썬 파이프라인이 떨군 읽기 전용 JSON 8종을 프런트에 넘긴다. 로직은 두 가지뿐이다:
**화이트리스트 조회**와 **JSON 파싱 실패 시 원문 폴백**. 둘 다 순수 함수로 갈라 두어
Tauri 런타임 없이 `cargo test` 로 검증한다(2단계-B 에서 매퍼/IO 를 가른 것과 같은 규율).

⚠ **경로 기준을 워크스페이스로 통일했다 — serve.js 와 다르다.**
`serve.js:83-84` 는 `reads`·`markets` 만 `ROOT`(= serve.js 자신의 폴더) 기준으로 찾았다.
개발 중엔 `ROOT` 와 `<워크스페이스>/hub` 가 같은 폴더라 일치했지만, **번들 배포본에선
serve.js 가 리소스 폴더에 놓여 `<설치경로>/_읽을거리/latest.json` 을 보게 된다 — 영원히 없는 경로다.**
정작 수집기는 워크스페이스 기준으로 쓴다(`읽을거리_수집.py:55` · `증시_수집.py:70` 둘 다
`HERE.parents[2] / "hub" / …`). 즉 파일을 쓰는 쪽과 읽는 쪽의 기준이 갈려 있었고,
1단계 실행 검증이 dev 경로에서 돌아 두 기준이 우연히 겹치는 바람에 가려져 있었다.
→ 8종 전부를 **워크스페이스 상대경로**로 적는다. 쓰는 쪽과 같은 기준이 되어 배포본에서도 맞는다.
*/
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 산출물 화이트리스트 — key → 워크스페이스 기준 상대경로 조각.
/// serve.js 의 `ARTIFACTS` 테이블(L75-85)과 1:1 대응한다.
const ARTIFACTS: &[(&str, &[&str])] = &[
    // 볼트 파생물(knowledge/_meta/) — 지식엔진·벌트DB·챕터원장·커리큘럼 산출
    (
        "knowledge",
        &["knowledge", "_meta", "cache", "_지식상태.json"],
    ),
    ("anki", &["knowledge", "_meta", "cache", "_anki신호.json"]),
    ("ledger", &["knowledge", "_meta", "cache", "_챕터원장.json"]),
    (
        "curriculum",
        &["knowledge", "_meta", "cache", "_커리큘럼.json"],
    ),
    // 손저작 계약('내 길')과 발견 triage 큐 — cache 가 아니라 각각 contract/·state/
    ("goals", &["knowledge", "_meta", "contract", "goals.json"]),
    (
        "discovery",
        &["knowledge", "_meta", "state", "_발견큐.json"],
    ),
    // 러닝허브 로컬 수집물 — hub/ 아래. 위 ⚠ 참조(serve.js 는 여기 기준이 틀려 있었다).
    ("reads", &["hub", "_읽을거리", "latest.json"]),
    ("markets", &["hub", "_증시", "latest.json"]),
];

/// 프런트 계약 — `api.ts` 의 `getArtifact` 반환형과 같다.
/// `data`(파싱 성공) 또는 `raw`(파싱 실패) 중 하나만 실린다.
#[derive(Debug, Serialize, PartialEq)]
pub struct ArtifactOut {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

/// "아직 생성 안 됨"과 "알 수 없는 이름"의 공통 접두.
/// 전송이 HTTP 가 아니게 됐어도 프런트의 **분류 계약은 안 바꾼다** —
/// `lib/api.ts` 가 이 접두를 보고 기존과 동일한 `HTTP 404` 에러로 번역하고,
/// `artifactState.ts:31` 의 `isNotYetError` 가 그대로 '미생성(empty)'으로 분류한다.
/// 문자열 접두를 쓰는 이유: Tauri 커맨드의 `Err` 는 문자열로 넘어가고, 한국어 메시지
/// 본문을 파싱 키로 삼으면 문구를 다듬는 순간 분류가 조용히 깨진다.
pub const NOT_FOUND: &str = "NOT_FOUND";

/// 화이트리스트 조회 — 이름 → 워크스페이스 상대경로. 목록에 없으면 None.
/// serve.js 의 `Object.hasOwn` 가드(감사 2026-07-16 ①#45)에 해당하는 자리인데,
/// Rust 는 배열 선형탐색이라 프로토타입 오염 자체가 성립하지 않는다.
pub fn artifact_rel(name: &str) -> Option<PathBuf> {
    ARTIFACTS
        .iter()
        .find(|(k, _)| *k == name)
        .map(|(_, parts)| parts.iter().collect())
}

/// 읽어 온 원문을 프런트 계약으로 — JSON 이면 `data`, 아니면 `raw`.
/// serve.js L632-633 과 동일하게 **파싱 실패도 성공(ok:true)** 으로 넘긴다.
/// 소비처가 원문을 보고 진단할 수 있어야 하고, 여기서 에러로 만들면
/// "파일은 있는데 내용이 깨졌다"가 "파일이 없다"와 구분 불가능해진다.
pub fn parse_artifact(text: String) -> ArtifactOut {
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => ArtifactOut {
            ok: true,
            data: Some(v),
            raw: None,
        },
        Err(_) => ArtifactOut {
            ok: true,
            data: None,
            raw: Some(text),
        },
    }
}

/// 워크스페이스 루트 + 이름 → 실제 파일을 읽는다. 경로 결정을 여기 하나에 가둔다.
fn read_at(root: &Path, name: &str) -> Result<ArtifactOut, String> {
    let rel = artifact_rel(name).ok_or_else(|| format!("{NOT_FOUND} 알 수 없는 산출물"))?;
    std::fs::read_to_string(root.join(rel))
        .map(parse_artifact)
        .map_err(|_| format!("{NOT_FOUND} 아직 생성 안 됨(도구를 먼저 실행)"))
}

#[tauri::command]
pub fn artifact_read(app: tauri::AppHandle, name: String) -> Result<ArtifactOut, String> {
    // 워크스페이스가 없으면 산출물도 있을 수 없다 — '미생성'과 같은 부류로 알린다
    // (프런트가 셋업 안내를 띄우는 자리이지 에러 패널을 띄우는 자리가 아니다).
    let root = crate::workspace::resolve(&app)
        .ok_or_else(|| format!("{NOT_FOUND} 워크스페이스가 설정되지 않았습니다"))?;
    read_at(&root, &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 화이트리스트_밖은_거부한다() {
        assert!(artifact_rel("knowledge").is_some());
        assert!(artifact_rel("../../secret").is_none());
        assert!(artifact_rel("").is_none());
        // serve.js 가 Object.hasOwn 으로 막던 프로토타입 키 — Rust 에선 애초에 성립하지 않는다.
        assert!(artifact_rel("__proto__").is_none());
        assert!(artifact_rel("constructor").is_none());
    }

    #[test]
    fn 여덟_종이_모두_등록돼_있다() {
        // serve.js ARTIFACTS 와 개수·이름이 일치해야 한다(포팅 누락 방지).
        let names: Vec<&str> = ARTIFACTS.iter().map(|(k, _)| *k).collect();
        assert_eq!(names.len(), 8);
        for k in [
            "knowledge",
            "anki",
            "ledger",
            "curriculum",
            "goals",
            "discovery",
            "reads",
            "markets",
        ] {
            assert!(names.contains(&k), "{k} 누락");
        }
    }

    #[test]
    fn reads_markets_는_워크스페이스_hub_기준이다() {
        // 이 테스트가 잡는 것: 수집기(읽을거리_수집.py:55 `parents[2]/"hub"`)와 기준이 갈리는 회귀.
        assert_eq!(
            artifact_rel("reads").unwrap(),
            PathBuf::from("hub").join("_읽을거리").join("latest.json")
        );
        assert_eq!(
            artifact_rel("markets").unwrap(),
            PathBuf::from("hub").join("_증시").join("latest.json")
        );
    }

    #[test]
    fn 파싱_실패는_원문으로_폴백한다() {
        let ok = parse_artifact(r#"{"a":1}"#.to_string());
        assert!(ok.data.is_some() && ok.raw.is_none());

        let bad = parse_artifact("깨진 내용{{".to_string());
        assert!(bad.ok, "파싱 실패도 ok:true — serve.js L633 계약");
        assert_eq!(bad.raw.as_deref(), Some("깨진 내용{{"));
        assert!(bad.data.is_none());
    }

    #[test]
    fn 없는_파일과_없는_이름은_같은_접두로_알린다() {
        let dir = std::env::temp_dir().join("lh-artifact-test");
        let _ = std::fs::create_dir_all(&dir);

        let unknown = read_at(&dir, "존재하지않음").unwrap_err();
        let missing = read_at(&dir, "knowledge").unwrap_err();
        assert!(unknown.starts_with(NOT_FOUND));
        assert!(missing.starts_with(NOT_FOUND));
    }

    #[test]
    fn 실재하는_파일을_읽어_돌려준다() {
        let dir = std::env::temp_dir().join("lh-artifact-read");
        let target = dir.join("hub").join("_읽을거리");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("latest.json"), r#"{"items":[1,2]}"#).unwrap();

        let out = read_at(&dir, "reads").unwrap();
        assert!(out.ok);
        assert_eq!(out.data.unwrap()["items"][1], 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /* ── 실물 대상 통합 검사 ─────────────────────────────────────────────────
    ▶ 트랙 B `4단계-B` 를 여기로 내렸다(2026-07-20 층 재배치).

    위 단위 테스트들은 **내가 만든 임시 폴더**를 읽으므로 "코드가 시키는 대로 하는가"만 본다.
    정작 4단계-B 가 고친 결함은 **경로 기준이 파일을 쓰는 쪽(파이썬 수집기)과 갈려 있던 것**이라,
    진짜 워크스페이스의 진짜 산출물을 읽어야만 드러난다. 그건 실물을 상대해야 한다는 요구이지
    *앱 창을 띄워야 한다*는 요구가 아니었다 — 그래서 GUI 없이 여기서 잰다. */

    #[test]
    fn 실_워크스페이스의_산출물을_읽는다() {
        let ws = crate::testkit::ws_or_skip!();

        // 볼트 파생물 — serve.js 도 여기는 맞게 보고 있었다.
        let knowledge = read_at(&ws, "knowledge").expect("knowledge 산출물 읽기 실패");
        assert!(knowledge.data.is_some(), "knowledge 가 JSON 으로 안 풀렸다");

        /* ⚠ 이 두 줄이 이 케이스의 존재 이유다.
        serve.js 기준(자기 폴더)이었다면 배포본에서 영원히 빈손이었을 자리 — 수집기는
        워크스페이스 기준으로 쓴다(읽을거리_수집.py:55 · 증시_수집.py:70). */
        for name in ["reads", "markets"] {
            let out = read_at(&ws, name)
                .unwrap_or_else(|e| panic!("{name} 읽기 실패(경로 기준이 수집기와 갈렸다): {e}"));
            assert!(out.data.is_some(), "{name} 이 JSON 으로 안 풀렸다");
        }
    }

    #[test]
    fn 실_워크스페이스에서도_화이트리스트_밖은_거부한다() {
        // 프런트가 '미생성'으로 분류하는 접두를 실물 경로에서도 그대로 쓰는지.
        let ws = crate::testkit::ws_or_skip!();
        let err = read_at(&ws, "../../etc/passwd").unwrap_err();
        assert!(err.starts_with(NOT_FOUND), "{err}");
    }
}
