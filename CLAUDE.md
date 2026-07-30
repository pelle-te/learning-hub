# 러닝 허브 — 작업 메모리 (웹앱 규약 · 항상 우선)

> **폴더 기준점** — git 루트는 `atelier/`(형제: `knowledge/`·`pipeline/`·`exports/`·`sources/`·**`hub/`**). 이 문서·경로는 **`hub/` 기준**이다(폴더는 hub, 앱 브랜드명은 여전히 "러닝허브"). 웹앱 소스는 전부 `web/`.
> **이 문서는 웹앱(러닝허브) 전용**이다. 볼트 노트 파이프라인 규약은 `../knowledge/CLAUDE.md`가 단일 진리 — 혼동 금지.

러닝 허브는 **볼트(knowledge/)·Anki·일과 데이터를 한눈에 보는 로컬 학습 대시보드**다. 구성:

- **`web/`** — React 19 + Vite 6 + TS SPA(프런트). `npm run dev`(:5173). **엔트리가 둘이다**(C-6): `index.html`=데스크톱 셸 · `phone.html`=**폰 웹앱**(`src/phone/`). 폰은 Workers 오리진에서 서빙되고 `lib/` 만 공유하며 화면은 따로다 — 이유는 클라우드전환-설계 §13-0(설계서의 "하위 컴포넌트 선별 재사용"이 실제로는 성립하지 않았다).
- ~~**`serve.js`** — Node stdlib HTTP 백엔드(:8000)~~ → **4단계에서 삭제됐다.** 라우트 12종(파이썬 도구·산출물·리서치 잡·Ollama·뉴스)이 전부 셸의 Rust 커맨드가 됐다.
  - ✅ **"앱이 여는 포트가 0"이 복원됐다**(2026-07-20). 5단계-A 의 LAN 모바일 뷰 서버(`server.rs` 845줄)가 **은퇴**했다 — 클라우드가 같은 요구를 더 잘 채우고, 남겨 두면 C-6 폰 번들이 백엔드 둘·인증 두 벌을 상대해야 했다(LAN 쪽은 **만료 없는 PSK 를 URL 에 싣는** 방식이라 P0-2 가 금지한 형태다). 근거는 클라우드전환-설계 §9-1.
- **`server/`** — **Cloudflare Workers + D1 클라우드 백엔드**(C-4~). 앱 데이터의 정본을 쥔다(불변식 I7). `web/src/lib/cloud/` 와 **zod 스키마·테이블 계약을 문자 그대로 공유**한다(서버도 TS 인 것이 Cloudflare 를 고른 실익). 게이트는 `cd server && npm run verify`.
- **`src-tauri/`** — Tauri 2 데스크톱 셸. **유일한 배포 진입점**(2단계-E). `web/dist` 를 WebView2 로 띄우고 **백엔드 전부**(파이썬 도구·산출물·AI·잡·볼트)를 직접 소유하며, **앱 데이터의 정본인 SQLite**(`learning-hub.db`)도 여기 있다. `npm run tauri:dev|build`.
- ⚠ **브라우저 `npm run dev` 에는 백엔드가 없다**(4단계에서 `/api` 프록시 제거). 산출물·도구·AI·볼트를 만지려면 `npm run tauri:dev` — 같은 Vite dev 서버를 셸 안에서 로드하므로 HMR 은 그대로다.

> **실행 경로 = 셸 하나, 저장 백엔드 = 둘.** 이 둘을 헷갈리지 말 것.
>
> - **배포**는 Tauri 셸뿐이다. 옛 브라우저 실행 경로(serve.js + Chrome `--app`)는 2단계-E에서 **은퇴**했다 — 정본이 SQLite로 갔는데 브라우저엔 SQLite가 없어, 그 경로로 띄우면 *갈라진 상태*가 된다.
> - ⚠ **저장 백엔드가 셋이다**(C-6): 셸=SQLite(plugin-sql) · **폰=SQLite(wasm+OPFS, 워커)** · dev/트랙 A=localStorage. 폰 것은 **`enableBrowserDb()` 로 명시 opt-in** 이고 폰 진입점만 부른다 — 무조건 켜면 dev 와 스냅샷 59장이 통째로 백엔드를 갈아탄다. 그래서 저장 경로의 조건은 `isTauri()` 가 아니라 **`isSqlitePrimary()`** 다(폰은 Tauri 가 아닌데 SQLite 가 정본 — 이걸 틀리면 폰 편집이 아웃박스에 안 걸려 **영원히 동기화되지 않는다**).
> - **`npm run dev` 와 트랙 A(스냅샷 59장)는 브라우저**라 계속 localStorage 백엔드로 돈다. 이 폴백을 없애면 개발과 시각 검증망이 함께 죽으므로 **의도적으로 남긴 것**이다(`lib/tauri.ts` 의 `isTauri()` 분기 · `lib/db/boot.ts`). 단 4단계 이후 **백엔드 기능(산출물·도구·AI)은 브라우저에서 동작하지 않는다** — 트랙 A 는 그중 산출물 5종만 invoke 스텁으로 목업한다.
> - ⚠ **오리진이 갈려 데이터는 자동 이관되지 않는다.** Chrome에서 쓰던 데이터가 있으면 반드시 기존 앱에서 내보내기 → 셸에서 가져오기. 셸 자신의 localStorage(1단계에 쓰던 것)는 **첫 부팅에 SQLite로 1회 자동 이관**된다(`initAppStore`).

