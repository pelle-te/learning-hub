# 러닝 허브 — 작업 메모리 (웹앱 규약 · 항상 우선)

> **폴더 기준점** — git 루트는 `atelier/`(형제: `knowledge/`·`pipeline/`·`exports/`·`sources/`·**`hub/`**). 이 문서·경로는 **`hub/` 기준**이다(폴더는 hub, 앱 브랜드명은 여전히 "러닝허브"). 웹앱 소스는 전부 `web/`.
> **이 문서는 웹앱(러닝허브) 전용**이다. 볼트 노트 파이프라인 규약은 `../knowledge/CLAUDE.md`가 단일 진리 — 혼동 금지.

러닝 허브는 **볼트(knowledge/)·Anki·일과 데이터를 한눈에 보는 로컬 학습 대시보드**다. 구성:

- **`web/`** — React 19 + Vite 6 + TS SPA(프런트). `npm run dev`(:5173).
- ~~**`serve.js`** — Node stdlib HTTP 백엔드(:8000)~~ → **4단계에서 삭제됐다.** 라우트 12종(파이썬 도구·산출물·리서치 잡·Ollama·뉴스)이 전부 셸의 Rust 커맨드가 됐고, **앱이 여는 포트는 이제 하나도 없다**(HTTP 공격면 소멸).
- **`src-tauri/`** — Tauri 2 데스크톱 셸. **유일한 배포 진입점**(2단계-E). `web/dist` 를 WebView2 로 띄우고 **백엔드 전부**(파이썬 도구·산출물·AI·잡·볼트)를 직접 소유하며, **앱 데이터의 정본인 SQLite**(`learning-hub.db`)도 여기 있다. `npm run tauri:dev|build`.
- ⚠ **브라우저 `npm run dev` 에는 백엔드가 없다**(4단계에서 `/api` 프록시 제거). 산출물·도구·AI·볼트를 만지려면 `npm run tauri:dev` — 같은 Vite dev 서버를 셸 안에서 로드하므로 HMR 은 그대로다.

> **실행 경로 = 셸 하나, 저장 백엔드 = 둘.** 이 둘을 헷갈리지 말 것.
>
> - **배포**는 Tauri 셸뿐이다. `러닝허브_실행.bat`(옛 serve.js + Chrome `--app`)은 2단계-E에서 **은퇴**했다(안내 스텁만 남김) — 정본이 SQLite로 갔는데 브라우저엔 SQLite가 없어, 그 경로로 띄우면 *갈라진 상태*가 된다.
> - **`npm run dev` 와 트랙 A(스냅샷 59장)는 브라우저**라 계속 localStorage 백엔드로 돈다. 이 폴백을 없애면 개발과 시각 검증망이 함께 죽으므로 **의도적으로 남긴 것**이다(`lib/tauri.ts` 의 `isTauri()` 분기 · `lib/db/boot.ts`). 단 4단계 이후 **백엔드 기능(산출물·도구·AI)은 브라우저에서 동작하지 않는다** — 트랙 A 는 그중 산출물 5종만 invoke 스텁으로 목업한다.
> - ⚠ **오리진이 갈려 데이터는 자동 이관되지 않는다.** Chrome에서 쓰던 데이터가 있으면 반드시 기존 앱에서 내보내기 → 셸에서 가져오기. 셸 자신의 localStorage(1단계에 쓰던 것)는 **첫 부팅에 SQLite로 1회 자동 이관**된다(`initAppStore`).

## 절대 규칙 (반복 실수 방지 — 매번 물림)

