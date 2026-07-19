/*! 러닝허브 Tauri 셸 — 플랫폼 개편 1단계.

목표: Tauri 2 셸이 현 `web/dist` 를 로드하고, `serve.js` 는 sidecar 로 유지한다.
**프런트 회귀 0 + 셸/경로 설정 신규**("기능 변화 0"이 아니다 — 워크스페이스 경로가 설정으로 승격됐다).

레이어 계약(I2): 프런트에서 `invoke` 를 부르는 쪽은 `web/src/lib/` 가 소유한다.
여기 등록한 커맨드가 그 유일한 대응면이다.
*/
mod sidecar;
mod workspace;

use std::time::Duration;
use tauri::Manager;

/// 앱 폴더(hub/) — serve.js 가 있는 곳. 개발 중엔 저장소 루트, 배포본에선 리소스 폴더.
/// serve.js 의 **존재**로 판정한다(경로 추측을 이 함수 하나에 가둔다).
fn app_dir() -> std::path::PathBuf {
    let exe = std::env::current_exe().ok();
    let mut cur = exe.as_deref().and_then(|p| p.parent());
    while let Some(dir) = cur {
        if dir.join("serve.js").is_file() {
            return dir.to_path_buf();
        }
        cur = dir.parent();
    }
    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 두 번째 실행은 새 창을 만들지 않고 기존 창을 깨운다 —
    // .bat 가 하던 "포트 8000 stale 서버 강제종료"의 근본 원인(중복 실행) 자체를 없앤다.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            workspace::workspace_status,
            workspace::set_workspace,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let dir = app_dir();
            let handle = app.handle().clone();
            let ws = workspace::resolve(&handle);
            match sidecar::spawn(&dir, ws.as_deref()) {
                Ok(()) => {
                    // 창은 이미 떠 있으므로 대기는 짧게 — 실패해도 프런트가 오프라인 UI 로 폴백한다(usePing).
                    let ready = sidecar::wait_until_ready(Duration::from_secs(10));
                    log::info!("sidecar 준비: {ready} (workspace={ws:?})");
                }
                Err(e) => log::error!("sidecar 실행 실패: {e}"),
            }
            Ok(())
        })
        .on_window_event(|_window, event| {
            // 창이 닫히면 sidecar 도 함께 내린다(좀비 node 가 포트를 물고 남는 것 방지).
            // ⚠ 2단계에서 여기에 **비동기 flush 완료 대기**가 추가돼야 한다 —
            //    Tauri 창 닫기에서 `pagehide` 발화가 보장되지 않아 디바운스 대기 중 편집이 유실된다.
            if let tauri::WindowEvent::Destroyed = event {
                sidecar::shutdown();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
