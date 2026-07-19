/*! serve.js sidecar — 1단계에서 백엔드는 그대로 두고 **셸만** 이사한다(설계 §4-1단계).

`러닝허브_실행.bat` 의 4기능 중 셋을 여기서 흡수한다:
  · 포트 8000 stale 서버 강제종료 → `tauri-plugin-single-instance`(lib.rs)
  · 헬스체크 폴링(`:40-45`)      → `wait_until_ready`
  · `chcp 65001` / `PYTHONIOENCODING` → spawn env 로 승계
  · Chrome `--app=` 실행         → WebView2 가 대체(창 자체가 앱)

⚠ 4단계에서 이 모듈 전체가 사라진다(파이썬 spawn·잡 모델이 Rust 커맨드가 됨).
그때의 동등성 기준은 `web/test/serve.test.ts`(0단계-A)다.
*/
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 살아있는 sidecar 프로세스. 창 종료 시 정리해야 좀비 노드가 포트를 물고 남지 않는다.
pub static SERVER: Mutex<Option<Child>> = Mutex::new(None);

pub const PORT: u16 = 8000;

/// serve.js 를 node 로 띄운다. cwd 는 **앱 폴더(hub/)** 이고, 워크스페이스는 환경변수로 주입한다
/// — serve.js 가 `__dirname` 으로 추론하던 것을 설정값이 이기게 하는 지점(WORK 경로 승격).
pub fn spawn(app_dir: &Path, workspace: Option<&Path>) -> Result<(), String> {
    let mut guard = SERVER.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(()); // 이미 떠 있다(단일 인스턴스라 정상 경로에선 안 일어난다)
    }
    let script = app_dir.join("serve.js");
    if !script.is_file() {
        return Err(format!("serve.js 를 찾지 못했습니다: {}", script.display()));
    }
    let mut cmd = Command::new("node");
    cmd.arg(&script)
        .current_dir(app_dir)
        // 파이썬 도구가 한글 stdout 을 깨뜨리지 않게 — .bat 의 chcp 65001 짝을 승계.
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(ws) = workspace {
        // serve.js 가 이 값을 __dirname 추론보다 우선한다(0단계-A 이후 serve.js 에 추가).
        cmd.env("LH_WORKSPACE", ws);
    }
    #[cfg(windows)]
    {
        // 콘솔 창이 따로 뜨지 않게(CREATE_NO_WINDOW) — .bat 실행의 검은 창을 없애는 것도 이사 목적 중 하나.
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| {
        format!("node 를 실행하지 못했습니다({e}) — Node.js 가 설치되어 있어야 합니다.")
    })?;

    // sidecar 로그를 앱 로그로 흘려보낸다(창이 없으니 stdout 을 놓치면 진단 수단이 사라진다).
    for (label, pipe) in [
        (
            "serve.js",
            child
                .stdout
                .take()
                .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
        ),
        (
            "serve.js!",
            child
                .stderr
                .take()
                .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
        ),
    ] {
        if let Some(p) = pipe {
            std::thread::spawn(move || {
                for line in BufReader::new(p).lines().map_while(Result::ok) {
                    log::info!("[{label}] {line}");
                }
            });
        }
    }
    *guard = Some(child);
    Ok(())
}

/// `/api/ping` 이 응답할 때까지 대기 — .bat 의 헬스체크 폴링을 대체.
/// 실패해도 앱은 뜬다(프런트가 오프라인 UI 로 우아 폴백하는 게 기존 설계다 · usePing).
pub fn wait_until_ready(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if std::net::TcpStream::connect_timeout(
            &([127, 0, 0, 1], PORT).into(),
            Duration::from_millis(300),
        )
        .is_ok()
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

/// 창 종료·앱 종료 시 정리. 좀비가 남으면 다음 실행이 EADDRINUSE 로 죽는다
/// (그 증상을 없애려고 .bat 가 taskkill 을 하고 있었다).
pub fn shutdown() {
    if let Ok(mut guard) = SERVER.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