## 절대 규칙 (반복 실수 방지 — 매번 물림)

1. **Tauri 셸이 prebuilt `web/dist/`를 로드한다 → 소스 수정 후 반드시 `cd web && npm run build`.** UI/색이 "안 바뀐다"의 1순위 원인. (PWA SW는 **C-6에서 폰(Workers 오리진)에만** 등록된다 — 데스크톱 셸은 `tauri://` 로컬 파일, 트랙 A는 `serviceWorkers:'block'`이라 정의상 폰에만 붙는다(`vite.config.ts`의 `selfDestroying:false` 주석). 옛 "은퇴" 문구는 앱이 `localhost:8000`+serve.js로 뜨던 시절 것으로, 그 오리진이 죽으며 뒤집혔다. dev 서버 `npm run dev`는 HMR이라 빌드 불필요.) `npm run tauri:build` 는 `web` 빌드를 **자동으로 먼저 돌린다**(`beforeBuildCommand`)지만, **트랙 B(`npm run e2e:shell`)는 exe 를 검사하므로 앞서 `tauri:build` 가 필요**하다 — 안 하면 옛 exe 를 검사한다.
2. **레이어 경계는 단방향**(`app → features → components → {hooks, store} → lib`, 역방향 import 금지). `eslint-plugin-boundaries`가 **error**로 막는다. 새 코드가 상위를 import하면 린트가 깨진다 → 세부는 `web/docs/아키텍처.md`.
3. **과목 색 = 파생물**(저장값 아님 — 노브 교체로 전탭 반영). 임의 하드코딩 금지.
   - 파생은 **OKLCH 생성**(`lib/utils.ts` `colorForId`)이다(2026-07-24 에 옛 8색 `PALETTE` 배열 대체). `item.id` 해시 → 색상환 각도(hue), 명도·채도는 `SUBJECT_L`·`SUBJECT_C` 고정 → hex. **8색 한계가 사라졌다**(과목 무제한 구분). 파생 키가 id 인 이유는 그대로: 인덱스는 *위치*라 삭제·재정렬 때 뒤 과목 색이 밀렸고, id는 *정체성*이라 불변이고 파생이 1곳이다.
   - 원칙이 규칙이고 메커니즘은 그 구현이다: 색을 **저장값처럼 다루지 말 것**(입력으로 받거나 하드코딩 금지). 파생 키를 또 바꾸더라도 이 원칙은 유지된다.
4. **명시 지시 임의변경 금지.** 사용자가 못박은 결정(예 "블록도 색 있어야")을 내 판단으로 뒤집지 않는다. 대담한 재설계는 **새 영역에만**, 기존 제약은 유지.
5. **커밋 전 `git -c core.quotepath=false diff --cached --stat` 확인.** 이 저장소는 web/시스템/전공 세션이 **동시 작업**한다 — 스테이징에 `전공/`·`시스템/` 파일이 섞이면 그 커밋에서 빼고 **앱 저장소 범위(`web/` + `src-tauri/` + `docs/` + 루트 설정)** 만 담는다(인덱스 위생 재발 이력 다수). git user=`jin`, 기본 브랜치=`master`.
   - ⚠ 범위를 "web 변경만"에서 넓힌 이유(2026-07-19): 플랫폼 개편 1단계에서 `src-tauri/`(Rust·`Cargo.lock`)가 생기는데 이건 `web/` 밖이다. 옛 문구를 문자 그대로 지키면 **규칙이 자기 마이그레이션의 첫 커밋을 막는다.** 막으려던 것은 *다른 세션의 산출물 혼입*이지 앱 자체의 새 폴더가 아니다.
6. **게이트 없이 완료 보고 금지.** 아래 게이트가 녹색이어야 "됐다".

## 게이트 (원커맨드 · `cd web` 후)

