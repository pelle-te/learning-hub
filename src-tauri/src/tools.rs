/*! 파이썬 도구 실행 — 4단계-C. `serve.js` `/api/run/:tool`(L637-646 · `runTool` L161-186) 대체.

화이트리스트 11종을 `python <스크립트> <고정인자…> [위치인자]` 로 돌리고 stdout 을 돌려준다.
`shell` 을 쓰지 않으므로(인자 배열 전달) 셸 인젝션 표면이 0인 것은 serve.js 와 같다.

**stdout 파서 6종(serve.js:757-785)은 이식하지 않았다 — 죽은 코드였다.**
그 파서들이 만들던 `stats` 필드를 **프런트에서 읽는 곳이 하나도 없다**(소비처 3곳이 전부
`ok`·`code`·`out` 만 쓴다). 실제 도구 출력에 대보니 이미 2개가 틀린 값을 내고 있었고
(`vault-health` 의 `deadlinks` 는 도구 문구가 "죽은 위키링크"로 바뀌어 항상 null · `healthy` 는
개별 항목의 ✅ 하나만 걸려도 true 라 점검 439건인 볼트를 '양호'로 본다), **아무도 안 읽었기
때문에 그 오류가 드러난 적이 없다.** 읽히지 않는 값을 언어를 바꿔 옮기면 같은 결함을 새 코드에
심는 일이라 옮기지 않는다. 필요해지면 `out` 에서 다시 뽑을 수 있고, 그땐 실제 출력을 보고 쓴다.
→ Rust 는 프로세스와 IO 만 소유한다(2단계-B 의 rows/sqlite 분리와 같은 규율).

## 동시성 캡 — 0단계-A 가 유일하게 못 덮은 항목을 여기서 갚는다

serve.js 는 `RUNNING++` / `RUNNING = Math.max(0, RUNNING-1)` 로 캡을 셌다. 이 방식은 **해제를
빠뜨리거나 두 번 하는 것이 문법적으로 가능**하고, 실제로 그 사고가 있었다(감사 2026-07-16 ①#45 —
프로토타입 키가 콜백을 재실행시켜 `RUNNING` 이 이중 증가 → `/api/run` 전체가 429 로 영구 마비).
0단계-A 는 이걸 테스트로 못 덮었다(캡 3개가 라우터 클로저 안이라 단위 테스트가 닿지 않고, 실제
429 를 만들려면 python 을 실제로 점유해야 했다) — 그래서 "4단계에서 명시적 세마포어 타입으로
만들고 그때 테스트한다"로 미뤄 뒀다.

여기서 `Cap` 은 **RAII** 다. 획득하면 `CapGuard` 가 나오고 해제는 `Drop` 이 한다. 그 결과
"해제를 빠뜨린다"·"두 번 해제한다"가 **표현 불가능**해진다 — 조기 return 이든 `?` 전파든
패닉이든 스코프를 벗어나면 반드시 한 번 풀린다. 규율이 아니라 타입이 보장하는 쪽으로 옮긴 것이다.
*/
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/* ── 동시성 캡(RAII) ────────────────────────────────────────────── */

/// 동시 실행 상한. `try_acquire` 가 주는 guard 가 살아 있는 동안만 자리를 차지한다.
pub struct Cap {
    used: AtomicUsize,
    max: usize,
}

/// 자리 점유증. 떨어뜨리면(스코프 종료·조기 return·패닉) 자동으로 반납된다.
pub struct CapGuard<'a>(&'a Cap);

impl Cap {
    pub const fn new(max: usize) -> Self {
        Self {
            used: AtomicUsize::new(0),
            max,
        }
    }

