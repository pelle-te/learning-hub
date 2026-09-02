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

## ⚠ CI 는 실물이 **원리적으로** 없다 (C2 · 2026-08-01)

CI 는 hub 를 **독립 repo 로 체크아웃**한다(`pelle-te/learning-hub`) — `atelier/{knowledge,pipeline}`
형제 폴더가 존재할 수 없다. 그래서 위 환경 가정이 2026-07-19 부터 **8런 연속 빨간불**이었고,
`cargo test` 뒤의 `tauri:build` 와 **`npm run e2e`(시각 회귀 174케이스)가 전부 skipped** 였다.
2026-07-25 감사가 *"UI 안전망이 누가 로컬에서 기억하는가에 걸려 있다"* 고 진단해 CI 에 넣은 그
스텝이, 진단된 상태 그대로 13일을 살았다.

**픽스처 워크스페이스로는 못 고친다** — 실측으로 기각했다. 이 검사들이 단언하는 것은 *폴더가
있는가*가 아니라 **실제 내용**이다: 볼트 노트 비어있지 않음 · Anki 덱의 카드 수 > 0 ·
`reads`·`markets` 산출물이 JSON 으로 풀림 · `pipeline/_도구/` 의 파이썬이 **한글 stdout** 을 냄.
마지막 것은 애초에 **다른 저장소**에 있다. 빈 껍데기를 만들어 통과시키면 그게 정확히
"녹색인데 아무것도 안 쟀다"다.

→ 스위치는 **`LEARNING_HUB_NO_REAL_ENV`** 하나이고, `real_env_off()` 가 그것을 읽는다.
   그리고 **스위치 자신이 검사 대상이다**: 켜져 있는데 실 워크스페이스가 잡히면
   `환경_가정_…` 이 **실패한다**(로컬에서 켜 둔 채 잊는 것이 이 스위치의 유일한 오용이고,
   그러면 실물 6종이 통째로 안 도는데 게이트는 녹색이 된다).
   ⚠ 건너뛴 사실은 `--show-output` 으로 **로그에 남는다** — F6 이 측정했듯 cargo 는 통과
   테스트의 stderr 를 캡처하므로, 그 플래그 없이는 `skip!` 이 실제로는 조용하다.
   그래서 `tauri:test` 스크립트가 그 플래그를 소유한다(손으로 붙이지 말 것).
*/
use std::path::PathBuf;

/// 실물(진짜 워크스페이스·볼트·산출물·파이썬)이 **원리적으로 없는** 환경인가.
///
/// ⚠ "지금 없다"가 아니라 "있을 수 없다"에만 쓴다. 로컬에서 켜면 `환경_가정_…` 이 잡는다.
pub fn real_env_off() -> bool {
    std::env::var_os("LEARNING_HUB_NO_REAL_ENV").is_some()
}

/// 실물 대상 검사의 **단일 진입점**. 실물 없는 환경이면 눈에 보이게 건너뛰고,
/// 있어야 하는 환경에서 못 찾으면 시끄럽게 실패한다.
///
/// 각 테스트가 `real_workspace().expect(...)` 를 직접 부르면 스위치를 붙이는 자리가 6곳이 되고,
/// 하나를 빠뜨리면 그 하나만 CI 에서 빨간불로 남는다 — 그게 이 매크로가 존재하는 이유다.
macro_rules! ws_or_skip {
    () => {{
        if $crate::testkit::real_env_off() {
            $crate::testkit::skip!(
                "실물 없는 환경(LEARNING_HUB_NO_REAL_ENV) — 워크스페이스 검사 생략"
            );
        }
        $crate::testkit::real_workspace().expect("환경 가정 위반 — testkit 참조")
    }};
}
pub(crate) use ws_or_skip;

/// `ws_or_skip!` 의 볼트판.
macro_rules! vault_or_skip {
    () => {{
        if $crate::testkit::real_env_off() {
            $crate::testkit::skip!("실물 없는 환경(LEARNING_HUB_NO_REAL_ENV) — 볼트 검사 생략");
        }
        $crate::testkit::real_vault().expect("환경 가정 위반 — testkit 참조")
    }};
}
pub(crate) use vault_or_skip;

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

    아래 모듈들(artifact·tools·vault·server)의 실물 검사는 워크스페이스가 잡힌다는
    가정 위에 서 있다. 가정이 깨졌을 때 각자 조용히 건너뛰면 **게이트는 녹색인데 실물은 하나도
    안 재는** 상태가 된다 — 트랙 B 를 여기로 내린 이유와 정확히 같은 실패 모양이다.
    그래서 가정을 **한 곳에서 시끄럽게** 잠근다. 여기가 빨간불이면 다른 실패는 볼 것도 없다. */
    #[test]
    fn 환경_가정_실_워크스페이스가_잡힌다() {
        /* ⚠ **스위치 자신을 검사한다.** 실물이 있는 기계에서 이걸 켜 둔 채 잊으면 실물 6종이
        통째로 안 도는데 게이트는 녹색이 된다 — 그게 이 스위치의 유일한 오용이고, 여기서 잡힌다. */
        if real_env_off() {
            assert!(
                real_workspace().is_none(),
                "LEARNING_HUB_NO_REAL_ENV 가 켜졌는데 실 워크스페이스가 잡힙니다 — \
                 스위치를 끄고 다시 돌리세요. 켜 둔 채로는 실물 대상 통합 검사가 하나도 안 돕니다.",
            );
            eprintln!(
                "⚠ 실물 대상 통합 검사를 건너뜁니다 — LEARNING_HUB_NO_REAL_ENV \
                 (CI 는 hub 를 독립 repo 로 체크아웃하므로 형제 폴더가 원리적으로 없다)"
            );
            return;
        }
        /* ⚠⚠ **이 메시지엔 처방이 없었다**(V087 · 2026-08-31). hub 단독 클론(= CI 가 하는 것 —
        이건 사설 서브모듈이다)에서 `npm run gate` 가 여기서 죽는데, 탈출구
        `LEARNING_HUB_NO_REAL_ENV` 는 저장소 전체에서 이 파일과 `ci.yml` **두 곳에만** 있었고
        `README`·`CLAUDE.md`·`web/docs` 전수 grep 이 **0건**이었다. 게이트는 첫 실패에서
        멈추므로 뒤 단계가 통째로 안 돈다 — 즉 처방 없는 한 줄이 게이트 전체를 세웠다.
        `tools.rs` 의 spawn 실패 메시지가 «원인 + 처방 + 변수 이름»을 전부 주는 것과 정확히
        대비됐다. 짝인 「미리」 쪽은 `README.md §새 클론에서 첫 실행` 이 진다. */
        let ws = real_workspace().expect(
            "워크스페이스를 못 찾았습니다 — `knowledge/` 와 `pipeline/` 을 가진 폴더가 \
             이 저장소의 부모여야 합니다. 실물 대상 통합 테스트가 전부 이 가정 위에 있습니다.\n\
             \n\
             ▸ 부모 워크스페이스를 가진 기계라면: 이 저장소를 그 폴더 **안에** 두고 다시 돌리세요.\n\
             ▸ hub 만 단독으로 클론했다면(CI 가 그렇습니다): 환경변수 \
             `LEARNING_HUB_NO_REAL_ENV=1` 을 켜세요 — 실물 대상 통합 검사를 건너뜁니다.\n\
             ⚠ 그건 검사를 «끄는» 것이 아니라 **「이 기계엔 실물이 없다」고 선언**하는 것입니다. \
             실물이 있는 기계에서 켜 두면 바로 위 단언이 시끄럽게 잡습니다.",
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
