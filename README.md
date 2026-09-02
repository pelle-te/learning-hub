# 러닝 허브

졸업까지의 수강 계획, 옵시디언 볼트/Anki 현황, 일과 빈 시간을 한 곳에서 보고
**주당 목표 시간**을 정하면 하루 가용시간을 **모듈(기본 2h) 단위**로 과목에 자동 배분하고,
**그날 배운 챕터**를 근거로 간격반복 복습까지 잡아주는 로컬 웹앱.

## 실행

**React + Vite 앱**입니다(바닐라 ESM에서 이전 완료).

### 새 클론에서 첫 실행 (V050·V089 · 2026-08-31 신설)

전에는 이 절이 **없었다**. `npm ci` 가 이 파일에도 `CLAUDE.md` 에도 0건이라, README 대로 치면
**두 번 연속으로, 서로 다른 이유로, 안내 없이 죽었다**(루트 `@tauri-apps/cli` 없음 → 설치 뒤
`beforeDevCommand` 의 `vite` 없음). 유일한 출처가 `.github/workflows/ci.yml` 이었다 — 즉
**CI 는 이미 푼 문제인데 사람에게는 안 적혀 있었다.**

```
# 1. Node — 정본은 web/.nvmrc (현재 24). CI 도 node-version-file 로 그 파일을 읽는다.
#    ⚠ web/package.json engines 는 ">=22" 라 더 느슨하다 — 24 를 쓰는 근거는 O003.
# 2. 의존성은 두 벌이다 (루트 = Tauri CLI · web = 앱). 하나만 하면 다른 쪽에서 죽는다.
npm ci            # 루트
cd web && npm ci  # 앱
npx playwright install --with-deps chromium   # e2e(트랙 A·a11y·모션)를 돌 거면
```

**게이트 full 을 돌리려면 여기까지 더 필요하다**(안 하면 `npm run gate` 가 중간에서 죽고,
게이트는 **첫 실패에서 멈추므로 뒤 단계가 통째로 안 돈다**):

```
# 3. Rust 툴체인 (stable + rustfmt + clippy) · Windows 는 MSVC 빌드도구 + WebView2
# 4. cargo install cargo-deny --locked        # tauri:deny 단계
# 5. cd server && npm ci                      # server verify 단계
# 6. 첫 부팅에 앱에서 워크스페이스 폴더를 지정한다 (부모 atelier/ 루트)
```

⚠ **부모 워크스페이스 없이 hub 만 클론했다면**(= CI 가 하는 것 · 이건 사설 서브모듈이다)
`cargo test` 가 실물 볼트를 못 찾아 죽는다. 그때의 탈출구는 환경변수
**`LEARNING_HUB_NO_REAL_ENV=1`** 이다(`src-tauri/src/testkit.rs` · `ci.yml`). 조용히 skip 하지
않는 것이 의도이므로 **끄는 것이 아니라 「실물이 없다」고 선언하는 것**으로 읽어라.

- **데스크톱 앱(Tauri 셸)**: 루트에서 `npm run tauri:dev`(개발) · `npm run tauri:build`(배포본 + NSIS 설치프로그램). 셸 하나가 프런트와 백엔드를 모두 소유한다 — 터미널·브라우저·별도 서버가 필요 없다(4단계에서 `serve.js` 를 삭제하고 라우트 12종을 셸의 Rust 커맨드로 옮겼다).
- **개발**: `npm run tauri:dev` — 셸 안에서 Vite dev 서버를 로드하므로 HMR 을 쓰면서 백엔드 기능도 그대로 쓴다. ⚠ `cd web && npm run dev`(:5173 · 브라우저)는 **UI 작업 전용**이다 — 4단계 이후 브라우저엔 백엔드가 없어 산출물·도구·AI·볼트가 동작하지 않는다.
- ~~**단일 출처(브라우저 배포)**~~ — **은퇴(2단계-E · 2026-07-19).** 앱 데이터 정본이 SQLite 로 옮겨졌고 브라우저엔 SQLite 가 없다. `npm run dev` 와 시각 회귀 테스트는 localStorage 폴백으로 계속 돌지만, 그건 **개발·검증 경로**이지 사용자 실행 경로가 아니다.

