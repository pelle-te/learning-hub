/*! 볼트 Anki 카드 스캔 — 4단계-I. `web/src/lib/anki.ts` 의 `pickAndScanAnki`(FSA) 대체.

3단계가 볼트 **노트** 읽기에서 없앤 마찰을 여기서도 없앤다: 셸은 이미 워크스페이스를 알므로
`<workspace>/knowledge` 가 볼트다 — **폴더를 물을 이유가 없다.**

⚠ **FSA 가 깨져서 옮기는 게 아니다.** 트랙 B 프로브로 재보니 WebView2 에서
`showDirectoryPicker` 는 존재하고(`isSecureContext: true`) 대화상자도 실제로 열린다
(호출했더니 모달이 창 종료를 막았다 — 그게 관측이다). `<a download>` 처럼 조용히 죽는 부류가
**아니다.** 옮기는 근거는 동작이 아니라 **UX 일관성**이다: 앱이 아는 경로를 사용자에게 다시
묻는 것은 3단계가 "폴더 선택·권한 분기가 셸엔 없다"고 정리한 결정과 어긋난다.

우선순위는 프런트와 같다: 정본 `_index.json` 의 `anki` 매니페스트 → 없으면 `anki/` 폴더 `.txt` 스캔.
*/
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    /// 확장자를 뗀 덱 파일명.
    pub file: String,
    /// 파일명 앞부분(`과목_챕터.txt` 관용) — 프런트가 과목별로 묶는다.
    pub subj: String,
    pub cards: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnkiScan {
    /// 출처 표시 문구(`_index.json` | `anki/ 폴더`) — 프런트가 그대로 보여준다.
    pub src: String,
    pub decks: Vec<Deck>,
}

/// `과목_챕터.txt` → (`과목_챕터`, `과목`). 프런트 로직과 **같은 규칙**이어야 한다 —
/// 여기서 갈리면 같은 볼트에서 과목 묶음이 달라진다(3단계-B 에서 집계가 두 벌이라 숫자가
/// 갈렸던 것과 같은 실패 모양).
fn deck_of(file_name: &str, cards: usize) -> Deck {
    let stem = file_name.strip_suffix(".txt").unwrap_or(file_name);
    Deck {
        file: stem.to_string(),
        subj: stem.split('_').next().unwrap_or("").to_string(),
        cards,
    }
}

/// `.txt` 덱의 카드 수 — 빈 줄과 `#` 주석을 뺀 줄 수(프런트와 동일 규칙).
pub fn count_cards(text: &str) -> usize {
    text.lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .count()
}

/// 정본 인덱스의 `anki` 매니페스트에서 덱 목록을 만든다. 없거나 비면 `None`.
fn from_index(vault: &Path) -> Option<Vec<Deck>> {
    let text =
        std::fs::read_to_string(vault.join("_meta").join("cache").join("_index.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let arr = v.get("anki")?.as_array()?;
    let decks: Vec<Deck> = arr
        .iter()
        .filter_map(|a| {
            let file = a.get("file")?.as_str()?;
            let cards = a
                .get("cards")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0) as usize;
            Some(deck_of(file, cards))
        })
        .collect();
    (!decks.is_empty()).then_some(decks)
}

/// `anki/`(또는 `_anki/`) 폴더의 `.txt` 를 직접 센다.
fn from_folder(vault: &Path) -> Option<Vec<Deck>> {
    let dir = ["anki", "_anki"]
        .iter()
        .map(|n| vault.join(n))
        .find(|p| p.is_dir())?;
    let mut decks: Vec<Deck> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_file())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".txt") {
                return None;
            }
            let text = std::fs::read_to_string(e.path()).ok()?;
            Some(deck_of(&name, count_cards(&text)))
        })
        .collect();
    // 파일시스템 순회 순서는 플랫폼마다 다르다 — 화면 순서가 흔들리지 않게 고정한다.
    decks.sort_by(|a, b| a.file.cmp(&b.file));
    Some(decks)
}

fn scan_at(vault: &Path) -> Result<AnkiScan, String> {
    if let Some(decks) = from_index(vault) {
        return Ok(AnkiScan {
            src: "_index.json".into(),
            decks,
        });
    }
    match from_folder(vault) {
        Some(decks) => Ok(AnkiScan {
            src: "anki/ 폴더".into(),
            decks,
        }),
        None => Err("정본 _index.json 도 anki 폴더도 못 찾았어요.".into()),
    }
}

