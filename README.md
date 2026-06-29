# 러닝 허브

졸업까지의 수강 계획, 옵시디언 볼트/Anki 현황, 일과 빈 시간을 한 곳에서 보고
**주당 목표 시간**을 정하면 하루 가용시간을 **모듈(기본 2h) 단위**로 과목에 자동 배분하고,
**그날 배운 챕터**를 근거로 간격반복 복습까지 잡아주는 로컬 웹앱.

## 실행
**React + Vite 앱**입니다(바닐라 ESM에서 이전 완료 — 설계·이력은 `MIGRATION.md`).

- **개발**: 터미널 2개 — ① 루트에서 `node serve.js`(:8000 · `/api` 제어판 백엔드) ② `cd web && npm run dev`(:5173 · HMR). 브라우저는 **`http://localhost:5173`**.
- **단일 출처(배포)**: `cd web && npm run build` 후 루트에서 `node serve.js` → `http://localhost:8000` 하나가 **빌드물(web/dist) + `/api` + SPA 딥링크 폴백**을 모두 서빙.

(볼트/Anki 폴더 읽기에 File System Access API를 쓰므로 Chrome/Edge 권장.)

## 탭
- **🎯 오늘 학습** — *학습방법론 실행 레이어.* 오늘 배치된 블록 + **블록 내부 4단계 흐름**(개념 정찰→풀이→스케치→3문장 요약, 비중·분 추정)·**70% 룰** 가이드. 블록마다 **3문장 요약**(3절)·**CBMS 오답**(6절)·**보충 필요 백로그**(5절)를 바로 기록. **요약·오답을 Anki 카드 초안(.txt)으로** 내려받기.
- **📅 주간 스케줄** — 한 주씩 넘겨보기(◀▶). 각 날짜의 가용시간을 칸에서 바로 조정(그날만). 모듈·복습·**백지복습·모의시험**·Anki가 시각순으로.
- **📝 학습 항목** — 과목별 *주당 목표 시간* + *챕터(순서·예상시간)* 편집. +/- 스텝퍼, 챕터 일괄 붙여넣기.
- **⏰ 일과 & 가용시간** — 시작일/모듈길이/복습비중 설정, 수면·식사·취미·수업 블록 → 요일별 공부시간·빈 시간. (가용 공부시간 = 깨어있는 시간 − 이 블록들. 별도 '공부' 블록 개념은 폐지.) **+ 적응형 용량**(최근 완료율로 다음 계획 자동 보정)·**피크 시간대**(어려운 새 학습을 맑을 때)·**복습 Anki 위임**·**백업/아카이빙** 유지보수.
- **📊 통계** — 과목별 진행·완료 챕터·예상 종료일, 주별 학습시간 막대, "무엇을 언제 배우는지" 챕터 타임라인. **+ 인출 증거**(CBMS 추세·백지복습 완료율·능동 인출 활동 — 투입 아닌 출력 지표).
- **📚 볼트 현황** — 전공 폴더 선택 → **정본 `_meta/감사/_index.json` 소비**(검사.sh --index 산출)로 과목→챕터 노트/검증/**구버전**/Anki 상태. 인덱스 없으면 .md 직접 스캔 폴백. 과목을 챕터까지 통째로 학습 항목에 추가.
- **🃏 Anki 현황** — **정본 `_index.json`의 덱 목록**(file·cards) 집계 + AnkiConnect 실시간 due. '매일' 항목으로 추가. **요약·오답 전체를 카드 초안(.txt)으로 생성**(Anki import → ≤5장 큐레이션·왜/응용형 손질은 사람이, due는 FSRS). ⚠️ `anki/*.txt` 폴더 폴백은 **선택 핸들의 직속 자식**에서 `anki`/`_anki`를 찾으므로, 2026-06-23 4분할 이후 카드 `.txt`는 `전공/`의 *형제* `anki/`에 있어 — 정본대로 `전공/`을 고르면 폴백이 못 찾는다. **폴백을 쓰려면 `작업 폴더` 루트를 고르거나(권장은 `_index.json` 정본 경로).**

> ⚠️ **복습 슬롯 ≠ 실제 Anki due:** `lib/utils.ts`의 `REVIEW_OFFSETS=[1,3,7,16]`은 *학습 계획용* 고정 간격 휴리스틱이다. 실제 카드 복습 시점은 **Anki/FSRS가 소유**(시스템 본체는 네이티브 FSRS). 이 앱의 복습 슬롯은 "그날 배운 챕터를 언제 다시 볼지"의 계획 보조일 뿐.
- **🔄 주간 리뷰** — *메타인지 점검(방법론 10절).* 주 1회: **계획 대비 실제**(요일별 막대)·**CBMS 분포**(약점별 처방 힌트)·**보충 필요 회수**·주간 체크리스트+메모(그 주에 저장).
- **🎓 졸업 계획** — 학기별 과목·학점·구분·성적, 졸업요건 대비 진행률.

> 🔗 **방법론 ↔ 앱:** `학습방법론.md`의 절차가 탭과 1:1로 대응한다. 블록 배분/인터리빙(스케줄러) · 1·3·7·16 복습 슬롯 · **블록 4단계·3문장·CBMS·백로그**(오늘 학습) · **주간 메타인지**(주간 리뷰) · 백지복습·모의시험 자동 배치는 *일과 탭 설정*(`blankReviewWeekly`/`mockEveryWeeks`)로 켜고 끈다.