**파이썬 인터프리터** — 셸이 파이썬 도구를 돌릴 때 기본은 **`PATH` 의 `python`** 이다. 다른
인터프리터를 쓰려면(대개 **부모 워크스페이스의 venv**) 환경변수 **`LEARNING_HUB_PYTHON`** 에
그 경로를 넣는다:

```
# 예 — 이 워크스페이스의 venv 를 쓴다
set LEARNING_HUB_PYTHON=D:/atelier/pipeline/.venv/Scripts/python.exe   # cmd
$env:LEARNING_HUB_PYTHON = 'D:/atelier/pipeline/.venv/Scripts/python.exe'  # PowerShell
```

> ⚠ **이름이 `PYTHON` 에서 바뀌었다**(C069 · 2026-08-22). 옛 이름은 이름공간이 없어서 다른
> 도구·셸 프로필이 세워 둔 값을 이 앱이 **의도치 않게** 집을 수 있었고, 그 오작동은 조용하다
> (파이썬이 뜨긴 뜬다). 이 저장소는 같은 규율을 이미 `LEARNING_HUB_E2E_DATA_DIR` 에 적용해
> 두었고(`src-tauri/src/paths.rs`), 그게 한쪽에만 적용돼 있었다.
> **옛 `PYTHON` 도 계속 읽는다**(하위 호환) — 둘 다 있으면 새 이름이 이긴다.

> ⚠ 이 워크스페이스에는 **`python3` 이 없다**(Microsoft Store 스텁이 뜬다) — 부모 `CLAUDE.md` 의
> 「이 머신의 사실」 절이 그 사정을 소유한다. 도구가 `spawn 실패` 를 내면 그 메시지 자체가 이
> 변수를 안내한다(n-7).

**볼트 읽기** — 셸은 워크스페이스의 `knowledge/` 를 **직접 읽고 파일 변경을 감시**한다(3단계). 폴더를 고를 필요도, 권한을 허용할 필요도, "다시 스캔"을 누를 필요도 없다. 브라우저로 열었을 땐 File System Access API 폴백이라 Chrome/Edge 가 필요하고 갱신도 수동이다.

> ⚠ **브라우저 → 셸로 옮길 땐 데이터를 손으로 이관해야 한다.** WebView2 는 Chrome 과 **별개 저장소 오리진**이라 자동으로 넘어가지 않는다(셸 첫 실행이 빈 상태로 뜬다). 기존 앱에서 `⋯` → **데이터 내보내기(백업)** → 셸에서 `⋯` → **데이터 가져오기**. 가져오기는 현재 상태를 덮어쓰므로 셸을 쓰기 **전에** 할 것.

## 탭

탭 목록은 **`web/src/shell/tabs.ts`의 `TABS` 배열이 단일 원천**이다 — 여기 열거하지 않는다(문서 3벌이 각각 8·11·13개로 서로 다르게 낡았던 이력). 앱을 띄우면 좌측 레일이, 코드에선 `tabs.ts`가 현재 로스터를 보여준다.

대표 축만 짚으면:

- **계획** — 뼈대(일과·가용시간)·과목·배분·일일 배치를 한 탭에서. 자동초안을 엔진이 제안하고 사람이 오버라이드한다.
- **오늘 학습** — _학습방법론 실행 레이어._ 블록 내부 4단계 흐름(개념 정찰→풀이→스케치→3문장 요약)·70% 룰. 블록마다 3문장 요약(3절)·CBMS 오답(6절)·보충 필요 백로그(5절)를 바로 기록.
- **통계 · 주간 리뷰** — 진행·예상 종료일·챕터 타임라인 + **인출 증거**(CBMS 추세·백지복습 완료율 — 투입 아닌 출력 지표), 주 1회 메타인지 점검(10절).
- **연동 현황** — 볼트/Anki 정본 인덱스를 소비. 볼트 읽기는 셸의 Rust가 하고(`src-tauri/src/vault.rs`), 파일이 바뀌면 자동 갱신된다. 브라우저에선 File System Access 폴백.
  ⛔ **「숙달도 지도」는 은퇴했다**(2026-08-29 · V053). 부모가 목적을 「전공 교재 → 원자형 노트」만으로
  좁히며 **생산자(`지식엔진.py`)까지 삭제**했다 — `_지식상태.json` 은 이제 만들어지지 않고
  `fetchKnowledgeArtifact` 는 항상 throw 한다. 이 줄이 **현재형으로 엿새를 더 살아 있었다**.