```
npm run verify   # codegen:check + typecheck + lint + lint:css + **check:tokens** + format:check + knip + test:coverage
                 #   ⚠ `check:tokens` 가 이 목록에서 빠져 있었다(2026-07-30 감사). H20 이 만든,
                 #   **TS 문자열 속 미정의 `var(--x)`** 의 유일한 검출기다(stylelint 는 CSS 만 본다).
                 #   목록을 손으로 베끼면 이렇게 드리프트한다 — 정본은 `package.json` 이다.
npm run audit    # SCA — 알려진 CVE 게이트(2026-07-25). ⚠ **verify 에 없다**: 레지스트리 네트워크를
                 #   타므로 오프라인에서 verify 가 통째로 죽는다. 자리는 여기와 CI.
                 #   예외는 `audit-allowlist.json` 의 **사유+만료일 원장**이고, 만료·사문화도 실패다
                 #   (근거는 scripts/audit-gate.mjs 머리주석).
npm run e2e      # 트랙 A — Playwright 시각/동작 스냅샷 (백엔드 없이 · 산출물은 invoke 스텁으로 목업)
                 #   ⚠ C-6 에서 `phone.spec.ts` 가 붙었다 — 폰이 진짜 크로미움에서 뜨는지 +
                 #   OPFS 저장소가 실제로 생기는지(wasm·워커가 살았다는 관측 가능한 증거).
                 #   스냅샷은 안 찍는다. 정적 검사가 원리적으로 못 보는 층이라 여기 있다.
                 #   ⚠ 2026-07-25 에 `a11y.spec.ts`(axe)가 붙었다 — 아래 절 참조.
npm run e2e:a11y # a11y — axe-core 로 렌더된 DOM 을 검사(`serious`+`critical` 만 실패).
                 #   린트(jsx-a11y)는 **소스**를 보고 axe 는 **결과물**을 본다 — 대체재가 아니다.
npm run e2e:motion # 모션 — **중간 프레임** 시각 회귀(`e2e/motion.spec.ts` · 2026-07-29 신설).
                 #   ⚠ `e2e` 안에 포함돼 있다(별도로 돌릴 때만 이 스크립트). 여기 적는 이유는
                 #   **정지 프레임 게이트가 모션 층을 원리적으로 못 보기** 때문 — `visual.spec.ts` 는
                 #   reducedMotion 을 명시하므로 duration·키프레임·이징을 어떻게 바꿔도 122장이
                 #   전부 통과한다(E24 에서 실증: 어휘 32종→20종 · 길이 15종→토큰 8종에 **정지
                 #   스냅샷은 한 장도 안 움직였다**). 애니를 0ms 에 얼리고 `currentTime` 을 직접
                 #   세워 찍는다.
                 #   ⚠ **감도에 바닥이 있다** — 그 파일 머리주석의 실측 표가 SSOT("무엇을 보고
                 #   무엇을 못 보는가"). 요지: 길이는 잡고 **무한 주기는 픽셀로 못 잡는다**(주기는
                 #   토큰 + 불변식 ⑥이 지킨다). 어휘를 관측하려면 그 어휘가 프레임 면적을
                 #   지배해야 한다(그래서 맥동은 자기 클립을 쓴다).
npm run budget   # 번들 예산 — **4축**(2026-07-30 에 둘이 붙었다 · 정본은 그 파일 머리주석):
                 #   ① 엔트리별 초기 로드 ② **데스크톱 부팅 웨이브**(엔트리+App) ③ 전체 총합
                 #   ④ **번들 오염**(배포 바이너리가 dist 에 섞였는가).
                 #   ⚠ ②가 생긴 이유가 요지다 — `main.tsx` 가 `App` 을 동적으로 부르는 건
                 #   최적화가 아니라 부팅 순서 계약(SD-7)이라 ①의 정적 그래프 순회에서 빠지는데,
                 #   App 은 **항상 즉시** 로드된다. 그 사각에서 14.7 KB gz 이 새고 있었다(H14).
                 #   ⚠ 총합 축은 폴더를 직접 훑는다(매니페스트엔 워커·wasm 이 없다).
                 #   ⚠ ④ 때문에 **릴리스 바이너리는 `web/release-assets/`**(빌드 입력 아님)에 두고
                 #   배포 직전에만 `npm run release:stage` 로 `dist/updates/` 에 넣는다 — `public/`
                 #   에 두면 tauri `frontendDist` 를 타고 **데스크톱 번들 안에** 실린다(실측 7.16MB ·
                 #   매 릴리스마다 배로). 절차 SSOT 는 `web/docs/릴리스.md` §2-4.
npm run build    # tsc -b && vite build — Tauri 셸이 로드할 dist 재생성
npm run e2e:shell # 트랙 B — 빌드된 exe 를 띄워 WebView2 안을 검사(사전 `npm run tauri:build:fast` 필요)
```

- ⚠ **`verify` 녹색 ≠ 완료.** SCA·a11y·시각회귀는 `verify` 밖이다. 완료 판정은 `npm run gate`(full) 로 한다.

```
cargo test --manifest-path src-tauri/Cargo.toml   # 루트에서 — Rust 유닛 + 실물 통합(73개 · ~4초)
```

```
cd server && npm run verify   # 클라우드 백엔드 — typecheck + format + 계약(SQL) + 왕복(실 workerd·D1)
```

- ⚠ **`server/` 게이트를 빼먹지 말 것.** 인터넷에 노출되고 **인증·입력검증을 다루는** 유일한 층인데, 2026-07-20 감사 전까지 **CI 도 로컬 게이트도 안 돌고 있었다.** `test:roundtrip` 이 핵심이다 — 진짜 workerd + 진짜 D1 로 온보딩→토큰→push→pull→폐기를 왕복한다(12케이스 1.7초). 이 저장소는 "정적 검사 전량 녹색인데 실물에서 죽는" 부류에 **네 번** 물렸고(2단계 저장 · C-4 삭제부활 · C-5 CSP · pull 페이지네이션), 그 층이 없어서 매번 사용자 앞에서 드러났다.