1. **Tauri 셸이 prebuilt `web/dist/`를 로드한다 → 소스 수정 후 반드시 `cd web && npm run build`.** UI/색이 "안 바뀐다"의 1순위 원인. (PWA SW는 `selfDestroying`으로 은퇴시켜 옛 캐시 마찰은 해소됨 — `vite.config.ts` 참고. dev 서버 `npm run dev`는 HMR이라 빌드 불필요.) `npm run tauri:build` 는 `web` 빌드를 **자동으로 먼저 돌린다**(`beforeBuildCommand`)지만, **트랙 B(`npm run e2e:shell`)는 exe 를 검사하므로 앞서 `tauri:build` 가 필요**하다 — 안 하면 옛 exe 를 검사한다.
2. **레이어 경계는 단방향**(`app → features → components → {hooks, store} → lib`, 역방향 import 금지). `eslint-plugin-boundaries`가 **error**로 막는다. 새 코드가 상위를 import하면 린트가 깨진다 → 세부는 `web/docs/아키텍처.md`.
3. **과목 색 = `PALETTE` 파생물**(저장값 아님 — 한 줄 교체로 전탭 반영). 임의 하드코딩 금지.
   - 파생 키는 **`item.id` 해시**(`lib/utils.ts` `colorForId`)다. 0단계-G에서 배열 인덱스에서 옮겼다 — 인덱스는 *위치*라 삭제·재정렬 때 뒤 과목 색이 전부 밀렸고 보정 코드가 파생을 4곳으로 불렸다. id는 *정체성*이라 불변이고 파생이 1곳이다.
   - 원칙이 규칙이고 메커니즘은 그 구현이다: 색을 **저장값처럼 다루지 말 것**(입력으로 받거나 하드코딩 금지). 파생 키를 또 바꾸더라도 이 원칙은 유지된다.
4. **명시 지시 임의변경 금지.** 사용자가 못박은 결정(예 "블록도 색 있어야")을 내 판단으로 뒤집지 않는다. 대담한 재설계는 **새 영역에만**, 기존 제약은 유지.
5. **커밋 전 `git -c core.quotepath=false diff --cached --stat` 확인.** 이 저장소는 web/시스템/전공 세션이 **동시 작업**한다 — 스테이징에 `전공/`·`시스템/` 파일이 섞이면 그 커밋에서 빼고 **앱 저장소 범위(`web/` + `src-tauri/` + `docs/` + 루트 설정)** 만 담는다(인덱스 위생 재발 이력 다수). git user=`jin`, 기본 브랜치=`master`.
   - ⚠ 범위를 "web 변경만"에서 넓힌 이유(2026-07-19): 플랫폼 개편 1단계에서 `src-tauri/`(Rust·`Cargo.lock`)가 생기는데 이건 `web/` 밖이다. 옛 문구를 문자 그대로 지키면 **규칙이 자기 마이그레이션의 첫 커밋을 막는다.** 막으려던 것은 *다른 세션의 산출물 혼입*이지 앱 자체의 새 폴더가 아니다.
6. **게이트 없이 완료 보고 금지.** 아래 게이트가 녹색이어야 "됐다".

## 게이트 (원커맨드 · `cd web` 후)

```
npm run verify   # codegen:check + typecheck + lint + lint:css + format:check + knip + test:coverage
npm run e2e      # 트랙 A — Playwright 시각/동작 스냅샷 (백엔드 없이 · 산출물은 invoke 스텁으로 목업)
npm run build    # tsc -b && vite build — Tauri 셸이 로드할 dist 재생성
npm run e2e:shell # 트랙 B — 빌드된 exe 를 띄워 WebView2 안을 검사(사전 `npm run tauri:build` 필요)
```

- **트랙 A/B 를 나눈 이유**: A 는 Chromium 으로 `vite preview` 를 찍으므로 **WebView2 에서만 깨지는 것을 원리적으로 못 잡는다**("무효화되는 도구로 무효화되지 않았음을 증명"하는 순환). B 는 진짜 exe 를 띄워 창·라우팅·IPC 왕복·종료 시 flush 만 본다(**스냅샷은 안 찍는다** — 베이스라인 두 벌 방지). 구현은 `tauri-driver` 가 아니라 **CDP + 기존 Playwright**다(WebView2 가 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 를 존중 · 디버그 포트는 하네스만 켬 → 배포본 노출 0).

