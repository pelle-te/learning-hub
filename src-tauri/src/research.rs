/*! 탐구 수집 잡 — 4단계-D. `serve.js` `/api/research/{start,jobs,cancel}`(L188-245) 대체.

`탐구_수집.py` 는 30분까지 걸린다. 요청을 붙들지 않고 **백그라운드 잡**으로 소유하는 모델은
serve.js 그대로다. 바뀐 것은 셋이다: 소유자가 Rust · 진행 알림이 폴링에서 **이벤트** ·
잡 이력이 프로세스 밖에 **영속**된다.

## ⚠ "재시작 유실 해소"(설계 갭 ④)의 의미가 셸에서 달라진다 — 정직하게 적는다

serve.js 모델에선 서버 프로세스가 브라우저 탭보다 오래 산다. 그래서 *탭 새로고침*엔 잡이
살아남고 *서버 재시작*엔 잃었다. Tauri 에선 **앱 프로세스가 곧 잡 소유자**라 앱이 죽으면
자식 python 도 함께 죽는다 — 즉 "**진행 중이던 잡이 앱 재시작 후에도 계속 돈다**"는 것은
어떤 저장소를 쓰든 원리적으로 불가능하다.

여기서 영속이 실제로 주는 것:
  · 끝난 잡의 **결과 로그가 남는다**(30분 걸린 수집의 출력이 앱을 껐다 켜면 사라지던 것)
  · 앱이 죽을 때 running 이던 잡이 **조용히 증발하지 않고** '중단됨'으로 보인다
webview 새로고침에 잡이 살아남는 것(원래 이점)은 잡이 Rust 메모리에 있으므로 그대로다.

`Control.tsx:273` 의 "탭을 떠나거나 새로고침해도 **서버에서** 계속 돌아가요" 문구는 이 모델에
맞춰 4-F 에서 고친다(셸엔 별도 서버가 없다).

## ⚠ 저장소는 SQLite 가 아니라 JSON 파일이다 — 설계에서 의도적으로 벗어났다

설계 §4-4단계는 "잡 상태는 SQLite(④)"라고 적었다. 안 따랐다.

앱 DB 에 쓰려면 Rust 가 **두 번째 커넥션 풀**로 같은 파일을 열어야 하는데, 그건 2단계-E 에서
실제로 앱을 죽인 사고와 정확히 같은 모양이다(`database is locked` — sqlx 풀이라 한쪽의
쓰기가 다른 쪽을 막았다). 게다가 이 데이터는 **앱 상태가 아니다**: `AppState` 에 없고 내보내기에도
안 들어가는 *실행 로그*라, 데이터 모델의 정본 파일에 섞으면 층이 흐려진다. 크기도 유계다
(끝난 잡 12개 × 출력 20,000자 상한). 질의할 것도 "전부 나열" 하나뿐이라 SQL 이 줄 게 없다.
→ `app_config_dir/research-jobs.json`(`workspace.json` 과 같은 자리·같은 관용구).
*/
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

use crate::tools::{kill_tree_pid, tail_chars, Cap, OUT_CAP};

/// 동시 running 캡(serve.js `MAX_RESEARCH = 2`). 4단계-C 의 RAII 캡을 그대로 쓴다.
static RESEARCH_CAP: Cap = Cap::new(2);
/// 종료된 잡 보관 상한(serve.js `pruneJobs` L202-205).
const KEEP_FINISHED: usize = 12;
/// 30분 초과 시 중단(serve.js L227).
const JOB_TIMEOUT: Duration = Duration::from_secs(1800);
/// 진행 알림 이벤트 이름. 프런트는 `lib/tauri.ts` `onResearchChanged` 로만 듣는다(I2).
pub const RESEARCH_CHANGED: &str = "research:changed";

/// 프런트 계약 — `api.ts` 의 `ResearchJob` 과 1:1(필드명까지).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub topic: String,
    pub scope: String,
    /// `running` | `done` | `error` | `canceled`
    pub status: String,
    pub code: Option<i32>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub out: String,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn jobs() -> &'static Mutex<Vec<Job>> {
    static JOBS: OnceLock<Mutex<Vec<Job>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(Vec::new()))
}