- **검사를 어느 층에 두는가 (2026-07-20 재배치 · 이 규약이 반복 실수를 막는다)**
  - 트랙 B 가 16개까지 불어나 있었는데 **대부분은 GUI 가 필요해서가 아니라 _실물_(진짜 워크스페이스·볼트·DB)을 상대해야 해서** 거기 있었다. 그 요구가 정당화하는 것은 **통합 테스트**지 *앱 창을 띄우는 것*이 아니다 — GUI 를 테스트 하네스로 쓰고 있었고, 대가로 회당 앱 기동이 **19번**이었다(앞에 릴리스 빌드+NSIS 까지).
  - 지금 기준: **실물이 필요하면 `cargo test`, WebView2 안에서만 존재하면 트랙 B.** 산출물 경로·파이썬 도구·볼트 읽기/감시·Anki 스캔·탐구 잡·실 DB 스탬프는 전부 `src-tauri/src/*.rs` 의 `#[cfg(test)]` 로 내려가 **초 단위**로 돈다. 공용 헬퍼와 근거는 **`src-tauri/src/testkit.rs` 머리주석**이 SSOT.
  - ⚠ **커맨드는 `AppHandle` 을 로직에 섞지 말 것**(규율 11-2). 경로·값만 받는 순수/준순수 함수로 갈라 두면 그 자리가 곧 통합 테스트 진입점이 된다(`vault::scan_at` · `anki_scan::scan_at` · `artifact::read_at` · `research::restored_from` · `vault::watch_with` 가 그 형태).
  - ⚠ **조용한 skip 금지.** 리소스가 없다고 그냥 통과시키면 "녹색인데 아무것도 안 쟀다"가 된다 — 환경 가정은 `testkit` 의 `환경_가정_…` 하나가 시끄럽게 단언한다.

- **트랙 A/B 를 나눈 이유**: A 는 Chromium 으로 `vite preview` 를 찍으므로 **WebView2 에서만 깨지는 것을 원리적으로 못 잡는다**("무효화되는 도구로 무효화되지 않았음을 증명"하는 순환). B 는 진짜 exe 를 띄워 **창·라우팅·IPC 왕복(Channel 포함)·종료 시 flush·커맨드 등록**만 본다(**스냅샷은 안 찍는다** — 베이스라인 두 벌 방지). 구현은 `tauri-driver` 가 아니라 **CDP + 기존 Playwright**다(WebView2 가 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 를 존중 · 디버그 포트는 하네스만 켬 → 배포본 노출 0).
  - 케이스는 **공유 셸 하나**를 쓴다(`shellApp.ts` 의 `sharedShell`). 창 닫기를 검사하는 케이스만 자기 셸을 쓰고, 그때는 **반드시 `closeSharedShell()` 을 먼저** 부른다 — `launchShell()` 이 `ensureNoStrayShell()` 로 learning-hub 를 전부 죽이기 때문에 안 그러면 서로를 죽인다.
  - ⚠ **트랙 B 는 사용자의 실물 DB 를 쓴다 — 쓰기를 넣지 말 것.** 옛 케이스가 `INSERT OR REPLACE INTO docs (key, value)`(2열)로 써서 **실제 독후감의 `updated_at` 을 0 으로 깎았고, 그 행이 클라우드 동기화에서 영원히 빠졌다**(앱은 "최신 상태"라고 말한다). 검증이 검증 대상을 망가뜨린 사고다 — 상세는 결정로그.

