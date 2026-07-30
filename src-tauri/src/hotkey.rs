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

   ⚠ **2026-07-30 `/감사 근본`(H1) 정정: 위 문장은 *등록* 에만 참이었다.** 발동(창 표시·포커스·
   이벤트 전달) 실패는 `log::warn!` 뿐이었고 릴리스엔 로거가 없었다(`lib.rs` 가 로거를
   `debug_assertions` 안에만 등록했다) → 배포본에서 무음. `get_webview_window` 가 `None` 인
   분기는 **로그조차 없었다**. 지금은 발동 실패도 `LAST_FIRE_ERR` 로 같은 채널을 탄다.

   ## 범위 — **앱이 실행 중일 때만 산다**(2026-07-30 실측으로 확정)

   전역 단축키의 OS 등록은 **프로세스에 묶인다** — 앱이 꺼지면 조합도 함께 풀린다. 그래서 이
   기능의 값은 "사용자가 셸을 켜 놓고 사는가"에 달려 있었고, 로드맵 E20 이 그 실측을 선행조건으로
   달아 첫 조각을 여기까지로 못박았다.

   **실측 결과: 사용자는 켜 놓고 살지 않는다.** 그래서 두 가지가 확정됐다:

   · **다음 조각(`/capture` 알약 라우트)은 드롭이다.** 상시 캡처 인박스를 전제한 설계였고 그
     전제가 거짓이면 남는 것은 금도금이다. 앱이 꺼진 동안의 캡처는 **E14(폰 캡처 바)** 가 덮는다 —
     로드맵이 예고한 그대로이고, 그건 이미 출하됐다. 자동 시작은 닫힌 항목이라 여기서 열지 않는다.
   · **이 조각은 남긴다 — 값이 0 이 아니라 *좁다*.** 실제로 값이 나오는 구간은 **집중 세션 중**이다:
     세션을 시작하려면 앱을 열게 되고, 그 뒤 PDF·강의 창으로 포커스를 넘긴다. 붙잡을 생각이
     떠오르는 자리가 정확히 거기다. 즉 이것은 "상시 인박스"가 아니라 **세션 스코프 어포던스**다.
   ⚠ 그 좁은 값이 이 표면(플러그인 1 · 권한 3 · 채널 1 · 치트시트 1줄)을 못 갚는다고 판단되면
     **되돌리기는 커밋 하나**다 — 위 넷을 지우면 끝이고 다른 계약에 엮인 것이 없다(그게 이 조각을
     이 크기로 자른 이유다).

   구현상 프런트에는 **"눌렸다"만** 보낸다 — 무엇을 열지는 화면 층의 결정이라 대상을 바꾸는 것이
   프런트 한 줄이고 Rust 재빌드가 0 이다.

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

/* ⚠⚠ **발동(fire) 실패도 관측한다(H1 · 2026-07-30 `/감사 근본`).**

이 파일의 머리주석은 *등록* 실패를 삼키지 않는 것을 존재 이유의 절반으로 선언했는데,
**발동 실패는 그 규율 밖이었다**: `w.show()`·`set_focus()`·`emit()` 이 실패하면 `log::warn!`
뿐이었고, 릴리스 빌드엔 로거가 아예 없었다(H1 의 나머지 절반 — `lib.rs`). 더 나쁜 것은
`get_webview_window("main")` 이 `None` 인 경우인데, 그때는 분기 전체가 **로그조차 없이**
no-op 이었다.

사용자가 보는 증상은 등록 실패와 **똑같다** — "키를 눌렀는데 아무 일도 안 일어난다".
원인이 다른데 관측 가능성이 갈리면, 제보를 받아도 어느 쪽인지 모른다. 같은 채널로 보낸다. */
static LAST_FIRE_ERR: Mutex<Option<String>> = Mutex::new(None);

fn note_fire_err(what: &str, e: impl std::fmt::Display) {
    log::warn!("전역 캡처 — {what} 실패: {e}");
    *LAST_FIRE_ERR.lock().expect("hotkey fire err") = Some(format!("{what} 실패: {e}"));
}