/// 진행 중 잡의 PID — 사용자 중단(트리킬)에 쓴다.
fn pids() -> &'static Mutex<HashMap<String, u32>> {
    static PIDS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    PIDS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 사용자 중단 표시 — 종료 코드만으로는 '실패'와 '취소'를 구분할 수 없다(serve.js `_canceled`).
fn canceled() -> &'static Mutex<std::collections::HashSet<String>> {
    static C: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

/* ── 영속 ─────────────────────────────────────────────────────── */

fn store_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    // 폴더 결정은 paths 가 소유한다(SD-6) — DB·workspace.json 과 **같은 폴더**여야 하기 때문.
    Some(crate::paths::config_dir(app).ok()?.join("research-jobs.json"))
}

fn save(app: &tauri::AppHandle) {
    let Some(p) = store_path(app) else { return };
    let snapshot = jobs().lock().map(|j| j.clone()).unwrap_or_default();
    if let Ok(text) = serde_json::to_string(&snapshot) {
        // 실패해도 앱을 멈추지 않는다 — 이력은 편의지 정본이 아니다.
        let _ = std::fs::write(p, text);
    }
}

/// 저장된 이력 텍스트 → 복원할 잡 목록. **running 이던 잡은 '중단됨'으로 내린다** — 앱이
/// 죽으면 자식 python 도 함께 죽으므로 그 잡은 실제로는 더 이상 돌지 않는다. 그대로 두면 UI 가
/// 영원히 스피너를 돌리고 캡(2)이 유령 잡에게 잠겨 새 수집을 못 시작한다.
///
/// ⚠ 순수 함수로 갈라 둔다(`AppHandle` 도 시계도 안 받는다). 이 전이가 4단계-D 의 실질이고
/// 예전엔 **앱을 껐다 켜야만** 확인할 수 있었다 — 그런데 "재시작을 넘는가"는 결국
/// *파일에 쓰고 다시 읽는가*라, 창을 띄울 이유가 없었다. 손상 파일은 `None`(이력 없음)이다.
pub fn restored_from(text: &str, now: i64) -> Option<Vec<Job>> {
    let mut loaded = serde_json::from_str::<Vec<Job>>(text).ok()?;
    for j in loaded.iter_mut() {
        if j.status == "running" {
            j.status = "error".into();
            j.code = Some(-3);
            j.ended_at = Some(now);
            j.out = tail_chars(&format!("{}\n(앱이 종료돼 중단됨)", j.out), OUT_CAP);
        }
    }
    Some(loaded)
}

/// 부팅 시 이력 복원.
pub fn restore(app: &tauri::AppHandle) {
    let Some(p) = store_path(app) else { return };
    let Ok(text) = std::fs::read_to_string(p) else {
        return;
    };
    // 손상 파일은 '이력 없음'으로 — 이것 때문에 앱이 안 뜨면 안 된다.
    let Some(loaded) = restored_from(&text, now_ms()) else {
        return;
    };
    if let Ok(mut g) = jobs().lock() {
        *g = loaded;
    }
}

/* ── 상태 변경 ────────────────────────────────────────────────── */

/// 종료된 잡은 최근 12개만 남긴다(serve.js `pruneJobs`). running 은 항상 보존.
fn prune(list: &mut Vec<Job>) {
    let mut finished: Vec<usize> = list
        .iter()
        .enumerate()
        .filter(|(_, j)| j.status != "running")
        .map(|(i, _)| i)
        .collect();
    finished.sort_by_key(|&i| list[i].started_at);
    while finished.len() > KEEP_FINISHED {
        let idx = finished.remove(0);
        list.remove(idx);
        // 앞을 지웠으니 뒤 인덱스가 한 칸씩 당겨진다.
        for f in finished.iter_mut() {
            if *f > idx {
                *f -= 1;
            }
        }
    }
}

