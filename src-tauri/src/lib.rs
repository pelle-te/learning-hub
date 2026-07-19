/*! 러닝허브 Tauri 셸 — 플랫폼 개편 1~5단계.

**백엔드가 여기 하나다.** 1단계는 셸만 이사하고 `serve.js`(Node HTTP)를 sidecar 로 유지했지만,
4단계가 그 라우트 12종을 전부 Rust 커맨드로 옮기고 `serve.js` 를 삭제했다 — 이제 이 프로세스가
곧 백엔드다.

⚠ **4단계의 "리슨하는 포트가 0"은 5단계-A 에서 조건부로 깨졌다.** `server.rs` 가 LAN 읽기 전용
모바일 뷰용 HTTP 서버를 들여왔기 때문이다. 다만 **기본은 여전히 포트 0** 이다 — 서버는 사용자가
설정에서 켤 때만 뜬다. 켠 동안에는 4단계-G 대조표가 "불필요"로 닫았던 방어 일부가 되살아나며,
무엇이 되살아나고 무엇이 토큰 설계로 상쇄되는지는 `server.rs` 머리주석과 설계 §5단계-0 에 있다.

레이어 계약(I2): 프런트에서 `invoke` 를 부르는 쪽은 `web/src/lib/tauri.ts` 하나다.
여기 등록한 커맨드가 그 유일한 대응면이다.
*/
mod anki;
mod anki_scan;
mod artifact;
mod db;
mod files;
mod news;
mod ollama;
mod research;
/* 5단계-C — AppState ↔ 행 표현 매퍼(rows.ts 의 Rust 이식). 아직 **아무도 안 부른다** —
5-D 가 이중 대조로, 5-E 가 실제 쓰기 경로로 배선한다. 단계가 독립 릴리스 가능해야 하므로
이식과 배선을 나눴다(§5단계 재범위 v6). */
mod rows;
mod server;
mod tools;
mod vault;
mod workspace;

use tauri::Manager;

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
            // 4단계-I — 볼트 Anki 카드 스캔(폴더 선택 없이).
            anki_scan::anki_scan,
            // 5단계-A — LAN 읽기 전용 모바일 뷰 서버. **기본 OFF** — 사용자가 켤 때만 뜬다.
            server::server_status,
            server::server_start,
            server::server_stop,
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
            log::info!("워크스페이스: {:?}", workspace::resolve(app.handle()));
            Ok(())
        })
        .on_window_event(|_window, event| {
            /* 창이 닫히면 우리가 띄운 자식 프로세스도 함께 내린다.
            ⚠ 이 경로는 **정상 종료에만** 탄다 — 강제 종료·크래시에선 안 불린다. 4단계 이전엔
               그게 "고아 node 가 포트 8000 을 물고 남는" 문제였고 `sidecar::spawn` 이 선점으로
               받아냈지만, **serve.js 가 사라지면서 그 실패 모드 자체가 없어졌다**(포트를 여는
               프로세스가 없다). 남은 건 탐구 잡의 python 뿐이고, 그건 앱이 죽으면 부모가 없어져
               대개 함께 죽는다 — 부팅 시 `research::restore` 가 잔여 'running' 을 정리한다.
            ⚠ 5단계-A 로 **포트를 여는 프로세스가 다시 생겼다**(우리 자신). 강제 종료되면 소켓은
               OS 가 회수하므로 고아 서버는 안 남지만, 정상 종료에서는 여기서 명시적으로 내려야
               graceful shutdown 이 돌아 곧바로 재시작할 때 EADDRINUSE 를 피한다. */
            if let tauri::WindowEvent::Destroyed = event {
                research::shutdown();
                server::shutdown();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
