//! paths.rs — **앱이 자기 데이터를 어디에 두는가**의 단일 원천 (SD-6).
//!
//! ## 왜 생겼나
//!
//! 트랙 B(E2E)가 **사용자의 실제 DB 를 상대**하고 있었다. 이미 실사고를 냈다 — 옛 케이스가
//! `INSERT OR REPLACE INTO docs (key, value)`(2열)로 써서 실제 독후감의 `updated_at` 이 0 이
//! 되었고, 그 행은 클라우드 동기화에서 **영원히 빠졌다**(앱은 "최신"이라고 말한다). 검증이
//! 검증 대상을 망가뜨린 사고다(결정로그 2026-07-20).
//!
//! 그 뒤로는 "하네스는 실 DB 에 쓰지 않는다"는 **규약**으로 막고 있었는데, 규약은 흘러내린다.
//! 여기서 구조로 바꾼다: 하네스가 자기 폴더를 지정하면 앱의 **모든** 사용자 데이터가 거기로
//! 간다(DB · `workspace.json` · `research-jobs.json` — 원래 같은 폴더에 있는 삼형제다).
//!
//! ## ⚠ 왜 환경변수 `APPDATA` 로는 안 되나 (실측 완료)
//!
//! `dirs-6.0.0/src/win.rs:10` 이 `SHGetKnownFolderPath(FOLDERID_RoamingAppData)` 를 부른다 —
//! **Win32 API 라 `APPDATA` 를 갈아끼워도 무시된다.** 그래서 우회가 아니라 **앱이 스스로 읽는
//! override** 여야 한다. 아래 `override_dir()` 이 그것이고, 읽는 주체는 우리 코드다.
//!
//! ## 안전 설계 — 위험이 비대칭이라는 점을 설계에 반영했다
//!
//! 이 파일이 틀리면 **모든 사용자 데이터의 경로 해석**이 틀린다(빈 앱으로 보인다). 그래서:
//!
//! 1. **환경변수가 없으면 코드 경로가 이전과 한 글자도 다르지 않다.** override 는 순수 opt-in 이다.
//! 2. 이름이 `LEARNING_HUB_E2E_DATA_DIR` 이다 — 사용자의 평상 환경에 우연히 존재할 이름이
//!    아니고, 있으면 **무엇을 위한 것인지 이름 자체가 말한다**.
//! 3. 빈 문자열은 미설정과 같게 본다(셸 스크립트가 빈 변수를 export 하는 흔한 사고 방지).
//! 4. 프런트도 **같은 값을 커맨드로 받아** 연다(`db_url`). 백엔드가 A 에 마이그레이션하고
//!    프런트가 B 를 여는 것이 이 변경에서 가장 위험한 실패 모드라, 값을 두 벌 두지 않는다.

use std::path::PathBuf;

/// 하네스가 데이터 폴더를 지정하는 환경변수. 배포본에는 설정되지 않는다.
pub const DATA_DIR_ENV: &str = "LEARNING_HUB_E2E_DATA_DIR";

/// DB 파일명 — override 여부와 무관하게 같다(폴더만 갈린다).
const DB_FILE: &str = "learning-hub.db";

/// override 폴더. 미설정·빈 문자열이면 `None`(= 평상시 경로).
pub fn override_dir() -> Option<PathBuf> {
    match std::env::var(DATA_DIR_ENV) {
        Ok(s) if !s.trim().is_empty() => Some(PathBuf::from(s)),
        _ => None,
    }
}

/// 설정·잡 이력이 사는 폴더. 없으면 만든다.
///
/// `workspace.json`·`research-jobs.json` 이 여기 있고, `tauri-plugin-sql` 도 sqlite 상대경로를
/// **app_config_dir 기준**으로 푼다(`wrapper.rs:81` — 실측). 즉 셋이 원래 한 폴더다.
pub fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = match override_dir() {
        Some(d) => d,
        None => app
            .path()
            .app_config_dir()
            .map_err(|e| format!("설정 폴더를 찾지 못했습니다: {e}"))?,
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("설정 폴더 생성 실패: {e}"))?;
    Ok(dir)
}

/// `tauri-plugin-sql` 에 넘길 연결 문자열.
///
/// ⚠ **절대경로를 넣는 것이 여기서 유일하게 통하는 방법이다.** 플러그인의 `path_mapper` 는
/// `app_path.push(<콜론 뒤 문자열>)` 인데(`wrapper.rs:319`), `PathBuf::push` 는 인자가
/// 절대경로면 **앞을 통째로 버리고 치환한다.** 그래서 override 시엔 완전한 경로를 준다.
/// 미설정이면 예전 그대로 상대경로("sqlite:learning-hub.db")를 돌려준다.
pub fn db_url() -> String {
    match override_dir() {
        Some(d) => format!("sqlite:{}", d.join(DB_FILE).display()),
        None => format!("sqlite:{DB_FILE}"),
    }
}

/// 프런트가 열 DB 연결 문자열 — **백엔드가 마이그레이션한 바로 그 값**을 준다.
///
/// ⚠ 이 커맨드가 있는 이유가 이 변경의 핵심 위험이다: 프런트가 상수를 따로 들고 있으면
/// override 시 **백엔드는 A 에 마이그레이션하고 프런트는 B 를 여는** 상태가 만들어진다.
/// 그러면 스키마 없는 빈 DB 가 열리고 앱은 "데이터가 없다"고 조용히 말한다. 값은 한 벌뿐이어야 한다.
#[tauri::command]
pub fn db_url_cmd() -> String {
    db_url()
}

#[cfg(test)]
mod tests {
    use super::*;

    /* ⚠ 환경변수는 프로세스 전역이라 테스트가 병렬로 돌면 서로를 밟는다. 이 모듈의 케이스는
    한 함수 안에서 순차로 두고, 끝나면 반드시 지운다(다른 테스트가 override 를 물려받으면
    실 경로 대신 임시 경로를 보게 된다 — 조용히 이상해지는 종류의 오염). */
    #[test]
    fn override_는_설정됐을_때만_경로를_바꾼다() {
        // 미설정 — 예전 거동(상대경로).
        unsafe { std::env::remove_var(DATA_DIR_ENV) };
        assert_eq!(override_dir(), None);
        assert_eq!(db_url(), "sqlite:learning-hub.db");

        // 빈 문자열·공백만 = 미설정과 같다(빈 export 사고 방지).
        unsafe { std::env::set_var(DATA_DIR_ENV, "") };
        assert_eq!(override_dir(), None);
        assert_eq!(db_url(), "sqlite:learning-hub.db");
        unsafe { std::env::set_var(DATA_DIR_ENV, "   ") };
        assert_eq!(override_dir(), None);

        // 설정 — 절대경로가 통째로 실린다(플러그인의 PathBuf::push 가 앞을 버린다).
        let tmp = std::env::temp_dir().join("lh-paths-test");
        unsafe { std::env::set_var(DATA_DIR_ENV, &tmp) };
        assert_eq!(override_dir(), Some(tmp.clone()));
        let url = db_url();
        assert!(url.starts_with("sqlite:"), "연결 문자열 형식: {url}");
        assert!(
            url.contains("lh-paths-test") && url.ends_with("learning-hub.db"),
            "override 폴더 아래 DB 를 가리켜야 한다: {url}"
        );

        unsafe { std::env::remove_var(DATA_DIR_ENV) };
    }
}