- **작업 중 확인은 앱을 껐다 켜지 말 것.** `npm run tauri:dev` 를 **한 번 띄워 세션 내내 유지**한다 — 진짜 WebView2·IPC·SQLite 인데 프런트는 HMR 이라 재빌드·재기동이 0 이다(Rust 를 고칠 때만 알아서 다시 선다). ⚠ 단 dev 는 `devCsp`(느슨)에 오리진이 `localhost:5173` 이라 **CSP·오리진이 걸린 결함은 dev 에서 안 나타난다**(C-5 가 정확히 그 부류였다) → "됐다"고 말하기 전엔 릴리스 exe 로 트랙 B 1회.
- **`tauri:build:fast`(= `tauri build --no-bundle`)를 개발 루프에 쓴다.** 트랙 B 는 `target/release/learning-hub.exe` 만 검사하는데(`shellApp.ts`) `tauri:build` 는 그 뒤에 **NSIS 인스톨러까지** 만든다 — 매번 만들고 매번 안 쓴다. 배포본을 낼 때만 `tauri:build`.
- **Tauri 셸(`src-tauri/`, 플랫폼 개편 1단계~)**: 루트에서 `npm run tauri:check|fmt|clippy|test|dev|build`. `/게이트`가 **cargo가 있으면** `tauri:check` → `tauri:build` → `e2e:shell`(트랙 B)까지 돈다(없으면 전부 건너뜀 — web만 만지는 작업에 Rust 툴체인을 요구하지 않는다). **`tauri:check` 만으로는 부족하다** — 1단계에서 `cargo check` 녹색인데 번들이 죽은 실사고가 있었고, 그건 `tauri build` 에서만 나타난다. `e2e:shell` 이 마지막인 건 **빌드된 exe 를 검사 대상으로 삼기** 때문(순서가 뒤집히면 옛 exe를 검사해 통과가 거짓이 된다). ⚠ cargo가 "없다"고 나오면 대개 **셸이 rustup 설치보다 오래된 것** — 새 터미널을 열면 잡힌다.
- ⚠ **성공하지 않은 화면은 `components/State` 하나가 그린다**(E17 · 2026-07-30) — ⚠ **단 범위는 feature 본문이다**(2026-07-30 감사 정정). 부팅 폴백(`ShellFallback`·`DowngradeScreen`·`bootFallbackScreen`)·경계 폴백(`TabFallback`)·헤더 배너·폰 3종은 **의도적으로 밖**이다: 부팅 폴백은 **번들 밖**이어야 하고(청크를 못 받는 상황이 그 존재 이유다) 배너는 형상이 다르다. `kind='loading'|'error'|'empty'` 이고 판정은 `lib/artifactState.ts` 의 `classifyArtifact`(4단계 · 이미 SSOT)가 한다 — **판정=lib · 그리기=components**. `EmptyState`·`ArtifactError` 는 삭제됐다.
  - `next` 는 **필수**이고 타입이 `undefined` 를 **막는다**(`ReactNode` 를 쓰면 `next={undefined}` 가 통과해 필수화가 무력해진다 — 실제로 그 구멍으로 하나가 새고 있었다). 행동이 없으면 `{ terminal: '왜 없는지' }`.
  - 콜드 게이트 문구는 `WORKSPACE_UNSET`·`workspaceHint(gains)`·`needsWorkspace(what)` — **공통부만** 공유하고 "이 화면이 얻는 것"은 호출부가 준다.
- ⚠ **`commit`(내 행동이 반영됨)은 값 쪽이 소유한다** — `hooks/useCommitOnChange(value)`(E15). 뮤테이션에 DOM 을 알리면 `store` 가 배치를 알게 되어 레이어 규율이 깨지고, 입구가 여럿인 값(⌘K·키보드·폰·**클라우드 pull**)마다 붙여야 한다. 값 쪽에 붙이면 한 번에 전부 덮인다.
- **`npm run report:debt`** — 인지복잡도·파일 크기·features:lib 비율을 **강제 없이** 출력(추세 관찰용). 하드 게이트는 래칫 2개(`cognitive-complexity` · `max-lines`)뿐이고 — **값은 여기 적지 않는다**(`eslint.config.js` 가 정본 · 여기 730 이라 적혀 있던 동안 실제로는 745 였다. `report-debt.mjs` 가 같은 손베낌으로 물려 임계를 게이트에서 읽게 고친 이력이 있는데, 이 문서가 그 다음 사본이었다)  "더 나빠지지 않는다"만 보장한다.

- **e2e 스냅샷 함정:** `--update-snapshots`을 **값 없이** 주면 기본이 `changed` — **실패한 것만** 다시 쓴다. 임계(현재 0.5%) 아래로 드리프트한 낡은 베이스라인은 재생성도 경고도 없이 **통과**한다(§15-7 이 이걸로 몇 달을 잃었다). → `npm run e2e:update` 는 이제 **`--update-snapshots=all --workers=1`** 로 못박혀 있다(값 없는 형태를 쓰지 말 것 · 단일 워커는 웹폰트 스와프 상태를 베이스라인에 굽지 않기 위한 것). 전량이 아니라 일부만 다시 쓰려면 `-g` 로 **제목을 좁히고 `=all` 은 유지**한다. flaky 근절 위해 GPU는 `--disable-gpu`로 핀 고정돼 있다(건드리지 말 것).
  - ⚠ **재생성 대상은 "실패한 것"이 아니라 "그 UI 가 보이는 스냅샷 전부"다.** 네온 채움 복원(2026-07-24)에서 실패는 10장이었지만 실제로 바뀐 화면은 **24장**이었다 — 14장이 임계 아래로 조용히 통과 중이었다.