#[tauri::command]
pub fn anki_scan(app: tauri::AppHandle) -> Result<AnkiScan, String> {
    let ws = crate::workspace::resolve(&app)
        .ok_or("워크스페이스가 설정되지 않았습니다 — 설정 탭에서 폴더를 지정해 주세요.")?;
    scan_at(&ws.join("knowledge"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 카드_수는_빈_줄과_주석을_뺀다() {
        let t = "# 주석\n앞\t뒤\n\n  \n다른\t카드\n";
        assert_eq!(count_cards(t), 2);
    }

    #[test]
    fn 덱_이름에서_확장자와_과목을_뽑는다() {
        let d = deck_of("미적분_1장.txt", 12);
        assert_eq!(d.file, "미적분_1장");
        assert_eq!(d.subj, "미적분");
        assert_eq!(d.cards, 12);
        // 언더바가 없으면 전체가 과목이 된다(프런트의 `split('_')[0]` 과 같은 결과).
        assert_eq!(deck_of("단일.txt", 1).subj, "단일");
    }

    #[test]
    fn 정본_인덱스를_먼저_쓴다() {
        let dir = std::env::temp_dir().join("lh-anki-idx");
        let cache = dir.join("_meta").join("cache");
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::create_dir_all(dir.join("anki")).unwrap();
        // 폴더에도 덱이 있지만 인덱스가 이겨야 한다.
        std::fs::write(dir.join("anki").join("무시됨.txt"), "a\tb\n").unwrap();
        std::fs::write(
            cache.join("_index.json"),
            r#"{"anki":[{"file":"물리_2장.txt","cards":30}]}"#,
        )
        .unwrap();

        let s = scan_at(&dir).unwrap();
        assert_eq!(s.src, "_index.json");
        assert_eq!(s.decks, vec![deck_of("물리_2장.txt", 30)]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 인덱스가_없으면_폴더를_센다() {
        let dir = std::env::temp_dir().join("lh-anki-folder");
        std::fs::create_dir_all(dir.join("anki")).unwrap();
        std::fs::write(dir.join("anki").join("나_1.txt"), "# 머리말\nq\ta\n").unwrap();
        std::fs::write(dir.join("anki").join("가_1.txt"), "q\ta\nq2\ta2\n").unwrap();
        std::fs::write(dir.join("anki").join("메모.md"), "무시").unwrap();

        let s = scan_at(&dir).unwrap();
        assert_eq!(s.src, "anki/ 폴더");
        // 정렬 고정 — 파일시스템 순회 순서에 화면이 휘둘리지 않게.
        assert_eq!(
            s.decks.iter().map(|d| d.file.as_str()).collect::<Vec<_>>(),
            vec!["가_1", "나_1"]
        );
        assert_eq!(s.decks[0].cards, 2);
        assert_eq!(
            s.decks[1].cards, 1,
            ".txt 아닌 파일과 주석 줄을 세면 안 된다"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 둘_다_없으면_사유를_알린다() {
        let dir = std::env::temp_dir().join("lh-anki-none");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(scan_at(&dir).unwrap_err().contains("못 찾았어요"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /* ▶ 트랙 B `4단계-I` 를 여기로 내렸다(2026-07-20 층 재배치).

    그 케이스가 실제로 잠그던 것은 "**폴더를 묻지 않고 진짜 볼트를 읽는가**"이고, 그건
    `<workspace>/knowledge` 를 상대로 스캔이 성립하는지의 문제다 — 앱 창과는 무관하다.
    (원래 주석도 "FSA 가 깨져서 옮긴 게 아니다"라고 적고 있었다.) */
    #[test]
    fn 실_볼트에서_덱을_읽는다() {
        let vault = crate::testkit::vault_or_skip!();
        let s = scan_at(&vault).expect("실 볼트 스캔 실패");
        // 출처 문구는 프런트가 그대로 보여준다 — 둘 중 하나여야 한다.
        assert!(
            ["_index.json", "anki/ 폴더"].contains(&s.src.as_str()),
            "예상 밖 출처: {}",
            s.src
        );
        assert!(!s.decks.is_empty(), "실 볼트에서 덱을 하나도 못 읽었다");
        // 파싱이 됐다는 증거 — 이름과 카드 수가 실제로 채워졌는가.
        assert!(!s.decks[0].file.is_empty());
        assert!(
            s.decks.iter().any(|d| d.cards > 0),
            "모든 덱의 카드 수가 0 — 매니페스트 필드명이 갈렸을 수 있다"
        );
    }

    #[test]
    fn 빈_매니페스트는_폴더로_폴백한다() {
        // `anki: []` 를 "인덱스가 있다"로 읽으면 덱 0개가 정답이 되어 화면이 빈다.
        let dir = std::env::temp_dir().join("lh-anki-empty");
        let cache = dir.join("_meta").join("cache");
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::create_dir_all(dir.join("anki")).unwrap();
        std::fs::write(cache.join("_index.json"), r#"{"anki":[]}"#).unwrap();
        std::fs::write(dir.join("anki").join("실전_1.txt"), "q\ta\n").unwrap();

        let s = scan_at(&dir).unwrap();
        assert_eq!(s.src, "anki/ 폴더");
        assert_eq!(s.decks.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
