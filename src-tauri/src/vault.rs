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

/* ── T-11 부재 브리핑: "앱이 꺼져 있던 동안 **밖에서** 무슨 일이 있었나" ──────────────
앱의 부재 브리핑(`lib/absence.ts`)은 여태 **앱 안에서 무너진 것**만 말했다(밀린 복습·미완
블록·마감). 그런데 이 사용자의 학습은 앱 밖에서도 일어난다 — 볼트에 노트를 쓰고 Anki 를 돈다.
그 사실이 데이터 모델에 통째로 없어서, 4일 만에 연 화면은 **밖에서 한 일을 없던 것처럼**
그렸다(로드맵 T-11 의 _"'달라짐'이 데이터 모델에 없다"_ 가 이 말이다).

⚠ **mtime 만 본다 — 내용을 안 읽는다.** 프론트매터를 읽으면 노트 수백 개를 매번 열게 되고,
그건 복귀 첫 화면에 붙일 비용이 아니다. 여기서 답하는 질문은 *무엇이 바뀌었나*가 아니라
**바뀐 것이 있었나**다.
⚠ 여전히 **해석은 하지 않는다**(이 파일의 규율). 접기·문장 만들기는 `lib/absence.ts` 가 한다. */

/// 부재 기간에 손댄 노트 하나. `scan_at` 의 `Note` 와 같은 좌표계(과목=최상위 폴더).
#[derive(Debug, Clone, Serialize)]
pub struct TouchedNote {
    pub subject: String,
    /// 볼트 루트 기준 폴더(과목부터). 프런트가 챕터명을 만들 때 쓰는 것과 같은 형식.
    pub folder: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultTouched {
    /// 손댄 노트 **전체 수**. `notes` 는 상한에 잘리지만 이 수는 안 잘린다.
    pub count: usize,
    /// 표본(최대 [`TOUCHED_CAP`]개). 브리핑은 과목 이름 두어 개만 쓰므로 전량이 필요 없다.
    pub notes: Vec<TouchedNote>,
}

/// 표본 상한. 방학에 볼트를 통째로 손보면 500개가 넘을 수 있는데, 그 경우에도 화면이 쓰는 것은
/// **수 하나 + 과목 몇 개**다 — 전량을 IPC 로 넘기는 것은 값 없는 비용이다.
pub const TOUCHED_CAP: usize = 64;

/// `vault` 아래에서 mtime 이 `since_ms` **이후**인 노트를 센다.
///
/// ⚠ `AppHandle` 을 안 받는다(규율 11-2) — 임시 폴더와 실 볼트 양쪽에서 그대로 부를 수 있다.
pub fn touched_since_at(vault: &Path, since_ms: u64) -> VaultTouched {
    let mut out = VaultTouched {
        count: 0,
        notes: Vec::new(),
    };
    let Ok(top) = std::fs::read_dir(vault) else {
        return out;
    };
    for subj in top.flatten() {
        let name = subj.file_name().to_string_lossy().into_owned();
        if !subj.path().is_dir() || skip_dir(&name) {
            continue;
        }
        walk_touched(&subj.path(), &name, &name, since_ms, &mut out);
    }
    out
}

fn walk_touched(dir: &Path, subject: &str, folder: &str, since_ms: u64, out: &mut VaultTouched) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let p = e.path();
        if p.is_dir() {
            if !skip_dir(&name) {
                walk_touched(&p, subject, &format!("{folder}/{name}"), since_ms, out);
            }
        } else if !skip_note(&name) && modified_ms(&p).is_some_and(|m| m >= since_ms) {
            out.count += 1;
            if out.notes.len() < TOUCHED_CAP {
                out.notes.push(TouchedNote {
                    subject: subject.to_string(),
                    folder: folder.to_string(),
                });
            }
        }
    }
}

/// 파일 수정 시각(epoch ms). 플랫폼이 mtime 을 안 주면 None — **모르면 세지 않는다.**
fn modified_ms(path: &Path) -> Option<u64> {
    let t = std::fs::metadata(path).ok()?.modified().ok()?;
    let d = t.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(d.as_millis() as u64)
}

/// 볼트가 없으면 **에러가 아니라 0** 이다 — 복귀 화면은 볼트 미설정에서도 그려져야 하고,
/// "밖에서 한 것이 없다"와 "볼트를 모른다"를 프런트가 굳이 가를 이유가 없다(둘 다 할 말이 없다).
#[tauri::command]
pub fn vault_touched(app: tauri::AppHandle, since_ms: u64) -> VaultTouched {
    match vault_dir(&app) {
        Some(v) => touched_since_at(&v, since_ms),
        None => VaultTouched {
            count: 0,
            notes: Vec::new(),
        },
    }
}