- **졸업 계획** — 학기별 과목·학점·구분·성적, 졸업요건 대비 진행률.

> ⚠️ **복습 슬롯 ≠ 실제 Anki due:** `lib/utils.ts`의 `REVIEW_OFFSETS=[1,3,7,16]`은 _학습 계획용_ 고정 간격 휴리스틱이다. 실제 카드 복습 시점은 **Anki/FSRS가 소유**(시스템 본체는 네이티브 FSRS). 이 앱의 복습 슬롯은 "그날 배운 챕터를 언제 다시 볼지"의 계획 보조일 뿐.

> 🔗 **방법론 ↔ 앱:** 방법론 절차(`lib/methodology.ts` 가 코드 정본)가 탭과 1:1로 대응한다. 블록 배분/인터리빙(스케줄러) · 1·3·7·16 복습 슬롯 · **블록 4단계·3문장·CBMS·백로그**(오늘 학습) · **주간 메타인지**(주간 리뷰) · 백지복습·모의시험 자동 배치는 _일과 탭 설정_(`blankReviewWeekly`/`mockEveryWeeks`)로 켜고 끈다.

## 배분 엔진 (요약)

1. 일과 '공부' 블록(또는 날짜별 덮어쓰기) = 하루 가용시간 → 모듈(2h) + 복습예산으로 분리.
2. 과목의 _주당 목표 시간_ → 주당 모듈 수로 환산, 그 주 안에서 **마감 임박·덜 채운 과목 우선 + 인터리빙**으로 분배.
3. 모듈마다 과목의 **챕터 포인터**가 전진 → 그날 배운 챕터 기록.
4. 복습은 그날 배운 챕터를 달고 +1·3·7·16일에 생성, 복습예산에 배치.

## 폴더 구조

```
러닝허브/
├─ src-tauri/               Tauri 셸 = 프런트 호스트 + **백엔드**(도구·산출물·AI·잡·볼트·SQLite)
└─ web/                     React + Vite 앱
   ├─ src/
   │  ├─ main.tsx · app/    셸: App·TopBar·RailSidebar·SubTabs·ThemeProvider·queryClient
   │  ├─ shell/             네이티브 셸 서비스: 탭 레지스트리(tabs.ts)·팔레트·단축키·토스트·모달·데이터 액션
   │  │                     ⚠ **「아이콘」이 여기 적혀 있었다 — 아이콘은 `components/Icon.tsx` 다**(V054).
   │  │                     이 한 단어가 생성기(`feature-scaffolder`)에 `shell/icons.tsx` 오지시를 낳았다.
   │  ├─ store/             Zustand(앱상태 useApp) · selectors(파생 schedule) · queries(TanStack Query)
   │  ├─ lib/               ★ 순수 도메인: persistence·scheduler·methodology·ics·vault·anki·knowledge·api·utils (+ zod schema)
   │  ├─ features/          탭 1개 = 폴더 1개 · registry.tsx(key→lazy 컴포넌트)
   │  ├─ components/ui/      공용 프리미티브(Card/Button/Pill/Kpi…) · 스타일은 Tailwind 유틸 + 공유 `ds-*`
   │  └─ styles/            tokens.css(테마 변수) + ds.css(공유 `ds-*`) + tw.css(Tailwind 진입점) + global/(앱 크롬)
   ├─ test/                 Vitest(lib) · RTL(컴포넌트)  · e2e/  Playwright(스모크 + 비주얼 회귀)
   └─ package.json          scripts: dev·build·test·lint·typecheck·e2e
```