fn emit(app: &tauri::AppHandle) {
    let _ = app.emit(RESEARCH_CHANGED, ());
}

/// 주제 정제·검증(serve.js `startResearch` L208-210). **순수 함수로 뺀 이유**는 4단계-G 의
/// 대조표 때문이다 — `serve.test.ts` 가 이 계약("빈/200자 초과 topic 은 spawn 전에 거부")을
/// 잠그고 있었는데, 커맨드 안에 인라인으로 두면 `AppHandle` 없이는 검증할 수 없어
/// **그 테스트를 지우는 순간 계약이 아무 데서도 안 지켜진다.**
pub fn validate_topic(raw: &str) -> Result<String, String> {
    let t: String = raw.trim().chars().take(200).collect();
    if t.is_empty() {
        return Err("topic(주제)이 필요합니다.".into());
    }
    Ok(t)
}

/// 취소 가능한 잡인지 — 없거나 이미 끝났으면 사유를 돌려준다(serve.js `cancelResearch` L238-240).
fn ensure_cancelable(id: &str) -> Result<(), String> {
    let g = jobs().lock().map_err(|e| e.to_string())?;
    let j = g
        .iter()
        .find(|j| j.id == id)
        .ok_or("잡을 찾을 수 없어요.")?;
    if j.status != "running" {
        return Err("이미 끝난 잡이에요.".into());
    }
    Ok(())
}

/* ── 커맨드 ───────────────────────────────────────────────────── */

#[tauri::command]
pub fn research_jobs() -> Vec<Job> {
    let mut list = jobs().lock().map(|j| j.clone()).unwrap_or_default();
    // 최근 시작 순(serve.js 의 정렬을 승계 — 프런트가 그 순서를 전제한다).
    list.sort_by_key(|j| std::cmp::Reverse(j.started_at));
    list
}