/* ── T-18 시험 전날 한 장: 챕터 폴더의 노트 **본문**을 그대로 넘긴다 ─────────────────
`vault_scan` 은 프론트매터만 읽는다 — 그래서 앱은 노트가 *있다*는 것만 알고 그 안에 무엇이
적혀 있는지는 한 번도 안 봤다. 시험 전날에 필요한 것(정의·정리·함정·식)은 전부 본문에 있고,
그래서 사용자는 그걸 **손으로 옮겨 적고** 있었다.

⚠ **여기서도 해석은 하지 않는다.** 마크업을 읽어 항목으로 접는 것은 `lib/examSheet.ts` 다
(순수 함수라 픽스처로 잠글 수 있다 — Rust 에 두면 그 검사가 통합 테스트로 올라간다).
이 커맨드의 책임은 **경로를 안전하게 풀고 본문을 상한 안에서 넘기는 것**까지다. */

#[derive(Debug, Clone, Serialize)]
pub struct NoteText {
    /// 볼트 루트 기준 폴더(요청한 챕터 아래 하위 폴더면 그 경로까지).
    pub folder: String,
    /// 파일명에서 확장자를 뗀 것 — 노트 제목의 정본(파이프라인이 `title` 과 맞춰 둔다).
    pub title: String,
    pub text: String,
}

/// 한 번에 읽는 노트 수 상한. 챕터 하나가 이보다 크면 그건 챕터가 아니라 과목이다.
pub const SHEET_NOTE_CAP: usize = 80;
/// 노트당 바이트 상한. 실측 노트가 4~12 KB 라 넉넉하고, 이상치 하나가 IPC 를 막지 못하게 한다.
pub const SHEET_BYTES_CAP: usize = 64 * 1024;