- 슬래시 명령 `/게이트`가 verify+build+budget(번들 예산)+e2e(+cargo 있으면 tauri:check·tauri:build·e2e:shell)를 돌려 압축 리포트만 반환한다(quick=verify만).
- **Tailwind 규약의 집행자는 `eslint-plugin-better-tailwindcss`다**(C-6~ · 현재 `src/phone/**` 만 대상). 클래스가 CSS→JSX 로 옮겨가면 stylelint 검사 범위 밖으로 나가므로 **집행자만 교체**한 것이다. 임의값(`w-[137px]`)은 `no-restricted-classes` 패턴으로 막는다 — ⚠ 설계서가 말한 "임의값 룰"은 **그 플러그인에 없다**(v4.7.0 실측). C-7 이 feature 를 옮길 때마다 `files` 목록을 넓히고, **예외 둘**(반픽셀 font-size · 런타임 CSS 변수 주입)을 그때 판다(근거는 클라우드전환-설계 §14-3).
- ⚠ **C-7 이식 규약 6종의 SSOT 는 클라우드전환-설계 §15 다** — 전부 실사고에서 나왔다(추측 항목 0). 특히 **§15-4: feature 당 최소 1회 실렌더 확인**. 이식 2건에서 사고가 2건 났고 **둘 다 정적 검사 전량 녹색**이었다(존재하지 않는 토큰이 회색으로 렌더 · 카드가 1글자 폭으로 붕괴). `--update-snapshots` 는 **깨진 결과를 정답으로 굳힌다** → 순서는 "이식 → 눈으로 확인 → 스냅샷 재생성"이고, **커버리지 0인 화면은 이식 *전에* 스냅샷부터 만든다**.
- ⚠ **게이트는 병렬 작업(다른 세션·서브에이전트)이 멈춘 뒤에 돌린다.** 동시에 파일이 쓰이면 게이트가 시점에 의존해 **flaky 를 결함으로, 결함을 flaky 로** 읽는다(실측: `verify` 4건 실패 → 재실행 전량 통과, 원인은 코드가 아니었다).
- **`lint:css`(stylelint)가 CSS 규약을 강제한다** — 생 hex 금지(색은 tokens.css 토큰만) · 브레이크포인트 3종(560/700/900)만. 설정 근거는 `stylelint.config.js` 주석. 규약을 '관습'에 두면 흘러내린다는 게 감사 결론이었다.

## 2026-07-25 감사 — **배포 후를 보는 층**이 생겼다 (요지만 · 근거는 각 파일 머리주석)

> 이 저장소의 가장 큰 비대칭은 코드 품질이 아니라 **시제**였다. 배포 **전** 검증은 여섯 겹인데(정적·유닛·컴포넌트·트랙A·트랙B·실 workerd 왕복) 배포 **후** 관측은 0 이었다. 래칫은 *아는 회귀*를 막고, 아래 넷은 *모르는 것*을 잡는다.

| 무엇                    | 어디                                                   | 도입 즉시 잡은 것                                                              |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **SCA 게이트**          | `web/scripts/audit-gate.mjs` + 패키지별 `audit-allowlist.json` | web 14건·server 4건(전부 high)이 무게이트였다. server 는 즉시 0 으로 해소       |
| **a11y(axe)**           | `web/e2e/a11y.spec.ts`                                 | ⚠ **다크(기본) 테마에서 검색 입력 글자가 안 보였다**(대비 1.09:1) 외 3종        |
| **텔레메트리**          | `web/src/lib/telemetry.ts` + `server` `/api/log`       | `ErrorBoundary` 셋이 폴백만 그리고 아무것도 기록하지 않던 것 · 전역 훅 부재     |
| **업데이터**            | `src-tauri/src/updater.rs` + 설정 UI                   | 결함을 알게 돼도 **전달 경로가 수동 재설치뿐**이던 것(관측의 짝)                |