## 수정 가이드

- 배분 규칙 → `web/src/lib/scheduler/`(디렉터리 · 배럴은 `index.ts`)의 `schedule()`. 복습 주기는 `lib/utils.ts`의 `REVIEW_OFFSETS`,
  모듈 길이/복습비중은 앱의 "일과 & 가용시간" 탭(설정)에서.
- 화면(탭) → `web/src/features/<탭>/`. 스타일 → 토큰은 `styles/tokens.css`, 공유 클래스는 `styles/ds.css`, 앱 크롬은 `styles/global/`.
  ⚠ **`*.module.css` 를 만들지 말 것** — C-7 이후 이 저장소에 CSS Module 은 **0개**이고 `check:tokens` 가 신설을 막는다(언레이어드라 Tailwind 유틸을 이기고 집행자 검사 범위 밖으로 나간다).
- 도메인 로직(스케줄·방법론·영속·볼트/Anki/지식)은 **프레임워크 무관 `lib/`** 에 모여 Vitest로 검증된다. 앱상태는 Zustand(`store/useApp`), 서버/외부(볼트·Anki·`/api`)는 TanStack Query(`store/queries`)가 소유.
- 볼트/Anki 패널은 정본 `_index.json`을 읽으므로(`lib/vault.ts`), 데이터가 안 보이면 먼저 부모 파이프라인 도구로 인덱스를 만든다(`bash ../pipeline/_도구/검사.sh` — pipeline 소관 · 정본 산출물 = `../knowledge/_meta/cache/_index.json`).
  ⚠ **여기 `--index` 라 적혀 있었다 — 그런 플래그는 없다**(V049 · 2026-08-31). 그 스크립트의 인자
  파싱은 `--fast` 하나만 알고 **나머지는 전부 챕터 이름으로 먹는다**(`검사.sh:33-35`) → 인덱스만
  갱신하려던 사람이 전체 게이트를 돌린다(그리고 그게 «통과」하므로 아무도 모른다)..
- 검증: **완료의 정의는 `node scripts/gate.mjs`(full) 하나다** — 단계 목록의 정본은 그 파일의 `ALL`
  배열이다. 작업 중 빠른 루프는 `cd web && npm run verify`, 비주얼 회귀 갱신은 `npm run e2e:update`.
  ⚠ **여기 `typecheck && lint && test` 셋만 적혀 있었다**(V055 · 2026-08-31) — 그건 `verify` 의
  부분집합이고, `verify` 는 다시 게이트의 부분집합이다(SCA·a11y·시각회귀·트랙 B·Rust·server 가 밖).
  **같은 문서 아래 「테스트」 절이 이미 «정본은 `ALL` 배열»이라 적고 있어 자기모순이었다.**

## 문서·감사

- **현행 정본은 `web/docs/`** — `아키텍처.md`(레이어·경계 계약) · `디자인시스템.md`(토큰·컴포넌트 규격) · `결정로그.md`("왜 이렇게?") · **`원장.md`("다음 뭐" · 열린 것만)** · `원장-아카이브.md`(닫기 노트) · `판례.md`(실제로 물린 함정) · `protocols/`(반복작업 절차서) · `평가루브릭.md`·`평가기록.md`.
  ⚠ **`로드맵.md` 를 "다음 뭐"라 적고 있었다 — 그건 2026-08-20 부로 아카이브다**(V051 · 672 KiB ·
  그 파일 `:3` 이 스스로 그렇게 말한다). 그 줄을 믿은 사람은 **이미 닫힌 항목을 열린 백로그로 읽고
  착수**한다 — 폐루프(진단 → 원장 → `/실행`)가 통째로 우회된다.