/// 볼트 안으로만 내려가는 상대경로 결합. `..`·절대경로·드라이브 접두를 **전부 거절**한다.
///
/// ⚠ 이 함수가 없으면 프런트가 보낸 문자열 하나로 디스크 어디든 읽을 수 있다. 폴더 이름은
/// 사용자 데이터(볼트)에서 오지만, **경계에서 신뢰하지 않는 것**이 규약이다.
fn safe_join(vault: &Path, rel: &str) -> Option<PathBuf> {
    let mut p = vault.to_path_buf();
    for comp in Path::new(rel).components() {
        match comp {
            std::path::Component::Normal(c) => p.push(c),
            // `.` 은 무해하지만 나머지(부모·루트·접두)는 볼트를 벗어나는 유일한 수단이다.
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    p.starts_with(vault).then_some(p)
}

/// `<vault>/<rel>` 아래 노트들의 본문. 폴더가 없거나 경로가 볼트를 벗어나면 빈 벡터.
pub fn notes_text_at(vault: &Path, rel: &str) -> Vec<NoteText> {
    let mut out = Vec::new();
    let Some(dir) = safe_join(vault, rel) else {
        return out;
    };
    if !dir.is_dir() {
        return out;
    }
    collect_text(&dir, rel, &mut out);
    out
}

fn collect_text(dir: &Path, folder: &str, out: &mut Vec<NoteText>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    // 파일명 순 — 노트가 `CIRC 01`, `CIRC 02` 처럼 번호를 달고 있어 그게 곧 교재 순서다.
    names.sort();
    for p in names {
        if out.len() >= SHEET_NOTE_CAP {
            return;
        }
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if p.is_dir() {
            if !skip_dir(&name) {
                collect_text(&p, &format!("{folder}/{name}"), out);
            }
        } else if !skip_note(&name) {
            let Ok(text) = std::fs::read_to_string(&p) else {
                continue;
            };
            out.push(NoteText {
                folder: folder.to_string(),
                title: name.trim_end_matches(".md").to_string(),
                // char 경계로 자른다 — 바이트로 자르면 한글 노트가 UTF-8 중간에서 깨진다.
                text: if text.len() > SHEET_BYTES_CAP {
                    text.chars().take(SHEET_BYTES_CAP / 3).collect()
                } else {
                    text
                },
            });
        }
    }
}

#[tauri::command]
pub fn vault_notes_text(app: tauri::AppHandle, folder: String) -> Result<Vec<NoteText>, String> {
    let vault = vault_dir(&app).ok_or("볼트 폴더를 찾지 못했습니다(워크스페이스/knowledge).")?;
    Ok(notes_text_at(&vault, &folder))
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

/// 볼트 감시를 **다시 건다**. 새 세대를 올리므로 옛 워처는 스스로 은퇴한다.
///
/// ⚠⚠ **관측에는 짝이 있어야 한다**(M-9 · 2026-08-06 감사). H7 이 감시 실패를 화면까지 실어
/// 나르게 만들었지만(_"감시가 죽으면 볼트를 고쳐도 화면이 안 바뀐다"_) 사용자가 할 수 있는 일은
/// **앱 재시작**뿐이었다. 감시 실패는 대개 일시적(폴더 잠금·네트워크 드라이브 끊김)이라
/// 다시 거는 것이 맞는 처방이다.
///
/// ⚠ 즉시 성공/실패를 못 돌려준다 — 감시는 스레드에서 서고 실패 사유는 `WATCH_ERR` 에 나중에
/// 앉는다. 그래서 반환이 없고, 화면은 다음 `ping` 에서 사유가 사라졌는지로 판단한다
/// (없는 확신을 지어내지 않는다).
#[tauri::command]
pub fn vault_watch_retry(app: tauri::AppHandle) {
    start_watch(app);
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

    /// 지금(epoch ms). 테스트는 **파일을 지금 쓰므로** 창의 양쪽을 이걸로 만든다
    /// (mtime 을 인위로 세우려면 크레이트가 하나 더 필요하고, 그 값은 여기서 안 필요하다).
    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    #[test]
    fn 부재_창_안에_쓰인_노트만_센다() {
        let d = tmp();
        write(&d, "회로이론/03 과도응답/a.md", "본문");
        write(&d, "회로이론/03 과도응답/b.md", "본문");
        write(&d, "전자기학/개요.md", "본문");
        let t = now_ms();

        let hit = touched_since_at(&d, t - 60_000);
        assert_eq!(
            hit.count, 3,
            "방금 쓴 노트가 창 안에 안 들어오면 브리핑이 늘 0을 말한다"
        );
        let mut subs: Vec<_> = hit.notes.iter().map(|n| n.subject.clone()).collect();
        subs.sort();
        subs.dedup();
        assert_eq!(subs, vec!["전자기학", "회로이론"], "과목은 최상위 폴더다");

        // ⚠ 창의 반대편 — 미래를 기준으로 물으면 **아무것도 없어야** 한다. 이 단언이 없으면
        //    "전부 센다"는 구현도 위 케이스를 통과한다(경계를 안 보는 검사가 된다).
        assert_eq!(touched_since_at(&d, t + 60_000).count, 0);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn 손댄_노트도_스캔과_같은_분모를_쓴다() {
        let d = tmp();
        write(&d, "회로이론/01 기초/a.md", "본문");
        write(&d, "회로이론/01 기초/MOC.md", "본문"); // 집계 밖(파일명 규칙)
        write(&d, "회로이론/01 기초/메모.txt", "본문"); // .md 아님
        write(&d, "_복습시스템/x.md", "본문"); // 스킵 폴더
                                               // 같은 볼트를 두 경로로 세면 같은 분모여야 한다 — 안 그러면 "밖에서 3"과 화면의
                                               // 노트 수가 어긋나고, 사용자는 어느 쪽이 거짓인지 알 방법이 없다.
        assert_eq!(
            touched_since_at(&d, now_ms() - 60_000).count,
            walk_notes(&d).len()
        );
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn 챕터_폴더의_본문을_파일명_순으로_읽는다() {
        let d = tmp();
        write(&d, "회로이론/01 기초/CIRC 02.md", "둘");
        write(&d, "회로이론/01 기초/CIRC 01.md", "하나");
        write(&d, "회로이론/01 기초/CIRC-01 대표문제.md", "제외 대상 아님");
        write(&d, "회로이론/02 저항/x.md", "다른 챕터");
        let got = notes_text_at(&d, "회로이론/01 기초");
        let titles: Vec<_> = got.iter().map(|n| n.title.as_str()).collect();
        assert_eq!(
            titles,
            vec!["CIRC 01", "CIRC 02", "CIRC-01 대표문제"],
            "번호가 곧 교재 순서라 파일명 정렬이 계약이다"
        );
        assert_eq!(got[0].text, "하나");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn 볼트_밖을_가리키는_경로는_거절한다() {
        let d = tmp();
        write(&d, "회로이론/01 기초/a.md", "안");
        std::fs::write(d.join("비밀.md"), "밖").unwrap();
        // ⚠ 이게 통과하면 프런트가 보낸 문자열 하나로 디스크 어디든 읽힌다.
        assert!(notes_text_at(&d, "회로이론/../..").is_empty(), "부모 참조");
        assert!(notes_text_at(&d, "/etc").is_empty(), "절대경로");
        assert_eq!(
            notes_text_at(&d, "회로이론/01 기초").len(),
            1,
            "정상 경로는 그대로 읽힌다"
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