## 배분 엔진 (요약)
1. 일과 '공부' 블록(또는 날짜별 덮어쓰기) = 하루 가용시간 → 모듈(2h) + 복습예산으로 분리.
2. 과목의 *주당 목표 시간* → 주당 모듈 수로 환산, 그 주 안에서 **마감 임박·덜 채운 과목 우선 + 인터리빙**으로 분배.
3. 모듈마다 과목의 **챕터 포인터**가 전진 → 그날 배운 챕터 기록.
4. 복습은 그날 배운 챕터를 달고 +1·3·7·16일에 생성, 복습예산에 배치.

## 폴더 구조
```
러닝허브/
├─ serve.js                 백엔드(/api 제어판) + 빌드물(web/dist) 정적 서빙 + SPA 폴백
└─ web/                     React + Vite 앱
   ├─ src/
   │  ├─ main.tsx · app/    셸: App·Nav·Header·ThemeProvider·queryClient
   │  ├─ shell/             네이티브 셸 서비스: 탭 레지스트리·아이콘·토스트·모달·데이터 액션·팔레트
   │  ├─ store/             Zustand(앱상태 useApp) · selectors(파생 schedule) · queries(TanStack Query)
   │  ├─ lib/               ★ 순수 도메인: persistence·scheduler·methodology·ics·vault·anki·knowledge·api·utils (+ zod schema)
   │  ├─ features/          탭 구현(13) · registry.tsx(key→컴포넌트)
   │  ├─ components/ui/      공용 프리미티브(Card/Button/Pill/Kpi…, CSS Modules)
   │  └─ styles/            tokens.css(테마 변수) + global/(전역 디자인 시스템)
   ├─ test/                 Vitest(lib) · RTL(컴포넌트)  · e2e/  Playwright(스모크 + 비주얼 회귀)
   └─ package.json          scripts: dev·build·test·lint·typecheck·e2e
```

## 수정 가이드
- 배분 규칙 → `web/src/lib/scheduler.ts`의 `schedule()`. 복습 주기는 `lib/utils.ts`의 `REVIEW_OFFSETS`,
  모듈 길이/복습비중은 앱의 "일과 & 가용시간" 탭(설정)에서.
- 화면(탭) → `web/src/features/<탭>/`. 스타일 → 토큰은 `styles/tokens.css`, 전역 클래스는 `styles/global/`, 컴포넌트 고유는 `*.module.css`.
- 도메인 로직(스케줄·방법론·영속·볼트/Anki/지식)은 **프레임워크 무관 `lib/`** 에 모여 Vitest로 검증된다. 앱상태는 Zustand(`store/useApp`), 서버/외부(볼트·Anki·`/api`)는 TanStack Query(`store/queries`)가 소유.
- 볼트/Anki 패널은 정본 `_index.json`을 읽으므로(`lib/vault.ts`), 데이터가 안 보이면 먼저 `검사.sh --index`로 인덱스를 만든다.
- 검증: `cd web` 후 `npm run typecheck && npm run lint && npm test` · 비주얼 회귀 `npm run e2e`(베이스라인 갱신 `npm run e2e:update`).

## 문서·감사
- 설계(아키텍처): `설계도.md` · 학습 이론: `학습방법론.md` · 졸업 요건: `졸업요건_정리.md`.
- **시스템 전수 평가:** `감사_템플릿.md`를 `감사_리포트_<날짜>.md`로 복사해 12개 축(무결성·데이터·스케줄러·방법론 정합·학습효과·UX·연동·코드·보안·문서·세계수준·방향)을 점검 → 결과가 *개선/추가/수정/방향*으로 정리됨. 최근: `감사_리포트_2026-06-28.md`(종합 48/60·열린 P0/P1 0).

## 테스트
의존성 0 · Node 내장(`vm`)만 · 실패 시 비ZERO 종료(검사.sh/CI에 물리기 좋음). 총 30개.
- **스케줄러**: `node test/scheduler.test.js` — `utils.js`+`scheduler.js`를 mock state로 `schedule()` 검증. 타임존을 **Asia/Seoul로 고정(자기 재실행)**해 `iso()` 날짜밀림을 결정적으로. (T1~T18: 날짜키·done제외·용량·페이스·복습·인터리빙·마감경고·daily·빈입력·덮어쓰기·빈구간·blank·mock·**적응형용량·복습위임·피크배치**)
- **상태/마이그레이션**: `node test/state.test.js` — migrate 보강·무효 거부·persist↔boot 라운드트립·손상 보존·카드 생성.
- **UI 스모크**: `node test/ui-smoke.test.js` — 9개 탭 render*가 throw 없이 HTML 생성 + 핸들러가 state 갱신.
- 해당 레이어를 고친 뒤엔 그 테스트를 돌려 회귀를 확인하세요.

## 데이터
- localStorage 키 `study_planner_v3`에 자동 저장. 우상단 내보내기/가져오기로 JSON 백업. **일과 탭 유지보수**에서 볼트 폴더 백업(`러닝허브_백업.json`)·오래된 기록 아카이빙(6개월 이전 → 보관 파일로 비움).
- ⚠️ **백업은 정기적으로**: localStorage 한 곳에만 있어 브라우저 캐시를 지우면 전소됩니다(7일 미백업 시 경고 표시).
- 실행 레이어 필드: `summaries`(3문장)·`cbms`(오답)·`backlog`(보충필요)·`weekly`(주간리뷰)·`blankReviewWeekly`·`mockEveryWeeks`. 적응·배치: `adaptiveCapacity`·`peakStart`/`peakEnd`·`reviewViaAnki`. 모두 같은 키에 저장돼 백업에 포함되고, 구버전 데이터는 가져올 때 자동 보강(`migrate`).
- 모델이 바뀌어 이전(v2) 데이터와 호환되지 않습니다(처음 한 번 새로 입력).
