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

/* ── I006 **집중 시작이 대상을 실제로 연다**(2026-08-22 발상 축) ─────────────────────────

   ## 이 앱의 파이프는 전부 단방향이었다

   앱은 «이 챕터를 공부하라»고 말할 수 있지만 **그 일을 시작시킬 수는 없었다** — 노트를 여는
   경로가 0이었다(실측: capabilities 12종에 opener 없음 · 소스 grep 0). 사용자는 앱에서 이름을
   읽고 옵시디언·탐색기로 가서 같은 것을 다시 찾는다. 그 왕복이 「집중 시작」의 실제 마찰이다.

   ## ⚠⚠ 임의 경로를 안 연다 — 볼트 안으로 한정한다

   `save_text_file` 은 임의 경로를 쓰지만 그 경로의 출처가 **OS 저장 대화상자**다(위 주석).
   여기는 다르다: 경로가 **프런트 문자열**이라 그대로 믿으면 «앱을 침해한 JS 가 아무 실행 파일이나
   연다»가 된다. 그래서 `vault::safe_join` 을 그대로 쓴다 — `..`·절대경로·드라이브 접두를 전부
   거절하는 그 함수는 이미 노트 읽기의 경계이고, 여는 쪽이 **같은 경계**를 쓰는 것이 요점이다
   (두 벌이면 한쪽만 고쳐진다).
   ⚠ 그리고 **파일이 실재할 때만** 연다 — 없는 경로를 OS 에 넘기면 플랫폼마다 다른 일이 일어난다.
*/
/// 볼트 상대경로 → 실제 파일 경로. **판정 전부가 여기 있다**(규율 11-2 — `AppHandle` 을 로직에
/// 섞지 않으면 그 자리가 곧 통합 테스트 진입점이다).
pub fn resolve_in_vault(vault: &Path, rel: &str) -> Result<std::path::PathBuf, String> {
    let p = crate::vault::safe_join(vault, rel).ok_or_else(|| "볼트 밖 경로입니다".to_string())?;
    if !p.is_file() {
        return Err(format!("파일이 없습니다: {rel}"));
    }
    Ok(p)
}

#[tauri::command]
pub fn open_in_vault(app: tauri::AppHandle, rel: String) -> Result<(), String> {
    let vault =
        crate::vault::vault_dir(&app).ok_or_else(|| "볼트가 설정되지 않았습니다".to_string())?;
    let p = resolve_in_vault(&vault, &rel)?;
    tauri_plugin_opener::open_path(p.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("열기 실패: {e}"))
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

    /* ▶ I006(2026-08-22 발상 축) — **여는 경로의 경계.** 이 커맨드의 유일한 위험은 «프런트가
    보낸 문자열 하나로 디스크 어디든 연다» 이고, 그 방어 전부가 `resolve_in_vault` 안에 있다.
    ⚠ `safe_join` 은 `vault.rs` 가 이미 테스트한다 — 여기서 잠그는 것은 **여는 쪽이 같은 경계를
    쓴다**는 사실과, «파일이 실재할 때만 연다» 이다(없는 경로를 OS 에 넘기면 플랫폼마다 다르다). */
    #[test]
    fn 볼트_밖은_열지_않고_없는_파일도_열지_않는다() {
        let dir = std::env::temp_dir().join("lh-open-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("회로이론/01 기초")).unwrap();
        let note = dir.join("회로이론/01 기초/옴의법칙.md");
        std::fs::write(&note, "안").unwrap();
        std::fs::write(dir.join("비밀.md"), "밖").unwrap();

        assert_eq!(
            resolve_in_vault(&dir, "회로이론/01 기초/옴의법칙.md").unwrap(),
            note,
            "정상 경로는 그대로 풀린다"
        );
        assert!(
            resolve_in_vault(&dir, "회로이론/../../비밀.md")
                .unwrap_err()
                .contains("볼트 밖"),
            "부모 참조"
        );
        assert!(
            resolve_in_vault(&dir, "/etc/passwd")
                .unwrap_err()
                .contains("볼트 밖"),
            "절대경로"
        );
        assert!(
            resolve_in_vault(&dir, "회로이론/01 기초/없는파일.md")
                .unwrap_err()
                .contains("파일이 없습니다"),
            "없는 파일"
        );
        assert!(
            resolve_in_vault(&dir, "회로이론/01 기초")
                .unwrap_err()
                .contains("파일이 없습니다"),
            "폴더는 파일이 아니다"
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
