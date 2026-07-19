# 러닝 허브

졸업까지의 수강 계획, 옵시디언 볼트/Anki 현황, 일과 빈 시간을 한 곳에서 보고
**주당 목표 시간**을 정하면 하루 가용시간을 **모듈(기본 2h) 단위**로 과목에 자동 배분하고,
**그날 배운 챕터**를 근거로 간격반복 복습까지 잡아주는 로컬 웹앱.

## 실행

**React + Vite 앱**입니다(바닐라 ESM에서 이전 완료 — 설계·이력은 `MIGRATION.md`).

- **데스크톱 앱(Tauri 셸)**: 루트에서 `npm run tauri:dev`(개발) · `npm run tauri:build`(배포본 + NSIS 설치프로그램). 셸 하나가 프런트와 백엔드를 모두 소유한다 — 터미널·브라우저·별도 서버가 필요 없다(4단계에서 `serve.js` 를 삭제하고 라우트 12종을 셸의 Rust 커맨드로 옮겼다).
- **개발**: `npm run tauri:dev` — 셸 안에서 Vite dev 서버를 로드하므로 HMR 을 쓰면서 백엔드 기능도 그대로 쓴다. ⚠ `cd web && npm run dev`(:5173 · 브라우저)는 **UI 작업 전용**이다 — 4단계 이후 브라우저엔 백엔드가 없어 산출물·도구·AI·볼트가 동작하지 않는다.
- ~~**단일 출처(브라우저 배포)**~~ — **은퇴(2단계-E · 2026-07-19).** 앱 데이터 정본이 SQLite 로 옮겨졌고 브라우저엔 SQLite 가 없다. `npm run dev` 와 시각 회귀 테스트는 localStorage 폴백으로 계속 돌지만, 그건 **개발·검증 경로**이지 사용자 실행 경로가 아니다.

**볼트 읽기** — 셸은 워크스페이스의 `knowledge/` 를 **직접 읽고 파일 변경을 감시**한다(3단계). 폴더를 고를 필요도, 권한을 허용할 필요도, "다시 스캔"을 누를 필요도 없다. 브라우저로 열었을 땐 File System Access API 폴백이라 Chrome/Edge 가 필요하고 갱신도 수동이다.

> ⚠ **브라우저 → 셸로 옮길 땐 데이터를 손으로 이관해야 한다.** WebView2 는 Chrome 과 **별개 저장소 오리진**이라 자동으로 넘어가지 않는다(셸 첫 실행이 빈 상태로 뜬다). 기존 앱에서 `⋯` → **데이터 내보내기(백업)** → 셸에서 `⋯` → **데이터 가져오기**. 가져오기는 현재 상태를 덮어쓰므로 셸을 쓰기 **전에** 할 것.

## 탭

탭 목록은 **`web/src/shell/tabs.ts`의 `TABS` 배열이 단일 원천**이다 — 여기 열거하지 않는다(문서 3벌이 각각 8·11·13개로 서로 다르게 낡았던 이력). 앱을 띄우면 좌측 레일이, 코드에선 `tabs.ts`가 현재 로스터를 보여준다.

대표 축만 짚으면:

- **계획** — 뼈대(일과·가용시간)·과목·배분·일일 배치를 한 탭에서. 자동초안을 엔진이 제안하고 사람이 오버라이드한다.
- **오늘 학습** — _학습방법론 실행 레이어._ 블록 내부 4단계 흐름(개념 정찰→풀이→스케치→3문장 요약)·70% 룰. 블록마다 3문장 요약(3절)·CBMS 오답(6절)·보충 필요 백로그(5절)를 바로 기록.
- **통계 · 주간 리뷰** — 진행·예상 종료일·챕터 타임라인 + **인출 증거**(CBMS 추세·백지복습 완료율 — 투입 아닌 출력 지표), 주 1회 메타인지 점검(10절).
- **숙달도 지도 · 연동 현황** — 볼트/Anki 정본 인덱스와 지식엔진 산출(`_지식상태.json`)을 소비. 볼트 읽기는 셸의 Rust가 하고(`src-tauri/src/vault.rs`), 파일이 바뀌면 자동 갱신된다. 브라우저에선 File System Access 폴백.
- **졸업 계획** — 학기별 과목·학점·구분·성적, 졸업요건 대비 진행률.

> ⚠️ **복습 슬롯 ≠ 실제 Anki due:** `lib/utils.ts`의 `REVIEW_OFFSETS=[1,3,7,16]`은 _학습 계획용_ 고정 간격 휴리스틱이다. 실제 카드 복습 시점은 **Anki/FSRS가 소유**(시스템 본체는 네이티브 FSRS). 이 앱의 복습 슬롯은 "그날 배운 챕터를 언제 다시 볼지"의 계획 보조일 뿐.

