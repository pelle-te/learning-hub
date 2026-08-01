/*! 볼트 읽기 + 파일 감시 — 플랫폼 개편 3단계.

왜 Rust 로 옮기는가(설계 §4-3단계):
- **파일 감시**가 진짜 새 능력이다. File System Access API 에는 watch 가 없어 브라우저에선
  원리적으로 불가능했고(§10 이 OPFS 대안을 탈락시킨 근거), 그래서 갱신이 항상 "사용자가 버튼을
  누를 때"였다. `notify` 로 볼트가 바뀌면 앱이 스스로 안다.
- **폴더 선택·권한이 통째로 사라진다.** `workspace.rs` 가 이미 워크스페이스를 알고 볼트는
  `<workspace>/knowledge` 이므로, 사용자에게 폴더를 물을 이유가 없다.

⚠ **집계는 여기서 하지 않는다.** 노트 레코드만 만들어 프런트의 `subjectsFromIndex` 에 넘긴다.
   3단계-B 에서 "집계 구현이 두 벌이라 같은 볼트에서 숫자가 갈리던" 결함을 고쳤는데, 여기서
   Rust 로 또 한 벌을 만들면 같은 실수를 언어만 바꿔 반복하게 된다. 이 파일의 책임은
   **파일에서 노트 레코드를 뽑는 것**까지다.

⚠ rayon 은 안 쓴다. 설계가 `walkdir`+`rayon` 을 적었지만 실측 볼트가 519개 노트라 순차 순회로
   충분하고, 병렬화는 스레드풀·순서 비결정성을 들여올 뿐이다. 느려지면 그때 넣는다.
*/
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 순회에서 통째로 건너뛸 폴더 — 프런트 `lib/utils.ts` 의 `SKIP` 과 같은 목록이어야 한다.
const SKIP: [&str; 7] = [
    "attachments",
    "images",
    "_assets",
    ".obsidian",
    ".trash",
    "_복습시스템",
    "_인터랙티브",
];

/// 정본 인덱스와 같은 모양의 노트 레코드. 프런트 `IndexNote` 와 1:1.
#[derive(Debug, Clone, Serialize)]
pub struct Note {
    pub subject: String,
    /// 볼트 루트 기준 노트가 든 폴더(과목부터 시작). 프런트가 `split('/')` 로 챕터명을 만든다.
    pub folder: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub anki_exported: bool,
    /* ⚠⚠ **경계에서 필드를 버리지 말 것(W2 · 2026-07-31).** 인덱스 노트는 17키인데 여기가
    5키만 옮기고 있었고, 버려지는 것 중에 `reviewed`(468건에 날짜가 있다)와 `anki_state` 가
    있었다 — 앱은 "복습 0/0"이라 말하면서 그 답을 아는 파일을 매번 읽고 있었다.
    ⚠ 여전히 **해석은 하지 않는다**(집계는 프런트 `subjectsFromIndex` 하나 · 3단계-B 규율). */
    /// 검증 통과일(파이프라인). 인출일이 **아니다** — 프런트가 방향 제약을 걸어 쓴다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewed: Option<String>,
    /// 'ok' | 'none' | 'stale' — 노트↔카드 동기 상태. 파일 스캔 폴백에선 원리적으로 모른다(파생값).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anki_state: Option<String>,
    /// 이 노트를 선행으로 삼는 노트 수(링크 인입). 폴백에선 모른다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prereq_in: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub note_type: Option<String>,
}

/// 스캔 결과. `src` 는 UI 가 "어디서 온 숫자인지" 보여주는 데 쓴다(기존 문구 승계).
#[derive(Debug, Clone, Serialize)]
pub struct VaultNotes {
    pub notes: Vec<Note>,
    pub src: String,
    pub path: String,
}

/// `<workspace>/knowledge`. 워크스페이스를 모르거나 볼트가 없으면 None.
pub fn vault_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let ws = crate::workspace::resolve(app)?;
    let v = ws.join("knowledge");
    v.is_dir().then_some(v)
}

