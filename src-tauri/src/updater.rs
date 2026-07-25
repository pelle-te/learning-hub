/* ============================================================
   updater.rs — 자동 업데이트 커맨드(2026-07-25).

   ## 왜 이 층이 생겼나

   2026-07-25 감사가 잡은 비대칭의 나머지 절반이다. 텔레메트리(`/api/log`)로 **결함을 알게
   되는** 경로는 만들었는데, 그 수정을 **전달할** 경로가 없었다 — 배포가 NSIS 인스톨러
   수동 재설치뿐이었다. 관측과 전달은 짝이고, 한쪽만 있으면 다른 쪽이 무의미해진다.

   ## ⚠ 자동으로 받지도 설치하지도 않는다 — 그것이 설계다

   플러그인은 등록만 하고, 여기 두 커맨드는 **사용자가 설정에서 누를 때만** 돈다.
   근거: 이 앱은 학습 세션 중에 켜져 있는 물건이다. 집중 타이머·진행 중인 블록·미저장
   편집이 있는 상태에서 앱이 스스로 재시작하는 것은 이 앱에서 **가장 나쁜 실패 모드**다.
   "조용한 자동 업데이트"는 그 위험을 사용자 동의 없이 지운다.

   ## ⚠ `AppHandle` 을 로직에 섞지 않는다(규율 11-2)

   CLAUDE.md 가 못박은 규약이다 — 커맨드는 얇게 두고 순수/준순수 부분을 가른다. 여기서
   가를 것은 **버전 비교 결과의 표현**뿐이라 `UpdateInfo` 구조체가 그 자리다. 나머지는
   플러그인이 네트워크·서명검증·설치를 다 하므로 우리가 테스트할 로직이 실질적으로 없다
   (그래서 여기 `#[cfg(test)]` 가 얇은 것이 정상이다 — 없는 로직을 만들어 테스트하지 않는다).
============================================================ */
use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;

/// 업데이트 확인 결과. 프런트가 이 모양 그대로 읽는다(`web/src/lib/tauri.ts`).
#[derive(Serialize, Default)]
pub struct UpdateInfo {
    /// 새 버전이 있나. false 면 나머지 필드는 비어 있다.
    pub available: bool,
    /// 새 버전(예 "0.2.0"). 없으면 빈 문자열.
    pub version: String,
    /// 현재 버전 — UI 가 "0.1.0 → 0.2.0" 을 그릴 수 있게 함께 준다.
    pub current: String,
    /// 릴리스 노트(있으면). 사용자가 **무엇이 바뀌는지 보고** 설치를 결정하게 한다.
    pub notes: String,
}

/// 업데이트가 있는지 확인만 한다. **받지도 설치하지도 않는다.**
///
/// ⚠ 실패를 `Err` 로 올린다 — 네트워크 없음·엔드포인트 미설정은 정상적인 상태이고,
/// 프런트가 조용히 무시할지 토스트를 띄울지 정한다. 여기서 삼키면 UI 가 "확인됨(없음)"과
/// "확인 못 함"을 구분할 수 없다.
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(u) => Ok(UpdateInfo {
            available: true,
            version: u.version.clone(),
            current,
            notes: u.body.clone().unwrap_or_default(),
        }),
        None => Ok(UpdateInfo {
            available: false,
            current,
            ..Default::default()
        }),
    }
}

/// 받아서 설치하고 앱을 재시작한다. **사용자가 명시적으로 누른 뒤에만** 불린다.
///
/// ⚠ 이 함수는 정상 경로에서 **돌아오지 않는다**(`restart` 가 프로세스를 갈아탄다).
/// 프런트는 호출 전에 저장이 끝났음을 보장해야 한다 — 그래서 설정 UI 가 확인 대화를 낀다.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("설치할 업데이트가 없습니다".into());
    };
    /* 진행률 콜백은 쓰지 않는다 — 이 앱의 번들은 수 MB 라 진행바가 의미를 갖기 전에 끝난다.
    필요해지면 `Channel` 로 올린다(ollama.rs 가 그 형태의 선례). */
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
