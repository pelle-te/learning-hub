/*! 워크스페이스 경로 — 1단계 신설 작업(설계 §4-1단계).

`serve.js:32-33` 은 `WORK = path.dirname(__dirname)` 으로 워크스페이스를 **실행 위치에서 추론**한다.
파이썬 도구 11종이 전부 이 cwd 로 돌고 아티팩트 6종 경로도 여기 기준이다.

Tauri 앱은 설치 경로에 놓이므로 **1단계에서 이미 이 추론이 깨진다**(sidecar serve.js 의 `__dirname`
이 설치 경로가 됨). 그래서 워크스페이스 경로를 **설정값으로 승격**한다:
  ① 저장된 설정이 있으면 그것 ② 없으면 자동 추론(개발 중 실행 위치) ③ 그래도 없으면 사용자 선택.

> 이것 때문에 "1단계 = 기능 변화 0"은 성립하지 않는다 → "프런트 회귀 0 + 셸/경로 설정 신규".
*/
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 워크스페이스로 인정하는 표지 — `knowledge/` 와 `pipeline/` 이 함께 있는 폴더.
/// (러닝허브 앱 폴더 `hub/` 의 **부모**가 워크스페이스라는 것이 저장소 규약이다.)
const MARKERS: [&str; 2] = ["knowledge", "pipeline"];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceConfig {
    /// 사용자가 고르거나 추론된 워크스페이스 절대경로. 미설정이면 None.
    pub path: Option<String>,
}

/// 프런트에 돌려주는 현재 상태 — 경로가 있어도 폴더가 사라졌을 수 있으므로 유효성을 함께 준다.
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceStatus {
    pub path: Option<String>,
    /// 경로가 존재하고 표지(knowledge/·pipeline/)를 가졌는가. false면 복구 UX가 필요하다.
    pub valid: bool,
    /// 설정 없이 자동 추론으로 얻은 값인가(사용자 확인을 받을 대상).
    pub inferred: bool,
}

fn config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 폴더 결정은 paths 가 소유한다(SD-6) — DB·잡 이력과 **같은 폴더**여야 하기 때문.
    Ok(crate::paths::config_dir(app)?.join("workspace.json"))
}

pub fn load(app: &tauri::AppHandle) -> WorkspaceConfig {
    // 읽기 실패·손상은 '미설정'으로 취급한다 — 설정 파일 하나 때문에 앱이 안 뜨면 안 된다.
    config_file(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &tauri::AppHandle, cfg: &WorkspaceConfig) -> Result<(), String> {
    let p = config_file(app)?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(p, json).map_err(|e| format!("설정 저장 실패: {e}"))
}

/// 표지 폴더를 가진 진짜 워크스페이스인가.
pub fn is_workspace(dir: &Path) -> bool {
    dir.is_dir() && MARKERS.iter().all(|m| dir.join(m).is_dir())
}

/// 설정이 없을 때의 자동 추론 — 실행 파일 위치에서 위로 올라가며 표지를 찾는다.
/// 개발 중(`src-tauri/target/debug/`)에도, 저장소에서 바로 실행할 때도 여기서 잡힌다.
/// 설치 경로에 놓인 배포본은 대개 실패한다 → 그때가 사용자 선택이 필요한 순간이다.
pub fn infer() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut cur: Option<&Path> = exe.parent();
    while let Some(dir) = cur {
        if is_workspace(dir) {
            return Some(dir.to_path_buf());
        }
        cur = dir.parent();
    }
    // 개발 실행에서는 cwd 가 저장소 루트(hub/)인 경우가 흔하다 — 그 부모도 본다.
    let cwd = std::env::current_dir().ok()?;
    for cand in [cwd.parent(), Some(cwd.as_path())].into_iter().flatten() {
        if is_workspace(cand) {
            return Some(cand.to_path_buf());
        }
    }
    None
}

/// 실제로 쓸 경로 — 저장된 설정 우선, 없으면 추론. sidecar spawn 이 이걸 cwd 로 쓴다.
pub fn resolve(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Some(p) = load(app).path {
        let pb = PathBuf::from(p);
        if is_workspace(&pb) {
            return Some(pb);
        }
        // 저장된 경로가 죽었다(폴더 이동·외장드라이브 분리) → 추론으로 폴백하고 프런트가 안내한다.
    }
    infer()
}

#[tauri::command]
pub fn workspace_status(app: tauri::AppHandle) -> WorkspaceStatus {
    let saved = load(&app).path.map(PathBuf::from);
    match saved {
        Some(p) if is_workspace(&p) => WorkspaceStatus {
            path: Some(p.to_string_lossy().into_owned()),
            valid: true,
            inferred: false,
        },
        // 저장값이 있지만 무효 — 경로를 그대로 보여줘야 "어디가 사라졌는지" 안내할 수 있다.
        Some(p) => WorkspaceStatus {
            path: Some(p.to_string_lossy().into_owned()),
            valid: false,
            inferred: false,
        },
        None => match infer() {
            Some(p) => WorkspaceStatus {
                path: Some(p.to_string_lossy().into_owned()),
                valid: true,
                inferred: true,
            },
            None => WorkspaceStatus {
                path: None,
                valid: false,
                inferred: false,
            },
        },
    }
}

/// 사용자가 고른 경로를 확정 저장. 표지가 없으면 거부한다 —
/// 엉뚱한 폴더를 저장하면 파이썬 도구 11종이 전부 조용히 빈 결과를 낸다(진단이 가장 어려운 실패).
#[tauri::command]
pub fn set_workspace(app: tauri::AppHandle, path: String) -> Result<WorkspaceStatus, String> {
    let pb = PathBuf::from(&path);
    if !pb.is_dir() {
        return Err("폴더가 존재하지 않습니다.".into());
    }
    if !is_workspace(&pb) {
        return Err("워크스페이스 폴더가 아닙니다 — knowledge/ 와 pipeline/ 이 함께 있는 폴더를 골라주세요.".into());
    }
    save(
        &app,
        &WorkspaceConfig {
            path: Some(pb.to_string_lossy().into_owned()),
        },
    )?;
    /* ⚠⚠ **감시를 다시 건다(H6 · 2026-07-31 `/감사 근본`).** 종전엔 `setup` 이 부팅에 1회만
    걸어서, 워크스페이스를 **부팅 뒤에** 지정하면(= 첫 실행 온보딩의 정상 경로다) 그 세션 내내
    `vault:changed` 가 0 이었다 — 볼트를 고쳐도 화면이 안 바뀌는데 안내가 어디에도 없는
    조용한 무반응이고, 재시작하면 나아서 진단이 특히 어려웠다. 세대 번호가 옛 워처의 은퇴까지
    맡는다(근거는 `vault.rs` 의 `WATCH_GEN` 주석). */
    crate::vault::start_watch(app.clone());
    Ok(WorkspaceStatus {
        path: Some(pb.to_string_lossy().into_owned()),
        valid: true,
        inferred: false,
    })
}