    /// 자리가 있으면 점유증을, 없으면 None. **compare-exchange 루프**라 동시 호출에서도
    /// 상한을 넘지 않는다(`load` 후 `store` 로 쪼개면 두 호출이 같은 값을 읽어 둘 다 통과한다).
    pub fn try_acquire(&self) -> Option<CapGuard<'_>> {
        let mut cur = self.used.load(Ordering::Acquire);
        loop {
            if cur >= self.max {
                return None;
            }
            match self
                .used
                .compare_exchange_weak(cur, cur + 1, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => return Some(CapGuard(self)),
                Err(actual) => cur = actual,
            }
        }
    }

    #[cfg(test)]
    fn used(&self) -> usize {
        self.used.load(Ordering::Acquire)
    }
}

impl Drop for CapGuard<'_> {
    fn drop(&mut self) {
        self.0.used.fetch_sub(1, Ordering::AcqRel);
    }
}

/// `/api/run` 의 `MAX_RUNNING = 2`(serve.js:508) 승계.
static RUN_CAP: Cap = Cap::new(2);

/* ── 화이트리스트 ──────────────────────────────────────────────── */

pub struct Tool {
    /// 워크스페이스 기준 스크립트 경로 + 고정 인자.
    pub cmd: &'static [&'static str],
    pub label: &'static str,
    pub timeout_ms: u64,
}

/// serve.js `TOOLS`(L59-72)와 1:1. 순서·인자·타임아웃까지 그대로 옮겼다.
pub const TOOLS: &[(&str, Tool)] = &[
    (
        "knowledge-build",
        Tool {
            cmd: &["pipeline/_도구/지식엔진.py", "build"],
            label: "지식상태 재빌드",
            timeout_ms: 120_000,
        },
    ),
    (
        "vault-health",
        Tool {
            cmd: &["pipeline/_도구/벌트DB.py", "health"],
            label: "볼트 건강검진",
            timeout_ms: 60_000,
        },
    ),
    (
        "vault-stats",
        Tool {
            cmd: &["pipeline/_도구/벌트DB.py", "stats"],
            label: "볼트 통계",
            timeout_ms: 60_000,
        },
    ),
    (
        "index-build",
        Tool {
            cmd: &["pipeline/_도구/벌트DB.py", "build"],
            label: "인덱스/DB 재생성",
            timeout_ms: 120_000,
        },
    ),
    (
        "eval",
        Tool {
            cmd: &["pipeline/_도구/지시문평가.py", "eval"],
            label: "지시문 품질 회귀검사",
            timeout_ms: 120_000,
        },
    ),
    (
        "anki-signal",
        Tool {
            cmd: &["pipeline/_도구/학습신호.py"],
            label: "Anki 학습신호 갱신",
            timeout_ms: 60_000,
        },
    ),
    (
        "ledger-build",
        Tool {
            cmd: &["pipeline/_도구/챕터원장.py", "--quiet"],
            label: "챕터 원장 재빌드",
            timeout_ms: 60_000,
        },
    ),
    (
        "reads-collect",
        Tool {
            cmd: &["pipeline/_도구/읽을거리_수집.py"],
            label: "읽을거리 수집",
            timeout_ms: 180_000,
        },
    ),
    (
        "markets-collect",
        Tool {
            cmd: &["pipeline/_도구/증시_수집.py"],
            label: "증시 동향 수집",
            timeout_ms: 180_000,
        },
    ),
    // 발견 triage — 승격.py 가 --promote/--dismiss 뒤 위치인자(후보 id `kind::key`)를 받는다.
    (
        "discovery-promote",
        Tool {
            cmd: &["pipeline/_도구/승격.py", "--promote"],
            label: "발견 후보 승격",
            timeout_ms: 60_000,
        },
    ),
    (
        "discovery-dismiss",
        Tool {
            cmd: &["pipeline/_도구/승격.py", "--dismiss"],
            label: "발견 후보 기각",
            timeout_ms: 60_000,
        },
    ),
];

pub fn lookup(key: &str) -> Option<&'static Tool> {
    TOOLS.iter().find(|(k, _)| *k == key).map(|(_, t)| t)
}

/* ── 능력 탐지 ─────────────────────────────────────────────────── */

