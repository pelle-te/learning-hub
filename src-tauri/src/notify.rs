/*! 알림 **착지** + 시스템 **유휴** — 개입 채널이 도착지와 조건을 갖는다(W3 · 발산 6회차).

## ⚠⚠ 왜 플러그인으로는 안 되나 — 실측

감사 이관 항목이 *"`shellNotify` 클릭 핸들러 등록 0건"* 이었다. 그 처방으로 플러그인의
`onAction(...)` 을 붙이려다 크레이트 원본을 열어 보니 Windows 경로가 이렇다
(`tauri-plugin-notification-2.3.3/src/desktop.rs`):

```rust
tauri::async_runtime::spawn(async move {
    let _ = notification.show();      // ← 핸들을 버린다
});
```

즉 **활성화 콜백을 배관에 아예 안 태운다.** `onAction` 은 모바일(그리고 일부 데스크톱)
전용이고, Windows 에서는 리스너를 등록해도 **영원히 안 불린다** — 등록만 해 놓으면
"클릭 착지가 있다"는 착시만 생긴다(이 저장소가 P-8 에서 이미 물린 형태: 가드가 항상
거짓이라 알림을 한 번도 못 쐈다).

그래서 여기서는 **같은 크레이트를 직접 쓴다**. `notify-rust` 가 Windows 에서 부르는 것이
`tauri-winrt-notification` 이고, 그건 `on_activated` 를 갖고 있다(0.7.3 실측). 새 트리가
생기지 않는다 — 이미 의존성 그래프 안에 있는 크레이트다.

⚠ **경로를 OS 에 실어 보내지 않는다.** 토스트 XML 의 `launch` 속성을 세우는 API 가 이
크레이트에 없어서 본문 클릭의 인자는 항상 `None` 이다 — 대신 착지 경로를 **클로저가
들고 있는다**(어차피 알림 한 발마다 토스트 한 개다).
⚠ **실패하면 Err 를 준다.** 호출부(`lib/tauri.ts`)가 플러그인 경로로 폴백한다: 착지가 없는
알림이 알림이 없는 것보다는 낫다. 조용히 성공한 척하면 그게 P-8 의 재발이다.

## 유휴(N-8)는 왜 Rust 인가

*"PC 앞인데 5분째 무입력"* 은 **시스템 전역** 사실이다. 웹뷰가 보는 것은 자기 창의 입력뿐이라
(창이 뒤에 있으면 항상 "무입력") 프런트에서는 원리적으로 못 잰다. Win32 `GetLastInputInfo` 가
그 값을 주고, 다른 플랫폼에는 대응물이 제각각이라 **0(=모름)** 을 돌려준다.

⚠⚠ **이 단계에서는 알림을 안 쏜다.** 로드맵이 적은 가장 싼 검증이 _"알림 0으로 3일 유휴
로그만"_ 이다 — 5분+ 유휴가 하루 몇 번·몇 시에 나는지가 이 안의 전제이고, 그 전제(T-3 이
_"사용자는 켜 놓고 살지 않는다"_ 라 적은 실측은 **트레이·자동시작 이전** 것이다)를 재기 전에
개입을 붙이면 알림 피로만 남는다. 여기 있는 것은 **자**뿐이다.
*/

/// 프런트가 듣는 알림 클릭. payload = 착지 경로(문자열).
///
/// ⚠ 이름의 정본은 여기다 — `web/test/shellContract.test.ts` 가 이 줄을 파싱해 프런트 상수와
/// 대조한다(손베낌 상수끼리 비교하면 계약의 한쪽 끝만 보게 된다 · M-8).
pub const NOTIFY_CLICK: &str = "notify:click";

/// 설치본이면 앱 식별자, 개발 빌드면 `None`(= PowerShell AUMID 폴백).
///
/// ⚠⚠ **손으로 정한 규칙이 아니라 플러그인의 규칙을 그대로 옮긴 것**이다(`desktop.rs`):
/// AUMID 는 설치 과정에서 등록되므로, `target/debug`·`target/release` 에서 직접 띄운 exe 에
/// 그 식별자를 주면 **토스트가 아예 안 뜬다**(등록되지 않은 AppID). 두 규칙이 갈리면
/// "개발 중엔 되는데 배포본에서 안 되는"(혹은 그 반대) 부류가 된다.
pub(crate) fn installed_app_id(exe_dir: &std::path::Path, identifier: &str) -> Option<String> {
    let sep = std::path::MAIN_SEPARATOR;
    let dir = exe_dir.display().to_string();
    if dir.ends_with(&format!("{sep}target{sep}debug"))
        || dir.ends_with(&format!("{sep}target{sep}release"))
    {
        return None;
    }
    Some(identifier.to_string())
}

