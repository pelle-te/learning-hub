/*! 러닝허브 Tauri 셸 — 플랫폼 개편 1단계.

목표: Tauri 2 셸이 현 `web/dist` 를 로드하고, `serve.js` 는 sidecar 로 유지한다.
**프런트 회귀 0 + 셸/경로 설정 신규**("기능 변화 0"이 아니다 — 워크스페이스 경로가 설정으로 승격됐다).

레이어 계약(I2): 프런트에서 `invoke` 를 부르는 쪽은 `web/src/lib/` 가 소유한다.
여기 등록한 커맨드가 그 유일한 대응면이다.
*/
mod anki;
mod artifact;
mod db;
mod files;
mod news;
mod ollama;
mod research;
mod sidecar;
mod tools;
mod vault;
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
        // 2단계 — SQLite. 스키마는 db.rs 가 단일 원천이고 프런트는 데이터만 넣고 뺀다.
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            workspace::workspace_status,
            workspace::set_workspace,
            vault::vault_scan,
            // 4단계-B — serve.js /api/artifact/:name 대체.
            artifact::artifact_read,
            // 4단계-C — serve.js /api/run/:tool 대체(파이썬 도구 11종).
            tools::run_tool,
            // 4단계-D — serve.js /api/research/{start,jobs,cancel} 대체.
            research::research_start,
            research::research_jobs,
            research::research_cancel,
            // 4단계-E — serve.js Ollama 5종(코치·어휘·브리핑·회고·임베딩) 대체.
            ollama::ollama_run,
            ollama::ollama_cancel,
            ollama::ollama_embed,
            // 4단계-F — serve.js /api/atlas/news · /api/ping 대체.
            news::atlas_news,
            tools::capabilities,
            anki::anki_connect,
            files::save_text_file,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // 볼트 파일 감시(3단계) — 실패해도 앱은 뜬다(감시가 없으면 수동 갱신으로 돌아갈 뿐).
            vault::start_watch(app.handle().clone());
            // 탐구 잡 이력 복원(4단계-D). running 이던 잡은 '중단됨'으로 내린다 —
            // 앱이 죽으면 자식 python 도 죽으므로 그 잡은 실제로 안 돈다.
            research::restore(app.handle());
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
            // ⚠ 이 경로는 **정상 종료에만** 탄다. 강제 종료·크래시에선 안 불려 고아 node 가
            //    포트 8000 을 물고 남는다(실측) → 그쪽은 `sidecar::spawn` 의 선점 처리가 받는다.
            //
            // 프런트의 미저장 편집은 여기서 따로 챙기지 않는다 — WebView2 가 창 닫기에서
            // `pagehide`/`unload` 를 정상 발화해 `useApp` 의 기존 언로드 안전망이 그대로 걸린다
            // (2026-07-19 실측). 2단계에서 flush 가 비동기가 되면 그때 CloseRequested 훅이 필요해진다.
            if let tauri::WindowEvent::Destroyed = event {
                sidecar::shutdown();
                // 진행 중이던 탐구 잡의 python 도 함께 내린다 — 안 그러면 고아로 남아
                // 볼트를 계속 건드린다(sidecar 고아 문제와 같은 부류).
                research::shutdown();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