/// `serve.js` `/api/ping`(L623)의 자리. 프런트 `PingResponse` 와 필드가 같다.
#[derive(Debug, Serialize)]
pub struct Capabilities {
    /// **백엔드를 실제로 쓸 수 있는가.** 셸에선 프로세스가 곧 백엔드라 "떠 있는가"는 늘 참이고,
    /// 그걸 그대로 `true` 로 두면 상수가 되어 **10개 탭의 에러 UI 가 통째로 무력화된다**
    /// (설계 §4-4단계가 경고한 것). 그래서 의미를 **"워크스페이스가 유효한가"** 로 옮겼다 —
    /// 그게 거짓이면 도구 11종과 산출물 8종이 전부 조용히 빈 결과를 낸다. 즉 이 값이 거짓인 순간이
    /// 정확히 프런트가 셋업 안내를 띄워야 하는 순간이다.
    pub ok: bool,
    pub server: String,
    pub tools: Vec<String>,
    pub work: String,
    /// 전역 캡처 단축키가 등록됐는가(E20). ⚠ `false` 를 곧 "실패"로 읽지 말 것 —
    /// 브라우저·테스트에선 시도조차 안 하므로 `false` + 사유 없음이 정상이다.
    pub hotkey: bool,
    /// 등록 실패 사유. **이 값이 있을 때만 실패다**(대개 다른 앱이 조합을 선점한 경우).
    /// 조용히 삼키면 사용자는 키가 안 먹는 이유를 알 방법이 없다 — 그게 이 필드의 존재 이유다.
    ///
    /// ⚠⚠ **`rename` 이 필수다.** 이 구조체는 `rename_all` 이 없어 필드명이 그대로 나가므로,
    /// 이름을 안 바꾸면 JSON 은 `hotkey_error` 인데 프런트(`PingResponse`)는 `hotkeyError` 를 읽어
    /// **영원히 `undefined`** 가 된다 — 타입도 빌드도 통과하고 화면은 "실패 없음"으로 보인다.
    /// 다른 필드(`ok`·`server`·`tools`·`work`)는 한 낱말이라 이 함정이 없었고, 그래서 이 구조체엔
    /// 지금까지 `rename_all` 이 필요하지 않았다(첫 복합어가 이 필드다).
    #[serde(rename = "hotkeyError")]
    pub hotkey_error: Option<String>,
    /// 볼트 **감시**가 죽었나(H7 · 2026-08-01). 값이 있을 때만 실패다 — `hotkey_error` 와 같은 계약.
    ///
    /// 이 필드가 없던 동안 감시 스레드 사망은 `vault.rs` 의 로그 한 줄이 전부였고, `ok` 는
    /// 워크스페이스 유효성만 보므로 참이라 **콜드 게이트 문구도 안 떴다** — 사용자에게는
    /// "볼트를 고쳐도 화면이 안 바뀐다"만 남고 이유가 어디에도 없었다.
    /// ⚠ `rename` 은 위 필드와 같은 이유로 **필수**다(이 구조체엔 `rename_all` 이 없다).
    #[serde(rename = "vaultWatchError")]
    pub vault_watch_error: Option<String>,
}

/// ⚠ **python·Ollama 살아있음 플래그는 일부러 넣지 않았다.**
/// 설계는 `useCapabilities(Ollama up? python up? …)` 를 적었지만, 그 값을 **읽을 소비처가 없다** —
/// AI 실패는 이미 `{ok:false, error:"Ollama 연결 실패…"}` 봉투로 화면에 도달하고, 도구 실패는
/// `RunResult.ok` 로 도달한다. 읽히지 않는 값을 미리 만드는 건 4단계-C 에서 지운 `stats` 와 같은
/// 부류다(아무도 안 읽어서 틀린 줄도 몰랐던 필드). 필요해지는 소비처가 생기면 그때 넣는다.
#[tauri::command]
pub fn capabilities(app: tauri::AppHandle) -> Capabilities {
    let ws = crate::workspace::resolve(&app);
    let (hotkey, hotkey_error) = crate::hotkey::status();
    Capabilities {
        ok: ws.is_some(),
        server: "러닝허브 제어판".into(),
        tools: TOOLS.iter().map(|(k, _)| (*k).to_string()).collect(),
        work: ws
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        hotkey,
        hotkey_error,
        vault_watch_error: crate::vault::watch_error(),
    }
}