/// 착지 경로를 가진 알림 한 발. **Windows 전용** — 다른 플랫폼은 `Err` 로 폴백을 요청한다.
///
/// ⚠ 클릭하면 창을 되살리고(`tray::show` — 상주 모드의 숨은 창까지) 경로를 프런트에 던진다.
///   둘 중 하나만 하면 반쪽이다: 이벤트만 보내면 숨은 창에서 라우팅만 일어나고(사용자는 아무
///   변화도 못 본다), 창만 띄우면 알림이 부른 그 조각으로 못 간다.
#[tauri::command]
pub fn notify_landing(
    app: tauri::AppHandle,
    title: String,
    body: String,
    route: String,
) -> Result<(), String> {
    #[cfg(all(windows, desktop))]
    {
        use tauri::Emitter;
        use tauri_winrt_notification::Toast;

        let exe = tauri::utils::platform::current_exe().map_err(|e| e.to_string())?;
        let dir = exe
            .parent()
            .ok_or_else(|| "exe 폴더를 못 찾았습니다".to_string())?;
        let id = installed_app_id(dir, &app.config().identifier);
        let app_id = id.as_deref().unwrap_or(Toast::POWERSHELL_APP_ID);

        let handle = app.clone();
        Toast::new(app_id)
            .title(&title)
            .text1(&body)
            .on_activated(move |_| {
                crate::tray::show(&handle);
                let _ = handle.emit(NOTIFY_CLICK, route.clone());
                Ok(())
            })
            .show()
            .map_err(|e| e.to_string())
    }
    #[cfg(not(all(windows, desktop)))]
    {
        let _ = (&app, &title, &body, &route);
        Err("이 플랫폼에는 착지 가능한 알림 채널이 없습니다".into())
    }
}

/// 시스템 전역 유휴 시간(초). 못 재면 **0** — "지금 막 입력했다"와 같은 값이라 안전한 쪽으로 틀린다.
///
/// ⚠ `GetLastInputInfo` 의 `dwTime` 은 32비트 틱이라 49.7일에 한 바퀴 돈다 → `wrapping_sub`
///   가 필수다. 뺄셈을 그냥 하면 그 순간 **음수가 거대한 양수로** 접혀 "3주째 유휴"가 찍힌다.
#[tauri::command]
pub fn system_idle_seconds() -> u64 {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::GetTickCount;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

        let mut lii = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        // SAFETY: 크기를 채운 구조체 하나만 넘긴다. 실패하면 0(=모름)으로 떨어진다.
        let ok = unsafe { GetLastInputInfo(&mut lii) };
        if ok == 0 {
            return 0;
        }
        let now = unsafe { GetTickCount() };
        u64::from(now.wrapping_sub(lii.dwTime)) / 1000
    }
    #[cfg(not(windows))]
    {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /* ⚠ 여기서 잴 수 있는 것은 **경로 규칙**뿐이다. 토스트 표면도 `GetLastInputInfo` 도 실물
    OS 라 유닛으로도 트랙 B(WebView2 안)로도 관측되지 않는다 — `tray.rs` 가 세운 것과 같은
    경계다. 대신 `system_idle_seconds` 는 **부를 수는 있으므로** 한 번 불러 본다(링크 오류·
    구조체 크기 실수는 그것만으로 드러난다). */

    #[test]
    fn 개발_빌드_경로면_식별자를_안_쓴다() {
        let dev: PathBuf = ["C:\\", "atelier", "hub", "src-tauri", "target", "release"]
            .iter()
            .collect();
        assert_eq!(installed_app_id(&dev, "com.jin.learninghub"), None);
        let dbg: PathBuf = ["C:\\", "x", "target", "debug"].iter().collect();
        assert_eq!(installed_app_id(&dbg, "com.jin.learninghub"), None);
    }

    #[test]
    fn 설치_경로면_식별자를_쓴다() {
        let installed: PathBuf = ["C:\\", "Program Files", "러닝허브"].iter().collect();
        assert_eq!(
            installed_app_id(&installed, "com.jin.learninghub"),
            Some("com.jin.learninghub".to_string())
        );
    }

    /// 값 자체는 환경마다 다르다 — 단언하는 것은 **호출이 성립한다**는 것뿐이다.
    #[test]
    fn 유휴_조회가_터지지_않는다() {
        let _ = system_idle_seconds();
    }
}