> 🔗 **방법론 ↔ 앱:** `학습방법론.md`의 절차가 탭과 1:1로 대응한다. 블록 배분/인터리빙(스케줄러) · 1·3·7·16 복습 슬롯 · **블록 4단계·3문장·CBMS·백로그**(오늘 학습) · **주간 메타인지**(주간 리뷰) · 백지복습·모의시험 자동 배치는 _일과 탭 설정_(`blankReviewWeekly`/`mockEveryWeeks`)로 켜고 끈다.

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
   │  ├─ shell/             네이티브 셸 서비스: 탭 레지스트리·아이콘·토스트·모달·데이터 액션·팔레트
   │  ├─ store/             Zustand(앱상태 useApp) · selectors(파생 schedule) · queries(TanStack Query)
   │  ├─ lib/               ★ 순수 도메인: persistence·scheduler·methodology·ics·vault·anki·knowledge·api·utils (+ zod schema)
   │  ├─ features/          탭 1개 = 폴더 1개 · registry.tsx(key→lazy 컴포넌트)
   │  ├─ components/ui/      공용 프리미티브(Card/Button/Pill/Kpi…, CSS Modules)
   │  └─ styles/            tokens.css(테마 변수) + ds.module.css(공유 클래스 DS) + global/(앱 크롬)
   ├─ test/                 Vitest(lib) · RTL(컴포넌트)  · e2e/  Playwright(스모크 + 비주얼 회귀)
   └─ package.json          scripts: dev·build·test·lint·typecheck·e2e
```

## 수정 가이드

- 배분 규칙 → `web/src/lib/scheduler.ts`의 `schedule()`. 복습 주기는 `lib/utils.ts`의 `REVIEW_OFFSETS`,
  모듈 길이/복습비중은 앱의 "일과 & 가용시간" 탭(설정)에서.
- 화면(탭) → `web/src/features/<탭>/`. 스타일 → 토큰은 `styles/tokens.css`, 전역 클래스는 `styles/global/`, 컴포넌트 고유는 `*.module.css`.
- 도메인 로직(스케줄·방법론·영속·볼트/Anki/지식)은 **프레임워크 무관 `lib/`** 에 모여 Vitest로 검증된다. 앱상태는 Zustand(`store/useApp`), 서버/외부(볼트·Anki·`/api`)는 TanStack Query(`store/queries`)가 소유.
- 볼트/Anki 패널은 정본 `_index.json`을 읽으므로(`lib/vault.ts`), 데이터가 안 보이면 먼저 부모 파이프라인 도구로 인덱스를 만든다(`bash ../pipeline/_도구/검사.sh --index` — pipeline 소관 · 정본 산출물 = `../knowledge/_meta/cache/_index.json`).
- 검증: `cd web` 후 `npm run typecheck && npm run lint && npm test` · 비주얼 회귀 `npm run e2e`(베이스라인 갱신 `npm run e2e:update`).

## 문서·감사

- **현행 정본은 `web/docs/`** — `아키텍처.md`(레이어·경계 계약) · `디자인시스템.md`(토큰·컴포넌트 규격) · `결정로그.md`("왜 이렇게?") · `로드맵.md`("다음 뭐") · `protocols/`(반복작업 절차서) · `평가루브릭.md`·`평가기록.md`.
- 학습 이론: `학습방법론.md` · 졸업 요건: `졸업요건_정리.md`.
- ⚠️ 루트의 `설계도.md`·`MIGRATION.md`는 **레거시 아카이브**다(각 문서 상단 배너 참고) — 구조·API·탭 목록을 여기서 인용하지 말 것.
- **시스템 전수 평가:** 감사 템플릿·리포트는 atelier `../docs/감사/`로 이관됨 — `감사요청_템플릿_전체.md`의 **클러스터 E(러닝 허브 웹앱)**로 무결성·데이터·스케줄러·방법론 정합·학습효과·UX·연동·코드·보안·문서 축을 점검(옛 12축 흡수) → `감사_리포트.md`에 _개선/추가/수정/방향_ 갱신. 옛 결과(종합 48/60·열린 P0/P1 0): `../docs/감사/_아카이브/hub_감사_리포트_2026-06-28.md`.

## 테스트

정본 스위트 = **`web/` Vitest + Playwright**(옛 node-vm `test/` 30개는 React 전환으로 삭제 — 감사 2026-07-16 #46 정정).

- **단위/컴포넌트**: `cd web && npm run test`(Vitest — lib·store·features · 커버리지 게이트는 `test:coverage`).
- **e2e/비주얼**: `npm run e2e`(Playwright 스모크+시각 스냅샷 · 신규 스냅샷은 `e2e:update`).
- **원커맨드**: `node scripts/gate.mjs`(verify+build+budget+e2e — CLAUDE.md '게이트' 절이 SSOT).
- 해당 레이어를 고친 뒤엔 그 테스트를 돌려 회귀를 확인하세요.

## 데이터

- 셸에선 **SQLite**(`learning-hub.db`)에 자동 저장(2단계). 브라우저 폴백은 localStorage 키 `study_planner_v3`. 백업 파일 형식은 **양쪽 동일한 JSON** 이라 서로 오간다. 우상단 내보내기/가져오기로 JSON 백업. **일과 탭 유지보수**에서 볼트 폴더 백업(`러닝허브_백업.json`)·오래된 기록 아카이빙(6개월 이전 → 보관 파일로 비움).
- ⚠️ **백업은 정기적으로**: localStorage 한 곳에만 있어 브라우저 캐시를 지우면 전소됩니다(7일 미백업 시 경고 표시).
- 실행 레이어 필드: `summaries`(3문장)·`cbms`(오답)·`backlog`(보충필요)·`weekly`(주간리뷰)·`blankReviewWeekly`·`mockEveryWeeks`. 적응·배치: `adaptiveCapacity`·`peakStart`/`peakEnd`·`reviewViaAnki`. 모두 같은 키에 저장돼 백업에 포함되고, 구버전 데이터는 가져올 때 자동 보강(`migrate`).
- 모델이 바뀌어 이전(v2) 데이터와 호환되지 않습니다(처음 한 번 새로 입력).