/* ── 인자 정제(순수) ───────────────────────────────────────────── */

/// 도구에 넘길 추가 **위치인자** 산출 — serve.js `toolExtraArgs`(L151-158) 이식.
///
/// dash 접두를 거부하는 이유는 파이썬 argparse 가 *플래그*로 오해석하기 때문이다. 정상 과목명·
/// 후보 id 는 `-` 로 시작하지 않으므로 실사용 영향이 0 이고, `--` 리터럴 주입은 argparse 를
/// 안 쓰는 도구를 깨뜨려서 회피했다(0단계-A 가 잠근 판단을 그대로 승계).
/// 200자 상한 = 발견 id(`kind::긴개념명`)도 안 잘리는 길이. shell 을 안 쓰므로 길이만 막으면 된다.
pub fn tool_extra_args(subject: Option<&str>) -> Vec<String> {
    let Some(raw) = subject else { return vec![] };
    // ⚠ JS 는 `slice(0,200)` 이 UTF-16 코드유닛 기준이지만 여기선 문자 기준이다.
    //   한글은 BMP 라 둘이 같고, 상한의 목적이 "폭주 방지"라 경계값의 정확한 일치는 요구되지 않는다.
    let sub: String = raw.chars().take(200).collect();
    if sub.is_empty() || sub.starts_with('-') {
        return vec![];
    }
    vec![sub]
}

/* ── 출력 캡 ───────────────────────────────────────────────────── */

/// stdout 상한(serve.js L173 `out.slice(-20000)`). 문자 기준 뒤에서부터 남긴다.
pub const OUT_CAP: usize = 20_000;

/// 뒤에서 n 문자만 남긴다. **바이트 슬라이스를 쓰면 한글 중간에서 잘려 패닉**한다.
pub fn tail_chars(s: &str, n: usize) -> String {
    let count = s.chars().count();
    if count <= n {
        return s.to_string();
    }
    s.chars().skip(count - n).collect()
}

/* ── 실행 ──────────────────────────────────────────────────────── */

#[derive(Debug, Serialize)]
pub struct RunOut {
    pub ok: bool,
    pub out: String,
    pub code: i32,
    pub label: String,
}

/// 프로세스 트리 강제종료. Windows 의 `kill()` 은 **직속 자식만** 죽여, python 이 띄운
/// 손자(크롤러 등)가 살아남아 CPU·네트워크를 계속 쓴다(serve.js `killTree` L134-144 와 같은 이유).
pub fn kill_tree_pid(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .output();
    }
    #[cfg(not(windows))]
    let _ = pid;
}

fn kill_tree(child: &mut Child) {
    kill_tree_pid(child.id());
    let _ = child.kill();
}

