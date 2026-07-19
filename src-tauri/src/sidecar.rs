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

/// **입양한** sidecar 의 PID — 우리가 spawn 하지 않고 재사용한 고아(크래시 잔존물)다.
/// `Child` 핸들이 없어 `SERVER` 로는 못 잡으므로 PID 만 들고 있다가 종료 때 같이 내린다.
/// 이게 없으면 "재사용한 세션은 앱을 닫아도 node 가 영원히 남는다"가 된다(실측).
static ADOPTED: Mutex<Option<u32>> = Mutex::new(None);

pub const PORT: u16 = 8000;

/// serve.js 를 node 로 띄운다. cwd 는 **앱 폴더(hub/)** 이고, 워크스페이스는 환경변수로 주입한다
/// — serve.js 가 `__dirname` 으로 추론하던 것을 설정값이 이기게 하는 지점(WORK 경로 승격).
pub fn spawn(app_dir: &Path, workspace: Option<&Path>) -> Result<(), String> {
    let mut guard = SERVER.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(()); // 이미 떠 있다(단일 인스턴스라 정상 경로에선 안 일어난다)
    }

    /* 고아 sidecar 선점 처리 — 앱이 **강제 종료·크래시**로 죽으면 `Destroyed` 가 안 불려
    node 가 포트 8000 을 물고 살아남는다(2026-07-19 실측). 그대로 spawn 하면 새 serve.js 가
    EADDRINUSE 로 즉시 죽고, 앱은 이유 없이 오프라인 UI 로 뜬다 — `.bat` 이 taskkill 로
    때려잡던 상황이 `single-instance` 만으로는 안 사라진다는 뜻이다(그건 *정상* 중복 실행만 막는다).

    무조건 죽이지 않고 **워크스페이스가 같으면 재사용**한다: 같은 서버면 죽였다 다시 띄우는 게
    순수 손해(부팅이 느려지고, 진행 중인 파이썬 잡을 죽인다). 다르면 반드시 교체해야 한다 —
    낡은 `LH_WORKSPACE` 로 도는 서버는 파이썬 도구 11종이 **조용히 빈 결과**를 내게 하고,
    그게 이 앱에서 가장 진단하기 어려운 실패다(workspace.rs 가 표지 검사를 하는 것과 같은 이유). */
    if let Some(running) = probe_workspace() {
        let want = workspace.map(|p| p.to_string_lossy().into_owned());
        if want.as_deref() == Some(running.as_str()) || want.is_none() {
            // 재사용하되 **입양**한다 — 그래야 이 세션이 끝날 때 같이 내려간다.
            if let Ok(mut a) = ADOPTED.lock() {
                *a = port_owner_pid();
            }
            log::info!("기존 serve.js 재사용(workspace={running})");
            return Ok(());
        }
        log::warn!("포트 {PORT} 의 serve.js 가 다른 워크스페이스({running})라 교체합니다");
        kill_port_owner();
        // 포트가 실제로 풀릴 때까지 잠깐 기다린다(TIME_WAIT 아님 — 프로세스 종료 지연).
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline && probe_workspace().is_some() {
            std::thread::sleep(Duration::from_millis(150));
        }
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

/// 포트 8000 에 떠 있는 게 **우리 serve.js 인지**와 그 워크스페이스를 확인한다.
/// `/api/ping` 이 `{"server":"러닝허브 제어판", ..., "work":"D:\\atelier"}` 를 준다.
///
/// 의존성을 더하지 않으려고 HTTP/1.0 요청을 손으로 쓴다 — 요청 1개·응답 1개면 끝이라
/// http 크레이트를 들일 이유가 없다(4단계에서 백엔드가 Rust 가 되면 이 함수도 사라진다).
/// 우리 서버가 아니면(다른 앱이 8000 을 쓰는 중) `None` — 그런 프로세스를 죽이면 안 된다.
fn probe_workspace() -> Option<String> {
    use std::io::{Read, Write};
    let mut s = std::net::TcpStream::connect_timeout(
        &([127, 0, 0, 1], PORT).into(),
        Duration::from_millis(500),
    )
    .ok()?;
    s.set_read_timeout(Some(Duration::from_millis(1500))).ok()?;
    // ⚠ Host 는 **포트까지** 보내야 한다 — serve.js `hostOK`(:526) 가 DNS 리바인딩 방어로
    // `127.0.0.1:{PORT}` 정확 일치를 요구한다(0단계-A 가 테스트로 잠근 계약). 포트를 빼면
    // 403 이 돌아오고, 그러면 이 함수는 "우리 서버가 아니다"로 오판해 고아를 못 알아본다(실측).
    let req = format!("GET /api/ping HTTP/1.0\r\nHost: 127.0.0.1:{PORT}\r\n\r\n");
    s.write_all(req.as_bytes()).ok()?;
    let mut body = String::new();
    s.read_to_string(&mut body).ok()?;
    if !body.contains("러닝허브 제어판") {
        return None; // 8000 을 쓰는 남의 프로세스 — 건드리지 않는다.
    }
    // "work":"D:\\atelier" 에서 값만 꺼낸다(JSON 파서를 들이기엔 필드 하나).
    let at = body.find("\"work\"")?;
    let start = body[at..].find(':')? + at + 1;
    let open = body[start..].find('"')? + start + 1;
    let mut out = String::new();
    let mut it = body[open..].chars();
    while let Some(c) = it.next() {
        match c {
            '"' => return Some(out),
            '\\' => out.push(it.next()?), // JSON 이스케이프(`\\` → `\`)
            _ => out.push(c),
        }
    }
    None
}

/// 포트 8000 을 LISTENING 으로 물고 있는 PID. `probe_workspace` 가 **우리 serve.js 라고 확인한
/// 뒤에만** 쓴다 — 포트로 PID 를 찾는 이상 오인 사살 위험이 있어 호출 조건이 곧 안전장치다.
#[cfg(windows)]
fn port_owner_pid() -> Option<u32> {
    use std::os::windows::process::CommandExt;
    let out = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .creation_flags(0x0800_0000)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let needle = format!(":{PORT}");
    text.lines().find_map(|line| {
        // 형식: Proto  LocalAddress  ForeignAddress  State  PID
        let [_, local, _, state, pid] = line.split_whitespace().collect::<Vec<_>>()[..] else {
            return None;
        };
        (state == "LISTENING" && local.ends_with(&needle)).then(|| pid.parse().ok())?
    })
}

#[cfg(not(windows))]
fn port_owner_pid() -> Option<u32> {
    // Windows 단일 타깃(설계 §6 "배포 매트릭스 불필요") — 다른 OS 에선 고아 정리를 생략한다.
    None
}

/// PID 를 프로세스 트리째 종료. `/T` 인 이유는 serve.js 가 파이썬 도구를 자식으로 두기 때문
/// (serve.js 의 `killTree` 와 같은 사상 — 손자까지 안 잡으면 python 이 남는다).
#[cfg(windows)]
fn kill_pid(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .creation_flags(0x0800_0000)
        .output();
}

#[cfg(not(windows))]
fn kill_pid(_pid: u32) {}

/// 포트를 물고 있는 우리 serve.js 를 종료(워크스페이스 불일치로 교체가 필요할 때만).
fn kill_port_owner() {
    if let Some(pid) = port_owner_pid() {
        kill_pid(pid);
    }
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
            // 우리가 띄운 것: 트리째 내린다(파이썬 손자까지 — serve.js killTree 와 같은 이유).
            kill_pid(child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    // 입양한 고아도 함께 내린다 — "앱을 닫으면 sidecar 도 없다"를 spawn/재사용 양쪽에서 동일하게.
    if let Ok(mut a) = ADOPTED.lock() {
        if let Some(pid) = a.take() {
            kill_pid(pid);
        }
    }
}
