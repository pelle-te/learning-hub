/* ============================================================
   hotkey.rs — **전역 단축키**(E20 첫 조각 · 2026-07-30).

   ## 무엇을 푸는가

   PC 에서 강의·PDF 를 보다 무언가를 붙잡으려면 alt-tab → ⌘K → ⌘Enter → alt-tab = **화면 전환
   2회**에 레일 11탭·대시보드가 통째로 눈에 들어오는 문맥 이탈이었다. `shortcuts.ts` 가
   _"캡처는 떠올랐을 때 쓰는 것"_ 이라 적고도 그 입구는 **앱이 포커스일 때만** 열렸다.

   ## ⚠⚠ 이 파일의 존재 이유 절반은 **등록 실패를 관측 가능하게** 만드는 것이다

   전역 단축키는 **OS 전체에서 한 조합을 한 앱만** 가질 수 있다. 다른 앱이 선점하고 있으면 등록이
   실패하고, 그때 흔한 구현은 `let _ = register(...)` 로 **조용히 삼키는 것**이다. 그러면:

   · 사용자는 키를 눌러도 아무 일이 없는데 **왜인지 알 방법이 0** 이다.
   · 개발자도 모른다 — 로그도 UI 도 없으니 "안 된다"는 제보만 남는다.
   · 그건 이 저장소가 2026-07-25 감사에서 잡은 **"죽은 분기"** 와 정확히 같은 형태다
     (`ErrorBoundary` 셋이 폴백만 그리고 아무것도 기록하지 않던 것).

   그래서 실패를 **상태로 보관**하고 `capabilities` 에 실어 보낸다 — 그 커맨드는 이미 프런트 8곳이
   "백엔드를 지금 쓸 수 있는가"로 소비하는 진단 채널이라, 새 표면을 만들지 않고 관측이 붙는다.

   ## 왜 첫 조각이 여기까지인가

   로드맵 E20 은 _"첫 조각은 핫키 등록 + **등록 실패 관측만**"_ 이라 못박았다. 이유는 그 뒤
   단계(`/capture` 알약 라우트)가 **사용 패턴 실측에 달려 있기** 때문이다 — 사용자가 셸을 켜 놓고
   사는지가 미측정이고, 안 켜 두면 이 기능의 값이 0 이다(그 구멍은 자동 시작으로만 풀리는데 그건
   닫힌 항목이다). 그래서 지금은 **창을 띄우고 포커스한 뒤 프런트에 알린다** — 프런트가 그
   신호로 무엇을 열지는 화면 층의 결정이고, 되돌리기가 한 줄이다.

   ⚠ 단축키를 바꾸지 말 것(합의 없이). 전역 조합은 사용자의 다른 앱과 충돌할 수 있어서,
     바꾸는 것은 "설정 하나 고치기"가 아니라 **사용자 환경에 대한 변경**이다.
   ⚠ 새 창·새 WebView 를 만들지 않는다 — N-8(미니 HUD)의 논증을 그대로 상속한다. 그래서 SQLite
     커넥션·부팅 순서·single-instance·종료 flush 계약이 **전부 그대로**다.
============================================================ */

use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 캡처 전역 단축키. `CmdOrCtrl+Shift+Space` — 텍스트 입력을 방해하지 않는 조합.
pub const CAPTURE_ACCELERATOR: &str = "CmdOrCtrl+Shift+Space";

/// 프런트가 듣는 이벤트 이름. **무엇을 열지는 화면 층이 정한다**(이 파일은 "눌렸다"만 말한다).
pub const CAPTURE_EVENT: &str = "global-capture";

/// 등록 결과 — `None` 이면 아직 시도 전(비-데스크톱·테스트), `Some(Ok)` 성공, `Some(Err)` 실패 사유.
static STATUS: Mutex<Option<Result<(), String>>> = Mutex::new(None);

/// 등록 상태를 읽는다. `capabilities` 가 이 값을 실어 프런트로 보낸다.
///
/// 반환: `(등록됨, 실패 사유)`. 아직 시도 전이면 `(false, None)` — **`false` 를 "실패"로 읽지 말 것**.
/// 사유가 있어야 실패다(그 구분이 없으면 브라우저·테스트가 전부 "실패"로 보인다).
pub fn status() -> (bool, Option<String>) {
    match &*STATUS.lock().expect("hotkey status") {
        Some(Ok(())) => (true, None),
        Some(Err(e)) => (false, Some(e.clone())),
        None => (false, None),
    }
}

