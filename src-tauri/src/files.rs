/*! 파일 내보내기 — 4단계-F. `shell/actions.ts` 의 `download()`(`<a download>`) 대체.

## ▶ 실측: 셸에서 내보내기가 **조용히 아무 일도 안 하고 있었다**

트랙 B 프로브로 재봤다. `<a download>` 는 WebView2 에서 **예외를 던지지 않고 클릭되지만
파일이 어디에도 생기지 않는다**(다운로드 폴더·사용자 프로필·앱 폴더 전역 탐색으로 확인).
즉 실패가 조용하다 — 사용자에겐 "눌렀는데 아무 일도 안 일어남"이고, 코드에는 에러가 없다.

**이게 왜 심각한가**: 내보내기 6경로(`exportJSON`·`exportICS`·`archiveOld`·`exportAnkiCards`·
`exportSummaryNotes`·`downloadCorruptSnapshot`)가 전부 이 한 함수에 수렴한다. 그중 `exportJSON`
은 **백업**이고, 2단계-E 에서 배포 진입점을 셸 하나로 좁힌 뒤로 이 앱의 유일한 데이터 반출
수단이었다. 즉 1단계 이후 줄곧 **백업이 안 되는 상태**였고, 아무도 몰랐다.

설계 §4-4단계는 이걸 "무반응/위치 지정 불가"로 예측했다. 이번엔 예측이 맞았지만, **재보지
않았으면 "위치만 애매한 것"으로 넘겼을 것**이다(실제로는 파일 자체가 없다).
*/
use std::path::Path;

/// 사용자가 고른 경로에 텍스트를 쓴다. 경로 선택은 프런트가 `plugin-dialog` 의 `save()` 로 하고,
/// 여기서는 **쓰기만** 한다 — 대화상자를 Rust 에 두면 취소·기본파일명·확장자 필터를 다시 배선해야
/// 하는데 그건 이미 플러그인이 하는 일이다.
///
/// ⚠ 임의 경로 쓰기라 위험해 보이지만, 경로의 출처가 **사용자가 방금 고른 저장 대화상자**다.
/// 프런트가 만든 문자열을 그대로 받는 게 아니라 OS 파일 선택기의 반환값이라, 화이트리스트를
/// 두는 것이 오히려 사용자가 원하는 위치에 못 쓰게 만든다(내보내기의 요점이 위치 선택이다).
#[tauri::command]
pub fn save_text_file(path: String, contents: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(dir) = p.parent() {
        if !dir.as_os_str().is_empty() && !dir.is_dir() {
            return Err(format!("폴더가 없습니다: {}", dir.display()));
        }
    }
    // UTF-8 로 쓴다 — 파일명·본문에 한글이 들어가고, 기존 `<a download>` 도 UTF-8 Blob 이었다.
    std::fs::write(p, contents).map_err(|e| format!("저장 실패: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 한글_내용을_utf8_로_쓴다() {
        let dir = std::env::temp_dir().join("lh-files-test");
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("내보내기.json");
        save_text_file(
            f.to_string_lossy().into_owned(),
            "{\"과목\":\"미적분\"}".into(),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(&f).unwrap(),
            "{\"과목\":\"미적분\"}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 없는_폴더는_사유를_알린다() {
        // 조용히 실패하면 `<a download>` 와 같은 상태로 돌아간다 — 그게 이 단계가 고친 결함이다.
        let bad = std::env::temp_dir().join("lh-없는폴더-xyz").join("a.json");
        let err = save_text_file(bad.to_string_lossy().into_owned(), "x".into()).unwrap_err();
        assert!(err.contains("폴더가 없습니다"), "{err}");
    }
}
