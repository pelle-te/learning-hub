/*! 통합 테스트 공용 헬퍼 — **진짜 워크스페이스·진짜 DB 를 상대하는 테스트**의 토대.

## 왜 이 파일이 생겼나 (층 재배치, 2026-07-20)

트랙 B(`web/e2e-shell/shell.spec.ts`)가 16개까지 불어나 있었고, 그중 대부분은 **GUI 가 필요해서**가
아니라 *진짜 워크스페이스/DB 를 상대해야 해서* 거기 있었다. 각 케이스 주석이 "유닛 테스트는 내가
만든 임시 폴더를 읽으니 못 잡는다"고 정확히 논증하는데, 그 논증이 정당화하는 것은
**실물을 상대하는 통합 테스트**지 *앱 창을 띄우는 것*이 아니다. GUI 를 테스트 하네스로 쓰고 있었다.

대가는 컸다: 케이스마다 exe 를 띄웠다 내려 회당 기동이 19번이었고, 앞에 릴리스 빌드가 붙었다.
여기로 내려오면 같은 것을 **초 단위**로 잰다.

## 규율 — 조용한 skip 을 만들지 않는다

리소스가 없을 때 테스트를 그냥 통과시키면 "녹색인데 아무것도 안 쟀다"가 된다. 그건 이 재배치가
고치려는 병과 같은 부류다. 그래서:

- **환경 가정은 `환경_가정_실_워크스페이스가_잡힌다` 하나가 명시적으로 단언**한다.
  워크스페이스를 못 찾으면 **거기 하나가 시끄럽게 실패**한다 — 나머지가 조용히 비는 대신에.
- 개별 헬퍼의 `None` 은 그 위에서 **입자를 나누는 용도**다(볼트는 있는데 DB 는 아직 없는 상태 등).
  그 경우 `skip!` 이 stderr 에 표시를 남긴다.
*/
use std::path::PathBuf;

/// 리소스가 없어 검사를 건너뛴다는 **눈에 보이는** 표시. 조용히 통과하지 않게 한다.
///
/// ⚠ 이걸 환경 가정 전반에 쓰지 말 것 — 그 용도는 아래 `환경_가정_…` 테스트 하나가 맡는다.
/// 여기 쓰는 것은 "이 기계에선 아직 존재할 수 없는 것"(첫 실행 전 DB 등)에 한한다.
macro_rules! skip {
    ($why:expr) => {{
        eprintln!("⚠ SKIP [{}] — {}", module_path!(), $why);
        return;
    }};
}
pub(crate) use skip;

/// 실제 워크스페이스(`knowledge/` 와 `pipeline/` 을 가진 폴더).
///
/// `workspace::infer()` 를 그대로 쓴다 — 테스트 전용 경로 탐색을 따로 만들면 **앱이 쓰는 것과
/// 다른 경로를 검사**하게 되어, 정작 이 테스트들이 잡으려는 "경로 기준이 갈리는 결함"을 못 본다.
/// 테스트 바이너리는 `target/debug/deps/` 에 있고 거기서 위로 올라가면 워크스페이스가 잡힌다.
pub fn real_workspace() -> Option<PathBuf> {
    crate::workspace::infer()
}

/// 실제 볼트(`<workspace>/knowledge`).
pub fn real_vault() -> Option<PathBuf> {
    let v = real_workspace()?.join("knowledge");
    v.is_dir().then_some(v)
}

/// 실제 앱 DB. **아직 없을 수 있다**(앱을 한 번도 안 켠 기계) — 그건 정상이라 `None` 이다.
///
/// 경로는 `tauri-plugin-sql` 이 여는 것과 같아야 한다: app data 폴더 + `learning-hub.db`.
/// 식별자는 `tauri.conf.json` 의 `identifier`.
pub fn real_db() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let p = PathBuf::from(std::env::var("APPDATA").ok()?)
            .join("dev.jin.learninghub")
            .join("learning-hub.db");
        p.is_file().then_some(p)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// 블로킹 컨텍스트에서 async 를 돌리는 런타임 — sqlx 를 쓰는 테스트들의 공용 진입점.
pub fn rt() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("테스트 런타임 생성 실패")
}

#[cfg(test)]
mod tests {
    use super::*;

    /* ⚠ **이 테스트가 나머지 통합 테스트 전체의 전제를 대신 단언한다.**

    아래 모듈들(artifact·tools·vault·anki_scan·server)의 실물 검사는 워크스페이스가 잡힌다는
    가정 위에 서 있다. 가정이 깨졌을 때 각자 조용히 건너뛰면 **게이트는 녹색인데 실물은 하나도
    안 재는** 상태가 된다 — 트랙 B 를 여기로 내린 이유와 정확히 같은 실패 모양이다.
    그래서 가정을 **한 곳에서 시끄럽게** 잠근다. 여기가 빨간불이면 다른 실패는 볼 것도 없다. */
    #[test]
    fn 환경_가정_실_워크스페이스가_잡힌다() {
        let ws = real_workspace().expect(
            "워크스페이스를 못 찾았습니다 — `knowledge/` 와 `pipeline/` 을 가진 폴더가 \
             이 저장소의 부모여야 합니다. 실물 대상 통합 테스트가 전부 이 가정 위에 있습니다.",
        );
        assert!(ws.join("knowledge").is_dir(), "볼트가 없습니다: {ws:?}");
        assert!(
            ws.join("pipeline").is_dir(),
            "파이프라인이 없습니다: {ws:?}"
        );
        assert!(
            real_vault().is_some(),
            "볼트 경로 해석이 워크스페이스와 어긋납니다"
        );
    }
}