fn skip_dir(name: &str) -> bool {
    name.starts_with('_') || name.starts_with('.') || SKIP.contains(&name)
}

/// 집계에서 뺄 노트 파일인가(파일명 기준). 정본 인덱스는 파이프라인이 `kind` 로 거르므로
/// 이건 **폴백이 인덱스의 분모를 흉내내는** 장치이고, 흉내에는 한계가 있다(프런트 주석 참고).
fn skip_note(name: &str) -> bool {
    !name.ends_with(".md") || name.contains("MOC") || name.contains("실전문제")
}

/// 프론트매터 선두만 읽어 `key: value` 를 뽑는다. YAML 파서가 아니다 —
/// 프런트 `readFM` 과 같은 수준(첫 콜론 split)이어야 두 경로가 같은 답을 낸다.
fn read_front_matter(path: &Path) -> (Option<String>, bool, Option<String>) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return (None, false, None);
    };
    // 선두 1600바이트만 보는 프런트와 동형. char 경계로 잘라 UTF-8 을 깨지 않는다.
    let head: String = text.chars().take(1600).collect();
    let mut lines = head.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, false, None);
    }
    let (mut status, mut exported, mut reviewed) = (None, false, None);
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        let Some(i) = line.find(':') else { continue };
        let (k, v) = (line[..i].trim(), line[i + 1..].trim());
        match k {
            "status" => status = Some(v.to_string()),
            // ⚠ 값은 boolean 이 아니라 **날짜 문자열**이다(실측: `anki_exported: 2026-07-11`).
            //    존재 자체가 "내보냄"이므로 비어 있지 않으면 true.
            "anki_exported" => exported = !v.is_empty() && v != "null",
            // W2 — 폴백도 같은 레코드를 만든다. 빈 값은 None 이어야 프런트의 `''` 와 같은 뜻이 된다.
            "reviewed" => reviewed = (!v.is_empty() && v != "null").then(|| v.to_string()),
            _ => {}
        }
    }
    (status, exported, reviewed)
}

/// 볼트 트리를 **임의 깊이**로 순회한다. 깊이 2단 고정이 노트 46%를 버리던 것이 3단계-B 의 결함이다.
fn walk_notes(vault: &Path) -> Vec<Note> {
    let mut out = Vec::new();
    let Ok(top) = std::fs::read_dir(vault) else {
        return out;
    };
    for subj in top.flatten() {
        let name = subj.file_name().to_string_lossy().into_owned();
        if !subj.path().is_dir() || skip_dir(&name) {
            continue;
        }
        walk_dir(&subj.path(), &name, &name, &mut out);
    }
    out
}

fn walk_dir(dir: &Path, subject: &str, folder: &str, out: &mut Vec<Note>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let p = e.path();
        if p.is_dir() {
            if skip_dir(&name) {
                continue;
            }
            walk_dir(&p, subject, &format!("{folder}/{name}"), out);
        } else if !skip_note(&name) {
            let (status, anki_exported, reviewed) = read_front_matter(&p);
            out.push(Note {
                subject: subject.to_string(),
                folder: folder.to_string(),
                kind: None,
                status,
                anki_exported,
                reviewed,
                // 아래 넷은 파이프라인 **파생값**이라 프론트매터에 없다 — 폴백은 원리적으로 모른다.
                anki_state: None,
                prereq_in: None,
                tier_hint: None,
                role: None,
                note_type: None,
            });
        }
    }
}