- ⚠ **원장 두 개는 "무시"가 아니라 "기한부 판단"이다.** `audit-allowlist.json` 과 `a11y.spec.ts` 의 `알려진위반` 은 둘 다 **재검토 만료일**을 갖고, 지나면 게이트가 깨진다. 판단에 유효기간이 없으면 그건 판단이 아니라 방치다.
- ⚠ **TS 7 · ESLint 10 은 생태계 차단이다**(2026-07-25 실측 · 우리 코드 문제 아님). TS 7.0.2 는 typecheck·build 를 통과하지만 `typescript-eslint` 전 버전이 TS7 을 지원하지 않고(peer `<6.1.0`) 실제로 하드 크래시한다 → **레이어 경계 린트(절대규칙 #2)가 죽는다.** ESLint 10 은 `eslint-plugin-jsx-a11y`(peer `^9`) 하나가 막는다. 둘 다 롤백했고 재시도 조건은 SCA 원장에 적혀 있다 — **다시 조사하지 말 것.**
- ⚠ **업데이터 개인키**(`src-tauri/.updater-key`)는 gitignore 이고 **재생성 불가**다. 유출되면 업데이트 사칭, 잃으면 영구히 배포 불가. 절차는 `web/docs/릴리스.md` 가 SSOT.

## 트리거 라우팅 (요청 유형 → 읽을 프로토콜)

| 사용자 요청                        | 읽고 따를 것                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| "새 탭 추가 / (탭) 만들어줘"       | `web/docs/protocols/새탭추가.md` (또는 `/새탭 <key>`)                                                                  |
| "(기능) 추가 / 로직 붙여줘"        | `web/docs/protocols/기능추가.md`                                                                                       |
| "(탭) 재설계 / 다시 디자인"        | `web/docs/protocols/탭재설계.md` — **today 재설계 사상**(단일목적 한화면·상단 리드아웃·fill 프레임·온디맨드 세부) 준수 |
| "(feature) 리뷰 / 검토"            | `/감사 빠른 <대상>` — `web-reviewer` 4관점 팬아웃(옛 `/리뷰`가 이 모드로 흡수됐다)                                     |
| "(탭/모듈) 평가 / 점수 / 벤치마크" | `/감사 <대상> 점수` + `web/docs/평가루브릭.md` (독립 채점·다각도·추세 → `평가기록.md`. 옛 `/평가` 흡수)                |
| "전수 감사 / 왜 이렇게 설계했나 재검토" | `/감사` (17렌즈) · 전제까지 뒤집으려면 `/감사 근본`                                                                |
| "(대상) 개선 / 향상"               | `web/docs/개선루브릭.md` + `/개선 <대상>` (향상 발굴·랭크 → `로드맵.md`)                                               |
| "새 기능/탭 아이디어 / 확장"       | `/개선 [주제] 발산` (발산→심사→shortlist → `로드맵.md`. 옛 `/아이디어` 흡수)                                          |
| "다음 뭐 / 백로그 / 로드맵"        | `web/docs/로드맵.md`                                                                                                   |
| 색·토큰·컴포넌트 규격              | `web/docs/디자인시스템.md`                                                                                             |
| "왜 X를 이렇게?" 결정 근거         | `web/docs/결정로그.md`                                                                                                 |

> **작업 3단계 수명주기:** **만들기**(protocols·`/새탭`·`/재설계`) → **검증**(`/게이트`=통과/실패 · `/감사`=결함·점수·검증사각) → **발전**(`/개선`=향상·발산 → 로드맵). 발전이 다음 만들기를 먹인다.
>
> ⚠ **명령은 5개다**(2026-07-25 통합 — 옛 `/리뷰`·`/평가`→`/감사` 모드, `/아이디어`→`/개선 발산`).
> 경계는 한 줄로: **`/감사`=지금 어떤가 · `/개선`=다음에 뭘 · `/게이트`=통과인가 · `/새탭`·`/재설계`=만든다.**
> 서브에이전트 4종(`web-reviewer`·`web-evaluator`·`web-improver`·`web-ideator`)은 **그대로**다 — 팬아웃 일꾼이라 명령 통합과 무관하다.

개별 단발 요청이면 해당 프로토콜의 그 단계만 수행한다. 큰 작업(탭 신설·전면 재설계)은 **격리 서브에이전트로 단계 분리**해 정밀도를 새 챗 수준으로 유지한다(볼트 파이프라인과 같은 사상).

## 아키텍처 한눈 (깊이는 `web/docs/아키텍처.md`)

```
web/src/
  app/        셸 크롬(App·TopBar·RailSidebar·SubTabs·ThemeProvider·라우팅). 최상위.
  features/   탭 1개 = 폴더 1개. registry.tsx가 key→lazy 컴포넌트. tabs.ts가 탭 메타 원천.
  components/ 재사용 프리미티브(무상태에 가깝게). hooks·lib import 가능.
  hooks/      공유 React 훅(interactions·useFocusTrap·useWeekOffset). lib만 import. app/features/components가 소비.
  store/      zustand 스토어(useApp=앱 데이터·useUI=설정·useRuntime=plan-무관 캐시·useFocus·usePageChrome=상단
              리드아웃·prefill) + 비-스토어 데이터 접근(queries=TanStack·selectors=파생 캐시).
  lib/        순수 로직·IO(api·scheduler·anki·vault·schema…). 최하위, React 무관(훅은 hooks/).
  lib/db/     **앱 데이터 정본(SQLite · 2단계~)**. rows.ts=AppState↔행 **순수** 매퍼(Tauri 없이 전량
              테스트) · sqlite.ts=SQL만(로직 없음) · boot.ts=부팅 읽기+localStorage 1회 이관 · write.ts=정본 쓰기+되읽기 대조(옛 dual.ts).
              ⚠ **트랜잭션 금지** — sqlx 커넥션 풀이라 별도 execute로 부른 BEGIN이 다른 커넥션의 쓰기를
              막아 `database is locked`로 죽는다(실측). 증분 upsert가 대신 안전을 준다(DB가 비는 창이 없다).
              스키마 DDL의 단일 원천은 **`src-tauri/src/db.rs`**(프런트가 DDL을 들면 배포본마다 갈린다).
  shell/      탭 레지스트리(tabs.ts)·팔레트·단축키·토스트·액션.
  styles/     tokens(색·스케일 원천) + tokenBridge(Tailwind ↔ tokens) + ds.css(공유 `ds-*`) +
              tw.css(Tailwind 진입점·전역 키프레임) + global/(리셋·앱크롬). **`*.module.css` 는 0개**.
(백엔드 없음)  4단계에서 serve.js 를 삭제했다. 백엔드는 아래 src-tauri/ 의 커맨드가 전부다.
              프런트에서 그 커맨드를 부르는 곳은 **`web/src/lib/tauri.ts` 하나**(불변식 I2)이고,
              전송 분기(셸/브라우저)는 **모듈당 한 곳**이다(`api.ts`·`cloud/client.ts`·`anki.ts` —
              2026-07-26 감사에서 "api.ts 안에만"이 사실과 달라 정정).
src-tauri/    Tauri 2 셸(1단계~). workspace.rs=워크스페이스 경로 · **db.rs=SQLite 스키마(SSOT)** ·
              **hotkey.rs=전역 캡처 단축키(E20 · 등록 실패를 `capabilities.hotkeyError` 로 관측)** ·
              **vault.rs=볼트 읽기+notify 감시(3단계)** · **tools.rs=파이썬 도구 11종+RAII 동시성 캡 ·
              research.rs=탐구 잡(이벤트 진행·JSON 이력) · ollama.rs=AI 5종(Channel 스트리밍) ·
              artifact.rs=산출물 8종 · news.rs=뉴스 RSS · files.rs=내보내기 저장 · anki.rs=AnkiConnect 중계**(4단계). 프런트에서 invoke를 부르는 곳은 **`web/src/lib/tauri.ts` 하나**(불변식 I2).
              ⚠ **여는 포트가 없다**(4단계). 1단계의 '고아 sidecar 선점' 로직은 serve.js 와 함께
              사라졌다 — 포트를 물고 남을 프로세스 자체가 없어졌기 때문. `single-instance`는 유지.
```

- **탭 추가 = 2곳 한 줄씩**: `shell/tabs.ts` TABS 배열 + `features/registry.tsx` LOADERS. 그 외는 나브·팔레트·g단축키가 자동 순회.
- **Tailwind 전환(C-7) 완료 · `*.module.css` 0개.** 스타일은 ① JSX 유틸리티 ② 공유 `ds-*`(`styles/ds.css`) ③ 앱 리셋·크롬(`styles/global/`) 셋 중 하나다.
  - ⚠ **레이어가 계약이다**: `@layer base, components, theme, utilities` — `global/{base,components}.css`=base · `global/features.css`=components · **`ds.css` 와 `motion.css` 는 언레이어드**(유틸을 이긴다 → 덮으려면 `!`). 순서는 **최초 등장 순**이라 `main.tsx` 가 `global/index.css` → `tw.css` → `ds.css` 순으로 import 하는 것이 그 계약이다.
  - ⚠ **모션은 어휘 다섯 마디 + 시간 사다리로 닫혀 있다**(E24 · 2026-07-30). 어휘 SSOT = `lib/motion.ts` 머리주석(**enter · commit · live · transit · draw**) · 키프레임 SSOT = **`styles/tw.css`**(그 파일 밖에 `@keyframes` 를 만들지 말 것). 길이는 **토큰만** 쓴다(`--dur-fast|--dur|--dur-slow` · `--dur-cele` · `--draw` · `--tempo-*` · `--stagger`; transition 은 `duration-fast|base|slow|draw` 유틸). 새 움직임은 **축이 다르면 새 이름, 같은 축의 크기 차이면 노브**다. 집행자는 **불변식 ⑥**(`test/invariants.test.ts`)이고, 시간 리터럴·어휘 밖 키프레임 이름·`duration-<이름>` 브리지 누락을 전부 막는다.
    - ⚠ `duration-*` 의 Tailwind 네임스페이스는 **`--transition-duration-*`** 다(`--duration-*` 아님 · v4 실측). 틀리면 클래스가 **생성되지 않고** transition 이 기본 150ms 로 조용히 떨어지는데 **전 게이트가 녹색**이다 — 실제로 E24 에서 물렸다.
  - ⚠ **버튼 hover 장식엔 `enabled:`** 를 붙인다 — 전역은 `:not(:disabled)` 로 자기를 가드하지만 유틸은 그 가드를 상속하지 않는다(비활성 버튼이 hover 에서 밝아진 실사고).
  - 남은 CSS 와 그 존재 이유는 설계서 **§15-15 표**가 SSOT.
- 스택: zustand+immer · @tanstack/react-query · react-router 7 · zod · cmdk(⌘K) · vite-plugin-pwa.

## 참고 문서

- `web/docs/아키텍처.md` — 레이어·데이터레이어·경계 계약 SSOT
- `web/docs/디자인시스템.md` — 토큰·액센트·컴포넌트 규격
- `web/docs/protocols/` — 반복작업 절차서
- `web/docs/골든/` — 레퍼런스 feature(스타일 앵커)
- `web/docs/평가루브릭.md`·`평가기록.md` — 다각도 채점 SSOT + 추세
- `web/docs/개선루브릭.md`·`로드맵.md` — 개선 우선순위 채점 + 백로그 SSOT("다음 뭐")
- `web/docs/클라우드전환-설계.md` — **진행 중 · SSOT**: 여러 기기에서 보고 편집한다(앱 데이터만 클라우드, 로컬 자원은 PC). 6렌즈 전수 감사 기반. **C-0~C-7 완료**(C-7=Tailwind 본편 · §15 가 이식 규약·사고 기록의 SSOT). ⚠ §13 이 C-6 이행 결과이고 **§9-4·§4 를 정정한다** — 그 두 절을 문자 그대로 읽으면 오도된다. Tailwind 규약 3가지의 SSOT 는 `src/phone/phone.css` 머리주석
- `web/docs/cloudflare-런북.md` — **호스트 실행 절차서**(Cloudflare Workers + D1). 설계는 위 문서 §9-3b 가 SSOT, 여기는 "손으로 뭘 치는가"
- `README.md` — 배경·실행. 제품 목적은 이 문서(CLAUDE.md) 머리말이 SSOT.