- **Tauri 셸(`src-tauri/`, 플랫폼 개편 1단계~)**: 루트에서 `npm run tauri:check|fmt|clippy|dev|build`. `/게이트`가 **cargo가 있으면** `tauri:check` → `tauri:build` → `e2e:shell`(트랙 B)까지 돈다(없으면 전부 건너뜀 — web만 만지는 작업에 Rust 툴체인을 요구하지 않는다). **`tauri:check` 만으로는 부족하다** — 1단계에서 `cargo check` 녹색인데 번들이 죽은 실사고가 있었고, 그건 `tauri build` 에서만 나타난다. `e2e:shell` 이 마지막인 건 **빌드된 exe 를 검사 대상으로 삼기** 때문(순서가 뒤집히면 옛 exe를 검사해 통과가 거짓이 된다). ⚠ cargo가 "없다"고 나오면 대개 **셸이 rustup 설치보다 오래된 것** — 새 터미널을 열면 잡힌다.
- **`npm run report:debt`** — 인지복잡도·파일 크기·features:lib 비율을 **강제 없이** 출력(추세 관찰용). 하드 게이트는 래칫 2개(`cognitive-complexity` 77 · `max-lines` 730)뿐이고 "더 나빠지지 않는다"만 보장한다.

- **e2e 스냅샷 함정:** `--update-snapshots`의 기본은 `changed`(2% 내 신규 UI가 안 박힘) → 신규 스냅샷은 `npm run e2e:update`(=all)로. flaky 근절 위해 GPU는 `--disable-gpu`로 핀 고정돼 있다(건드리지 말 것).
- 슬래시 명령 `/게이트`가 verify+build+budget(번들 예산)+e2e(+cargo 있으면 tauri:check·tauri:build·e2e:shell)를 돌려 압축 리포트만 반환한다(quick=verify만).
- **`lint:css`(stylelint)가 CSS 규약을 강제한다** — 생 hex 금지(색은 tokens.css 토큰만) · 브레이크포인트 3종(560/700/900)만. 설정 근거는 `stylelint.config.js` 주석. 규약을 '관습'에 두면 흘러내린다는 게 감사 결론이었다.

## 트리거 라우팅 (요청 유형 → 읽을 프로토콜)

| 사용자 요청                        | 읽고 따를 것                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| "새 탭 추가 / (탭) 만들어줘"       | `web/docs/protocols/새탭추가.md` (또는 `/새탭 <key>`)                                                                  |
| "(기능) 추가 / 로직 붙여줘"        | `web/docs/protocols/기능추가.md`                                                                                       |
| "(탭) 재설계 / 다시 디자인"        | `web/docs/protocols/탭재설계.md` — **today 재설계 사상**(단일목적 한화면·상단 리드아웃·fill 프레임·온디맨드 세부) 준수 |
| "(feature) 리뷰 / 검토"            | `web-reviewer` 서브에이전트 팬아웃 (또는 `/리뷰 <feature>`)                                                            |
| "(탭/모듈) 평가 / 점수 / 벤치마크" | `web/docs/평가루브릭.md` + `/평가 <대상>` (독립 채점·다각도·추세 → `평가기록.md`)                                      |
| "(대상) 개선 / 향상"               | `web/docs/개선루브릭.md` + `/개선 <대상>` (향상 발굴·랭크 → `로드맵.md`)                                               |
| "새 기능/탭 아이디어 / 확장"       | `/아이디어 [주제]` (발산→심사→shortlist → `로드맵.md`)                                                                 |
| "다음 뭐 / 백로그 / 로드맵"        | `web/docs/로드맵.md`                                                                                                   |
| 색·토큰·컴포넌트 규격              | `web/docs/디자인시스템.md`                                                                                             |
| "왜 X를 이렇게?" 결정 근거         | `web/docs/결정로그.md`                                                                                                 |