#[tauri::command]
pub fn research_start(
    app: tauri::AppHandle,
    topic: String,
    scope: Option<String>,
) -> Result<Job, String> {
    let topic = validate_topic(&topic)?;
    let scope: String = scope.unwrap_or_default().trim().chars().take(200).collect();

    let cwd = crate::workspace::resolve(&app)
        .ok_or("워크스페이스가 설정되지 않았습니다 — 설정 탭에서 폴더를 지정해 주세요.")?;

    // ⚠ 캡 guard 를 잡 스레드로 **옮긴다**. 여기서 잡았다 떨어뜨리면 자리 점유 구간과
    //   실제 실행 구간이 어긋나 캡이 무의미해진다(4단계-C 의 RAII 규율을 그대로 승계).
    let slot = RESEARCH_CAP
        .try_acquire()
        .ok_or("이미 수집 중인 탐구가 많아요 — 잠시 후 다시.")?;

    let id = format!("r{}-{}", now_ms(), std::process::id());
    let job = Job {
        id: id.clone(),
        topic: topic.clone(),
        scope: scope.clone(),
        status: "running".into(),
        code: None,
        started_at: now_ms(),
        ended_at: None,
        out: String::new(),
    };

    let mut args: Vec<String> = vec![
        "pipeline/_도구/탐구_수집.py".into(),
        "--topic".into(),
        topic,
    ];
    if !scope.is_empty() {
        args.push("--scope".into());
        args.push(scope);
    }
    let py = std::env::var("PYTHON").unwrap_or_else(|_| "python".into());

    let mut cmd = Command::new(&py);
    cmd.args(&args)
        .current_dir(&cwd)
        .env("PYTHONIOENCODING", "utf-8")
        // 수집 스크립트가 결과 파일을 브라우저로 열지 않게(serve.js L222).
        .env("RESEARCH_NOOPEN", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            // spawn 실패도 **잡으로 남긴다** — 화면에 "왜 안 됐는지"가 남아야 한다.
            let mut failed = job.clone();
            failed.status = "error".into();
            failed.code = Some(-1);
            failed.ended_at = Some(now_ms());
            failed.out = format!("spawn 실패: {e} — python 이 PATH 에 있어야 합니다.");
            if let Ok(mut g) = jobs().lock() {
                g.push(failed.clone());
                prune(&mut g);
            }
            save(&app);
            emit(&app);
            return Ok(failed);
        }
    };

    if let Ok(mut p) = pids().lock() {
        p.insert(id.clone(), child.id());
    }
    if let Ok(mut g) = jobs().lock() {
        g.push(job.clone());
        prune(&mut g);
    }
    save(&app);
    emit(&app);

    // 출력 펌프 + 감시 스레드. stdout·stderr 를 각각 읽어야 파이프 교착이 없다(4-C 와 같은 이유).
    let app2 = app.clone();
    let id2 = id.clone();
    std::thread::spawn(move || {
        let _slot = slot; // 잡이 끝날 때까지 자리를 점유 → 여기서 drop.
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
            let (app3, id3) = (app2.clone(), id2.clone());
            pumps.push(std::thread::spawn(move || {
                /* 이벤트를 줄마다 쏘지 않고 **묶어서** 쏜다. 30분 수집은 수천 줄을 내는데
                줄마다 IPC 를 때리면 알림 자체가 부하가 된다(볼트 감시의 700ms 디바운스와 같은 판단). */
                let mut last = Instant::now();
                for line in BufReader::new(pipe).split(b'\n').map_while(Result::ok) {
                    let text = String::from_utf8_lossy(&line).into_owned();
                    if let Ok(mut g) = jobs().lock() {
                        if let Some(j) = g.iter_mut().find(|j| j.id == id3) {
                            j.out.push_str(&text);
                            j.out.push('\n');
                            if j.out.chars().count() > OUT_CAP * 2 {
                                j.out = tail_chars(&j.out, OUT_CAP);
                            }
                        }
                    }
                    if last.elapsed() > Duration::from_millis(700) {
                        last = Instant::now();
                        emit(&app3);
                    }
                }
            }));
        }

        // 타임아웃 감시(30분).
        let deadline = Instant::now() + JOB_TIMEOUT;
        let code = loop {
            match child.try_wait() {
                Ok(Some(s)) => break s.code().unwrap_or(-1),
                Ok(None) => {
                    if Instant::now() >= deadline {
                        kill_tree_pid(child.id());
                        let _ = child.kill();
                        let _ = child.wait();
                        if let Ok(mut g) = jobs().lock() {
                            if let Some(j) = g.iter_mut().find(|j| j.id == id2) {
                                j.out.push_str("\n(30분 초과 — 중단)");
                            }
                        }
                        break -2;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(_) => break -1,
            }
        };
        for p in pumps {
            let _ = p.join();
        }

        let was_canceled = canceled()
            .lock()
            .map(|mut c| c.remove(&id2))
            .unwrap_or(false);
        if let Ok(mut g) = jobs().lock() {
            if let Some(j) = g.iter_mut().find(|j| j.id == id2) {
                // 이미 종료 상태면 덮지 않는다(serve.js `fin` 의 재진입 가드와 같은 뜻).
                if j.status == "running" {
                    j.status = if was_canceled {
                        "canceled".into()
                    } else if code == 0 {
                        "done".into()
                    } else {
                        "error".into()
                    };
                    j.code = Some(code);
                    j.ended_at = Some(now_ms());
                    j.out = tail_chars(&j.out, OUT_CAP);
                }
            }
            prune(&mut g);
        }
        if let Ok(mut p) = pids().lock() {
            p.remove(&id2);
        }
        save(&app2);
        emit(&app2);
    });

    Ok(job)
}

