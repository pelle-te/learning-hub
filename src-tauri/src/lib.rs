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
mod cloud;
mod db;
mod files;
mod news;
mod ollama;
mod paths;
mod research;
/* 통합 테스트 공용 헬퍼(2026-07-20 층 재배치). 트랙 B 에 잘못 올라가 있던 실물 검사들이
여기 헬퍼를 딛고 `cargo test` 로 내려왔다 — 근거는 `testkit.rs` 머리주석. */
#[cfg(test)]
mod testkit;
mod tools;
mod updater;
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
        /* 자동 업데이트(2026-07-25) — **관측의 짝**. 텔레메트리로 결함을 알게 돼도 종전엔
        전달 경로가 NSIS 수동 재설치뿐이었다. 그 비대칭을 여기서 닫는다.

        ⚠ **자동으로 받지도 설치하지도 않는다.** 플러그인만 등록하고, 확인·설치는 사용자가
        설정에서 누를 때만 돈다(`updater::check_update`/`install_update`). 학습 중에 앱이
        제멋대로 재시작하는 것이 이 앱에서 가장 나쁜 실패다 — 진행 중인 집중 세션·타이머·
        미저장 편집이 날아간다. 조용한 자동 설치는 그 위험을 사용자 동의 없이 지운다.

        ⚠ 서명 검증은 플러그인이 한다(공개키는 `tauri.conf.json`). 개인키를 잃으면 이 앱에
        다시는 업데이트를 못 낸다 — 절차와 백업 책임은 `web/docs/릴리스.md` 가 SSOT. */
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        // 2단계 — SQLite. 스키마는 db.rs 가 단일 원천이고 프런트는 데이터만 넣고 뺀다.
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&paths::db_url(), db::migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            // SD-6 — 프런트가 **백엔드가 마이그레이션한 그 DB** 를 열게 한다(값 두 벌 금지).
            paths::db_url_cmd,
            /* C2 — 프런트가 DB 를 **열기 전에** 다운그레이드인지 묻는다. 조용한 폴백이면
            "뜨는데 데이터가 옛날 것"이 되기 때문(근거는 db.rs 의 가드 절 주석). */
            db::db_version_guard,
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
            /* C-5 후속 — 클라우드 HTTP 중계. 웹뷰가 직접 fetch 하면 CSP(C-3)에 막힌다(실측).
            뉴스·Ollama·Anki 와 같은 규약: 외부로 나가는 연결은 전부 Rust 가 소유한다. */
            cloud::cloud_http,
            /* 자동 업데이트(2026-07-25) — 관측(텔레메트리)의 짝. **확인과 설치를 가른다**:
            확인은 부작용이 없고, 설치는 앱을 재시작하므로 사용자가 명시적으로 누른 뒤에만
            불린다(근거는 updater.rs 머리주석). */
            updater::check_update,
            updater::install_update,
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
            ⚠ 5단계-A 가 잠시 포트를 여는 프로세스(LAN 서버)를 되살렸었지만 **§9-1 결정으로
               은퇴했다**(2026-07-20). 그래서 이 앱은 다시 **여는 포트가 0** 이다. */
            if let tauri::WindowEvent::Destroyed = event {
                research::shutdown();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
