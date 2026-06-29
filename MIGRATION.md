# 러닝 허브 → React 이전 설계도 (v2)

> v1 → v2: 세계적 시스템/2026 표준과 대조해 **9개 결함을 교정**. 핵심은 **상태를 목적별로 분리**(로컬-퍼스트 앱 상태 ≠ 서버/외부 상태)와 **경계의 데이터 계약(zod)**.
> 목표 스택: **React 18 + Vite + TypeScript + Zustand(+Immer,persist) + TanStack Query + React Router + CSS Modules + Radix/cmdk + zod + Vitest/RTL/Playwright**.
> 방식: 빅뱅 금지. 도메인 로직은 살리고 뷰만 탭 단위 교체(Strangler) — 단일 상태 원천 공유로 동기화 위험 제거.

---

## 0. 현재 시스템 (이전 대상)

**3계층 시스템** — 단순 정적 SPA 아님:
```
[React SPA] ─fetch /api─▶ [serve.js(Node /api)] ─exec─▶ [Python 도구·Obsidian 볼트]
     │  ─File System Access─▶ 전공 볼트(_지식상태.json)
     │  ─AnkiConnect(:8765)─▶ Anki
     └─ localStorage/IndexedDB ◀─ 로컬-퍼스트 앱 상태(study_planner_v3)
```

### 탭 인벤토리(13 노출 +1 숨김 +2 내장 +팔레트) — **상태 종류로 분류**(이게 v2의 핵심)
| 탭 | key | 그룹 | **상태 종류** | Phase |
|---|---|---|---|---|
| 졸업요건 정리 | degreeReq | degree | 정적 | 3 (첫 조각·trivial) |
| 학습 항목 | items | src | **앱상태**(Zustand) | 3 |
| 오늘 학습 | today | do | 앱상태 + 파생(scheduler) | 3 |
| 주간 스케줄 | schedule | do | 앱상태 + 파생 | 4 |
| 가용시간·수업·일과 | routine | do | 앱상태 | 4 |
| 학습 기록 | journal | log | 앱상태(methodology) | 4 |
| 주간 리뷰 | review | log | 앱상태 + 파생 | 4 |
| 통계 | stats | log | 앱상태 + 파생 | 4 |
| 졸업 계획 | degree | degree | 앱상태(degree) | 4 |
| 설정(숨김) | settings | settings | 앱상태 | 4 |
| 연동 현황 | integrations | src | **서버/외부**(Query: vault/anki) | 5 |
| 시스템 제어판 | control | src | **서버/외부**(Query: /api) | 5 |
| 숙달도 지도 | mastery | log | **서버/외부**(Query: knowledge) | 5 |
| (내장)볼트/Anki | — | — | 서버/외부 | 5 |
| (내장)팔레트 ⌘K | — | — | 라우트+액션(cmdk) | 2 |

### 살림 → `src/lib` (프레임워크 무관, 타입화)
`persistence`(defaults·migrate·boot·persist·import/export·backup·IDB미러 — **KEY/스키마 불변 → 데이터 100% 호환**), `scheduler`, `methodology`, `utils`. `serve.js /api`는 **백엔드로 유지**.

### 버림 → React/표준 라이브러리로
모든 `renderXxx()`(innerHTML), `globalThis`+인라인 onclick, `tabs.js`(→Router), `ui-kit`(→Radix), 손코딩 팔레트(→cmdk), `sw.js`(→vite-plugin-pwa), node-vm 테스트(→Vitest/RTL/Playwright).

---

## 1. 상태 아키텍처 — **목적별 분리** (v2의 가장 큰 교정)

> 정설(2026): *서버/외부 데이터를 클라이언트 상태에 복제하지 마라. 동기화 버그의 근원.* 현재 코드는 `state._knowState/_ankiLive`를 앱 상태에 섞는 안티패턴 → **분리한다.**

### 1-A. 로컬-퍼스트 앱 상태 → **Zustand (+Immer +persist)**
이 앱의 1차 데이터는 localStorage다(items·chapters·routine·degree·journal·cbms·설정·테마). 진짜 클라이언트 상태 → Zustand가 소유.
```ts
// store/useApp.ts  (Immer로 불변 업데이트 — 제자리 변형 금지)
export const useApp = create<AppStore>()(immer((set, get) => ({
  state: bootState(),                 // lib/persistence.boot() (zod 검증)
  setItemField(id, k, v){ set(s => { const it = s.state.items.find(i=>i.id===id); if(it) it[k]=v; });
                          persistDebounced(get().state); },
  setTheme(t){ set(s => { s.state.theme = t; }); applyTheme(t); persist(get().state); },
  // ...액션은 lib의 순수 함수를 호출하는 얇은 오케스트레이션
})));
```
- **파생 상태**(스케줄): `schedule()`를 매 렌더 X → **메모이즈드 셀렉터**(입력 바뀔 때만 재계산). `useSchedule()` 훅이 `state.items/routine/...` 의존으로 memo.
- **영속**: `persist()`는 디바운스(텍스트 입력마다 쓰지 않게) + IDB 미러 유지. 런타임 캐시는 **앱 상태에 안 넣음**(아래 1-B).