/// 실제 spawn·수집·타임아웃. 블로킹이라 커맨드에서 `spawn_blocking` 으로 부른다.
fn run_blocking(py: &str, tool: &'static Tool, extra: Vec<String>, cwd: &Path) -> RunOut {
    let mut cmd = Command::new(py);
    cmd.args(tool.cmd)
        .args(&extra)
        .current_dir(cwd)
        // 파이썬이 한글 stdout 을 깨뜨리지 않게 — .bat 의 chcp 65001 짝을 승계(serve.js L176).
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        // 도구를 돌릴 때마다 검은 콘솔 창이 깜빡이지 않게.
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return RunOut {
                ok: false,
                out: format!("spawn 실패: {e} — python 이 PATH 에 있어야 합니다."),
                code: -1,
                label: tool.label.to_string(),
            }
        }
    };

    /* stdout·stderr 를 **각각 스레드로** 읽는다. 한쪽만 읽으면 다른 쪽 파이프 버퍼가 차서
    자식이 write 에서 멈추고, 우리는 종료를 기다리며 멈춰 교착한다(파이프 데드락).
    serve.js 가 두 스트림에 같은 콜백을 붙였던 것과 같은 이유다. */
    let buf = Arc::new(Mutex::new(String::new()));
    let mut pumps = Vec::new();
    for pipe in [
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let buf = Arc::clone(&buf);
        pumps.push(std::thread::spawn(move || {
            for line in BufReader::new(pipe).split(b'\n').map_while(Result::ok) {
                let mut s = buf.lock().unwrap_or_else(|e| e.into_inner());
                s.push_str(&String::from_utf8_lossy(&line));
                s.push('\n');
                // 라이브 캡 — 무한 누적 방지(serve.js L181 과 같은 2배 여유 후 절단).
                if s.chars().count() > OUT_CAP * 2 {
                    *s = tail_chars(&s, OUT_CAP);
                }
            }
        }));
    }

    // 타임아웃 폴링. `try_wait` 은 좀비를 만들지 않고 상태만 본다.
    let deadline = Instant::now() + Duration::from_millis(tool.timeout_ms);
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) => {
                if Instant::now() >= deadline {
                    kill_tree(&mut child);
                    let _ = child.wait();
                    break -2; // serve.js 의 타임아웃 코드와 같은 값
                }
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(_) => break -1,
        }
    };
    // 파이프가 닫힐 때까지 기다려야 마지막 출력이 안 잘린다.
    for p in pumps {
        let _ = p.join();
    }

    let out = {
        let s = buf.lock().unwrap_or_else(|e| e.into_inner());
        tail_chars(&s, OUT_CAP)
    };
    RunOut {
        ok: code == 0,
        out,
        code,
        label: tool.label.to_string(),
    }
}