/// 테스트용 — 상태를 직접 세운다(등록은 OS 를 타므로 유닛에서 부를 수 없다).
#[cfg(test)]
fn set_status(v: Option<Result<(), String>>) {
    *STATUS.lock().expect("hotkey status") = v;
}

/// 앱 시작 시 1회. **실패해도 앱은 뜬다** — 전역 단축키는 편의이고, 없으면 ⌘K 로 돌아갈 뿐이다.
///
/// ⚠ `let _ =` 로 삼키지 않는다(이 파일 머리주석). 실패는 `STATUS` 에 남고 로그에도 남는다.
pub fn register(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    let handle = app.clone();
    let result = app
        .global_shortcut()
        .on_shortcut(CAPTURE_ACCELERATOR, move |_app, _shortcut, event| {
            /* ⚠ **Pressed 만 처리한다.** 기본으로 오는 것은 눌림과 떼임 둘이라, 가드가 없으면
            한 번 눌러 **두 번** 열린다(이 부류는 조용히 틀리고 사용자에게만 보인다). */
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if let Some(w) = handle.get_webview_window("main") {
                /* 창을 띄우고 포커스 — 최소화·백그라운드 상태에서 눌러도 즉시 쓸 수 있어야 한다.
                ⚠ 실패를 삼키지 않는다: 여기서 실패하면 키는 먹었는데 창이 안 뜨는 상태이고,
                  그건 사용자에게 "고장"으로 보인다. */
                if let Err(e) = w.show() {
                    log::warn!("전역 캡처 — 창 표시 실패: {e}");
                }
                if let Err(e) = w.set_focus() {
                    log::warn!("전역 캡처 — 포커스 실패: {e}");
                }
                // 무엇을 열지는 프런트가 정한다(라우팅·팔레트는 화면 층의 결정).
                if let Err(e) = handle.emit(CAPTURE_EVENT, ()) {
                    log::warn!("전역 캡처 — 이벤트 전달 실패: {e}");
                }
            }
        })
        .map_err(|e| e.to_string());

    match &result {
        Ok(()) => log::info!("전역 캡처 단축키 등록: {CAPTURE_ACCELERATOR}"),
        Err(e) => log::warn!(
            "전역 캡처 단축키 등록 실패({CAPTURE_ACCELERATOR}) — 다른 앱이 선점했을 수 있어요: {e}"
        ),
    }
    *STATUS.lock().expect("hotkey status") = Some(result);
}

#[cfg(test)]
mod tests {
    use super::*;

    /* ⚠ 등록 자체는 OS 를 타므로 유닛에서 못 부른다. 여기서 잠그는 것은 **상태 해석**이고,
    그게 실제로 틀릴 수 있는 부분이다: "아직 시도 안 함"과 "실패"를 뭉개면 브라우저·테스트가
    전부 실패로 보이고, 그러면 프런트가 상시 경고를 띄워 그 표면이 곧 무시된다. */

    #[test]
    fn 시도_전은_실패가_아니다() {
        set_status(None);
        let (ok, err) = status();
        assert!(!ok, "등록되지 않았다");
        assert!(
            err.is_none(),
            "그러나 실패 사유는 없어야 한다 — 아직 시도조차 안 했다"
        );
    }

    #[test]
    fn 성공은_사유가_없다() {
        set_status(Some(Ok(())));
        assert_eq!(status(), (true, None));
    }

    #[test]
    fn 실패는_사유를_보존한다() {
        set_status(Some(Err("HotKey already registered".into())));
        let (ok, err) = status();
        assert!(!ok);
        // 사유가 프런트까지 가야 사용자가 "다른 앱이 선점했다"를 알 수 있다.
        assert_eq!(err.as_deref(), Some("HotKey already registered"));
    }

    #[test]
    fn 단축키_문자열이_비어_있지_않다() {
        // 빈 문자열이면 등록이 조용히 무의미해진다(플러그인이 파싱 실패로 떨어진다).
        assert!(!CAPTURE_ACCELERATOR.is_empty());
        assert!(
            CAPTURE_ACCELERATOR.contains('+'),
            "수정자 없는 전역 키는 다른 앱을 망가뜨린다"
        );
    }
}
