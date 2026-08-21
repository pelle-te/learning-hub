/*! 러닝허브 Tauri 셸 — 플랫폼 개편 1~5단계.

**백엔드가 여기 하나다.** 1단계는 셸만 이사하고 `serve.js`(Node HTTP)를 sidecar 로 유지했지만,
4단계가 그 라우트 12종을 전부 Rust 커맨드로 옮기고 `serve.js` 를 삭제했다 — 이제 이 프로세스가
곧 백엔드다.

⚠ **이 앱이 여는 포트는 0 이다.** 5단계-A 가 LAN 모바일 뷰 서버(`server.rs`)로 그 성질을 잠시
깼지만, **§9-1 결정으로 2026-07-20 에 은퇴했다**(클라우드가 같은 요구를 더 잘 채우고, 남겨 두면
폰 번들이 백엔드 둘·인증 두 벌을 상대해야 했다). 아래 `on_window_event` 주석이 같은 사실을
적고 있었는데 **이 머리주석만 낡은 채로 남아 한 파일 안에서 자기모순**이었다(2026-07-26 감사).

레이어 계약(I2): 프런트에서 `invoke` 를 부르는 쪽은 `web/src/lib/tauri.ts` 하나다.
여기 등록한 커맨드가 그 유일한 대응면이다.
*/
mod anki;
mod anki_scan;
mod artifact;
mod cloud;
mod db;
mod files;
mod hotkey;
/// Q-28 — 실시간 poke 소켓(데스크톱). 정책은 프런트, 소켓 수명만 여기(그 파일 머리주석).
/* ⚠ **`news`·`research` 가 P10 W4 에서 사라졌다**(2026-08-07). `news.rs` 는 진로 지도의 RSS,
`research.rs` 는 탐구 수집 잡이었고 둘 다 교양축(`survey/`) 소관이다. 탐구는 이미 W2 에서
`survey/_도구/탐구_수집.py` 로 이사했으므로, 여기 남아 있던 잡 러너는 **없는 스크립트를 부르는
배관**이었다(판정 ⓑ). 되살리려면 `git show 1c21ad5:src-tauri/src/{news,research}.rs`. */
/* W3(발산 6회차) — 알림 **착지**와 시스템 **유휴**. 플러그인으로 안 되는 이유(Windows 경로가
토스트 핸들을 버린다)와 유휴를 프런트에서 못 재는 이유는 그 파일 머리주석이 SSOT. */
#[cfg(desktop)]
mod notify;
mod ollama;
mod paths;
/// T-3 — 상주 트레이. **T-6(예약 알림)의 원리적 선행**(그 파일 머리주석).
#[cfg(desktop)]
/* 통합 테스트 공용 헬퍼(2026-07-20 층 재배치). 트랙 B 에 잘못 올라가 있던 실물 검사들이
여기 헬퍼를 딛고 `cargo test` 로 내려왔다 — 근거는 `testkit.rs` 머리주석. */
#[cfg(test)]
mod testkit;
mod tools;
mod updater;
mod vault;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 두 번째 실행은 새 창을 만들지 않고 기존 창을 깨운다 —
    // .bat 가 하던 "포트 8000 stale 서버 강제종료"의 근본 원인(중복 실행) 자체를 없앤다.
    #[cfg(desktop)]
    {
        /* ⚠ 종전엔 `tray::show` 를 불렀다 — **트레이가 은퇴했다**(I049 · 2026-08-22). 상주
        모드가 없으므로 창이 `hide()` 로 숨겨져 있을 일도 없고, H-3 이 고친 «숨김은
        `unminimize` 로 안 돌아온다»는 조건 자체가 사라졌다. 되살리기는 다시 두 줄이다. */
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
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
        /* ⚠ **자동 시작(T-3) 플러그인이 여기 있었다 — 은퇴했다**(I049 · 2026-08-22). 그 축의
        존재 이유는 예약 알림(T-6)이 재부팅을 넘기는 것이었고, T-6 이 함께 갔다. */
    }

    builder
        /* 전역 단축키(E20) — **데스크톱 전용**이라 여기서 켠다. 실패해도 앱은 뜬다(등록 결과는
        `hotkey::status()` 가 보관하고 `capabilities` 가 프런트로 실어 보낸다 — 조용히 죽지 않는다). */
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        /* ⚠⚠ **알림(P-8 · 2026-08-01) — 이 앱의 개입 채널은 지금까지 0개였다.**
        `FocusChip` 은 세션이 끝나면 웹 `new Notification(...)` 을 쐈고 그 앞에
        `Notification.permission === 'granted'` 가드가 있었다. 실 셸에서 재 보니(CDP 프로브):

            origin=http://tauri.localhost · permissionBefore="denied"
            requestPermission() → "denied" (프롬프트 없이 즉시)
            new Notification(...) → 객체는 만들어지나 onerror 발화 · 표시 안 됨

        즉 그 가드가 **항상 거짓**이라 알림이 단 한 번도 뜬 적이 없다. 로드맵이 예약해 두고
        1년 가까이 미이행이던 30분 실측이 이것이었고, 답은 "1개가 아니라 0개"였다.
        웹 API 로는 못 고친다(tauri:// 오리진에 알림 권한이 없다) → 플러그인이 유일한 길이다.
        ⚠ **액션 버튼은 안 붙인다 — Windows 에서 원리적으로 불가**다(Actions API 는 모바일
        전용 · v2 문서 실측). 그래서 세 갈래(완료·휴식·계속)는 **앱 안**의 시한 없는 토스트가
        진다. 알림이 하는 일은 "지금 끝났다"를 알리고 앱으로 부르는 것까지다. */
        .plugin(tauri_plugin_notification::init())
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
            // T-11 — 부재 기간에 밖에서 손댄 노트(mtime 만 본다).
            vault::vault_touched,
            // T-18 — 시험 전날 한 장: 챕터 폴더의 노트 본문(해석은 프런트).
            vault::vault_notes_text,
            /* M-9 — **관측의 짝**. 두 채널(전역 단축키 등록 · 볼트 감시)은 실패 사유를 화면까지
            실어 나르면서 처방이 "앱 재시작"뿐이었다. 둘 다 일시적 원인(선점·폴더 잠금)이 흔해
            *다시 걸기*가 맞는 행동이다. */
            vault::vault_watch_retry,
            hotkey::hotkey_retry,
            // 4단계-B — serve.js /api/artifact/:name 대체.
            artifact::artifact_read,
            // 4단계-C — serve.js /api/run/:tool 대체(파이썬 도구 7종 · P10 W4 에서 11 → 7).
            tools::run_tool,
            /* 4단계-E — Ollama. ⚠ **5종에서 2종으로**(P10 W4): 코치·어휘·브리핑이 읽을거리·증시와
            함께 갔다. 남은 것은 회고 코치와 임베딩(⌘K 의미 검색)이다 — 커맨드는 `kind` 로
            갈리므로 등록은 그대로고 줄어든 것은 프런트의 호출부다. */
            ollama::ollama_run,
            ollama::ollama_cancel,
            ollama::ollama_embed,
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
            /* W3(발산 6회차) — 알림 착지 + 시스템 유휴. 둘 다 데스크톱 전용이라 여기 등록도
            갈라야 하는데, `generate_handler!` 안에서는 `#[cfg]` 가 안 먹는다(매크로가 배열을
            먼저 조립한다) → 모듈은 `#[cfg(desktop)]` 이고 커맨드 자체가 플랫폼에서 `Err` 로
            떨어진다(그 파일 머리주석 §폴백). */
            notify::notify_landing,
            notify::system_idle_seconds,
        ])
        .setup(|app| {
            /* ⚠⚠ **릴리스에도 로거를 등록한다(H1 · 2026-07-30 `/감사 근본`).**

            종전엔 이 블록이 `if cfg!(debug_assertions)` 안에 있었다 → **배포본에서 Rust 로그가
            전부 사라졌다.** 그 대가가 구체적이다:

            · **볼트 감시 중단**(`vault.rs`)의 유일한 신호가 `log::error!` 다 → 자동 갱신이 멈춘
              사실이 화면·로그·텔레메트리 **어디에도** 없었다. 사용자는 "왜 안 바뀌지"만 안다.
            · **전역 캡처 발동 실패**(`hotkey.rs`)도 `log::warn!` 뿐이다 → E20 이 *등록* 실패를
              관측 가능하게 만들어 둔 그 파일에서, *발동* 실패는 여전히 무음이었다.

            2026-07-25 감사가 세운 명제("배포 후를 보는 층이 0")를 텔레메트리·업데이터로 닫았는데,
            **Rust 쪽 절반이 컴파일 조건 하나로 빠져 있었다.** dev 에서는 정상으로 보이므로
            이 부류는 릴리스 빌드로만 드러난다.

            ⚠ 레벨을 갈라 둔다: dev 는 `Info`(개발 중 흐름을 본다), 릴리스는 `Warn`(디스크에
              쌓이는 것은 문제만). 파일 타깃이 있어야 사용자가 나중에 첨부할 수 있다 —
              stdout 만 두면 GUI 앱에서는 그 출력이 아무 데도 안 남는다. */
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(if cfg!(debug_assertions) {
                        log::LevelFilter::Info
                    } else {
                        log::LevelFilter::Warn
                    })
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir { file_name: None },
                    ))
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Stdout,
                    ))
                    .build(),
            )?;
            // 볼트 파일 감시(3단계) — 실패해도 앱은 뜬다(감시가 없으면 수동 갱신으로 돌아갈 뿐).
            vault::start_watch(app.handle().clone());
            /* 전역 캡처 단축키(E20) — 등록 실패는 **삼키지 않는다**(다른 앱이 조합을 선점할 수
            있다). 사유는 `capabilities.hotkey_error` 로 프런트까지 간다. */
            hotkey::register(app.handle());
            log::info!("워크스페이스: {:?}", workspace::resolve(app.handle()));
            Ok(())
        })
        .on_window_event(|_window, event| {
            /* 창이 닫히면 우리가 띄운 자식 프로세스도 함께 내린다.
            ⚠ 이 경로는 **정상 종료에만** 탄다 — 강제 종료·크래시에선 안 불린다. 4단계 이전엔
               그게 "고아 node 가 포트 8000 을 물고 남는" 문제였고 `sidecar::spawn` 이 선점으로
               받아냈지만, **serve.js 가 사라지면서 그 실패 모드 자체가 없어졌다**(포트를 여는
               프로세스가 없다).
            ⚠ 5단계-A 가 잠시 포트를 여는 프로세스(LAN 서버)를 되살렸었지만 **§9-1 결정으로
               은퇴했다**(2026-07-20). 그래서 이 앱은 다시 **여는 포트가 0** 이다.
            ⚠⚠ **이 핸들러가 P10 W4 에서 비었다.** 마지막 세입자는 탐구 잡의 python 트리킬
               (`research::shutdown`)이었고 그 모듈이 사라졌다 — 지금 이 앱이 띄우는 장수
               자식 프로세스는 **0** 이다. 핸들러 자체는 남긴다: 다음에 자식을 띄우는 순간
               정리할 자리가 없으면 같은 고아 프로세스 문제를 다시 만든다. */
            let _ = event;
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