> **작업 3단계 수명주기:** **만들기**(protocols) → **검증**(게이트=통과/실패·리뷰=결함·평가=점수) → **발전**(개선·아이디어·로드맵). 발전이 다음 만들기를 먹인다.

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
              테스트) · sqlite.ts=SQL만(로직 없음) · boot.ts=부팅 읽기+localStorage 1회 이관 · dual.ts=대조.
              ⚠ **트랜잭션 금지** — sqlx 커넥션 풀이라 별도 execute로 부른 BEGIN이 다른 커넥션의 쓰기를
              막아 `database is locked`로 죽는다(실측). 증분 upsert가 대신 안전을 준다(DB가 비는 창이 없다).
              스키마 DDL의 단일 원천은 **`src-tauri/src/db.rs`**(프런트가 DDL을 들면 배포본마다 갈린다).
  shell/      탭 레지스트리(tabs.ts)·팔레트·단축키·토스트·액션.
  styles/     ds.module(전역 디자인시스템) + feature별 *.module.css.
(백엔드 없음)  4단계에서 serve.js 를 삭제했다. 백엔드는 아래 src-tauri/ 의 커맨드가 전부다.
              프런트에서 그 커맨드를 부르는 곳은 **`web/src/lib/tauri.ts` 하나**(불변식 I2)이고,
              전송 분기(셸/브라우저)는 **`web/src/lib/api.ts` 안에만** 있다.
src-tauri/    Tauri 2 셸(1단계~). workspace.rs=워크스페이스 경로 · **db.rs=SQLite 스키마(SSOT)** ·
              **vault.rs=볼트 읽기+notify 감시(3단계)** · **tools.rs=파이썬 도구 11종+RAII 동시성 캡 ·
              research.rs=탐구 잡(이벤트 진행·JSON 이력) · ollama.rs=AI 5종(Channel 스트리밍) ·
              artifact.rs=산출물 8종 · news.rs=뉴스 RSS · files.rs=내보내기 저장 · anki.rs=AnkiConnect 중계**(4단계). 프런트에서 invoke를 부르는 곳은 **`web/src/lib/tauri.ts` 하나**(불변식 I2).
              ⚠ **여는 포트가 없다**(4단계). 1단계의 '고아 sidecar 선점' 로직은 serve.js 와 함께
              사라졌다 — 포트를 물고 남을 프로세스 자체가 없어졌기 때문. `single-instance`는 유지.
```

- **탭 추가 = 2곳 한 줄씩**: `shell/tabs.ts` TABS 배열 + `features/registry.tsx` LOADERS. 그 외는 나브·팔레트·g단축키가 자동 순회.
- **CSS Module 전면 전환 완료**: 전역 클래스는 앱 크롬만(27개). feature는 `*.module.css`.
- 스택: zustand+immer · @tanstack/react-query · react-router 7 · zod · cmdk(⌘K) · vite-plugin-pwa.

## 참고 문서

- `web/docs/아키텍처.md` — 레이어·데이터레이어·경계 계약 SSOT
- `web/docs/디자인시스템.md` — 토큰·액센트·컴포넌트 규격
- `web/docs/protocols/` — 반복작업 절차서
- `web/docs/골든/` — 레퍼런스 feature(스타일 앵커)
- `web/docs/평가루브릭.md`·`평가기록.md` — 다각도 채점 SSOT + 추세
- `web/docs/개선루브릭.md`·`로드맵.md` — 개선 우선순위 채점 + 백로그 SSOT("다음 뭐")
- `web/docs/플랫폼개편-설계.md` — **진행 중**: Tauri 2 셸 + SQLite 데이터 모델 이행(4단계) SSOT
- `README.md` · `설계도.md` · `MIGRATION.md` — 배경·이전 이력