/// 정본 인덱스(`_meta/cache/_index.json`)의 `notes[]` 를 그대로 넘긴다.
/// 파싱만 하고 해석하지 않는다 — 해석은 프런트 집계 함수 하나가 소유한다.
fn notes_from_index(vault: &Path) -> Option<Vec<Note>> {
    let raw = std::fs::read_to_string(vault.join("_meta/cache/_index.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let arr = v.get("notes")?.as_array()?;
    /// 인덱스의 문자열 필드 — `null` 이거나 빈 문자열이면 None(프런트의 `''` 와 같은 뜻).
    fn s(n: &serde_json::Value, k: &str) -> Option<String> {
        n.get(k)
            .and_then(|x| x.as_str())
            .filter(|x| !x.is_empty())
            .map(str::to_string)
    }
    Some(
        arr.iter()
            .map(|n| Note {
                subject: n
                    .get("subject")
                    .and_then(|x| x.as_str())
                    .unwrap_or("?")
                    .to_string(),
                folder: n
                    .get("folder")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                kind: s(n, "kind"),
                status: s(n, "status"),
                // 인덱스에선 날짜 문자열이거나 null 이다 — null 이 아니면 내보낸 것.
                anki_exported: n.get("anki_exported").is_some_and(|x| !x.is_null()),
                reviewed: s(n, "reviewed"),
                anki_state: s(n, "anki_state"),
                prereq_in: n.get("prereq_in").and_then(|x| x.as_f64()),
                tier_hint: s(n, "tier_hint"),
                role: s(n, "role"),
                note_type: s(n, "type"),
            })
            .collect(),
    )
}

/// 볼트 스캔 — 정본 인덱스 우선, 없으면 직접 순회. 프런트의 폴백 관계와 같은 순서다.
///
/// ⚠ `AppHandle` 을 받지 않는다(규율 11-2 · `server.rs:364` 와 같은 이유). 경로만 받으면
/// **진짜 볼트를 상대로 `cargo test` 에서 그대로 부를 수 있다** — 앱 창을 띄우지 않고도
/// "실물에서 노트가 읽히는가"를 잰다.
pub fn scan_at(vault: &Path) -> VaultNotes {
    let path = vault.to_string_lossy().into_owned();
    match notes_from_index(vault) {
        Some(notes) => VaultNotes {
            notes,
            src: "정본 _index.json".into(),
            path,
        },
        None => VaultNotes {
            notes: walk_notes(vault),
            src: "파일 스캔(.md)".into(),
            path,
        },
    }
}

#[tauri::command]
pub fn vault_scan(app: tauri::AppHandle) -> Result<VaultNotes, String> {
    let vault = vault_dir(&app).ok_or("볼트 폴더를 찾지 못했습니다(워크스페이스/knowledge).")?;
    Ok(scan_at(&vault))
}

/// 프런트가 구독하는 이벤트 이름 — `lib/tauri.ts` 의 상수와 일치해야 한다.
pub const VAULT_CHANGED: &str = "vault:changed";

/* ⚠⚠ **감시 세대(H6 · 2026-07-31 `/감사 근본`)**

종전엔 `lib.rs` 의 `setup` 이 `start_watch` 를 **1회**만 불렀고, 그 시점에 워크스페이스가
없으면 _"볼트 감시 생략"_ 을 로그에 적고 끝이었다. 그런데 **첫 실행 온보딩 경로가 정확히
그것**이다: 미설정으로 부팅 → 설정 탭에서 폴더 지정 → **그 세션 내내 `vault:changed` 가 0**.
프런트 구독(`app/VaultSync`)은 살아 있고 에러도 없어서, 볼트를 고쳐도 화면이 안 바뀌는데
**어디에도 그 사실이 없다**(조용한 무반응 · 재시작하면 나아서 진단이 특히 어렵다).

그래서 `workspace::set_workspace` 가 성공할 때마다 다시 부른다. 그러면 두 번째 문제가 생긴다 —
옛 스레드가 **옛 폴더를 계속 감시한 채** 프로세스 수명 내내 남아(notify 워처 + 플랫폼 FS 핸들)
그 폴더가 바뀌면 엉뚱한 `vault:changed` 를 쏜다. 세대 번호가 그걸 닫는다.

⚠ 정직하게 적는다: 옛 스레드는 `rx.recv()` 에 블록돼 있으므로 **옛 폴더에 이벤트가 한 번
올 때 은퇴**한다(즉시가 아니다). 다만 그 순간에도 **알림은 안 쏘고**(세대 검사가 emit 앞에
있다) 곧바로 루프를 끝낸다 — 잘못된 알림 0, 누수는 유한. 즉시 해제하려면 워처를 밖에서
드롭해야 하고 그건 `watch_with` 의 주입 계약(테스트 가능성)을 깬다. */
static WATCH_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 새 감시 세대를 발급한다. 이전 세대의 워처는 다음 이벤트에서 스스로 은퇴한다.
pub fn next_watch_generation() -> u64 {
    WATCH_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
}

/// 이 세대가 아직 현역인가. 아니면 그 워처는 알리지 말고 끝나야 한다.
pub fn watch_generation_is_current(generation: u64) -> bool {
    WATCH_GEN.load(std::sync::atomic::Ordering::SeqCst) == generation
}

/// 볼트 파일 감시를 시작한다(앱 부팅 시 + **워크스페이스가 바뀔 때마다**). 실패는 치명적이지
/// 않다 — 감시가 없으면 예전처럼 사용자가 버튼을 눌러 갱신할 뿐이므로, 앱을 못 뜨게 하지 않는다.
/* ── 감시 실패의 **관측 가능한 자리**(H7 · 2026-08-01) ──────────────────────────────────
감시 스레드가 죽으면 볼트를 고쳐도 화면이 안 바뀌는데, 종전엔 그 사실이 **로그 한 줄**로만
남았다(아래 `log::error!`). `capabilities.ok` 는 워크스페이스 유효성만 보므로 참이고, 그래서
콜드 게이트 문구도 안 뜬다 — 사용자에게는 "볼트가 조용하다"와 "감시가 죽었다"가 구분되지
않는다. 같은 파일이 `hotkey` 에 대해서는 정확히 반대 판단을 내려 두고 있었다(`hotkey.rs`
머리주석: *"조용히 삼키면 사용자는 키가 안 먹는 이유를 알 방법이 없다"*).
→ **같은 형태**로 사유를 싣는다: 여기 한 필드 + `capabilities` 한 줄 + 프런트 한 줄. */
static WATCH_ERR: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn set_watch_error(v: Option<String>) {
    *WATCH_ERR.lock().expect("vault watch err") = v;
}

/// 마지막 감시 실패 사유(없으면 None). `capabilities` 가 이 값을 실어 프런트로 보낸다.
///
/// ⚠ "폴더를 못 찾음"은 **실패가 아니다** — 워크스페이스 미설정은 정상 상태이고 그건 콜드
/// 게이트가 이미 말한다. 여기 실리는 것은 *감시를 걸려다 실패했거나 루프가 죽은* 경우뿐이다.
pub fn watch_error() -> Option<String> {
    WATCH_ERR.lock().expect("vault watch err").clone()
}

pub fn start_watch(app: tauri::AppHandle) {
    // ⚠ 세대는 **폴더를 못 찾아도** 올린다 — 그래야 옛 워처가 은퇴한다(경로를 지운 경우).
    let generation = next_watch_generation();
    let Some(dir) = vault_dir(&app) else {
        log::info!("볼트 감시 생략 — 볼트 폴더를 찾지 못했습니다.");
        // 미설정은 실패가 아니다 — 옛 실패 사유만 지운다(경로를 바꾼 뒤 유령 경고가 남지 않게).
        set_watch_error(None);
        return;
    };
    set_watch_error(None); // 새 세대 시작 — 앞 세대의 사유를 물려주지 않는다
    std::thread::spawn(move || {
        use tauri::Emitter;
        // 감시 자체는 `watch_with` 가 하고, 여기서 주는 것은 **알림 방법**뿐이다.
        let r = watch_with(&dir, || {
            // 세대가 바뀌었으면 이 워처는 옛 폴더를 보고 있다 — **알리지 않고** 끝낸다.
            if !watch_generation_is_current(generation) {
                log::info!("볼트 감시 은퇴(세대 {generation}) — 워크스페이스가 바뀌었습니다.");
                return false;
            }
            let _ = app.emit(VAULT_CHANGED, ());
            true // 앱이 살아 있는 동안 계속 감시한다
        });
        if let Err(e) = r {
            log::error!("볼트 감시 실패: {e}");
            /* ⚠ 현역 세대일 때만 싣는다 — 은퇴한 워처의 실패는 사용자에게 참이 아니다
            (워크스페이스를 바꾸면 옛 워처가 정상적으로 끝난다). */
            if watch_generation_is_current(generation) {
                set_watch_error(Some(format!("볼트 감시가 멈췄습니다: {e}")));
            }
        }
    });
}

/// 볼트 변경 감시 루프 — **알림 수단을 주입받는다.**
///
/// ⚠ `AppHandle` 을 받지 않는 이유는 테스트 가능성이다. 예전엔 `app.emit` 이 루프 안에
/// 박혀 있어서 "파일이 바뀌면 알림이 뜨는가"를 **앱을 띄워야만** 잴 수 있었고, 실제로 그
/// 케이스가 트랙 B 에 올라가 있었다(3단계). 정작 검사 대상은 notify 배선·디바운스·경로
/// 필터이고 그 어느 것도 창을 필요로 하지 않는다.
///
/// `on_change` 가 `false` 를 돌려주면 루프를 끝낸다 — 테스트가 유한하게 끝나기 위한 출구다.
pub fn watch_with(dir: &Path, mut on_change: impl FnMut() -> bool) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        // 내용이 아니라 **변화가 있었다는 사실만** 보낸다 — 프런트는 어차피 전체를 다시 읽는다.
        // 이벤트 종류로 분기하면 플랫폼별 차이(윈도우의 중복 발화 등)를 떠안게 된다.
        if let Ok(ev) = res {
            // 파생·시스템 폴더 변경은 무시 — 파이프라인이 `_meta/` 를 자주 건드려서
            // 그대로 두면 감시가 사실상 상시 발화가 된다. 단 정본 인덱스만은 예외다.
            let interesting = ev.paths.iter().any(|p| {
                let s = p.to_string_lossy();
                s.ends_with("_index.json") || !s.contains("\\_") && !s.contains("\\.")
            });
            if interesting {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    log::info!("볼트 감시 시작: {}", dir.display());

    /* 디바운스 — 에디터 한 번 저장에 notify 는 여러 번 운다(임시파일 생성·rename·mtime 갱신).
    그대로 흘리면 프런트가 저장 한 번에 스캔을 여러 번 돈다. 마지막 이벤트로부터
    조용해질 때까지 기다렸다가 **한 번만** 알린다. */
    const QUIET: Duration = Duration::from_millis(700);
    loop {
        // 첫 이벤트까지는 무한 대기(폴링 없음).
        if rx.recv().is_err() {
            return Ok(()); // 송신부가 사라졌다 = 앱 종료
        }
        let mut last = Instant::now();
        while last.elapsed() < QUIET {
            match rx.recv_timeout(QUIET) {
                Ok(()) => last = Instant::now(), // 아직 쓰는 중 — 조용해질 때까지 더 기다린다
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
            }
        }
        if !on_change() {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    /// ⚠ 테스트마다 **다른** 폴더를 준다. 처음엔 PID 로만 이름을 지었는데, 같은 바이너리 안의
    /// 테스트들이 병렬로 도는 데다 PID 가 같아 서로의 파일을 세고 있었다(셋 다 6개를 봤다).
    fn tmp() -> PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let d = std::env::temp_dir().join(format!(
            "lh-vault-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn 임의_깊이의_노트를_전부_찾는다() {
        let d = tmp();
        write(
            &d,
            "기초 수학/미적분/01 극한/a.md",
            "---\nstatus: verified\n---\n",
        );
        write(
            &d,
            "기초 수학/미적분/02 미분/더 깊이/b.md",
            "---\nstatus: drafted\n---\n",
        );
        write(&d, "기초 수학/개요.md", "---\nstatus: verified\n---\n");
        let notes = walk_notes(&d);
        assert_eq!(notes.len(), 3, "깊이 2단 고정이면 1개만 잡힌다");
        let mut folders: Vec<_> = notes.iter().map(|n| n.folder.clone()).collect();
        folders.sort();
        assert_eq!(
            folders,
            vec![
                "기초 수학",
                "기초 수학/미적분/01 극한",
                "기초 수학/미적분/02 미분/더 깊이"
            ]
        );
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn 스킵_폴더는_모든_깊이에서_걸러진다() {
        let d = tmp();
        write(
            &d,
            "수학/미적분/.trash/x.md",
            "---\nstatus: verified\n---\n",
        );
        write(
            &d,
            "수학/미적분/_리포트/y.md",
            "---\nstatus: verified\n---\n",
        );
        write(&d, "수학/미적분/01장/z.md", "---\nstatus: verified\n---\n");
        assert_eq!(walk_notes(&d).len(), 1);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn moc와_실전문제는_제외하고_프론트매터를_읽는다() {
        let d = tmp();
        write(&d, "수학/1장/MOC.md", "---\nstatus: verified\n---\n");
        write(
            &d,
            "수학/1장/실전문제 모음.md",
            "---\nstatus: verified\n---\n",
        );
        write(
            &d,
            "수학/1장/n.md",
            "---\nstatus: verified\nanki_exported: 2026-07-11\n---\n본문",
        );
        write(&d, "수학/1장/m.md", "본문만 있고 프론트매터 없음");
        let notes = walk_notes(&d);
        assert_eq!(notes.len(), 2);
        let n = notes.iter().find(|n| n.status.is_some()).unwrap();
        assert_eq!(n.status.as_deref(), Some("verified"));
        assert!(n.anki_exported, "날짜 문자열은 '내보냄'을 뜻한다");
        let m = notes.iter().find(|n| n.status.is_none()).unwrap();
        assert!(!m.anki_exported);
        std::fs::remove_dir_all(&d).unwrap();
    }

    /* ── 실물 대상 통합 검사 ─────────────────────────────────────────────────
    ▶ 트랙 B `3단계`("볼트를 폴더 선택 없이 읽고 파일 변경에 자동 갱신된다")를 여기로 내렸다.

    그 케이스는 **두 가지**를 한꺼번에 재고 있었다: ① 진짜 볼트가 읽히는가 ② 파일이 바뀌면
    스스로 갱신되는가. 둘 다 앱 창과 무관하다 — ①은 경로 문제고 ②는 notify 배선 문제다.
    원래 주석의 "브라우저엔 watch 가 없다"는 **트랙 A(Chromium)로는 못 잡는다**는 뜻이었지
    *창을 띄워야 한다*는 뜻이 아니었다. Rust 통합 테스트가 정확히 그 자리다.

    ⚠ 그리고 여기로 내리면서 검사가 **더 안전해졌다**: 옛 케이스는 사용자의 실제 볼트 파일을
    다시 써서(같은 바이트) mtime 을 건드렸다. 아래 ②는 임시 폴더를 쓰므로 실물을 만지지 않는다. */

    #[test]
    fn 실_볼트를_폴더_선택_없이_읽는다() {
        let vault = crate::testkit::vault_or_skip!();
        let out = scan_at(&vault);
        assert!(!out.notes.is_empty(), "실 볼트에서 노트를 하나도 못 읽었다");
        assert!(
            out.path.contains("knowledge"),
            "볼트 경로가 아니다: {}",
            out.path
        );
        // 노트 레코드가 실제로 채워졌는가 — 과목이 전부 비면 파싱이 죽은 것이다.
        assert!(out.notes.iter().any(|n| !n.subject.is_empty()));
    }

    #[test]
    fn 파일이_바뀌면_감시가_한_번_운다() {
        let d = tmp();
        std::fs::create_dir_all(d.join("수학")).unwrap();

        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let dir = d.clone();
        let h = std::thread::spawn(move || {
            // 첫 발화에서 false 를 돌려 루프를 끝낸다 — 테스트가 유한하게 끝난다.
            let _ = watch_with(&dir, || {
                let _ = tx.send(());
                false
            });
        });

        // 감시자가 올라올 시간을 준 뒤 실제 파일을 만든다(진짜 fs 이벤트여야 의미가 있다).
        std::thread::sleep(std::time::Duration::from_millis(400));
        std::fs::write(
            d.join("수학").join("새노트.md"),
            "---\nstatus: drafted\n---\n",
        )
        .unwrap();

        // 디바운스(700ms)를 감안한 여유. 안 오면 notify 배선이 끊긴 것이다.
        let got = rx.recv_timeout(std::time::Duration::from_secs(10));
        assert!(
            got.is_ok(),
            "파일을 바꿨는데 감시가 울지 않았다 — notify 배선이 끊겼다"
        );
        let _ = h.join();
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 파생_폴더_변경은_감시를_깨우지_않는다() {
        /* `_meta/` 는 파이프라인이 상시 건드린다 — 그대로 흘리면 감시가 사실상 상시 발화가
        되어 프런트가 계속 재스캔한다. 단 **정본 인덱스만은 예외**(그건 진짜 갱신 신호다).
        이 필터가 풀리면 성능 결함이 조용히 들어오므로 여기서 잠근다. */
        let d = tmp();
        std::fs::create_dir_all(d.join("_meta").join("cache")).unwrap();

        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let dir = d.clone();
        let h = std::thread::spawn(move || {
            let _ = watch_with(&dir, || {
                let _ = tx.send(());
                false
            });
        });
        std::thread::sleep(std::time::Duration::from_millis(400));

        // 파생 폴더의 **인덱스가 아닌** 파일 — 무시돼야 한다.
        std::fs::write(d.join("_meta").join("cache").join("_잡동사니.json"), "{}").unwrap();
        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(2500))
                .is_err(),
            "파생 폴더 변경에 감시가 울었다 — 상시 발화가 된다"
        );

        // 정본 인덱스는 예외라 울어야 한다(필터가 과하게 잠기지 않았는지 함께 확인).
        std::fs::write(d.join("_meta").join("cache").join("_index.json"), "{}").unwrap();
        assert!(
            rx.recv_timeout(std::time::Duration::from_secs(10)).is_ok(),
            "정본 인덱스 변경을 놓쳤다 — 필터가 과하게 잠겼다"
        );
        let _ = h.join();
        let _ = std::fs::remove_dir_all(&d);
    }
}

#[cfg(test)]
mod watch_generation_tests {
    use super::*;

    /* ⚠⚠ H6(2026-07-31 `/감사 근본`) — 워크스페이스를 **부팅 뒤에** 지정하면 감시가 그 세션 내내
    안 붙었고, 경로를 바꾸면 옛 워처가 옛 폴더를 계속 감시한 채 남았다. 세대 번호가 둘 다
    닫는다. 여기서 잠그는 것은 그 규율의 **뼈대**다 — 실제 notify 배선은 위 케이스들이,
    `set_workspace` 가 이걸 부르는지는 그 함수의 호출 한 줄이 소유한다.

    ⚠ `start_watch` 자체를 부르지 않는 이유: `AppHandle` 이 필요해 실물 창이 있어야 한다.
    규율 11-2 대로 **판정을 순수 함수로 갈라** 두었으므로 그 자리가 곧 테스트 진입점이다. */

    #[test]
    fn 새_세대를_발급하면_이전_세대는_현역이_아니다() {
        let old = next_watch_generation();
        assert!(
            watch_generation_is_current(old),
            "방금 발급한 세대가 현역이 아니면 첫 워처부터 즉시 은퇴한다"
        );

        let new = next_watch_generation();
        assert!(new > old, "세대는 단조 증가해야 한다");
        assert!(
            !watch_generation_is_current(old),
            "옛 세대가 현역으로 남으면 워크스페이스를 바꿔도 엉뚱한 폴더의 알림이 계속 온다"
        );
        assert!(watch_generation_is_current(new));
    }

    #[test]
    fn 폴더를_못_찾아도_세대는_올라간다는_계약() {
        // `start_watch` 는 dir 조회 **전에** 세대를 올린다 — 그래야 경로를 지운 경우에도
        // 옛 워처가 은퇴한다. 그 순서를 여기서 문장으로 못박는다(호출 순서 회귀 방지).
        let before = next_watch_generation();
        let after = next_watch_generation();
        assert_eq!(after, before + 1);
    }
}