#[tauri::command]
pub fn research_cancel(app: tauri::AppHandle, id: String) -> Result<(), String> {
    ensure_cancelable(&id)?;
    // 먼저 표시하고 죽인다 — 순서가 반대면 종료 핸들러가 '실패'로 확정한 뒤 표시가 도착한다.
    if let Ok(mut c) = canceled().lock() {
        c.insert(id.clone());
    }
    if let Ok(mut g) = jobs().lock() {
        if let Some(j) = g.iter_mut().find(|j| j.id == id) {
            j.out.push_str("\n(사용자 중단됨)");
        }
    }
    let pid = pids().lock().ok().and_then(|p| p.get(&id).copied());
    if let Some(pid) = pid {
        kill_tree_pid(pid);
    }
    emit(&app);
    Ok(())
}

/// 앱 종료 시 진행 중 잡의 프로세스 트리를 내린다 — 안 하면 python 이 고아로 남아
/// 볼트를 계속 건드린다(sidecar 고아 문제와 같은 부류).
pub fn shutdown() {
    if let Ok(p) = pids().lock() {
        for pid in p.values() {
            kill_tree_pid(*pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: &str, status: &str, started: i64) -> Job {
        Job {
            id: id.into(),
            topic: "t".into(),
            scope: String::new(),
            status: status.into(),
            code: None,
            started_at: started,
            ended_at: None,
            out: String::new(),
        }
    }

    #[test]
    fn 끝난_잡은_열두_개만_남고_running_은_항상_보존된다() {
        let mut list: Vec<Job> = (0..20).map(|i| job(&format!("f{i}"), "done", i)).collect();
        list.push(job("live", "running", 0)); // 가장 오래됐지만 살아 있다
        prune(&mut list);

        let finished = list.iter().filter(|j| j.status != "running").count();
        assert_eq!(finished, KEEP_FINISHED);
        assert!(
            list.iter().any(|j| j.id == "live"),
            "진행 중인 잡을 지웠다 — 화면에서 잡이 증발한다"
        );
        // 오래된 것부터 지워야 한다.
        assert!(!list.iter().any(|j| j.id == "f0"));
        assert!(list.iter().any(|j| j.id == "f19"));
    }

    #[test]
    fn 잡이_열두_개_이하면_아무것도_안_지운다() {
        let mut list: Vec<Job> = (0..5).map(|i| job(&format!("f{i}"), "done", i)).collect();
        prune(&mut list);
        assert_eq!(list.len(), 5);
    }

    #[test]
    fn 직렬화가_프런트_계약과_같은_필드명을_쓴다() {
        // camelCase 가 아니면 `startedAt` 이 undefined 가 되어 정렬·경과시간 표시가 조용히 죽는다.
        let text = serde_json::to_string(&job("r1", "running", 42)).unwrap();
        assert!(text.contains("\"startedAt\":42"), "{text}");
        assert!(text.contains("\"endedAt\":null"), "{text}");
        assert!(!text.contains("started_at"));
    }

    #[test]
    fn 빈_주제는_spawn_전에_거부한다() {
        // serve.test.ts 가 잠그던 계약 — 빈 주제로 30분짜리 수집기를 띄우면 안 된다.
        assert!(validate_topic("").is_err());
        assert!(validate_topic("   ").is_err());
        assert_eq!(validate_topic("  위상수학 ").unwrap(), "위상수학");
    }

    #[test]
    fn 주제는_200자에서_잘린다() {
        assert_eq!(
            validate_topic(&"가".repeat(500)).unwrap().chars().count(),
            200
        );
    }

    #[test]
    fn 없는_잡_취소는_프로세스를_건드리지_않고_거부한다() {
        assert!(ensure_cancelable("존재하지-않는-잡").is_err());
        // 이미 끝난 잡도 거부 — 안 그러면 남의 PID 를 죽일 수 있다(PID 재사용).
        if let Ok(mut g) = jobs().lock() {
            g.push(job("끝난잡-테스트", "done", 1));
        }
        assert!(ensure_cancelable("끝난잡-테스트")
            .unwrap_err()
            .contains("이미 끝난"));
        if let Ok(mut g) = jobs().lock() {
            g.retain(|j| j.id != "끝난잡-테스트");
        }
    }

    #[test]
    fn 이력_왕복이_손실_없이_된다() {
        let list = vec![job("a", "done", 1), job("b", "canceled", 2)];
        let text = serde_json::to_string(&list).unwrap();
        let back: Vec<Job> = serde_json::from_str(&text).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back[1].status, "canceled");
    }

    /* ── 트랙 B `4단계-D` 를 여기로 내렸다(2026-07-20 층 재배치) ─────────────

    옛 케이스는 실제 수집기를 띄웠다 곧바로 중단하고, **앱을 껐다 켜서** 이력이 남는지 봤다.
    거기서 실제로 잠기던 것은 둘이다: ① 재시작 후 이력이 복원되고 running 이 정리되는가
    ② PID 추적이 되어 중단이 먹히는가. 둘 다 창과 무관하다 — ①은 파일 왕복이고 ②는
    프로세스 트리 종료다. 아래 둘이 그 자리를 대신한다.

    ⚠ 그리고 이쪽이 **덜 파괴적이다**: 옛 케이스는 사용자의 실제 이력 저장소(12칸)에 테스트
    잡을 밀어 넣어, 안 치우면 e2e 를 열두 번 돌린 시점에 진짜 수집 기록을 전부 밀어냈다
    (검증하려던 것을 검증이 망가뜨리는 자리). 여기서는 실물 저장소를 아예 만지지 않는다. */

    #[test]
    fn 재시작_복원에서_running_은_중단됨으로_내려간다() {
        let mut list = vec![job("살아있던잡", "running", 10), job("끝난잡", "done", 5)];
        list[0].out = "수집 중…".into();
        let text = serde_json::to_string(&list).unwrap();

        let back = restored_from(&text, 12_345).expect("복원 실패");
        assert_eq!(back.len(), 2, "이력이 재시작을 넘지 못했다");

        let live = back.iter().find(|j| j.id == "살아있던잡").unwrap();
        /* 그대로 두면 UI 가 영원히 스피너를 돌리고 캡(2)이 유령 잡에게 잠긴다 —
        앱이 죽으면 자식 python 도 죽으므로 그 잡은 실제로 안 돈다. */
        assert_eq!(live.status, "error", "running 이 그대로 복원됐다");
        assert_eq!(live.code, Some(-3));
        assert_eq!(live.ended_at, Some(12_345));
        assert!(live.out.contains("앱이 종료돼 중단됨"), "사유가 안 남았다");
        assert!(live.out.contains("수집 중"), "기존 출력이 날아갔다");

        // 이미 끝난 잡은 손대지 않는다.
        let done = back.iter().find(|j| j.id == "끝난잡").unwrap();
        assert_eq!(done.status, "done");
        assert_eq!(done.code, None);
    }

    #[test]
    fn 손상된_이력은_앱을_막지_않는다() {
        // 이것 때문에 앱이 안 뜨면 안 된다 — '이력 없음'으로 조용히 내려간다.
        assert!(restored_from("깨진 JSON{{", 0).is_none());
        assert_eq!(restored_from("[]", 0).unwrap().len(), 0);
    }

    #[test]
    fn 프로세스_트리_종료가_실제로_먹힌다() {
        /* 중단이 동작하는가 = `kill_tree_pid` 가 진짜 프로세스를 죽이는가. 옛 케이스는 이걸
        재려고 30분짜리 수집기를 띄웠는데, 필요한 건 **오래 사는 자식** 하나면 된다.
        ⚠ Windows 의 `kill()` 은 직속 자식만 죽인다 — 그래서 taskkill /T 를 쓴다. */
        let mut child = match Command::new("ping")
            .args(["-n", "60", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("⚠ SKIP [research] — 테스트용 자식 프로세스를 못 띄웠다: {e}");
                return;
            }
        };
        assert!(
            child.try_wait().unwrap().is_none(),
            "자식이 시작하자마자 끝났다 — 테스트가 아무것도 안 잰다"
        );

        kill_tree_pid(child.id());

        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "kill_tree_pid 후에도 프로세스가 살아 있다 — 중단이 먹히지 않는다"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}
