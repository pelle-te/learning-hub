/*! 상주 트레이 + 자동 시작 — **T-3**(2026-08-02).

## 무엇이 없었나

창을 닫으면 프로세스가 없었다. 그래서 이 앱은 **사용자가 여는 순간에만** 존재했고, 그 사실이
다른 항목을 원리적으로 막고 있었다: `tauri-plugin-notification` 에 **스케줄 API 가 없어서**
(v2 문서 확인 2026-08-02) 예약 알림(T-6)은 발사 시각에 프로세스가 살아 있어야 한다. 우회가
없다 — 그래서 로드맵이 `T-3 → T-6` 을 **원리적 선행**으로 적었다.

## ⚠⚠ 기본값은 **종전 동작**이다

상주도 자동 시작도 **꺼져 있다.** 켜는 것은 설정의 사용자 결정이고, 설치만으로 시스템 상태를
바꾸는 것(자동 시작 등록 · 닫아도 안 죽는 프로세스)은 사용자가 안 본 사이에 벌어지는 변화라
이 앱이 금지하는 형태다. 꺼져 있는 동안 이 파일이 하는 일은 **트레이 아이콘 하나**뿐이다.

## 닫기를 누가 해석하나 — 프런트다

닫기 가드(`lib/tauri.ts` 의 `installCloseGuard`)는 **미저장 SQL 을 flush 한 뒤** 창을 파괴한다.
상주 모드에서 달라지는 것은 마지막 한 줄(`destroy` → `hide`)뿐이라, 그 판단을 여기로 옮기면
flush 계약이 두 곳으로 갈린다. 그래서 Rust 는 **트레이와 자동 시작만** 알고, "닫기가 무엇을
뜻하나"는 프런트가 정한다(`hotkey.rs` 가 _"눌렸다만 보낸다"_ 로 세운 경계와 같은 형태).

## 종료는 왜 이벤트인가

트레이의 `종료` 가 곧바로 `app.exit(0)` 이면 **디바운스 대기 중인 쓰기가 잘린다** — 그건
2단계-C 트랙 B 케이스가 실제로 관측한 실패이고, 닫기 가드가 존재하는 이유 그 자체다.
그래서 `TRAY_QUIT` 이벤트를 올리고 프런트가 flush 후 종료한다. ⚠ 프런트가 죽어 있으면
아무도 안 끄므로 **Rust 가 폴백 타임아웃으로 끈다**(닫힘 > 저장 · 가드와 같은 우선순위).
*/

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

/// 프런트가 듣는 종료 요청. 받으면 flush 후 스스로 끈다.
pub const TRAY_QUIT: &str = "tray:quit";

/// 프런트가 응답하지 않을 때 Rust 가 직접 끄기까지의 시간.
///
/// ⚠ 닫기 가드의 3초와 **같은 값**이다 — 같은 것을 지키는 두 타이머가 다른 값을 가지면
/// 어느 쪽이 이겼는지 사고 때 알 수 없다.
const QUIT_FALLBACK_MS: u64 = 3000;

/// 트레이를 세운다. 실패해도 앱은 뜬다 — 트레이는 부가 표면이다.
///
/// ⚠ 실패를 **삼키지 않는다**(`hotkey.rs` 규율). 다만 여기서 할 수 있는 일은 로그뿐이다.
pub fn setup(app: &tauri::AppHandle) {
    if let Err(e) = build(app) {
        log::warn!("트레이를 세우지 못했습니다: {e}");
    }
}