- ⚠ 종전에 여기 있던 `학습방법론.md`·`졸업요건_정리.md` 는 **워크스페이스 어디에도 없다**(2026-08-06 실측 · 전수 grep 0건). 방법론의 코드 정본은 `web/src/lib/methodology.ts`, 졸업요건은 `/degree` 화면과 그 feature 다.
- **전수 평가:** **`/리뷰 <축>`** 을 축마다 돌린다(`코드`·`성능`·`ux`·`데이터`·`운영`·`규약`·`발상`).
  **한 회차에 한 축만** 판다 — 발견은 `web/docs/원장.md` 에 append 되고, 닫는 것은 `/실행` 뿐이다.
  ⚠ **여기 `/감사` 의 「클러스터 E」로 12축을 한 번에 점검하라고 적혀 있었다**(V052 · 2026-08-31).
  `/감사` 는 2026-08-20 에 **은퇴**했고 `.claude/commands/` 에는 `새탭`·`재설계` 둘뿐이다. 없는 명령을
  받은 세션은 **자기 방식으로 다축 동시 감사를 흉내내고**, 그건 축 분리가 폐지한 바로 그 실패
  형태다(렌즈당 예산 1/36 → 매번 "기존 표면에 한 줄" 급 발견). 옛 결과:
  `../docs/감사/_아카이브/hub_감사_리포트_2026-06-28.md`.

## 테스트

정본 스위트 = **`web/` Vitest + Playwright**(옛 node-vm `test/` 30개는 React 전환으로 삭제 — 감사 2026-07-16 #46 정정).

- **단위/컴포넌트**: `cd web && npm run test`(Vitest — lib·store·features · 커버리지 게이트는 `test:coverage`).
- **e2e/비주얼**: `npm run e2e`(Playwright 스모크+시각 스냅샷 · 신규 스냅샷은 `e2e:update`).
- **원커맨드**: `node scripts/gate.mjs` — **단계 목록의 정본은 그 파일의 `ALL` 배열**이다(CLAUDE.md 의 게이트 절은 요약이고, 스스로 정본이 아니라고 적는다 · 2026-08-06 순환 정정).
- 해당 레이어를 고친 뒤엔 그 테스트를 돌려 회귀를 확인하세요.

## 데이터

- 셸에선 **SQLite**(`learning-hub.db`)에 자동 저장(2단계). 브라우저 폴백은 localStorage 키 `study_planner_v3`. 백업 파일 형식은 **양쪽 동일한 JSON** 이라 서로 오간다. 우상단 내보내기/가져오기로 JSON 백업. **일과 탭 유지보수**에서 볼트 폴더 백업(`러닝허브_백업.json`)·오래된 기록 아카이빙(6개월 이전 → 보관 파일로 비움).
- ⚠️ **백업은 정기적으로**: 셸의 정본은 **SQLite 파일 하나**(`learning-hub.db`)이고, 클라우드에
  연결하지 않았다면 그 PC 밖에 사본이 없습니다(7일 미백업 시 경고 표시).
  ⚠ **여기 «localStorage 한 곳에만 있어 브라우저 캐시를 지우면 전소»라 적혀 있었다**(V048 ·
  2026-08-31) — **바로 윗줄이 이미 SQLite 라 말하는데** 그 문장이 남아 있었다. 데이터 안전에 관한
  거짓이라 방향이 둘 다 나쁘다: 브라우저 캐시를 지워도 셸 데이터는 안 날아가고(헛된 공포),
  **디스크가 죽으면 캐시와 무관하게 전소된다**(놓치는 진짜 위험).
- 실행 레이어 필드: `summaries`(3문장)·`cbms`(오답)·`backlog`(보충필요)·`weekly`(주간리뷰)·`blankReviewWeekly`·`mockEveryWeeks`. 적응·배치: `adaptiveCapacity`·`peakStart`/`peakEnd`·`reviewViaAnki`. 모두 같은 키에 저장돼 백업에 포함되고, 구버전 데이터는 가져올 때 자동 보강(`migrate`).
- 모델이 바뀌어 이전(v2) 데이터와 호환되지 않습니다(처음 한 번 새로 입력).