/// 등록 상태를 읽는다. `capabilities` 가 이 값을 실어 프런트로 보낸다.
///
/// 반환: `(등록됨, 실패 사유)`. 아직 시도 전이면 `(false, None)` — **`false` 를 "실패"로 읽지 말 것**.
/// 사유가 있어야 실패다(그 구분이 없으면 브라우저·테스트가 전부 "실패"로 보인다).
///
/// ⚠ 등록은 됐는데 **발동**이 실패한 경우도 사유를 싣는다(H1). 그때 첫 값은 `true` 로 남는다 —
/// 등록은 실제로 됐기 때문이다. 두 실패를 한 채널로 보내되 **서로 덮지 않는다**(등록 실패가 우선).
pub fn status() -> (bool, Option<String>) {
    let fire = LAST_FIRE_ERR.lock().expect("hotkey fire err").clone();
    match &*STATUS.lock().expect("hotkey status") {
        Some(Ok(())) => (true, fire),
        Some(Err(e)) => (false, Some(e.clone())),
        None => (false, fire),
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
            let Some(w) = handle.get_webview_window("main") else {
                /* ⚠ 종전엔 이 분기가 **로그조차 없는 no-op** 이었다(H1). 창이 없는 상태에서
                키를 누르면 아무 일도 안 일어나고 아무 데도 안 남았다 — 등록 실패와 증상이
                같은데 관측 가능성만 갈렸다. */
                note_fire_err("메인 창을 찾지 못함", "창이 없거나 이미 파괴됨");
                return;
            };
            /* 창을 띄우고 포커스 — 최소화·백그라운드 상태에서 눌러도 즉시 쓸 수 있어야 한다.
            ⚠ 실패를 삼키지 않는다: 여기서 실패하면 키는 먹었는데 창이 안 뜨는 상태이고,
              그건 사용자에게 "고장"으로 보인다. */
            if let Err(e) = w.show() {
                note_fire_err("창 표시", e);
            }
            if let Err(e) = w.set_focus() {
                note_fire_err("포커스", e);
            }
            // 무엇을 열지는 프런트가 정한다(라우팅·팔레트는 화면 층의 결정).
            if let Err(e) = handle.emit(CAPTURE_EVENT, ()) {
                note_fire_err("이벤트 전달", e);
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

    /* H1(2026-07-30 `/감사 근본`) — **발동 실패도 같은 채널로 간다.** 사용자가 보는 증상이
    등록 실패와 같으므로(키를 눌렀는데 아무 일도 안 일어난다), 관측 가능성이 갈리면 제보를
    받아도 어느 쪽인지 모른다. 여기서 잠그는 것은 **두 실패가 서로를 덮지 않는다**는 것이다. */
    #[test]
    fn 등록은_됐는데_발동이_실패하면_등록됨_true_에_사유가_실린다() {
        set_status(Some(Ok(())));
        *LAST_FIRE_ERR.lock().unwrap() = None;
        note_fire_err("창 표시", "테스트 사유");

        let (ok, err) = status();
        assert!(
            ok,
            "등록은 실제로 됐다 — false 로 뒤집으면 진단이 거짓말한다"
        );
        assert!(
            err.as_deref().is_some_and(|s| s.contains("창 표시")),
            "발동 실패 사유가 프런트까지 가야 한다: {err:?}"
        );
        *LAST_FIRE_ERR.lock().unwrap() = None;
    }

    #[test]
    fn 등록_실패가_발동_사유에_덮이지_않는다() {
        set_status(Some(Err("HotKey already registered".into())));
        note_fire_err("포커스", "나중에 난 실패");

        let (ok, err) = status();
        assert!(!ok);
        // 등록이 안 됐으면 그게 근본 원인이다 — 발동 사유를 앞세우면 엉뚱한 곳을 보게 된다.
        assert_eq!(err.as_deref(), Some("HotKey already registered"));
        *LAST_FIRE_ERR.lock().unwrap() = None;
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