fn build(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "러닝허브 열기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::AssetNotFound(
                "기본 창 아이콘이 없어 트레이 아이콘을 만들 수 없습니다".into(),
            )
        })?)
        .tooltip("러닝허브")
        .menu(&menu)
        /* 좌클릭으로 메뉴가 뜨지 않게 한다 — Windows 관용은 **좌클릭=열기 · 우클릭=메뉴**이고,
        메뉴가 좌클릭에도 뜨면 "열기"가 두 걸음이 된다. */
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id.as_ref() {
            "open" => show(app),
            "quit" => quit_gracefully(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = ev
            {
                show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// 창을 보이게 하고 포커스한다 — **숨겨진 창을 되살리는 유일한 경로**.
///
/// ⚠⚠ 되살리기 진입점은 둘이다(트레이 클릭·메뉴 · **두 번째 실행**), 그런데 종전엔
/// `lib.rs` 의 single-instance 핸들러가 이 함수를 안 쓰고 `unminimize + set_focus` 만
/// 손으로 적고 있었다(H-3 · 2026-08-06 감사). `hide()` 로 숨긴 창은 **`unminimize` 로 안
/// 돌아온다** — 즉 상주 모드에서 시작 메뉴로 다시 실행하면 **아무 일도 안 일어났다**
/// (프로세스는 이미 떠 있으니 새 창도 안 뜬다). 두 경로가 비대칭이면 한쪽만 고쳐진다 →
/// `pub(crate)` 로 열어 **같은 함수를 쓴다.**
pub(crate) fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/* ── A-6 **트레이가 데이터를 나른다**(발산 6회차 · 2026-08-07) ─────────────────
⚠⚠ 상주 모드를 켜면 **정보가 있는 표면이 0이 된다.** 창을 `hide()` 하면 작업표시줄 버튼이
사라지고, 거기 붙어 있던 오버레이 배지(Q-30)도 **함께 사라진다** — 즉 "창을 닫아도 남는다"를
켠 순간 남는 유일한 표면은 아무것도 말하지 않는 아이콘 하나다. 그게 가장 필요한 때인데.

처방은 최소다: **툴팁이 한 줄을 나른다.** 아이콘에 수를 굽는 것(합성)은 안 한다 — 기본 창
아이콘을 래스터로 풀어 캔버스 합성을 해야 하고, 그 배관이 이 값보다 크다. 툴팁만으로
"수 하나 보려고 창을 띄우는 왕복"이 사라진다.

⚠ **문구를 Rust 가 만들지 않는다.** 무엇을 말할지는 앱 상태를 아는 프런트가 정한다
(`reminder.ts` 가 알림에 대해 세운 것과 같은 경계 — Rust 는 채널만 안다).
⚠ 트레이가 없으면(빌드 실패·플랫폼) **조용히 무동작**이다. 부가 표면이라 앱을 막지 않는다. */
#[tauri::command]
pub fn tray_tooltip(app: tauri::AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id("main") {
        // 빈 문자열이면 기본 이름으로 되돌린다 — 빈 툴팁은 "정보 없음"이 아니라 깨진 것처럼 보인다.
        let t = if text.trim().is_empty() {
            "러닝허브"
        } else {
            text.trim()
        };
        let _ = tray.set_tooltip(Some(t));
    }
}

/// 프런트에 종료를 요청하고, 응답이 없으면 직접 끈다(머리주석 §종료).
fn quit_gracefully(app: &tauri::AppHandle) {
    let emitted = app.emit(TRAY_QUIT, ()).is_ok();
    if !emitted {
        app.exit(0);
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(QUIT_FALLBACK_MS)).await;
        /* 여기 도달했다는 것은 프런트가 스스로 안 껐다는 뜻이다. 저장을 더 기다리지 않는다 —
        사용자가 끄겠다고 눌렀는데 안 꺼지는 것이 이 앱에서 가장 나쁜 실패다(1단계 실측). */
        handle.exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /* ⚠⚠ **프런트와의 상수 정합은 여기서 못 잡는다 — `web/test/shellContract.test.ts` 로
    옮겼다**(M-8 · 2026-08-06 감사).

    종전엔 이 자리에 `assert_eq!(QUIT_FALLBACK_MS, 3000)` 과 `assert_eq!(TRAY_QUIT, "tray:quit")`
    가 있었다. 둘 다 **자기 자신을 손베낌 상수와 비교**하므로 TS 쪽이 5000 이 되어도, 이벤트
    이름이 바뀌어도 통과한다 — 계약의 한쪽 끝만 보는 검사였다. 옳은 방향은 `dbMigrations.test.ts`
    의 선례다: **한쪽이 상대의 원본을 파싱해서** 대조한다. TS→Rust 방향인 이유는 반대로 하면
    cargo 빌드가 `web/` 에 결합되기 때문(cargo 만 도는 CI 에서 깨진다).

    여기 남는 것은 **Rust 안에서만 성립하는 것**이다 — 트레이 표면 자체는 실물 OS 라 유닛으로도
    트랙 B 로도(WebView2 밖) 못 본다. */
    /* 0 이면 프런트가 flush 할 틈 없이 즉시 죽는다 — 값의 *크기*는 위 TS 테스트가 프런트와
    대조하고, 여기서는 "기다리기는 한다"만 잠근다(두 파일이 같은 것을 재지 않게).

    ⚠ `#[test]` 가 아니라 **컴파일 타임 단언**이다(2026-08-06). 둘 다 상수라 실행할 것이 없고,
    clippy(`assertions_on_constants`)가 정확히 그 사실을 지적한다 — 런타임에 재는 시늉을 하면
    "테스트가 하나 더 있다"는 착시만 남는다. 이 형태는 값이 틀리면 **빌드가** 실패한다. */
    const _: () = assert!(QUIT_FALLBACK_MS > 0);
    const _: () = assert!(!TRAY_QUIT.is_empty());
}