/// 도구 1종 실행. 캡이 차 있으면 즉시 거절한다(serve.js 의 429 자리).
#[tauri::command]
pub async fn run_tool(
    app: tauri::AppHandle,
    tool: String,
    subject: Option<String>,
) -> Result<RunOut, String> {
    let Some(t) = lookup(&tool) else {
        return Err(format!("알 수 없는 도구: {tool}"));
    };
    let cwd = crate::workspace::resolve(&app)
        .ok_or("워크스페이스가 설정되지 않았습니다 — 설정 탭에서 폴더를 지정해 주세요.")?;
    let extra = tool_extra_args(subject.as_deref());
    let py = std::env::var("PYTHON").unwrap_or_else(|_| "python".into());

    // ⚠ guard 를 **블로킹 작업 안으로** 옮긴다. 여기서 잡고 있다가 await 로 넘기면
    //   자리 점유 구간과 실제 실행 구간이 어긋난다.
    tauri::async_runtime::spawn_blocking(move || {
        let Some(_slot) = RUN_CAP.try_acquire() else {
            return Err("이미 실행 중인 도구가 많아요 — 잠시 후 다시.".to_string());
        };
        Ok(run_blocking(&py, t, extra, &cwd))
        // _slot 이 여기서 drop → 자리 반납. 위 Err 경로도, 패닉도 마찬가지다.
    })
    .await
    .map_err(|e| format!("도구 실행이 중단됐습니다: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /* ── 캡 ── 0단계-A 가 못 덮은 항목. 여기서 잠그는 건 "숫자가 맞는가"가 아니라
     **"해제가 새지 않는가"** 다 — 그게 실제로 앱을 429 로 마비시킨 실패였다. */

    #[test]
    fn 캡은_상한까지만_내준다() {
        let cap = Cap::new(2);
        let a = cap.try_acquire();
        let b = cap.try_acquire();
        assert!(a.is_some() && b.is_some());
        assert!(cap.try_acquire().is_none(), "상한을 넘겨 내줬다");
        assert_eq!(cap.used(), 2);
    }

    #[test]
    fn 스코프를_벗어나면_반드시_반납된다() {
        let cap = Cap::new(1);
        {
            let _g = cap.try_acquire().unwrap();
            assert!(cap.try_acquire().is_none());
        }
        assert_eq!(cap.used(), 0);
        assert!(cap.try_acquire().is_some(), "반납이 안 됐다");
    }

    #[test]
    fn 조기_return_경로에서도_새지_않는다() {
        // serve.js 에서 실제로 샜던 형태 — 중간에 빠져나가는 경로가 해제를 건너뛰던 것.
        let cap = Cap::new(1);
        fn 중간에_실패(cap: &Cap) -> Result<(), &'static str> {
            let _slot = cap.try_acquire().ok_or("full")?;
            Err("도중 실패")
        }
        for _ in 0..5 {
            let _ = 중간에_실패(&cap);
        }
        assert_eq!(cap.used(), 0, "실패 경로가 자리를 물고 있다");
    }

    #[test]
    fn 패닉이_나도_반납된다() {
        let cap = Cap::new(1);
        // 패닉은 unwind 하며 Drop 을 부른다 — 수동 해제였다면 여기서 영구히 샌다.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _slot = cap.try_acquire().unwrap();
            panic!("도구가 터졌다");
        }));
        assert_eq!(cap.used(), 0);
    }

    #[test]
    fn 동시_획득이_상한을_넘지_않는다() {
        // load-then-store 였다면 두 스레드가 같은 값을 읽어 둘 다 통과할 수 있다.
        let cap = Arc::new(Cap::new(4));
        let got = Arc::new(AtomicUsize::new(0));
        let mut hs = Vec::new();
        for _ in 0..32 {
            let (cap, got) = (Arc::clone(&cap), Arc::clone(&got));
            hs.push(std::thread::spawn(move || {
                if let Some(g) = cap.try_acquire() {
                    got.fetch_add(1, Ordering::AcqRel);
                    std::thread::sleep(Duration::from_millis(20));
                    drop(g);
                }
            }));
        }
        for h in hs {
            h.join().unwrap();
        }
        assert_eq!(cap.used(), 0);
        assert!(got.load(Ordering::Acquire) >= 4);
    }

    /* ── 화이트리스트·인자 정제 ── */

    #[test]
    fn 열한_종이_모두_등록돼_있다() {
        assert_eq!(TOOLS.len(), 11);
        for k in [
            "knowledge-build",
            "vault-health",
            "vault-stats",
            "index-build",
            "eval",
            "anki-signal",
            "ledger-build",
            "reads-collect",
            "markets-collect",
            "discovery-promote",
            "discovery-dismiss",
        ] {
            assert!(lookup(k).is_some(), "{k} 누락");
        }
        assert!(lookup("rm").is_none());
        assert!(lookup("__proto__").is_none());
    }

    #[test]
    fn capabilities_가_도구_키를_그대로_알린다() {
        /* serve.test.ts 의 "/api/ping — 도구 목록과 워크스페이스 경로를 알린다" 를 이어받는다.
        프런트(`Control`·`Integrations`)가 이 목록으로 실행 가능한 도구를 그리므로,
        키가 바뀌면 버튼이 조용히 사라진다. */
        let keys: Vec<String> = TOOLS.iter().map(|(k, _)| (*k).to_string()).collect();
        assert_eq!(keys.len(), 11);
        assert!(keys.contains(&"knowledge-build".to_string()));
        // 발견 triage 는 프런트의 DISCOVERY_DECISION_TOOL 이 이 두 키를 그대로 쓴다.
        assert!(keys.contains(&"discovery-promote".to_string()));
        assert!(keys.contains(&"discovery-dismiss".to_string()));
    }

    #[test]
    fn dash_접두_인자는_거부한다() {
        // argparse 가 플래그로 오해석하는 것을 막는다(0단계-A 가 잠근 계약).
        assert_eq!(tool_extra_args(Some("--help")), Vec::<String>::new());
        assert_eq!(tool_extra_args(Some("-rf")), Vec::<String>::new());
        assert_eq!(tool_extra_args(Some("미적분")), vec!["미적분".to_string()]);
        assert_eq!(tool_extra_args(None), Vec::<String>::new());
        assert_eq!(tool_extra_args(Some("")), Vec::<String>::new());
    }

    #[test]
    fn 인자는_200자에서_잘린다() {
        let long = "가".repeat(500);
        let got = tool_extra_args(Some(&long));
        assert_eq!(got[0].chars().count(), 200);
    }

    #[test]
    fn 출력_캡은_한글_중간에서_안_깨진다() {
        // 바이트 슬라이스였다면 여기서 패닉하거나 U+FFFD 가 섞인다.
        let s = "가나다라마".repeat(10_000);
        let cut = tail_chars(&s, OUT_CAP);
        assert_eq!(cut.chars().count(), OUT_CAP);
        assert!(!cut.contains('\u{FFFD}'));
        assert!(
            s.ends_with(&cut),
            "뒤에서부터 남겨야 한다(요약이 끝에 있다)"
        );
    }

    #[test]
    fn 짧은_출력은_그대로_둔다() {
        assert_eq!(tail_chars("완료", OUT_CAP), "완료");
    }

    /* ── 실물 대상 통합 검사 ─────────────────────────────────────────────────
    ▶ 트랙 B `4단계-C` 를 여기로 내렸다(2026-07-20 층 재배치).

    위 단위 테스트들은 캡·인자 정제·출력 절단 같은 **순수 부분**만 잠근다. 실제로 여기서만
    드러나는 것들이 따로 있다 — python 이 PATH 에서 잡히는가 · cwd 가 워크스페이스인가(틀리면
    도구가 조용히 빈 결과를 낸다: 이 앱에서 가장 진단하기 어려운 실패) · PYTHONIOENCODING 이
    실제로 한글 stdout 을 지키는가 · 파이프를 양쪽 다 읽어 교착하지 않는가.

    그 전부가 **프로세스 문제이지 창 문제가 아니다.** 옛 케이스는 이걸 재려고 exe 를 띄웠는데,
    `run_blocking` 은 워크스페이스 경로만 있으면 그대로 부를 수 있다.

    읽기 전용 도구(`vault-stats`)를 고른 이유는 사용자 볼트를 훼손하지 않기 위해서다
    (옛 케이스와 같은 선택). */

    #[test]
    fn 실_워크스페이스에서_파이썬_도구가_돈다() {
        let cwd = crate::testkit::ws_or_skip!();
        let py = std::env::var("PYTHON").unwrap_or_else(|_| "python".into());
        let tool = lookup("vault-stats").expect("vault-stats 가 화이트리스트에서 사라졌다");

        let out = run_blocking(&py, tool, vec![], &cwd);

        assert_eq!(out.label, "볼트 통계");
        // cwd 가 워크스페이스가 아니면 python 이 스크립트를 못 찾아 code≠0 + 빈 stdout 이 된다.
        assert_eq!(
            out.code, 0,
            "도구가 실패했다(cwd 가 워크스페이스가 아닐 수 있다): {}",
            out.out
        );
        assert!(
            !out.out.is_empty(),
            "stdout 이 비었다 — 파이프를 못 읽었을 수 있다"
        );
        // PYTHONIOENCODING 이 안 걸리면 한글이 깨지거나 python 이 UnicodeEncodeError 로 죽는다.
        assert!(
            !out.out.contains('\u{FFFD}'),
            "출력에 깨진 문자가 있다: {}",
            out.out
        );
        assert!(
            out.out.chars().any(|c| ('가'..='힣').contains(&c)),
            "한글이 하나도 없다 — 인코딩이 깨졌을 수 있다: {}",
            out.out
        );
    }
}
