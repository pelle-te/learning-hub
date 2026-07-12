# 러닝 허브 — 작업 메모리 (웹앱 규약 · 항상 우선)

> **폴더 기준점** — git 루트는 `atelier/`(형제: `knowledge/`·`pipeline/`·`exports/`·`sources/`·**`hub/`**). 이 문서·경로는 **`hub/` 기준**이다(폴더는 hub, 앱 브랜드명은 여전히 "러닝허브"). 웹앱 소스는 전부 `web/`.
> **이 문서는 웹앱(러닝허브) 전용**이다. 볼트 노트 파이프라인 규약은 `../knowledge/CLAUDE.md`가 단일 진리 — 혼동 금지.

러닝 허브는 **볼트(knowledge/)·Anki·일과 데이터를 한눈에 보는 로컬 학습 대시보드**다. 두 프로세스로 동작한다:

- **`web/`** — React 19 + Vite 6 + TS SPA(프런트). `npm run dev`(:5173).
- **`serve.js`** — Node stdlib HTTP 백엔드(:8000). `/api/*`로 볼트 스캔·Anki·리서치·임베드 제공. **prebuilt `web/dist/`를 서빙**한다.
- dev에선 Vite(:5173)가 `/api`를 :8000으로 프록시해 동일출처처럼 동작. 실행 진입점은 `러닝허브_실행.bat`.

## 절대 규칙 (반복 실수 방지 — 매번 물림)

1. **serve.js는 prebuilt `web/dist/`를 서빙한다 → 소스 수정 후 반드시 `cd web && npm run build`.** UI/색이 "안 바뀐다"의 1순위 원인. (PWA SW는 `selfDestroying`으로 은퇴시켜 옛 캐시 마찰은 해소됨 — `vite.config.ts` 참고. dev 서버 `npm run dev`는 HMR이라 빌드 불필요.)
2. **레이어 경계는 단방향**(`app → features → components → {hooks, store} → lib`, 역방향 import 금지). `eslint-plugin-boundaries`가 **error**로 막는다. 새 코드가 상위를 import하면 린트가 깨진다 → 세부는 `web/docs/아키텍처.md`.
3. **과목 색 = `PALETTE` 인덱스 파생**(한 줄 교체로 전탭 반영). 임의 하드코딩 금지.
4. **명시 지시 임의변경 금지.** 사용자가 못박은 결정(예 "블록도 색 있어야")을 내 판단으로 뒤집지 않는다. 대담한 재설계는 **새 영역에만**, 기존 제약은 유지.
5. **커밋 전 `git -c core.quotepath=false diff --cached --stat` 확인.** 이 저장소는 web/시스템/전공 세션이 **동시 작업**한다 — 스테이징에 `전공/`·`시스템/` 파일이 섞이면 그 커밋에서 빼고 web 변경만 담는다(인덱스 위생 재발 이력 다수). git user=`jin`, 기본 브랜치=`master`.
6. **게이트 없이 완료 보고 금지.** 아래 게이트가 녹색이어야 "됐다".

## 게이트 (원커맨드 · `cd web` 후)

```
npm run verify   # typecheck + lint + format:check + test:coverage (커버리지 게이트 포함)
npm run e2e      # Playwright 시각/동작 스냅샷 (serve.js OFF 상태로 돈다)
npm run build    # tsc -b && vite build — serve.js가 서빙할 dist 재생성
```

- **e2e 스냅샷 함정:** `--update-snapshots`의 기본은 `changed`(2% 내 신규 UI가 안 박힘) → 신규 스냅샷은 `npm run e2e:update`(=all)로. flaky 근절 위해 GPU는 `--disable-gpu`로 핀 고정돼 있다(건드리지 말 것).
- 슬래시 명령 `/게이트`가 verify+e2e를 돌려 압축 리포트만 반환한다.

## 트리거 라우팅 (요청 유형 → 읽을 프로토콜)

| 사용자 요청 | 읽고 따를 것 |
|---|---|
| "새 탭 추가 / (탭) 만들어줘" | `web/docs/protocols/새탭추가.md` (또는 `/새탭 <key>`) |
| "(기능) 추가 / 로직 붙여줘" | `web/docs/protocols/기능추가.md` |
| "(탭) 재설계 / 다시 디자인" | `web/docs/protocols/탭재설계.md` — **today 재설계 사상**(단일목적 한화면·상단 리드아웃·fill 프레임·온디맨드 세부) 준수 |
| "(feature) 리뷰 / 검토" | `web-reviewer` 서브에이전트 팬아웃 (또는 `/리뷰 <feature>`) |
| "(탭/모듈) 평가 / 점수 / 벤치마크" | `web/docs/평가루브릭.md` + `/평가 <대상>` (독립 채점·다각도·추세 → `평가기록.md`) |
| "(대상) 개선 / 향상" | `web/docs/개선루브릭.md` + `/개선 <대상>` (향상 발굴·랭크 → `로드맵.md`) |
| "새 기능/탭 아이디어 / 확장" | `/아이디어 [주제]` (발산→심사→shortlist → `로드맵.md`) |
| "다음 뭐 / 백로그 / 로드맵" | `web/docs/로드맵.md` |
| 색·토큰·컴포넌트 규격 | `web/docs/디자인시스템.md` |
| "왜 X를 이렇게?" 결정 근거 | `web/docs/결정로그.md` |

> **작업 3단계 수명주기:** **만들기**(protocols) → **검증**(게이트=통과/실패·리뷰=결함·평가=점수) → **발전**(개선·아이디어·로드맵). 발전이 다음 만들기를 먹인다.

개별 단발 요청이면 해당 프로토콜의 그 단계만 수행한다. 큰 작업(탭 신설·전면 재설계)은 **격리 서브에이전트로 단계 분리**해 정밀도를 새 챗 수준으로 유지한다(볼트 파이프라인과 같은 사상).

## 아키텍처 한눈 (깊이는 `web/docs/아키텍처.md`)

```
web/src/
  app/        셸 크롬(App·TopBar·RailSidebar·SubTabs·ThemeProvider·라우팅). 최상위.
  features/   탭 1개 = 폴더 1개. registry.tsx가 key→lazy 컴포넌트. tabs.ts가 탭 메타 원천.
  components/ 재사용 프리미티브(무상태에 가깝게). hooks·lib import 가능.
  hooks/      공유 React 훅(interactions·useFocusTrap). lib만 import. app/features/components가 소비.
  store/      zustand: useApp(앱 데이터)·useUI(설정)·useRuntime(plan-무관 캐시)·useFocus.
  lib/        순수 로직·IO(api·scheduler·anki·vault·schema…). 최하위, React 무관(훅은 hooks/).
  shell/      탭 레지스트리(tabs.ts)·팔레트·단축키·토스트·액션.
  styles/     ds.module(전역 디자인시스템) + feature별 *.module.css.
serve.js      /api/{ping,artifact,run,research/start,research/jobs,embed} — stdlib.
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
- `README.md` · `설계도.md` · `MIGRATION.md` — 배경·이전 이력