### 1-B. 서버/외부 상태 → **TanStack Query**
`/api`·지식상태·볼트·Anki = 외부에서 오는 데이터 → Query가 캐시·로딩·에러·무효화 소유. **persist 안 함, 앱 상태에 복제 안 함.**
```ts
useKnowledge()   = useQuery(['knowledge'], lib/api.getArtifact|vault.loadKnowledge)  // 숙달도 탭
useVaultIndex()  = useQuery(['vault'], vault.loadVaultIndex)                          // 연동/볼트
useAnkiDue()     = useQuery(['anki'], anki.fetchDue, { enabled, refetchInterval })    // KPI·연동
useRunTool()     = useMutation(lib/api.runTool, { onSuccess: invalidate(['knowledge']) }) // 제어판
```
- "지식상태 재빌드"(mutation) 성공 → `knowledge` 쿼리 invalidate → 숙달도 탭 자동 갱신(지금의 수동 `loadKnowledgeFromAPI`+`_knowState` 통째 제거).
- `serve.js` 미연결(file://)·AnkiConnect 미연결 = Query `isError` → 우아한 폴백 카드.

### 1-C. 경계의 데이터 계약 → **zod**
localStorage·`/api`·`_지식상태.json`을 zod 스키마로 검증하고 **타입을 추론**(스키마=타입=런타임 가드 일원화). 손코딩 `validShape/migrate`를 대체·강화.
```ts
// lib/schema.ts
export const AppStateSchema = z.object({ schemaVersion:z.number(), items:z.array(ItemSchema), ... });
export type AppState = z.infer<typeof AppStateSchema>;
export const KnowledgeSchema = z.object({ subjects:..., frontier:..., gaps:..., calibration:... });
// boot: 파싱 실패 → 손상본 보존 후 기본값(기존 P1-7 동작 유지)
```

---

## 2. 스타일 — **CSS Modules** (기존 style.css 폐기)
1. **토큰 레이어(전역 유지)** `styles/tokens.css`: 테마 CSS 변수 + `[data-theme]`(라이트 기본·인디고·다크·세피아). `ThemeProvider`가 `<html data-theme>` 제어.
2. **컴포넌트 스타일**: 각 `*.module.css`, **비주얼 새로 작성**(옛 1100줄 전역 규칙 이식 안 함 — 룩 재설계 기회). 토큰만 참조해 테마 자동 대응.
> 런타임 CSS-in-JS는 안 씀(제로런타임이 세계 표준 — Linear/Vercel 결).

---

## 3. 컴포넌트·접근성 — **표준 프리미티브 채택**(손코딩 금지)
- **Radix UI**: Dialog(모달)·Tabs(그룹/하위탭)·Tooltip·Popover·DropdownMenu(⋯메뉴) — 접근성 검증됨.
- **cmdk**: ⌘K 명령 팔레트(Linear/Vercel 표준).
- **react-error-boundary**: 라우트별 에러 경계(한 탭 깨져도 앱 안 죽음).
- 토스트: `sonner`(또는 Radix Toast). 차트(레이더/히트맵)는 의존성 최소 — 기존 SVG 로직 컴포넌트화 or `visx`.

---

## 4. 라우팅·구조
- **React Router**: URL=탭(`/today`,`/stats`,`/degree/plan`). 그룹/하위탭 = **중첩 라우트**. 라우트 lazy + Suspense로 코드분할. **데이터 로더는 안 씀**(원천이 인메모리 스토어라 불필요).
- **구조 방법론**: bulletproof-react 베이스 + **FSD식 단방향 의존**(`app → features → components → lib`, 역방향 금지)을 **eslint-plugin-boundaries로 강제**. 풀 FSD는 과하므로 규칙만 차용.

```
index.html  vite.config.ts(React+PWA+/api 프록시)  tsconfig  package.json
serve.js                      # 백엔드 /api + (배포 시) SPA 폴백·빌드물 서빙
src/
  main.tsx
  app/        App, Layout, Header, Nav(중첩라우트), ThemeProvider, ErrorBoundary, queryClient
  store/      useApp.ts(zustand+immer), selectors.ts(파생: useSchedule)
  lib/        persistence schemer(zod) scheduler methodology utils types  api knowledge vault anki
  components/ Card Kpi Chip Button Heatmap Radar ...(+ Radix/cmdk 래퍼)
  features/   today schedule routine items journal review stats mastery degree degreeReq integrations control settings
  styles/     tokens.css global.css
legacy/       # 이전 완료 전까지 옛 js/* + 어댑터(삭제 기한 명시)
test/         # vitest(lib) · RTL(components/features) · playwright(e2e+visual)
```

---

## 5. 점진 이전 (Strangler — **단일 원천 공유로 동기화 위험 제거**)

> 조사 교훈: 데이터 동기화가 최대 함정 · 첫 조각은 trivial · **삭제 기한 못 박기**.
> 핵심: 레거시는 이미 전역 `state` **하나**에 모여 있다 → 그 `state/persist/render` 3개를 **Zustand 스토어로 리다이렉트**하면 원천이 하나라 동기화 문제 자체가 없다. 레거시 DOM 쓰기는 **마운트 노드로 스코프**(React 루트 불침범).

| Phase | 작업 | 끝 상태 | 위험 |
|---|---|---|---|
| **0** | Vite+React+TS 스캐폴딩(옛 `/js`와 공존), `/api` 프록시, PWA, eslint-boundaries | "hello" 마운트 + `/api/ping` OK | 낮음 |
| **1** | `lib` 이식 + **zod 스키마/타입** + Zustand(+immer) 스토어 + TanStack Query 셋업 + 데이터 호환 라운드트립 테스트 | 순수 로직 Vitest 통과 | 낮음 |
| **2** | React 셸(Layout/Nav 중첩라우트/Theme/ErrorBoundary) + **cmdk 팔레트** + **레거시 어댑터**(store 리다이렉트) | 셸=React, 탭=옛 렌더 — 13탭 작동 | **높음**(어댑터·DOM 스코프) |
| **3** | 토큰+공용 컴포넌트 + **첫 조각: degreeReq(trivial) → items → today** | 3탭 React화, 새 디자인 | 중 |
| **4** | 앱상태 탭 일괄: schedule·routine·journal·review·stats·degree·settings (Zustand+셀렉터) | 표준 탭 전부 React | 중 |
| **5** | ✅ **서버/외부 탭: integrations·control·mastery (TanStack Query)** + 볼트/Anki 패널 | 전 탭 React(완료) | 중(외부 의존) |
| **6** | ✅ 옛 `js/*`·globalThis 어댑터 **삭제** · 네이티브 셸(나브/토스트/모달/액션) · vite-plugin-pwa 정식화 · 코드분할 | 순수 React 앱(완료) | 낮음 |

각 Phase 종료: **Vitest+RTL 통과 + Playwright 비주얼 회귀(라이트/다크) 통과.**
**삭제 기한**: Phase 5 종료 시점 = `legacy/` 제거 데드라인(이중 유지비 방지).

---

## 6. 배포·운영
- **개발**: Vite(프론트·HMR) + serve.js(/api) 2프로세스, Vite `server.proxy['/api']`로 동일출처처럼.
- **배포**: `vite build` → `dist/`. serve.js가 **(a) /api (b) 정적 dist (c) SPA history 폴백**(현재 404 내는 부분 → 미매칭 GET은 `index.html` 반환)으로 단일 출처. 딥링크 새로고침 깨짐 해결.
- **PWA**: vite-plugin-pwa(Workbox) — 셸 precache·자동 업데이트(현 stale 캐시 문제 해소). `/api`는 캐시 제외(NetworkOnly).
- **대용량 외부 데이터**(_지식상태·볼트 인덱스): Query 캐시(메모리)만, **localStorage 영속 금지**(쿼터 보호).

---

## 7. 명시적 비목표 (과설계 방지 — 세계적 판단 = 안 쓸 것을 아는 것)
- **No Next.js/SSR** — 로컬-퍼스트·FS Access·AnkiConnect·SEO불필요 → Vite SPA가 정답.
- **No Redux/Saga, No GraphQL, No 마이크로프론트, No 런타임 CSS-in-JS, No 데이터로더.**

---

## 8. 설계 검증: 세계적 시스템·표준과 대조
- **상태 분리(Zustand=UI/클라이언트, TanStack Query=서버)** — 2026 정설(“서버 데이터를 클라 상태에 복제 말 것”).
- **불변 업데이트(Immer)** — Redux Toolkit/Zustand 권장.
- **데이터 계약(zod)** — “아키텍처는 파일위치가 아니라 소유권·도메인경계·**데이터 계약**”.
- **Strangler Fig** — 단일 원천·trivial 첫조각·삭제기한(데이터 동기화 함정 회피).
- **FSD 단방향 의존 + eslint-plugin-boundaries** / bulletproof-react 베이스.
- **Radix·cmdk** — 접근성 프리미티브 표준(Linear/Vercel).

> 참고: Feature-Sliced Design, bulletproof-react, TanStack Query 가이드(“서버상태≠클라상태”), Strangler Fig(Martin Fowler) — 본 설계가 정렬됨.

---

## 9. 다음 액션
- [x] **Phase 0** 스캐폴딩(비파괴) — `web/`에 React+Vite+TS 셸. 레거시(`index.html`·`js`·`css`·`sw.js`·`serve.js`) 무손상. *(완료 2026-06-29)*
  - [x] `web/`: `package.json`·`vite.config.ts`(/api 프록시 → 127.0.0.1:8000, PWA 설치만·dev SW 비활성)·`tsconfig`(strict·`@/*`)·`eslint.config.js`(flat·boundaries 단방향) + `src/main.tsx`·`app/App`·`store/useApp`·`app/queryClient`
  - [x] 수용: `npm run build`(tsc -b + vite) OK · `npm run lint` 클린 + 역방향 import(lib→store) error 검출 · `/api/ping` 프록시 라운드트립 OK · 레거시 무손상
  - **개발 실행**: 터미널2개 — ① 루트 `node serve.js`(:8000, /api) ② `cd web && npm run dev`(:5173, HMR). **Vite는 `::1`(localhost)에 바인딩** → 브라우저는 `http://localhost:5173` 로 접속(127.0.0.1 아님).
  - **함정 기록**: `eslint-plugin-boundaries` v5는 Windows에서 rootPath(역슬래시)와 정규화 경로(슬래시) 불일치로 상대경로 변환 실패 → 패턴을 `**/src/<layer>/**`로(절대경로 매칭), import 해석은 `eslint-import-resolver-typescript` 필요. *(`web/eslint.config.js` 주석 참조)*
- [x] **Phase 1** lib 이식 + zod 스키마 + Zustand 스토어 + 데이터 호환 테스트 *(완료 2026-06-29)*
  - [x] `src/lib`: `schema.ts`(zod 데이터계약·z.infer 타입) · `types.ts` · `utils.ts` · `persistence.ts`(defaults·validShape·migrate·boot/persist·exportSnapshot·completions — KEY/SCHEMA_VERSION 불변) · `scheduler.ts`(schedule/layoutDay 전역→state 파라미터화) · `methodology.ts`(CBMS·요약·백지·백로그·주간·Anki카드 순수+뮤테이터) · `idb.ts`(브라우저 게이트 미러) · `api.ts`(타입드 /api)
  - [x] `src/store`: `useApp.ts`(boot로 부팅·디바운스 persist+IDB미러·얇은 액션) · `selectors.ts`(`useSchedule` 메모이즈드)
  - [x] **parity 검증**: `web/test`로 레거시 state.test(S1~11)·scheduler.test(T1~21) 이식 → **Vitest 32통과**. typecheck/lint/build OK. **레거시 node-vm 32통과 무손상**.
  - **주의**: 뮤테이터(addCbms 등)는 받은 state(=Immer draft)를 변형하고 persist/토스트/DOM은 안 함 — store/features가 조립. `vite.config`(플러그인)와 `vitest.config`(test) 분리 = vitest 중첩 vite 타입 충돌 회피.
- [x] **Phase 2** React 셸 + cmdk 팔레트 + 레거시 어댑터(store 리다이렉트) *(완료 2026-06-29)*
  - [x] **어댑터**(`src/legacy/load.js` + `load.d.ts`): 옛 `js/*`를 `src/legacy/js`로 벤더링 → main.js 순서대로 사이드이펙트 import(전역 표면 설치). 그 위에서 4개 전역만 리다이렉트 — `state`(스토어 부팅 객체와 **단일 공유**) · `persist`(원본 localStorage+IDB 호출 후 `useApp.setState`로 rev/통째교체 동기화) · `render`(현재 마운트 탭 노드만 재페인트 + `legacyNotify`) · `go/goGroup`(React Router navigate). `renderNav`=no-op(나브는 React). `app.js`·`main.js`·`ui-command.js`는 **제외**(부팅 render·오케스트레이션·손코딩 팔레트 → React/cmdk 대체).
  - [x] **React 셸**: `app/App`(라우트=레지스트리에서 생성·라우트별 `react-error-boundary`) · `app/Nav`(2단 중첩 나브, 레거시 `.navtop/.navchild`·아이콘 재사용) · `app/Header`(⋯메뉴·테마·가져오기는 레거시 전역 호출) · `app/ThemeProvider`(`state.theme`→`<html data-theme>`) · `features/LegacyTab`(레지스트리 경유 **단일 컴포넌트로 13탭 마운트** — 개별 포팅 X) · `components/CommandPalette`(cmdk, 명령=레지스트리+액션).
  - [x] **스토어 브리지**: `useApp`에 `rev`+`legacyNotify`(state 참조 불변 → globalThis.state 공유 안전). `subscribe`로 React 액션 시 globalThis.state 추종(양방향 sync).
  - [x] 수용: typecheck/lint/build OK(185모듈·레거시+lit-html 번들·style.css 동봉) · **Vitest 34통과**(lib 32 + RTL 스모크 2: jsdom에서 셸 마운트→레거시 `renderToday`/`renderItems`가 실제 `#page`를 채움→탭 라우팅 확인) · dev 서버 어댑터 체인 트랜스폼 200.
  - **함정 기록**:
    - `setAutoFreeze(false)`(immer) **필수** — 레거시는 공유 `state`를 in-place 변형. 기본 동결이면 변형 시 throw. `legacy/load`를 main.tsx 최상단에서 평가해 어떤 store action보다 먼저 끈다.
    - `legacyNotify`는 `s.rev`만 증가 → immer 구조공유로 `s.state` **참조 유지** → globalThis.state와 스토어가 같은 객체로 유지(가져오기/되돌리기처럼 통째 교체될 때만 persist override가 `s.state=cur`로 재동기화).
    - `#page` 노드는 React가 *소유만* 하고 비운 채 둠(`suppressHydrationWarning`) — 레거시가 innerHTML. 지역 재렌더가 `document.getElementById('page')`/`'itemCards'` 등 id에 의존하므로 id 보존.
    - 레거시 `.js`는 **tsc/eslint 제외**(`tsc` allowJs off로 무시·`eslint.config` `src/legacy/**` ignore). import는 `load.d.ts`가 타입 표면 제공(tsc는 `.d.ts`, vite는 `.js`).
    - 레거시 인라인 `onclick="fn()"`은 `Object.assign(globalThis,…)`로 window에 올라가 그대로 동작(ESM strict에서도 globalThis 속성은 bare 식별자로 읽힘 — 벤더링이 옛 동작 보존).
  - **개발 실행**: 터미널2개 — ① 루트 `node serve.js`(:8000) ② `cd web && npm run dev`(:5173). 브라우저 `http://localhost:5173`. **남은 검증**: 13탭 실제 브라우저 비주얼(라이트/다크)·볼트(FS Access)/Anki/제어판 외부연동은 사용자 환경에서 클릭 확인 권장(Playwright 비주얼 회귀는 Phase 3 도입).
- [x] **Phase 3** 토큰 레이어 + 공용 컴포넌트 + 첫 React화 탭(degreeReq→items→today) *(완료 2026-06-29)*
  - [x] **토큰 레이어**: `src/styles/tokens.css`(라이트 기본·다크·세피아 `:root[data-theme]` 변수만 — legacy/style.css와 동일 값, 별도 파일로 분리해 Phase 6 style.css 삭제 후에도 생존). `main.tsx`에서 style.css보다 먼저 로드(같은 변수·값 → 충돌 없음).
  - [x] **공용 컴포넌트**(`src/components/ui`, CSS Modules·토큰 참조·순수 프레젠테이션): `Card` · `Button`(variant/danger/sm) · `Pill`(good/warn/bad) · `Kpi`/`KpiGrid` · `ProgressBar` · `Table`(.box 하위 요소셀렉터로 스코프). 배럴 `index.ts`. boundaries상 components는 lib만 import.
  - [x] **레지스트리 분기**(`features/registry.tsx`): key→React 컴포넌트(lazy). `App` 라우트에서 React 구현 있으면 `Suspense`로 마운트, 없으면 `LegacyTab`. **탭 목록/순서/나브는 여전히 레거시 `listTabs()` 단일 원천** → 한 탭씩 교체.
  - [x] **degreeReq**(정적): 데이터 `features/degreeReq/data.ts`(타입화) + `DegreeReq.tsx`(공용 컴포넌트). **items**(앱상태): `Items`/`ItemCard`/`ChapterEditor` — 읽기 `useApp(s=>s.state.items)`, 변경 `store.mutate(recipe)`(immer draft 직접 변형, 디바운스 영속). **today**(파생): `Today`/`SetupGuide`/`TodayBlocks` — `useSchedule()` + `layoutDay`/`isDone`/`studyStreak`/`openBacklog`/`blankResultFor`(순수 읽기) + `toggleDone`/`setBlankResult`/`mutate(setRitual/clearBlankResult)`.
  - [x] **어댑터 확장**(`load.js`/`load.d.ts`): React 탭이 Phase 4 전까지 재사용할 레거시 UI 표면 — `ui`(toast/confirm/prompt/backupNow/toastUndo) + `journal`(prefillSummary/Cbms/Backlog: 아직 레거시인 기록 탭으로 이동+프리필).
  - [x] 수용: typecheck/lint(boundaries) OK · **Vitest 40통과**(lib 32 + RTL 8: degreeReq 1·items 3·today 2·shell 2) · `npm run build` OK(degreeReq/items/today 각 lazy 청크 분할). 구조 레이아웃은 레거시 전역 클래스(card/itemrow/fieldgrid/chaptbl/blk/glance…) 재사용(style.css 유지 중) + 인터랙티브/칩은 토큰 컴포넌트.
  - **함정 기록**:
    - CSS Modules는 **클래스/ID만 로컬화**, 요소(tag) 셀렉터는 글로벌 → `Table.module.css`는 `.box th/td`처럼 로컬 클래스 하위로 스코프(누수 방지).
    - 스텝퍼(+/-)·체크박스는 **controlled**(value/checked)여야 버튼 변경이 화면에 즉시 반영 — uncontrolled+defaultValue는 마운트 후 stale. `ItemCard`는 `memo`로 편집 중인 카드만 재렌더(immer 구조공유로 미변경 item ref 유지).
    - `getRitual`/`setRitual`은 state에 기본 객체를 **할당**(변형)하므로, 렌더 읽기에선 호출하지 말고 `state.rituals?.[ds] || {…}`로 직접 읽음(immer set 밖 변형 회피). 쓰기만 `mutate(st=>setRitual(st,…))`.
    - `state._ankiLive`는 zod `unknown` → `as AnkiLive`로 좁혀 사용(외부 상태는 Phase 5에서 TanStack Query로 정식화).
    - React 탭은 `#page`를 만들지 않음 → 레거시 `_activeRenderer`는 라우트 전환 시 `LegacyTab` 언마운트로 null(전역 `render()`는 legacyNotify만). degreeReq/items/today 라우트에서 `document.getElementById('page')===null`로 회귀 검증.
    - prefill 버튼은 `go('journal')` 후 DOM 조작인데 React navigate가 비동기라 포커스/스크롤 프리필은 안 될 수 있음(기록 탭 React화하는 Phase 4에서 해소). 이동 자체는 동작.
- [x] **Phase 4** 앱상태 탭 일괄 React화 — schedule·routine·journal·review·stats·degree·settings *(완료 2026-06-29)*
  - [x] **7개 탭**(`features/*`, lazy 청크 분할 · 레거시 전역 CSS클래스 재사용 + ui Button/Pill·토큰): **schedule**(파생: `useSchedule`+`layoutDay`/`dayStudyMin`/`studyMinByWeekday`, 개요/카드 뷰·주 네비·가용 인라인·완료체크`toggleDone`·마감카운트다운·`.ics` 신선도) · **routine**(가용바·수업/일과 블록 CRUD via `mutate`) · **journal**(요약/CBMS/백로그 폼·prefill 소비·로컬폼state) · **review**(계획대비실제·CBMS분포·백로그회수·주간체크) · **stats**(KPI·인출증거·유지율스파크·스트릭히트맵·CBMS레이더 SVG·과목표·주별막대·챕터타임라인 — lit-html 점진렌더는 React 키드렌더로 대체) · **degree**(요건·학기/과목 CRUD·GPA 인사이트·수강→학습항목) · **settings**(기본설정 + 유지보수).
  - [x] **어댑터 확장**: `load.js`에 `legacyFns`(planSignature·exportICS·backupToVault·exportJSON·restoreFromIDB·archiveOldData·exportAnki/Summary — 부수효과가 본질인 IO/다운로드/FS는 React로 안 옮기고 위임) + `journal` prefill을 레거시 DOM조작 → **`store/prefill.ts`**(today·journal 공유, features→store) 경유로 전환(Phase 3 미해소분 마감).
  - [x] 수용: typecheck/lint(boundaries) OK · `npm run build` OK(7탭 각 lazy 청크) · **Vitest 47통과**(lib 32 + RTL 15: degreeReq 1·shell 2·today 2·items 3 + **phase4 7**[7탭 각 마운트+변경→store 반영, #page 미사용]). shell의 레거시-#page 회귀 테스트는 `/schedule`→`/mastery`(Phase 5 잔여 레거시)로 교체.
  - **함정 기록**:
    - `getWeekly`/`setRitual`처럼 state에 기본값을 *할당*(변형)하는 헬퍼는 렌더에서 호출 금지 → `state.weekly?.[wk] || {checks:{},note:''}`로 직접 읽고, 쓰기만 `mutate(st=>setWeeklyCheck(st,…))`(Phase 3 getRitual 패턴 답습).
    - CSS 변수 인라인(`--c`)은 `style={{ '--c': v } as React.CSSProperties}`로 캐스팅(React CSSProperties가 임의 커스텀 속성 미허용).
    - `degree.courses`는 스키마가 느슨(`z.object({}).passthrough()`)해 화면용 로컬 `Course` 타입으로 좁혀 다룸(`as unknown as`).
    - 텍스트 입력은 **controlled + onChange마다 mutate**로 충분(디바운스 persist) — React 리렌더가 포커스/커서를 유지하므로 레거시의 silent-update+blur-render 분기는 불필요.
    - prefill은 nonce 증가로 같은 (form,sid) 재요청도 effect가 감지 → request 후 `go('journal')` 순서면 Journal 마운트 effect가 1회 소비(포커스/스크롤 포함).
  - **남은 검증**: Playwright 비주얼 회귀(라이트/다크)는 **아직 미도입**(Phase 5/6로 이월) — 7탭 실제 브라우저 비주얼·다크/세피아·`.ics`/볼트백업(FS Access) 클릭은 사용자 환경 확인 권장(터미널2개: `node serve.js` + `cd web && npm run dev` → `http://localhost:5173`).
  - **다음은 Phase 5**: 서버/외부 탭 — integrations·control·mastery(TanStack Query) + 볼트/Anki 패널. `legacy/` 삭제 데드라인.
- [x] **Phase 5** 서버/외부 탭 React화(TanStack Query) — integrations·control·mastery *(완료 2026-06-29)*
  - [x] **lib 이식**(프레임워크 무관·타입화): `lib/knowledge.ts`(fetchKnowledgeArtifact=/api·loadKnowledgeStateFromVault=FS + Knowledge 타입) · `lib/vault.ts`(loadVaultIndex·subjectsFromIndex·scanVaultFromFiles·pickAndScanVault·chaptersFromVault — FS Access 정본 _index.json 우선·.md 폴백) · `lib/anki.ts`(ankiConnect·fetchAnkiLive·pickAndScanAnki·totalDue). `lib/api.ts`에 `runTool` 추가. FS Access의 비표준 `entries()` async iterator는 좁힘 캐스팅.
  - [x] **Query 훅**(`store/queries.ts` — store에 둬 features·app 공유, store→lib 허용): `usePing`(제어판 연결상태) · `useKnowledge`(['knowledge'], 성공 시 `setRuntimeCache('_knowState')` write-through). `useApp`에 **`setRuntimeCache`** 액션 추가(런타임 캐시는 persist 제외 → 저장 스케줄 없이 state ref만 갱신).
  - [x] **3개 탭**: **mastery**(`useKnowledge` 자동 + 볼트 FS 수동로드를 `qc.setQueryData(['knowledge'])`로 같은 캐시에 주입 → 본문 렌더; 히트맵·프런티어·갭·캘리브레이션) · **control**(`usePing` 연결판정·오프라인 폴백 카드, 도구 실행은 `runTool` 직접+로컬 busy/log, '지식상태 재빌드' 성공→`invalidateQueries(['knowledge'])`→숙달도·스케줄러 graphPriority 자동 갱신, 탐구 수집 폼) · **integrations**(VaultPanel+AnkiPanel — 스캔결과는 `qc.setQueryData(['vault']/['ankiFile']/['ankiLive'])` 캐시, vaultHandle 공유, '+학습항목/+스케줄'은 store.mutate, 실시간 due는 `_ankiLive` write-through[오늘 KPI]+`recordRetentionSnapshot`[유지율 persist]).
  - [x] 수용: typecheck/lint(boundaries) OK · `npm run build` OK(3탭+queries 각 lazy 청크) · **Vitest 50통과**(lib 32 + RTL 18: 기존 8 + phase4 7 + **phase5 3**[mastery·control은 /api 없으면 우아한 폴백, integrations 두 패널 렌더, 모두 #page 미사용]). shell의 레거시-#page 테스트는 전 탭 React화로 "#page 미사용 확인"으로 전환.
  - **설계 노트(서버상태≠클라상태)**: 순수론은 "외부데이터를 앱상태에 복제 금지"지만, **스케줄러 graphPriority가 `state._knowState`를, 오늘 KPI가 `state._ankiLive`를 인엔진 소비**한다 → Query가 fetch 수명(로딩/에러/무효화)을 소유하되 그 결과만 **RUNTIME_CACHE_KEYS(비영속)로 write-through**하는 과도기 브리지를 택함. 레거시의 통째 복제+수동 `loadKnowledgeFromAPI` 배선은 제거(개선). 소비처(Today/scheduler)를 Query 훅으로 직접 전환하는 순수화는 후속 과제.
  - **함정 기록**:
    - 전 탭이 React가 되어 어댑터 `mountTab`(레거시 #page 렌더)은 *폴백으로만* 잔존 — 등록 탭 중 쓰는 건 없음. 레거시 `ui-*.js`의 renderXxx는 더 이상 호출 안 됨(레지스트리가 React로 라우팅). 단 **나브/탭목록은 여전히 레거시 `listTabs()` 단일 원천**이라 `legacy/js`는 Phase 6까지 잔존.
    - 외부 스캔 결과는 탭 전환에도 살아야 자연스러워 `useState` 대신 `queryClient.setQueryData/getQueryData`를 캐시로 사용(QueryClientProvider가 앱 루트 → 언마운트에도 보존).
    - jsdom 테스트엔 fetch가 상대경로 URL을 못 풀어 Query가 isError → 폴백 카드를 그대로 검증(서버 모킹 없이 폴백 UX 회귀 확인).
  - **남은 검증**: 실제 환경(serve.js·Anki·볼트 폴더) 클릭 확인 권장(jsdom 미커버). Playwright 비주얼 회귀는 여전히 미도입(Phase 6 이월).
  - **다음은 Phase 6**: 레거시 삭제 데드라인 — `js/*`·globalThis·`sw.js` 제거, 나브/탭 레지스트리를 React 네이티브로(현 `listTabs` 의존 해소), vite-plugin-pwa 정식화, 코드분할 마무리. (TS strict는 이미 적용 중.)
- [x] **Phase 6** 레거시 JS 런타임 제거 + 네이티브 셸 + PWA 정식화 *(완료 2026-06-29)*
  - [x] **레거시 전량 삭제**: `web/src/legacy/`(벤더링한 옛 `js/*` 13파일 + 어댑터 `load.js`/`load.d.ts`) 제거. `style.css`는 전역 클래스(.card/.kpi/.tl/.nav…)를 React 탭들이 재사용 중이라 **`styles/global.css`로 이동**(CSS 모듈화는 후속). 결과: `src`에 `.js` 0개·`globalThis` 표면·`setNavigate`/`mountTab`/`render` 디스패치·인라인 onclick 전무. 번들 **506→365KB**(gzip 164→121 · lit-html·레거시JS 제거).
  - [x] **네이티브 셸**(`src/shell/` — boundaries 무관 디렉터리, 옛 legacy/load와 동일 import 규약): `toast.tsx`(zustand+명령형 `toast`/`toastUndo` + `<ToastHost>`) · `modal.tsx`(Promise `confirm`/`prompt` + `<ModalHost>` · Esc/Enter/포커스) · `icons.tsx`(`<Icon>` 라인아이콘 맵) · `tabs.ts`(**네이티브 TAB 레지스트리** — 분산 registerTab → 단일 표; nav/팔레트 단일 원천) · `actions.ts`(데이터 액션: export/import JSON·undo·reset·backup·theme·ICS·anki/summary 내보내기·vault 백업·IDB 복구·아카이브 — store+lib+toast/modal 오케스트레이션) · `palette.ts` · `index.ts`(배럴: `ui`/`actions`/`legacyFns` 표면 유지 → feature 탭 import 무변경). `lib/ics.ts`(buildICS·planSignature 이식). 셸 컴포넌트(App/Nav/Header/CommandPalette/ThemeProvider)는 shell·React Router로 재배선, `LegacyTab` 삭제.
  - [x] **스토어 정리**: `useApp`에서 레거시 브리지(`rev`/`legacyNotify`) 제거 + `loadState`(통째 교체+즉시 영속) 추가. `setAutoFreeze(false)`를 store 모듈로 이관(파생 셀렉터의 인엔진 state 읽기 보호). `journal` prefill은 store/prefill+`useNavigate`로 인라인화(TodayBlocks).
  - [x] **PWA 정식화**(`vite.config`): `registerType:'autoUpdate'`+`injectRegister:'auto'`(stale 캐시 해소) · workbox `navigateFallback:index.html`(딥링크) + `/api` NetworkOnly(캐시 제외) · manifest 추가. dev SW는 비활성(HMR 간섭 회피).
  - [x] 수용: typecheck/lint(boundaries) OK · `npm run build` OK(전 탭 lazy 청크 + precache 28) · **Vitest 54통과**(lib 32 + RTL 22: 기존 18 + **phase6 4**[globalThis.state 브리지 부재·네이티브 나브+svg.ic·테마 토글→data-theme+토스트·확인 모달 취소→데이터 유지]). items 테스트의 globalThis.state 단일원천 단언은 스토어 기준으로 갱신.
  - **함정 기록**:
    - 토스트/모달은 모듈 싱글턴 zustand → 명령형 `toast()`/`confirm()`를 컴포넌트 밖(이벤트 핸들러·actions)에서 호출 가능. `<ToastHost>`/`<ModalHost>`는 App 루트에 1개씩.
    - 외부 데이터를 앱상태에 안 쓰는 원칙은 유지하되, 인엔진 소비분(_knowState·_ankiLive)은 Phase 5 write-through 그대로(완전 순수화는 후속).
    - 버튼의 접근성 이름은 text content가 우선(title 아님) — 테스트는 보이는 텍스트로 쿼리.
  - [x] **마감 정리(2026-06-29 · 비차단 항목 + 옛 앱 삭제 완료)**:
    - **① 전역 CSS 분해**: 단일 `global.css`(683줄)를 `styles/global/{theme,base,components,features}.css` + `index.css`(@import 캐스케이드 순서 보존)로 분해. **바이트 동일성 검증**(분해본 concat === 원본, 줄끝만 LF 정규화) · 빌드 CSS 청크 **해시 불변**(`index-BS4xFGi6.css` 39.44KB). 공유 클래스는 컴포넌트 스코프가 아니라 *앱 전역 디자인 시스템*이라 CSS Module(로컬화)이 아니라 정돈된 전역 파일로 둠(컴포넌트 고유 스타일은 이미 `components/ui/*.module.css`).
    - **② 옛 바닐라 앱 삭제 + 배포 컷오버**: 리포 루트 `index.html`·`js/`·`css/`·`sw.js`·`manifest.webmanifest`·`icon.svg`·`test/`(옛 node-vm 테스트) **제거**. `serve.js`를 **컷오버** — 정적 루트를 `web/dist`로, 미매칭 GET은 `index.html`(SPA history 폴백), `/api`(제어판)는 유지(검증: `/`→React·`/stats`→폴백·`/api/ping`→JSON·없는 자원→404·dist 없으면 `npm run build` 안내). serve.js는 백엔드(/api)로 계속 유지.
    - **③ Playwright 도입**: `@playwright/test`+chromium. `playwright.config.ts`(webServer=`vite preview`·maxDiffPixelRatio 0.02·animations off), `e2e/smoke.spec.ts`(3 — 나브·팔레트·테마·외부탭 폴백), `e2e/visual.spec.ts`(**18 비주얼 베이스라인** = 6탭[today/schedule/items/journal/degree/stats]×3테마[light/dark/sepia], `page.clock` 고정시각 + localStorage 시드로 날짜·데이터 결정성). 스크립트 `e2e`/`e2e:update`/`e2e:smoke`. e2e는 앱 tsc/lint/vitest 범위 밖(별도 러너).
    - **최종 수용**: typecheck/lint/build OK · **Vitest 54** · **Playwright 3 smoke + 18 visual** 전부 통과 · `src` 내 `.js` 0개·`globalThis` 표면 0.
  - **남은 선택 과제(차단 아님)**: 컴포넌트별 진짜 CSS Module화는 *디자인 재작성*에 가까워(공유 디자인 시스템 특성상) 보류 — 필요 시 비주얼 베이스라인을 안전망 삼아 점진 진행.
- [x] **Phase 7** 성능·UX·접근성 보강(프레임워크 최대 활용) *(2026-06-29)*
  - [x] **번들 분할**(`vite.config` build.rollupOptions.manualChunks): 단일 `index.js` **365KB(gzip 121)** → `react`(194KB·gzip 61, 거의 안 바뀜=장기 캐시) + `vendor`(132KB·gzip 44, router/query/zustand/immer/zod/cmdk) + 앱 셸(`index` ~54KB·gzip 22)로 3분할. 앱 코드 수정 시 사용자는 셸 청크만 재다운로드(나머지 326KB 캐시 유지) → 재방문 로딩↓.
  - [x] **React Compiler**(React 19, `babel-plugin-react-compiler@1.0.0` via `@vitejs/plugin-react` babel.plugins, target:'19'): 컴포넌트를 빌드타임에 자동 메모이제이션 → 수동 memo/useMemo/useCallback 없이 불필요한 리렌더 제거. 런타임은 react 내장(`react/compiler-runtime`)이라 별도 deps 0. *주의*: vitest는 `vitest.config`(컴파일러 미적용)로 동작 검증, 컴파일러는 빌드타임 최적화라 분리 유지.
  - [x] **라우트 프리페치**(`features/registry.tsx` `prefetchTab` + `Nav` hover/focus): lazy import 썽크를 보관해 나브 hover/focus 시 대상 탭 청크를 선로딩(모듈 캐시 dedupe) → 클릭 시 즉시 표시(Linear/Vercel급 체감).
  - [x] **View Transitions**(`Nav` `navigate(...,{viewTransition:true})` + `styles/global/motion.css`): 탭 전환 시 본문만 크로스페이드+살짝 떠오름, 헤더/네비는 `view-transition-name`으로 고정(깜빡임 제거). `prefers-reduced-motion` 존중. 미지원 브라우저는 라우터가 즉시 폴백.
  - [x] **Suspense 스켈레톤**(`components/ui/Skeleton`): 탭 청크 로딩 폴백을 "불러오는 중…" 텍스트 → 카드형 시머 스켈레톤(레이아웃 시프트·체감 지연↓, reduced-motion 존중).
  - [x] **Query 튜닝**(`app/queryClient`): `staleTime 60s`·`gcTime 30m`·`refetchOnReconnect:false` — 로컬-퍼스트라 외부 데이터(지식/볼트/Anki) 탭 왕복 시 재요청 안 함(무효화는 mutation이 명시).
  - [x] **접근성**: ① 나브 **방향키/Home/End 탐색**(WAI-ARIA tablist 자동 활성 + roving tabindex, 그룹·하위탭 각각) + 외곽 div를 `role=tablist`(무효 중첩) → `<nav aria-label>` 랜드마크로 교정. ② 모달 **포커스 트랩**(Tab 순환)·**포커스 복원**(열기 직전 요소로)·`aria-labelledby/describedby`. ③ 오류 토스트 `role=alert`(assertive).
  - [x] 수용: typecheck/lint(boundaries) OK · `npm run build` OK(react/vendor/셸 3청크 + 탭 lazy) · **Vitest 58**(기존 54 + **phase7 4**: 나브 ArrowRight/End·그룹 ArrowRight·모달 포커스복원+aria) · **Playwright 3 smoke + 18 visual 회귀 0**.
- [x] **Phase 8** 신규 기능(팔레트·단축키·대시보드·PWA) + 비주얼 베이스라인 교정 *(2026-06-29)*
  - [x] **① 명령 팔레트 고도화**(`shell/palette` + `shell/recent`): 액션 대폭 확장(테마 직접전환 3 · Anki카드/요약노트 오늘·전체 · 볼트백업 · IDB복구 · 아카이브 · 단축키도움말). **최근 실행 LRU**(`recent.ts`, localStorage)로 자주 쓰는 명령을 ⌘K 상단에 안정 정렬(Raycast 결). 선택 시 `recordRecent`.
  - [x] **② 전역 키보드 단축키**(`shell/shortcuts` + `App`): `g`→키 시퀀스 네비(t/s/i/j/r/a/m/d, 1.2s 시간창, 입력 중·수정자·팔레트 열림 시 무시) + `?` 치트시트(`components/ShortcutsHelp`, 헤더 변경 없이 팔레트 명령/커스텀이벤트로 노출 — fullPage 베이스라인 보호). `g` 누르면 후보 탭 프리페치.
  - [x] **③ 오늘 대시보드 히어로**(`features/today/TodayHero` + module.css): 인사 + **주간 달성률 도넛**(conic-gradient) + 통계 타일(블록·연속·Anki·보충) + **마감 임박 스트립**(D-14 이내·가까운 순·색칩 D-day). 중복 제거 위해 RitualCard의 glance 행은 히어로로 이관하고 의식 체크만 남김('오늘 한눈에'→'일일 의식').
  - [x] **④ PWA·오프라인 강화**: 설치 아이콘(`public/icon.svg` — SVG any+maskable 단일, 기존 manifest는 아이콘 0이라 설치 반쪽이었음) + manifest theme/배경/카테고리. **오프라인 배지**(`components/OnlineStatus`, online/offline 이벤트 구독·복귀 시 자동 해제). 업데이트는 기존 `autoUpdate`(무중단) 유지.
  - [x] **⑤ 비주얼 베이스라인 교정(중요)**: 기존 18 베이스라인이 lazy 탭 로딩을 안 기다려 **"불러오는 중…" 폴백 화면**을 찍고 있었음(안전망 무력) → `visual.spec`에 *탭 본문(h2/aria-label 섹션) 가시화 대기* 추가 후 18장 **실제 콘텐츠로 재생성**. 이제 진짜 회귀를 잡는다. (`reuseExistingServer:true` 함정: 옛 preview가 스테일 dist 서빙 → 재생성은 `CI=1`로 신선 서버 강제.)
  - [x] 수용: typecheck/lint OK · `npm run build` OK · **Vitest 60**(기존 58 + **phase8 2**: 히어로 달성률링+마감임박 D-6 · 팔레트 최근명령 상단) · **Playwright 3 smoke + 18 visual(실콘텐츠) 전부 통과·결정성 확인**.
  - [x] **⑥ ESLint react-hooks + react-compiler 가드(React Compiler 채택 완성)**: `eslint-plugin-react-hooks@7`(`configs.flat['recommended-latest']`) 추가 — rules-of-hooks·exhaustive-deps + **react-compiler purity 규칙**. 기존엔 hooks 린트가 아예 없었음(React 앱 견고성 갭). 가드가 **실제 버그 1건 검출**: `Schedule.tsx`가 렌더 중 `Date.now()` 호출(불순 → 컴파일러가 그 컴포넌트 메모이즈 포기) → 앱 정본 `todayISO(state)`(테스트 `_today` 존중)로 교체. CommandPalette useMemo는 `open ? cmds : []`로 정직화, Journal prefill effect는 의도적 부분구독을 disable 주석으로 명시. 결과 **lint 0 경고/에러** → 컴파일러 최적화 적용률 보장.
  - [x] **⑦ 차트 접근성·인터랙티브 툴팁**: 네이티브 `title`(터치·키보드·SR 취약)을 **앱 전역 위임형 툴팁**(`components/Tooltip` `<TooltipHost>`)으로 대체 — `data-tip` 속성만 붙이면 hover/focus에 스타일된 fixed 툴팁(위임이라 히트맵 셀 수백 개도 핸들러 1쌍, 레이아웃/베이스라인 불변). 데이터 시각화성 `title`을 `data-tip`+`aria-label`(SR)로 교체: Stats(유지율 스파크·스트릭 히트맵·CBMS 레이더 꼭짓점·주별 막대) · Mastery(상태분포·과목 히트맵·캘리브레이션·프런티어 의존칩) · Schedule(주개요 요일셀) · Review(계획대비실제 칸) · TodayBlocks(단계 막대) · ItemCard(진행 미니바). 이산 요소(스파크 막대·레이더 점)는 `tabIndex=0` 키보드 포커스. 버튼류 `title`은 텍스트·aria-label 보유라 보조 용도로 유지. (포커스 가시성은 전역 `:focus-visible`가 이미 처리 — 키보드 작업 전부 가시.)
  - [x] **⑧ 단축키 확장**: `[` / `]` = 이전/다음 탭 순환(숨김 제외, 현재 경로는 이벤트 시점 `window.location` 직접 읽어 stale 방지). 치트시트(`shell/shortcuts`)에 추가.
  - [x] 최종 수용: typecheck/lint **0** · build OK · **Vitest 62**(+툴팁 hover/out · +`[`/`]` 탭순환) · **Playwright 3 smoke + 18 visual 회귀 0**.
- [ ] **Phase 9** CSS Module 완전 전환(composes) — *진행 중(슬라이스 단위, 항상 녹색)* *(2026-06-29 착수)*
  - **방침**: 전역 `styles/global/*.css`의 *클래스 기반 디자인 시스템*을 `styles/ds.module.css`(+컴포넌트별 `*.module.css` `composes`)로 스코프화. **요소·`:root` 토큰·리셋(input/table/button/body/h*/`:focus-visible`)은 전역 base 레이어로 유지**(CSS Modules는 클래스/ID만 스코프 — 이게 정석). 전환 중 전역 사본과 공존, 소비처 이전 완료 후 전역 정의 제거.
  - **결합 지도(전환 순서를 좌우)**: `itemrow/itemhead/itembody/fieldgrid/chaptbl`(아코디언)=**items↔degree 공유** · `.day/.tl/.wkcol/.weekgrid`=schedule/today/review 공유 · `.glance/.ritual-*`=today · `.kpi .v`·`.day .dh .dt` 등 100+ 하위결합 선택자는 같은 모듈에 묶어 이전. 총 ~600 className 편집/~30파일. 비주얼 베이스라인은 6/13탭 커버(나머지 7탭은 수동 확인 필요).
  - [x] **슬라이스 1**: `ds.module.css` 토대(card·row·muted·tiny·foot·empty·swatch·pill[+tones]·bar·kpis/kpi[+v/l]·warnbox[+bad]·tag[+variants]·seg·spin — 값 드리프트 0, @keyframes는 `ds-` 접두로 스코프) + 앱 셸 폴백(main.tsx·App.tsx TabFallback)을 ds로 전환(버튼은 `<Button>` 컴포넌트). typecheck/lint/build/**Vitest 62** 그린. 패턴(import ds·`${ds.a} ${ds.b}` 조합) end-to-end 증명.
  - [x] **슬라이스 2**: 아코디언 그룹(itemrow/itemhead/chev/itemname/itemmeta/minibar/itembody/itemfoot/fieldgrid/fld/chapwrap/chaptbl/bulkwrap — items↔degree 공유)을 ds.module로 중앙화 + **degree 탭 완전 전환**. **degree 비주얼 3종 픽셀 동일 검증**(전 게이트 그린).
    - ⚠ **핵심 발견(소스 순서 함정)**: CSS Modules도 같은 특이도면 *생성 CSS의 소스 순서*가 승자를 정함. 첫 시도에서 `pill tiny` 조합이 11.5px→11px로 바뀌어 baseline 실패 — 원본은 `.tiny`가 `.pill`보다 뒤라 tiny가 이겼는데 모듈에선 앞에 둬 pill이 이김. **ds.module 클래스 정의 순서를 원본 components.css→features.css 순서와 동일하게 유지**해야 픽셀 동일(모듈 헤더에 규칙 명시). 이후 슬라이스도 이 순서 규칙 준수.
  - [x] **슬라이스 3**: **items 탭 완전 전환**(Items·ItemCard·ChapterEditor) — 아코디언은 ds 재사용, `draghandle`(tr[draggable] 결합)만 ds에 추가(`tr[draggable]:hover .draghandle`은 요소/속성이라 전역 유지+`.draghandle`만 스코프). **items 비주얼 3종 픽셀 동일** + Vitest 62(items RTL 포함) 그린. (펼친 편집영역은 baseline 미커버지만 RTL이 렌더 검증.)
  - [x] **슬라이스 4**: **journal 탭 완전 전환**. 기록카드+CBMS 그룹(rec·recHead·rec3·blOpen·cbmsChip·cbmsRow·cbmsTrack — journal↔review 공유)을 ds.module에 중앙화하되 **하이픈명(rec-head 등)을 camelCase로**(CSS Module 키 접근 모호성 회피·전역 하이픈 클래스는 review 전환 전까지 잔존). 컴포넌트 prop `ds`(날짜)는 모듈명 충돌 피해 `dsKey`로 개명. **journal 비주얼 3종 픽셀 동일** + Vitest 62 + 전체 e2e 21 그린.
  - [x] **슬라이스 5**: **today 탭 완전 전환**(Today·TodayBlocks·SetupGuide) + **`features/today/Today.module.css`** 신설(today 전용: ritual/princ/blkhead/stagebar/setup* — 하이픈→camelCase). 공유 표준 `blk`·`input.donechk`는 ds로(today↔routine, today↔schedule 공유). 발견: `glance`/`gl-v`는 **죽은 코드**(hero가 대체), `ritual-card`는 **CSS 규칙 없는 no-op**(드롭). 함정: 지역 `const ds`(날짜)가 import `ds`(모듈)와 섀도잉 → `ds2`로 개명(journal과 동일 패턴). **today 비주얼 3종 픽셀 동일**(셋업·hero·의식·블록·stagebar 포함) + 전체 e2e 21·Vitest 62 그린.
    - **아키텍처 확립**: 공유 표준 클래스 → `ds.module`, feature 전용 → `<Feature>.module.css`. 결합 수정자(rowdone/mn 등 feature 컴포넌트에 엮인 것)는 해당 feature 모듈에 로컬 정의(cross-module descendant 불일치 회피).
  - [x] **슬라이스 6**(최난도 결합): **schedule 탭 완전 전환**. 주간/타임라인 그룹 전체(day·dh·dt·cap·body·tl[+tm/nm/mn/free/block/nowline/rowdone]·weekgrid[+overrides]·wkstrip·wkcol[+sel/today/wd/dd/colBar/colH/colSub]·wkdot·ddrow·ddaychip·todaychip·tag.blank/mock)를 ds.module에 중앙화(schedule·stats[tl]·review[dh]·routine[daychip/cap]·today 공유). 주차 네비 raw `<button>`→`<Button>`, seg 버튼은 `.seg button` 스타일 유지 위해 raw 유지+`ds.on`. 함정: `computeDay`의 지역 `ds`(날짜)·StudyRow prop `ds`→`ds2`/`dsKey`(모듈 섀도잉). col-bar/col-h/col-sub→camelCase. **schedule 비주얼 3종 픽셀 동일**(개요+카드뷰) + Vitest 62 + 전체 e2e 21.
  - [x] **슬라이스 7**: **stats 탭 완전 전환** + `features/stats/Stats.module.css`(히트맵 hm* — stats 전용, camelCase). 나머지(kpi·card·tl·pill·bar·swatch·muted·tiny·foot·empty)는 ds 재사용. 지역 날짜변수 `ds`→`ds2`/`dsk`(섀도잉 회피). **stats 비주얼 3종 픽셀 동일**(KPI·인출증거·히트맵·레이더·과목표·주별막대·타임라인 전부) + Vitest 62 + 전체 e2e 21.
  - [x] **슬라이스 8**: **routine 탭 완전 전환** + `features/routine/Routine.module.css`(wkbars/classrow/blkrow/daychip/days/daysep — routine 전용). 공유(card/seg/muted/tiny/foot/empty)는 ds, raw `sm` 버튼→`<Button>`(seg 버튼은 raw+`ds.on`). **검증 강화**: routine을 **비주얼 베이스라인에 추가**(전환 전 렌더로 baseline 생성 → 전환 후 픽셀 동일 확인). 이제 **visual 21 = 7탭×3** + smoke 3 = **e2e 24**. Vitest 62 그린.
  - [x] **슬라이스 9**: **settings 탭 완전 전환**(전부 공유 클래스 → 전용 모듈 불필요). `chk-row`(settings↔review 공유)를 ds로(`chkRow`). settings를 baseline에 추가(전환 전→후 픽셀 동일). **e2e 27**(visual 24 = 8탭×3 + smoke 3). Vitest 62.
  - [x] **슬라이스 10**: **외부데이터 탭 3개 전환**(mastery·control·integrations[VaultPanel+AnkiPanel]) + 전용 모듈 3개(`Mastery.module.css` ms*+i.dot · `Control.module.css` ctl* · `Integrations.module.css` tree). 공유 `chip`(control/mastery/review)을 ds로. 함정: AnkiPanel 지역 `ds`(decks 배열)가 import `ds` 섀도잉 → `dks`로 개명. **외부 3탭 baseline 추가**(폴백 상태, 전환 전→후 픽셀 동일). **e2e 36**(visual 33 = 11탭×3 + smoke 3). Vitest 62.
  - [x] **슬라이스 11**: **review 탭 전환**(놓쳤던 탭) + `Review.module.css`(pa* 계획대비실제 차트 — review 전용). cbms*/rec/recHead/blOpen/chkRow는 ds 재사용, raw `sm` 버튼→`<Button>`. **degreeReq는 전역 클래스 0**(이미 Card 컴포넌트+자체 DegreeReq.module.css) — 추가작업 불필요. review baseline 추가. **e2e 39**(visual 36 = 12탭×3 + smoke 3). Vitest 62.
    - 함정: CSS 주석 안 `cbms*/chkRow`의 `*/`가 주석을 조기 종료 → 빌드 실패. 주석에서 `*/` 시퀀스 금지(가운뎃점으로 교체).
  - [x] **슬라이스 12(마감 클린업)**: 전역 CSS에서 ds/feature 모듈로 이전된 **죽은 클래스 정의 일괄 삭제**. `components.css`는 요소 규칙(label/input/button/table/details/hr/:focus-visible)만, `features.css`는 앱 크롬(menu/toast/modal/scrollbar/reduced-motion)만 남김. 죽은 코드 제거: `cmd-*`(CommandPalette 자체 모듈 소유)·`navsep`·`heatcol`·`cols`·`#page`/`fadeUp`·`glance`/`gl`. App "알 수 없는 탭" 폴백 `card`→ds.
    - **아키텍처 결정(전역 유지가 정석)**: **앱 셸 크롬은 전역 base 레이어로 유지** — Header(top/menu)·Nav(nav 그룹)·`wrap`·shell 싱글턴(toast/modal)·`ic`(아이콘 프리미티브)·`button.primary/.ghost/.sm/.danger`(헤더·모달 raw 버튼). 이들은 *재사용 디자인 시스템*이 아니라 **단 한 번 쓰이는 싱글턴/요소 수정자**라 스코프 불필요(`.nav .ic`처럼 전역 `.ic`에 의존하기도 함). 완전 모듈화 앱도 base 레이어는 전역으로 둠.
    - **결과**: 전역 CSS 클래스 정의 **201 → 27**(크롬+버튼 수정자만). 남은 className 문자열은 전부 크롬. **CSS 글로벌 번들 41.2KB → 35.96KB**(디자인 시스템은 ds.module + feature 모듈 청크로 이동).
  - [x] **Phase 9 완료 수용**: typecheck/lint **0** · build OK · **Vitest 62** · **Playwright 39**(visual 36 = **12탭×3테마 전부 픽셀 동일** + smoke 3). 13개 탭 전부 + 공유 디자인 시스템(`ds.module.css`)이 CSS Module화. 전역은 tokens·element/reset·앱 크롬만.
    - **방식 요약**: 공유 표준→`styles/ds.module.css`(composes/직접참조), feature 전용→`<Feature>.module.css`, 결합 수정자→해당 feature 모듈 로컬, 앱 크롬/요소/토큰→전역 base. 검증=전환 전 baseline 캡처→전환 후 픽셀 동일(미커버 탭은 전환 전 baseline 신규 추가). 함정: 모듈 내 클래스 **소스 순서**가 캐스케이드 승자 결정(pill/tiny)·지역변수 `ds` 섀도잉·CSS 주석 `*/`·하이픈명 camelCase.
