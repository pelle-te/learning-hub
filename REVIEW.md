# 전면 코드 리뷰 — 러닝허브(hub)

> ## ✅ 처리 완료 (2026-08-20)
>
> **46건 전량 착수 · 44건 그대로 수정 · 2건은 실측으로 범위 조정**(아래 §처리 결과).
> 게이트 전량 녹색: `verify`(codegen·typecheck·lint·lint:css·check:tokens·compiler:ratchet·
> format·knip·coverage) · `audit` · `server verify`(실 workerd+D1 왕복 27) ·
> `tauri:fmt`/`clippy`/`test`(75) · `build`+`budget`(4축) · `e2e`(167+5) · `e2e:a11y`(65) ·
> `e2e:shell`(트랙 B · 9). **유닛 2028 · 스냅샷 회귀 0.**
>
> 아래 본문은 **수정 전** 진단이다(그대로 둔다 — 무엇을 왜 고쳤는지의 근거다).


- 대상: `D:\atelier\hub` @ `5f2a6fc` (v0.5.1) · **604 파일 / 106,842줄**
- 방법: 0단계 전체 파악(직접) → 1단계 4축 독립 병렬 리뷰(서브에이전트) → 2단계 통합·재검증(직접)
- 읽음 대장: [`review-manifest.md`](./review-manifest.md)
- ⚠ 아래 모든 `file:line` 은 통합 시점에 **다시 열어 확인**했다. 재현하지 못한 주장은 버렸다.

---

## 총평

세계 최고 수준 코드베이스의 리뷰어가 이 저장소에서 먼저 볼 것은 코드가 아니라 **검증 체계**다.
그 축은 통과선 위에 있다 — 게이트 4잡(web·secret-scan·cloud-server·shell-build), 실물 workerd+D1
왕복, 실 exe 를 띄우는 트랙 B, axe 64화면, 모션 중간프레임 회귀, 번들 예산 4축, 기한부 SCA 원장,
GitHub Action SHA 핀 + 체크섬 대조. 레이어 단방향은 린트가 error 로 집행하고, 순수/IO 분리는
실측상 실제로 지켜진다(`lib/**` 130모듈 중 이식 불가는 4개). 이 정도의 자기검증을 갖춘 개인
프로젝트는 드물다.

**통과선 대비 현재 위치: approve 아님 — changes requested.** 이유는 결함의 *양*이 아니라 *형태*다.
발견된 Major 14건 중 **10건이 "이 저장소가 이미 진단하고 처방까지 적어 둔 문제의 재발"** 이다.
`events.ts` 는 N+1 을 고치고 실측표까지 주석에 남겼는데 그 뒤 같은 함수에 들어온 `tasks` 는
그 인덱스를 안 받았다. `methodology.ts` 는 CBMS 열거 드리프트를 "봉쇄했다"고 선언했는데 네 번째
사본이 **백업 복원 필터**에 생 리터럴로 산다. `degree.ts` 는 "두 뷰가 공유하는 단일 출처"라
적었는데 화면이 삼항 사슬을 글자단위로 복제했다. 즉 이 코드베이스의 문제는 **판단력이 아니라
판단의 내구성**이다 — 결론을 산문에 적고 집행자를 안 붙인다. 그리고 저장소 자신이 그 진단을
`stylelint`·`knip`·번들예산 도입 근거에서 세 번 적었다. 처방이 일부 축에만 적용됐다.

두 번째 축은 **래칫이 현상에 맞춰져 있다**는 것이다(실측: `cognitive-complexity` 임계 62 vs
현행 최댓값 59, `max-lines` 727 vs 720). 임계가 최악값 + ε 이면 게이트는 아무것도 지키지 않고,
가장 자주 바뀌는 파일(`TodaySignature.tsx` — 7주간 50커밋 · 936줄 · 복잡도 59)이 정확히 그
사각에 있다. 이 리뷰의 Major 중 하나(M-2, 44px 앵커가 시간에 반응하지 않음)가 그 파일에서 나왔다.

**Critical 0건.** 데이터 손실·보안 침해·즉시 장애를 유발하는 결함은 찾지 못했다. 경로 조작·셸
인젝션·SQL 인젝션·토큰 검증 누락·리소스 누수는 축1이 전수 확인 후 **전부 기각**했다(근거는 §버린 가설).
가장 무거운 두 건(M-1·M-6)은 도달 조건이 특정되지만 아직 잠복이다.

### 커버리지

| | 수 | 비율 |
|---|---|---|
| ✅ 전량 정독 | 99 | 16.4% |
| 🟡 구조 열람(머리주석 + 전 export 시그니처 + 인용 구간 재확인) | 299 | 49.5% |
| ✅ **[미열람]** | **0** | — 제출 시점 206 · 2026-08-20 전량 해소 |

[미열람] 206의 최대 덩어리는 `web/test/**` 169개(27,037줄 중 축2가 대형·핵심 14개 6,236줄만 전량
정독)였다. **제출 시점의 이 리뷰에는 미열람 파일을 근거로 한 지적이 하나도 없었다.**

⚠ 그 206은 이후 사용자 지시로 **전량 정독해 해소**했고(정독 99 → **305**), 그 구간에서 Major 둘이
나왔다 — 문서 맨 아래 「[미열람] 206 정독」 절이 그것이다. 원 커버리지 표는 *제출 시점의 사실*이라
지우지 않고 이 줄로 갱신 사항만 얹는다.

---

## 근본 원인 (3개)

### R1 — 선언이 곧 집행이 아니다: SSOT·관용구·계약을 **산문으로 선언하고 집행자를 안 붙인다**

이 저장소는 "규약을 관습에 두면 흘러내린다"를 스스로 세 번(stylelint · knip · 번들예산) 적었고
그때마다 집행자를 만들었다. 그런데 그 처방이 적용되지 않은 축이 남았고, 거기서 결함이 나온다.

| 선언 | 실제 |
|---|---|
| `lib/degree.ts:3` "두 뷰가 공유하는 단일 출처" | `features/degree/Degree.tsx:542-550` 이 삼항 사슬 복제 (M-8) |
| `lib/methodology.ts:115` CBMS 재선언 드리프트를 "**봉쇄**" | `lib/persistence.ts:293` 에 네 번째 사본 (M-7) |
| `lib/weekAlloc.ts:282` "훅은 껍데기가 되고, 팔레트도 같은 것을 부른다" | 스토어 어댑터 3벌 + 계약 무시 변종 1 (M-9) |
| `lib/events.ts:107-132` 날짜 인덱스 관용구 + 실측표 | 같은 함수의 `tasks` 축은 안 받음 (M-3) |
| `eslint.config.js:346` "cross-feature import는 전부 별칭을 쓰고" | 상대경로는 **에러 0건** (m-3) |
| `src-tauri/src/vault.rs:21` "프런트 `SKIP` 과 같아야 한다" | 집행자 0 — 주석이 유일한 방어 (m-11) |
| `test/invariants.test.ts` 가 13번 세운 규율 | 13번째(불변식 ⑬)가 그 규율을 안 받음 (m-16) |
| `store/usePageChrome.ts:96` `exhaustive-deps` off + 손 deps | 20 호출부 중 1곳이 틀림 (M-2) |
| `lib/cloud/outbox.ts:201-220` M-18 의 `Promise.all` + 근거 주석 | 서버 pull 은 여전히 순차 (m-8) |
| `scheduler/priority.ts:108-118` H29 의 `parseISO` 캐싱 | **바로 이웃** `engine.ts:86` 은 안 받음 (n-3) |

**처방의 형태는 이미 저장소 안에 있다** — `codegen:check`(부모 스키마 대조) · `invariants.test.ts`
(소스를 스캔하는 테스트) · `audit-allowlist`(기한부 판단 원장). 선언을 할 때 이 셋 중 하나를
붙이는 것이 규율이 되어야 한다.

### R2 — 주석이 **코드의 수·상태·소유자를 손으로 적고**, 그 주석이 판단의 전제로 쓰인다

이 저장소는 주석을 계약으로 쓴다(그래서 품질이 높다). 그 대가로 **낡은 주석은 장식이 아니라
실제 결함**이다. 그리고 저장소는 "수를 적지 마라"를 여러 번 규율로 세웠는데 계속 적고 있다.

- `src-tauri/src/tools.rs:3` "화이트리스트 **11종**" ↔ **같은 파일 96행** "11 → 7" (자기모순)
- `web/src/lib/api.ts:66` 이 **존재하지 않는 산출물 `index`** 를 유효 인자로 광고 → 쓰면 404 →
  `classifyArtifact` 가 "미생성"으로 분류 → **오류가 정상 빈 상태로 보인다**
- `scheduler/priority.ts:63,88` · `engine.ts:158` "기본 off → 영향 0" ↔ `persistence.ts:182`
  `graphPriority: true` → **그 근거로 과목당 cbms 800건 전량 스캔이 검토 밖에 남았다**
- `app/useMarkSeen.ts:5` 가 **은퇴한 `SubTabs`** 를 소비처로 가리킴 → 표시 쪽이 사라질 때 판정
  (`lib/since.ts`)과 시점(`useMarkSeen`)이 안 걷혀 **아무도 안 읽는 값을 매 내비마다 영속**한다
- `src-tauri/src/vault.rs:95` 이 `chars().take(1600)`(문자)를 쓰면서 "선두 1600**바이트**만 보는
  프런트와 동형"이라 적는다 — **불일치를 알아본 뒤 반대로 서술했다**
- `scheduler/windows.ts:168` "점유 없는 날 = 창 계산 자체를 생략(**핫패스 비용 0**)" — 그 판정
  자체가 이미 `tasks` 전량 스캔이다
- 그 외 개수·상태 표류 6곳(`App.tsx:150` · `RailSidebar.tsx:250` · `CommandPalette.tsx:133` ·
  `api.ts:94` · `vite.config.ts:65` · `test/phase5.test.tsx:11-12`)

### R3 — 임계를 **현상에 맞춰 조정하고**, 그 유예에 만료일이 없다

저장소는 "기한부 판단" 관용구를 갖고 있다(`audit-allowlist.json` 의 사유+만료일, a11y `알려진위반`).
그런데 아래 넷은 그 형식을 안 받았다.

| 노브 | 값 | 현행 최댓값 | 결과 |
|---|---|---|---|
| `sonarjs/cognitive-complexity` | 62 | **59** (`TodaySignature.tsx:194`) | 20 초과 함수 **35개** 전량 면제. 신규 코드도 59까지 자유 |
| `max-lines` | 727 | **720** (`features/review/Review.tsx`) | 여유 7줄. 파일은 한도까지 자란다 |
| `asyncUtilTimeout` / `testTimeout` | 5,000 / 15,000 | — | 테스트 17개가 `App` 전체를 마운트하는 **원인**을 안 고치고 예산을 5배 늘림. `test/_setup.ts` 가 근본 처방을 명시적으로 유예 |
| `test/today.test.tsx` | 벽시계 수용 | — | 결정성을 포기했고, 그 대가가 파일 안에 두 번 기록됨(토요일에 깨짐 · 저녁에 깨짐) |

⚠ 커버리지 임계(69/68/55/59)는 여기 넣지 않았다 — "관측 최저치 아래"라는 근거가 flaky 방지로
타당하고, 그 판단이 주석에 정확히 적혀 있다.

---

## 지적 목록

### Critical

없음.

---

### Major

#### M-1 · [축1] pull 이 상한 초과 배치에서 **영구 교착**한다 — 도달 조건은 마이그레이션이 만든다

**`web/src/lib/cloud/schema.ts:130-137` + `:219`** · 비용 **S**

`OutboxBatchSchema` 가 `total > MAX_BATCH_ITEMS`(500)를 **거부**하고, `parseInboundBatch:219` 가
그 스키마를 **수신에도 그대로** 적용한다. 그런데 서버는 정당하게 500을 넘길 수 있다 —
`server/src/pull.ts:53-57` 이 같은 스탬프 그룹을 쪼개지 않고(`fetchGroup`) 통째로 주고,
`contract.ts:194` 의 `taken > 0` 가드가 첫 그룹을 상한 초과해도 담으며, 그 신호인 `oversized` 를
**아무도 읽지 않는다**.

실패 경로: 클라가 throw → `isPermanent` 거짓 → `run.ts` `failed` → `commitPullMark` 미도달 →
**`since` 가 영원히 그 자리** → 다음 트리거마다 같은 배치로 같은 자리에서 죽는다. 자가복구 없음.
화면에 남는 것은 "동기화 실패" 한 줄이다.

**도달 조건을 코드로 특정했다**: `src-tauri/migrations/006_backfill_stamps.sql` 이 7개 테이블의
모든 레거시 행을 `updated_at = 1` **상수**로 올린다(시계를 안 쓰는 것은 의도된 옳은 결정이다).
즉 레거시 행 전량이 **단일 스탬프 그룹**이고, 그 합이 500을 넘는 기기에서 **두 번째 기기의
첫 전량 pull 이 영구 실패**한다.

이건 push 축이 `chunkBatch`(H2)로 이미 고친 결함의 수신 방향 판박이다 — 그 함수 머리주석이
*"`capBatch` 는 통째로 담고 `parseOutboxBatch` 는 거부한다 → `blocked`"* 라고 적은 구조가
pull 쪽에 처방 없이 남아 있다.

```ts
// schema.ts — `OutboxBatchSchema` 에서 건수 상한 검사를 뺀다(fence·열 개수·k2 규약은 그대로)
-    const total = b.rows.length + b.tombstones.length;
-    if (total > MAX_BATCH_ITEMS) {
-      ctx.issues.push({ code: 'custom', message: `배치가 상한을 넘었다: ${total} > ${MAX_BATCH_ITEMS}`, input: ctx.value });
-    }

// 그리고 **송신 경로에만** 남긴다
export function parseOutboxBatch(input: unknown): { ok: true; batch: OutboxBatch } | { ok: false; error: string } {
  const r = OutboxBatchSchema.safeParse(input);
  if (!r.success) return { ok: false, error: issueLine(r.error) };
  const total = r.data.rows.length + r.data.tombstones.length;
  /* ⚠ 상한은 **보내는 쪽** 계약이다 — 서버는 스탬프 그룹을 쪼갤 수 없어 정당하게 넘길 수 있고
     (`pull.ts` fetchGroup · `capBatch` 의 taken>0 가드), 수신에서 거부하면 그 기기의 pull 이
     영구 정지한다. push 축에서 H2 가 고친 것과 같은 형태다. */
  if (total > MAX_BATCH_ITEMS) return { ok: false, error: `배치가 상한을 넘었다: ${total} > ${MAX_BATCH_ITEMS}` };
  return { ok: true, batch: r.data as OutboxBatch };
}
```

> Critical 이 아닌 이유 한 줄: 로컬 정본은 무사하고 데이터 손실이 없다 — 잃는 것은 동기화 진행뿐이다.

#### M-2 · [축2] `TodaySignature` 의 44px 앵커가 **시간이 흘러도 갱신되지 않는다**

**`web/src/features/today/TodaySignature.tsx:539-542`** · 비용 **S**

```ts
usePageChromeEffect(
  () => chromeFor({ cap, streak, todayDone, todayTotal, allDone, hasItems, res, nearestDday, goPlanToday, go }),
  [todayDone, streak, nearestDday, todayTotal, allDone, hasItems, res.adaptApplied, res.adapt],
);   // ← cap 이 deps 에 없다
```

`chromeFor` 의 `primary`(= 이 화면 최상위 앵커)는 **오직 `cap.slackMin` 만** 읽는다(`:881-889`).
그리고 `cap` 은 `freeMinAfter(freeIntervals, nowMin)` 파생이고 `useAdaptiveTick(30_000)`(`:225`)이
30초마다 리렌더를 강제한다 → **여유는 30초마다 줄어드는데 이펙트는 안 돈다.** 상단 바는 8개 deps 중
하나가 마지막으로 바뀐 시점(대개 마운트)의 값을 하루 종일 붙들고 있다. `오늘 여유 1.2h` 를
*"다음 행동을 가장 많이 바꾸는 한 수"* 라 정의하고 세운 앵커가 **시간에 반응하지 않으면 그 값이 없다.**

집행자가 못 잡는 이유는 구조다 — `usePageChromeEffect` 는 계약상 `exhaustive-deps` 를 끈다
(`store/usePageChrome.ts:96` 의 `eslint-disable-next-line`). 손 deps 목록이 유일한 방어선이다.

```ts
usePageChromeEffect(
  () => chromeFor({ cap, streak, todayDone, todayTotal, allDone, hasItems, res, nearestDday, goPlanToday, go }),
  // ⚠ 앵커가 읽는 값을 deps 에 넣는다 — `cap` 은 매 렌더 새 객체라 참조가 아니라 그 스칼라로.
  [cap.slackMin, todayDone, streak, nearestDday, todayTotal, allDone, hasItems, res.adaptApplied, res.adapt],
);
```

재발 방지는 API 쪽이 옳다 — `usePageChromeEffect(build, deps)` 를 값 기반(`usePageChromeEffect(value)`)
으로 바꾸면 목록 자체가 사라진다. **20 호출부 중 이 하나만 틀렸다는 사실이 "손 목록은 언젠가 틀린다"의 증거다.**

#### M-3 · [축4] `tasks` 가 스케줄러 일자 루프에서 N+1 — `events` 가 이미 고친 결함의 부활

**`web/src/lib/tasks.ts:153-163` · `:168-173`** (호출: `scheduler/windows.ts:139-140` ← `:167`·`:201` ← `engine.ts:89`) · 비용 **S**

`taskIntervals` 는 호출마다 `state.tasks` 전량 선형 스캔 + `Array.sort()`, `untimedChoreMin` 은
전량 reduce 다. 소비 경로가 `dayStudyMin` ← **일자 생성 루프**(horizon+1 ≈ 547회)라 곱해진다 —
`schedule()` 1회당 tasks 전량 스캔 **≈1,680회**. 그리고 `schedule()` 은 `SCHEDULE_INPUT_KEYS` 20개
슬라이스 중 하나만 바뀌어도 재실행되므로 **체크 한 번·타이핑 한 글자마다** 그 값을 낸다.

`lib/events.ts:107-132` 가 정확히 이 결함을 H15 에서 진단하고 날짜 인덱스 + 모듈 버전 카운터로
고쳤다(머리주석에 실측표까지: *"일정 2000 / days 901 = **29.52ms**"*). 그런데 N-1(W8)이
**같은 함수 `dayOccupancy` 에 `tasks` 를 넣으면서 인덱스를 안 만들었다.** 한 함수 안에서
두 축이 서로 다른 방식으로 산다.

부수: `windows.ts:168` 의 *"점유 없는 날 = 창 계산 자체를 생략(핫패스 비용 0)"* 은 **거짓**이다 —
그 판정(`dayOccupancy`) 자체가 이미 전량 스캔이다(→ R2).

```ts
// lib/tasks.ts — events.ts 의 관용구를 그대로 복제한다(새 관용구를 만들지 않는 것이 요점)
let tkVersion = 0;
/** 이 모듈의 쓰기 API 가 부른다 — 날짜 인덱스를 무효화한다(`events.ts` 의 `bumpEvents` 와 같은 이유:
 *  참조 동일성만으로는 제자리 변형 경로에서 낡은 인덱스가 조용히 살아난다). */
function bumpTasks(): void { tkVersion++; }   // add/set/remove 뮤테이터 끝에 호출

const EMPTY_INTERVALS: [number, number][] = [];
let tkCache:
  | { src: unknown; version: number; timed: Map<string, [number, number][]>; untimed: Map<string, number> }
  | null = null;

function tkIndex(state: AppState) {
  const src = state.tasks;
  if (tkCache && tkCache.src === src && tkCache.version === tkVersion) return tkCache;
  const timed = new Map<string, [number, number][]>();
  const untimed = new Map<string, number>();
  for (const t of src || []) {
    if (t.done || !t.min) continue;
    if (t.start == null) { untimed.set(t.ds, (untimed.get(t.ds) ?? 0) + Math.max(0, t.min)); continue; }
    if (!Number.isFinite(t.start) || !Number.isFinite(t.min)) continue;
    const s = Math.max(0, Math.min(1439, Math.round(t.start)));
    const e = Math.min(1440, s + Math.max(1, Math.round(t.min)));
    if (e <= s) continue;
    const list = timed.get(t.ds);
    if (list) list.push([s, e]); else timed.set(t.ds, [[s, e]]);
  }
  for (const list of timed.values()) list.sort((a, b) => a[0] - b[0]);
  tkCache = { src, version: tkVersion, timed, untimed };
  return tkCache;
}

export function taskIntervals(state: AppState, ds: string): [number, number][] {
  return tkIndex(state).timed.get(ds) ?? EMPTY_INTERVALS;
}
export function untimedChoreMin(state: AppState, ds: string): number {
  return tkIndex(state).untimed.get(ds) ?? 0;
}
```

> ⚠ 캐시 배열을 그대로 돌려주게 되므로 소비처가 변형하지 않아야 한다 — `windows.ts:141` 의
> `dayOccupancy` 는 이미 `[...ev, ...tk]` 로 새 배열을 만들고, `subtractIntervals` 도 새 배열을 만든다(확인함).

#### M-4 · [축4] `latestBlank` 이 복습 블록마다 `blankResults` 전량을 다시 훑는다

**`web/src/lib/scheduler/priority.ts:34-45`** (호출: `engine.ts:242` · `dayPlanOverride.ts:62`) · 비용 **S**

`latestBlank(state, sid)` 는 `(blankResults, sid)` 의 순수 함수이고 sid 는 과목 수(8)만큼만 있다.
그런데 `pushReviewTasks` 가 **new 블록을 놓을 때마다** 부른다 — 자동 경로(`engine.ts:331` 일자×modLeft)
+ 배분 경로(`:283` 주×7×8) + manual 날(`dayPlanOverride.ts:62`, 최대 400) ≈ **1,600~2,700회** ×
200건 = 32~54만 반복/`schedule()`. `reviewViaAnki` 기본값이 `false` 라 이 경로는 항상 산다.
`dayPlanOverride.ts:50-53` 의 `state.items.find(...)` 도 블록마다 다시 돈다.

```ts
// engine.ts — weekly 조립 직후 과목별로 한 번만
const blankBySid = new Map<string, boolean | null>();
for (const s of weekly) blankBySid.set(s.id, latestBlank(state, s.id));
// pushReviewTasks 안:  const blank = blankBySid.get(s.id) ?? null;

// dayPlanOverride.ts:38 — 루프 밖으로
const itemById = new Map((state.items || []).map((x) => [x.id, x]));
const dlIdxOf = (sid: string): number => {
  const it = itemById.get(sid);
  return it?.deadline ? dayDiff(start, it.deadline) : Infinity;
};
const blankCache = new Map<string, boolean | null>();
const blankOf = (sid: string): boolean | null => {
  let v = blankCache.get(sid);
  if (v === undefined) { v = latestBlank(state, sid); blankCache.set(sid, v); }
  return v;
};
```

#### M-5 · [축4] `ShiftContext` 가 **자기 주석의 계약을 지키지 않는다**

**`web/src/lib/spacedReview.ts:218-241` · `:263-265`** (+ `lib/chapterStrength.ts:90-103`) · 비용 **M**

`ShiftContext` 는 *"한 번 만들어 여러 챕터에 재사용한다(**과목 스캔 반복 방지**)"* 라고 선언한다.
`failing`·`cbmsByChapter`·`leeches` 셋은 실제로 1회지만 `strong`·`coef` 만 **클로저**라 호출 시점에
계산되고, `chapterShift:263-265` 는 같은 `(sid, chapter)` 로 `chapterStrength` 를 **두 번** 부른다.
그 함수는 매번 `blankResults` 전량 `.filter().sort()` 다.

`chapterReviews:331-346`(챕터 상한 200 · 캐시 없음 · 소비처 8곳)에서
**200 × 2 × 200 = 8만 반복 + 400 filter 할당 + 400 sort**. `examStaleChapters:659` 는 컨텍스트를
한 번 더 만든 뒤 `chapterReviews`(그 안에서 또 만든다)를 불러 같은 호출에 컨텍스트가 두 벌이다.

```ts
// lib/chapterStrength.ts — 배치판을 추가한다(단건판은 소비처가 있으니 유지)
export function chapterStrengths(state: AppState, todayDs: string): Map<string, ChapterStrength> {
  const rows = new Map<string, { ds: string; passed: boolean }[]>();
  for (const b of state.blankResults || []) {
    const chapter = (b.chapter || '').trim();
    if (!b.sid || !chapter) continue;
    const k = b.sid + '|' + chapter;
    const g = rows.get(k);
    if (g) g.push({ ds: b.ds, passed: !!b.passed });
    else rows.set(k, [{ ds: b.ds, passed: !!b.passed }]);
  }
  const touches = state.reviewTouches || {};
  const out = new Map<string, ChapterStrength>();
  for (const [k, tries] of rows) {
    tries.sort((a, b) => (a.ds < b.ds ? -1 : a.ds > b.ds ? 1 : 0));
    const lastTouchDs = touches[k] || null;
    const passes = tries.filter((t) => t.passed).length;
    const lastPassed = !!tries[tries.length - 1]!.passed;
    out.set(k, {
      attempts: tries.length, passes, lastPassed, lastTouchDs,
      daysSince: lastTouchDs ? dayDiff(lastTouchDs, todayDs) : null,
      band: !lastPassed || passes * 2 < tries.length ? 'shaky' : 'strong',
    });
  }
  return out;
}

// lib/spacedReview.ts:230 — 클로저를 Map 조회로
export function shiftContext(state: AppState, todayDs: string): ShiftContext {
  const strengths = chapterStrengths(state, todayDs);
  const at = (sid: string, chapter: string): ChapterStrength =>
    strengths.get(sid + '|' + chapter) ??
    { attempts: 0, passes: 0, lastPassed: null, lastTouchDs: null, daysSince: null, band: 'unseen' };
  return {
    failing: failingSids(state, todayDs),
    cbmsByChapter: latestCbmsByChapter(state, todayDs),
    leeches: new Set(leechChapters(state, todayDs, Infinity).map((l) => l.sid + '|' + l.chapter)),
    strong: (sid, chapter) => at(sid, chapter).band === 'strong',
    coef: (sid, chapter) => chapterCoefficient(at(sid, chapter)),
  };
}
```

> ⚠ 폴백이 단건판의 `UNSEEN`(`lastTouchDs: null`)과 **동형**이어야 한다 — `features/items/Subject.tsx:145` 가 그 판을 계속 쓴다.

#### M-6 · [축1] `redo` 가 "행을 만든 편집"에 대해 **항상** 실패한다 — 그리고 거짓 사유를 말한다

**`web/src/lib/cloud/undo.ts:143`** · 비용 **S**

```ts
pushOpposite(await currentImages(rows, tombstones), entry.stamp);   // ← 원본 쓰기의 스탬프
```

반대편 스택에 **원본 쓰기의 스탬프**를 싣는데, 그 항목을 적용할 때의 툼스톤 가드는 `:106-108` 의
`deleted_at > entry.stamp` 다. `nextStamp()` 는 단조라 **역연산이 방금 찍은 툼스톤이 언제나 그 조회에 걸린다.**

재현: ① 할 일을 **추가** → flush 가 pre-image `{vals: null}` 을 `S1` 로 쌓는다 ② ⌘Z → `p.vals === null`
이므로 **툼스톤**을 `S2 = nextStamp() > S1` 로 낸다(`:129`), redo 스택은 `stamp = S1` ③ ⇧⌘Z →
`blocked` 가 그 툼스톤을 담아 `skipped++`, `rows`·`tombstones` 둘 다 비어 `drop` ④ 아무것도 복원되지
않고 토스트는 **"1건 중 1건은 다른 기기가 지워 되돌리지 않았어요."**(`store/undoController.ts:135`) —
다른 기기는 관여한 적이 없다. 항목이 소비돼 재시도도 불가능하다.

**검증 공백도 확인했다**: `web/test/cloudUndo.test.ts` 는 `it(` 13개인데 문자열 `redo` 가 **0회**다.
redo 경로 전체가 미검증이다.

```ts
  let inverseStamp = 0;                       // ← 이 역연산이 찍은 최대 스탬프
  for (const p of entry.rows) {
    // …
    const stamp = nextStamp();
    if (stamp > inverseStamp) inverseStamp = stamp;
    // …
  }
- pushOpposite(await currentImages(rows, tombstones), entry.stamp);
+ /* ⚠ 기준선은 **이 역연산의 스탬프**다 — `entry.stamp` 를 쓰면 방금 우리가 만든 툼스톤이
+    반대 방향의 가드에 걸려 자기 재실행을 막는다(추가→⌘Z→⇧⌘Z 가 항상 실패했다). */
+ pushOpposite(await currentImages(rows, tombstones), inverseStamp);
```

#### M-7 · [축3] CBMS 코드 열거의 **네 번째 사본**이 백업 복원 필터에 있다 — "봉쇄했다"는 주석 옆에서

**`web/src/lib/persistence.ts:293`** · 비용 **S**

```ts
const CBMS = new Set(['C', 'B', 'M', 'S', 'T']);   // 생 리터럴 · 어느 정본과도 결속 0
```

같은 열거가 `schema.ts:183`(`CbmsCodeSchema` · 타입 SSOT) · `methodology.ts:106`(`CBMS_INFO` ·
`Record<CbmsCode,…>` 라 타입이 강제) · `methodology.ts:117`(`CBMS_CODES`)에 있고, `:115-116` 이
*"각자 `['C','B','M','S','T']` 를 재선언하던 드리프트 위험을 **봉쇄**"* 라고 선언한다.

`sanitizeImported` 는 **가져오기 경로의 필터**다. 여섯 번째 코드를 추가하면 `CBMS_INFO` 는 TS 가
키 추가를 강제하지만 이 `Set` 은 아무 신호도 안 낸다 → 그 코드가 붙은 오답 레코드가
**백업 복원에서 통째로 삭제된다.** 복원이 데이터를 지우는 형태이고, 그 사실을 옆 주석이 부정한다.

```ts
import { CbmsCodeSchema } from './schema';
const CBMS = new Set<string>(CbmsCodeSchema.options); // 열거 정본 = schema.ts
```

> `uiState.ts:34` 의 `AccentSchema.options` 가 같은 관용구다(순환 없음 — `persistence → schema` 는 기존 방향).
> 그리고 `methodology.ts:115-116` 의 "봉쇄" 문장을 사실로 만들려면 `CBMS_CODES` 도 같은 파생으로 바꾼다.

#### M-8 · [축3] `categoryReq` 가 화면에 한 벌 더 인라인 — 한국어 라벨이 로직을 지고 타입 결속이 0

**`web/src/lib/degree.ts:159-161` ↔ `web/src/features/degree/Degree.tsx:542-550`** · 비용 **S~M**

같은 삼항 사슬이 글자단위로 두 벌이고, `degree.ts:3` 은 *"두 뷰가 공유하는 단일 출처"* 라 적는다.
더 나쁜 축은 타입이다 — `CourseSchema.category` 는 `z.string()`, `CATS` 는 `as const` 없는 `string[]`.
라벨 하나를 다듬으면(`'교양'` → `'교양·기초'`) 셀렉트는 새 라벨을 주고 과목은 그 값으로 저장되는데
**두 분기 모두 `0`(요건 없음)으로 조용히 떨어진다** → 진행바가 중립화되고 졸업 요건이 사라진 것처럼
보인다. 컴파일 에러 0 · 테스트 0.

```ts
// lib/degree.ts — 라벨을 타입으로 승격하고 매핑을 표로 (표가 있으면 라벨 변경이 컴파일 에러가 된다)
export const CATS = ['전공필수', '전공선택', '교양', '기타'] as const;
export type DegreeCat = (typeof CATS)[number];

const REQ_FIELD: Record<DegreeCat, 'reqMajorReq' | 'reqMajorSel' | 'reqLiberal' | null> = {
  전공필수: 'reqMajorReq', 전공선택: 'reqMajorSel', 교양: 'reqLiberal', 기타: null,
};
export function categoryReq(d: Degree, cat: string): number {
  const f = REQ_FIELD[cat as DegreeCat];
  return f ? d[f] : 0;
}
```

그리고 `Degree.tsx:543-550` → `const req = categoryReq(d, cat);`

#### M-9 · [축2] 주간 배정 레버의 **스토어 어댑터가 3벌**이고, 네 번째는 이미 계약을 어겼다

**`web/src/features/review/Review.tsx:370-374` · `web/src/shell/actions.ts:612-616` · `web/src/app/CommandPalette.tsx:452-455`** · 비용 **S**

세 곳이 문자 그대로 같다: `mutate(st => { const t = st.items.find(x => x.id === id); if (t) t.weeklyHours = bumpWeeklyHours(...) })`.
산술만 `lib` 으로 내려갔고 "찾아서 쓴다"는 세 층에 남았다. `Review.tsx:361` 은 자기가 *"E-4 레버 SSOT"*
라 선언하고 `lib/weekAlloc.ts:282` 는 *"팔레트도 같은 것을 부른다"* 라 선언한다 — 둘 다 사실이 아니다.

그리고 네 번째 변종이 이미 벗어났다: `actions.ts:636`("이번 주 쉼")은 `setWeekly(0)` 으로
**`bumpWeeklyHours` 를 건너뛴다** — 그 함수 머리주석의 *"하한이 0 인 것도 계약이다"* 가 지금은
한 호출부에서만 강제된다.

```ts
// lib/weekAlloc.ts — 순수 recipe 추가(스토어 무지 · `mutate(s => addBacklog(s, …))` 와 같은 관용구)
/** 주간 배정 조정의 단일 진입점. `delta` 는 시간, `set` 은 절대값('이번 주 쉼'=0). */
export function applyWeeklyHours(s: AppState, sid: string, op: { delta: number } | { set: number }): number | null {
  const it = s.items.find((x) => x.id === sid);
  if (!it || it.mode === 'daily') return null;   // 레버가 없는 과목은 무동작
  it.weeklyHours = 'set' in op ? Math.max(0, op.set) : bumpWeeklyHours(it.weeklyHours, op.delta);
  return it.weeklyHours;
}
```

세 호출부는 `mutate((s) => applyWeeklyHours(s, sid, { delta: 1 }))` 한 줄이 되고 "이번 주 쉼"은 `{ set: 0 }` 이 된다.

#### M-10 · [축2] 복습 러너 상태기계 복제 → **이어하기 커서가 단방향이다**

**`web/src/phone/ReviewView.tsx`(쓰기 0건) ↔ `web/src/features/review-run/ReviewRun.tsx:441-442` · `:374-376`** · 비용 **M**

두 러너가 `queue / idx / gotKeys / revealedAt` + `advance()` + `restart()` + 착지 클램프를 각자 든다
(클램프는 `phone/ReviewView.tsx:73` 과 `ReviewRun.tsx:329-331` 이 문자 그대로 같다). 문제는 복제 자체가
아니라 **이미 갈렸다**는 것이다 — 커서 **쓰기**가 데스크톱에만 있다(전 저장소 `writeResume` 호출부는
`app/useLeaveCursor.ts`·`ReviewRun.tsx`·`store/useFocus.ts` 셋뿐). 반면 폰은 커서를 **읽는다**
(`phone/PhoneApp.tsx:84-86`, `phone/TodayView.tsx:49-54`).

증상 둘, 둘 다 무증상으로 진행된다:

1. 폰에서 7장 하고 PC 를 열면 **0장부터** 연다 — `lib/resume.ts:4-6` 이 이 기능의 존재 이유로 든
   *"틀리면 같은 걸 두 번 한다"* 를 기능이 절반만 막는다.
2. 폰에서 세션을 **끝내도** `dropResume()` 이 안 돈다 → 커서가 TTL 6시간 동안 살아 PC·폰 홈에
   `이어하기 (7/12)` 유령 칩이 뜨고, 누르면 이미 끝낸 큐의 7번째로 착지한다.

`phone/TodayView.tsx:134` 는 *"폰이 이 기능의 주 수혜자다"* 라 적는데 폰은 순수 소비자다.

```ts
// lib/reviewSession.ts (신설 · 순수) — 착지·전진·재큐 + 커서 판정만. IO 는 호출부.
export const landingIndex = (startAt: number, len: number): number =>
  Math.max(0, Math.min(startAt, Math.max(0, len - 1)));
export type RunAction = { t: 'advance'; didIt: boolean } | { t: 'reveal' } | { t: 'restart'; queue: RunItem[] };
export function runReducer(s: RunState, a: RunAction): RunState { /* requeue·gotKeys dedupe */ }
/** 5장마다 쓰고 마지막 장에서 지운다 — 판정만 준다. */
export function cursorOp(idx: number, len: number): { kind: 'write'; progress: string } | { kind: 'drop' } | null
```

양쪽이 `useReducer(runReducer, …)` + `cursorOp` 결과를 `writeResume`/`dropResume` 에 흘린다.
데스크톱 고유(JOL·undo 스냅샷·인출 지연·CBMS)는 러너에 남는다 — 그건 실제로 다른 기능이다.

#### M-11 · [축2] `useApp` 의 영속 엔진이 클로저라 **지수 백오프가 무검증**이다

**`web/src/store/useApp.ts:136-299`** · 비용 **M**

디바운스·rebase 큐·병합창 지연·**지수 백오프 재시도**·localStorage 폴백·언로드 안전망·멀티탭 수신이
전부 `immer((set, get) => { … })` 안의 지역 클로저다. 밖에서 잡을 손잡이가 `mutate`/`flushNow` 둘뿐이라
분기 행렬을 단위로 못 친다.

실측 커버리지: `test/saveFailure.test.ts:24-51` 은 **브라우저 가지만** 검사하고,
`test/dbUnavailable.test.ts:153-165` 는 `writeFailed` 경로를 타지만 배너+임시사본만 단언한 뒤
`sleep(600)` 하고 끝난다. `retryMs` / `PERSIST_RETRY_MAX_MS` / `pending = [...borrowed, ...pending]`
를 건드리는 테스트는 **0건**이다.

`useApp.ts:254-262` 는 자기 주석에 위험을 명시한다 — *"400ms 고정 재시도는 시간당 9,000회 전량
쓰기가 된다."* 누가 백오프 승수를 되돌리거나 성공 경로의 `retryMs = 0`(`:220`)을 잘못 옮기면
`dbUnavailable.test.ts` 는 **그대로 통과한다**(실시계 600ms 안에 몇 번 썼는지 아무도 안 센다).

```ts
// lib/db/persistEngine.ts (신설 · 순수 · React·zustand 무지)
export interface EngineDeps {
  write: (s: AppState, o: { undo: boolean }) => Promise<WriteResult>;
  schedule: (ms: number) => void;              // 타이머 주입 — 테스트는 가짜를 준다
  onFallback: (lost: boolean, s: AppState) => void;
}
export function createPersistEngine(d: EngineDeps) {
  let retryMs = 0;
  return {
    /** 반환값이 곧 다음 예약 간격(0=예약 없음) — 단위 테스트는 이 수열만 보면 된다. */
    async flush(s: AppState, pending: Recipe[], captureUndo: boolean): Promise<{ nextMs: number; requeue: Recipe[] }> {
      /* … */
    },
  };
}
// → expect(seq).toEqual([400, 800, 1600, …, 30000, 30000]) 한 줄로 백오프가 잠긴다.
```

#### M-12 · [축2] 컴포넌트 테스트 **17개가 전부 `App` 전체를 마운트**한다 — 예산 5배 인상이 그 대가였다

**`web/test/{degreeReq,forecastTab,goalsTab,guideTab,items,ledgerTab,monthCalendar,phase4..8,planLanding,reviewRunTab,shell,statsTab,today}.test.tsx`** · 비용 **M**

`renderApp()` 12줄이 17개 파일에 문자 그대로 복사돼 있다(인자 이름만 `initialPath`/`path` 로 갈린다).
탭 하나를 검사하려고 라우터 + 레일 + TopBar + 오버레이 + 부팅 이펙트 + lazy 청크를 매번 돌린다.
그 대가를 저장소가 이미 지불했다 — `test/_setup.ts` 가 `asyncUtilTimeout: 5_000`, `vitest.config.ts`
가 `testTimeout: 15_000` 이고, 그 파일이 근본 처방을 *"케이스 다수를 고쳐야 하고, 그건 이 커밋의
범위가 아니다"* 로 유예했다.

진단이 반쪽이다. 원인은 Suspense 를 안 기다리는 것이 아니라 **Suspense 를 탈 필요가 없는 검사가
`App` 을 통과하는 것**이다. 반례가 같은 트리에 있다 — `test/allocBoard.test.tsx:82` 는
`<MemoryRouter><AllocBoard/></MemoryRouter>` 로 feature 를 직접 렌더하고 42케이스를 역할/라벨
질의로만 잠근다(lazy 없음 · QueryClient 없음).

```tsx
// test/_render.tsx (신설)
export function renderApp(path: string) { /* 지금의 12줄 · 여기 한 벌만 */ }

/** 라우터·쿼리만 두르고 feature 를 직접 렌더한다. App(레일·TopBar·부팅 이펙트·lazy)을 안 태운다. */
export function renderTab(ui: React.ReactElement, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
```

셸 자체(라우팅·레일·활성 표기)를 보는 `shell`·`phase6`·`phase7` 만 `renderApp`, 나머지 14개는
`renderTab(<Stats/>, '/stats')` 로 내린다. 그러면 위 두 예산 인상의 근거가 사라진다.

#### M-13 · [축2] 픽스처가 5벌이고, 그중 하나는 **자기가 틀린 줄 모른 채** 벽시계에 묶여 있다

**`web/test/today.test.tsx:37-46`** (+ `scheduler.test.ts:10-33` · `weekAlloc.test.ts:33-52` · `ics.test.ts:10-31` 이 바이트 동일) · 비용 **M**

`today.test.tsx` 가 두 번 물린 뒤 이렇게 결론지었다:

> *"`_today` 를 못박는 우회로는 **안 통한다**(시도했다): `schedule()` 의 날짜 범위는 실시계에서 오고
> `todayISO(state)` 만 시드를 따르므로, 둘이 갈려 오늘이 계획 범위 밖으로 나간다."*

**이 결론이 틀렸다.** `lib/scheduler/engine.ts` 에 `new Date()`·`Date.now()` 는 0건이고 날짜 범위는
`state.startDate` 에서 온다(`engine.ts:36`). 갈린 진짜 이유는 `defaults()` 가 `startDate: iso(new Date())`
로 **실시계를 굽기** 때문이고(`lib/persistence.ts:127,140`), 시드가 `_today` 만 못박고 `startDate` 는
안 못박아서다. 같은 트리의 두 파일이 그걸 제대로 한다 — `allocBoard.test.tsx`(둘 다) · `dayPlans.test.ts:30-31`(둘 다).

결과: 결정성을 포기했고 그 대가가 파일 안에 두 번 기록됐다 — 토요일에 깨졌고(`:44-52`),
저녁에 깨졌다(`:106-113`, *"저녁에 게이트를 돌렸다면 늘 실패했을 테스트"*).

```ts
// test/_fixtures.ts (신설 · e2e/_fixtures.ts 와 같은 자리매김)
export const subject = (over: Partial<Item> = {}): Item =>
  ItemSchema.parse({
    source: '직접', mode: 'weekly', weeklyHours: 6, dailyMin: 30, deadline: '',
    chapters: [{ id: 'c1', name: '1장', hours: 10, done: false }], ...over,
  });

/** ⚠ `_today` 와 `startDate` 를 **함께** 못박는다 — 하나만 시드하면 계획 창이 실시계로 열려 결정성이 깨진다. */
export const appState = (over: Partial<AppState> = {}): AppState =>
  ({ ...defaults(), startDate: '2026-06-22', _today: '2026-06-23', routine: [], ...over }) as AppState;
```

> ⚠ 픽스처는 **실제 스키마로 파싱해서** 만든다 — `allocBoard.test.tsx:32` 가 이미 그 규율을 적었고,
> 그 파일 하나에만 있다(지어낸 모양이 `sanitize` 에 걸러지는 사고 방지).

#### M-14 · [나] 래칫 둘이 **현행 최댓값 바로 위**에 고정돼 아무것도 지키지 않는다

**`web/eslint.config.js:95` · `:119`** · 비용 **M**

실측(`npx eslint src --rule '{"sonarjs/cognitive-complexity":["error",20]}'`, 2026-08-20):
20 초과 함수 **35개**. 상위 — 59 `features/today/TodaySignature.tsx:194` · 56 `lib/db/rows.ts:389`
(`stateToRows`) · 49 `lib/scheduler/engine.ts:33` · 45 `lib/spacedReview.ts:272` ·
43 `lib/scheduler/dayPlanOverride.ts:38` · 42 `lib/db/rows.ts:220` · 38 `phone/ReviewView.tsx:64` ·
37 `lib/persistence.ts:291`. 임계는 **62**.
`report:debt` 실측 최대 파일 720줄(`features/review/Review.tsx`), `max-lines` 한도 **727**.

임계가 관측 최댓값 + ε 이면 ① 기존 최악 8개가 영구 면제되고 ② 신규 코드가 59까지 자유롭다.
이 저장소는 같은 상황에 대한 규율을 이미 적었다 — *"큰 삭제 뒤 한도를 함께 내린다 — 여유 33% 면
게이트가 아무것도 안 지킨다"*(`CLAUDE.md` W4). 번들 예산에는 적용됐고 여기엔 안 됐다.

그리고 이 사각이 실해를 냈다: 7주간 churn 1위(50커밋)이자 복잡도 1위(59)인 `TodaySignature.tsx` 에서
**M-2** 가 나왔다.

```js
// eslint.config.js — 분포 기준으로 바꾸고, 초과분은 기한부 판단으로 명시한다
'sonarjs/cognitive-complexity': ['error', 25],
// + 초과 8건은 파일별 override 에 **사유 + 재검토 만료일**과 함께
//   (= audit-allowlist·a11y 알려진위반과 같은 관용구. 새 개념이 아니다)
```

---

### Minor

| # | 축 | 위치 | 문제 | 수정 | 비용 |
|---|---|---|---|---|---|
| m-1 | 3 | `web/src/lib/api.ts:66` | 독스트링이 **존재하지 않는 산출물 `index`** 를 유효 인자로 광고. `artifact.rs:21-35` `ARTIFACTS` 는 5종. 쓰면 404 → `classifyArtifact` 가 "미생성"으로 분류 → **오류가 정상 빈 상태로 보인다**. 타입도 안 막는다(`name: string`) | 인자를 `Exclude<ArtifactName,'index'>` 로 좁히고, 주석에서 "fetch 가능 5종"과 "스키마 6종" 네임스페이스를 가른다 | S |
| m-2 | 3 | `src-tauri/src/tools.rs:3`·`:174` · `workspace.rs:4`·`:125` | "도구 11종 / 산출물 8종·6종" — 실측 `TOOLS`=7, `ARTIFACTS`=5. `tools.rs:3` 은 **같은 파일 96행**("11 → 7")과 모순. `capabilities.ok` 의미 전환 **논증 전체가 그 수 위에** 서 있다 | 수를 지우고 상수를 가리킨다(`TOOLS` · `artifact::ARTIFACTS`) | S |
| m-3 | 2 | `web/eslint.config.js:349-365` | 절대규칙 #4(feature 끼리 import 금지)를 **상대경로가 통과**한다(축2 eslint 프로브 실측: 별칭 ✅에러 · 타입전용 ✅ · 동적 ✅ · `../alloc/Alloc` ❌**0건**). 주석이 "전부 별칭을 쓴다"는 **관습**을 전제로 삼는다. 현재 실제 위반 0 | `patterns` 에 `{ group: ['../*/*','../../features/*','../../features/*/**'], message: '…' }` 추가(코드 변경 0) | S |
| m-4 | 2 | `web/src/lib/since.ts`(65) · `predictionScore.ts`(125) · `app/useMarkSeen.ts` · `store/useUI.ts:139-143` | 프로덕션 소비처 **0**인 모듈 2개(테스트만 import). 더 나쁜 것은 `since` 의 **쓰기 경로는 살아서 매 내비게이션마다 돈다** — `seenAt` 을 **읽는 코드가 전 저장소에 없다**(실측: 스키마 기본값1·쓰기2·주석2). 원인은 `useMarkSeen.ts:5` 가 가리키는 `SubTabs` 가 N-14/W5 에 은퇴한 것 | 되살리려면 `selectNavSignals`(`store/selectors.ts:163`)에 `sinceCount` 한 줄. 지우려면 6개 파일을 함께. 그리고 knip 이 다음번에 보게 `entry` 에서 `test/**` 를 빼고 `project` 로 옮긴다 | S |
| m-5 | 4 | `web/src/lib/db/rows.ts:229-230` · `db/sqlite.ts:382` | `diffRowsDetailed` 가 flush 마다 기준선(`_last`)까지 다시 `toTableData` 한다. 10,380행이면 회당 **20,760 stringify**, 절반은 직전 회차와 바이트 동일 | `_lastTables` 캐시 + `diffRowsDetailed` 가 `nextTables` 를 함께 반환. `diffRows` 얇은 래퍼는 그대로 두면 테스트 계약 불변 | S |
| m-6 | 4 | `web/src/lib/scheduler/priority.ts:87-91` (+ 주석 `:63`·`:88`·`engine.ts:158`) | `mistakeNeed` 가 과목마다 `cbms` 800건 전량 + Map + sort + slice. 그리고 세 주석의 "기본 off → 영향 0" 이 **사실과 다르다**(`persistence.ts:182` = `true`) — 그 근거로 비용이 검토 밖에 남았다 | `weakCountBySid` 를 1회 계산해 주입하거나 `windows.ts:79` 의 `wdCache` 관용구 복제. **그리고 세 주석을 정정** | S |
| m-7 | 4 | `web/src/lib/cloud/merge.ts:160-174` | `applyPull` 이 드레인 회차마다 정본 전량을 `rowsToState` 로 재파싱 — `run.ts:197` 이 스스로 *"마지막 회차의 상태만 쓴다"* 라 적는데도. `MAX_PULL_DRAIN` 50 | `MergeResult` 가 `rows` 를 싣고 변환은 루프 뒤 1회 | S |
| m-8 | 4 | `server/src/index.ts:816-845` | pull 이 표 7개 + 툼스톤을 **순차** D1 왕복. `lib/cloud/outbox.ts:201-220` 이 **같은 형태를 M-18 에서 `Promise.all` 로 고쳤고 근거 주석까지 적었다** — 한쪽만 고쳐졌다. `ceilingOf` 가 min/max 라 순서 무관 | `Promise.all` 로 8회 → 1파동 | S |
| m-9 | 4 | `features/review/Review.tsx:589` · `features/items/Subject.tsx:132,145,205` | `riskChapters`/`chapterStrength`/`weakCountBySid` 가 렌더 본문에서 메모 없이. 둘 다 `useApp(s=>s.state)` **루트 참조** 구독이라 어떤 편집이든 M-5 전량 재실행. `features/items/Items.tsx:117` 이 같은 파일군에서 이미 옳은 형태 | `useMemo` 로 감싼다(근본 해소는 M-5) | S |
| m-10 | 1 | `web/src/lib/cloud/schema.ts:61` | `data: z.array(z.unknown())` 가 `server/src/index.ts:716` 의 D1 `.bind()` 로 그대로 간다. 객체/배열이면 bind 가 throw → **500** → 클라 재시도 대상 → 워터마크 미전진 → 무한 반복. 신뢰 경계에서 400 을 줘야 루프가 사라진다 | `data: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))` | S |
| m-11 | 3 | `src-tauri/src/vault.rs:21-31` ↔ `web/src/lib/utils.ts:151` | `SKIP` 목록이 언어 경계를 넘어 손으로 복제. 집행자는 **"같아야 한다"는 주석 하나**. 두 목록이 동시에 산다(셸=Rust · dev=FSA) → 갈리면 같은 볼트에서 노트 수·검증%가 실행 경로별로 달라지고 `vaultAnchors` 를 타고 복습 사다리까지 간다 | Rust `#[test]` 가 `../web/src/lib/utils.ts` 를 읽어 양방향 대조(`artifact.rs` 가 이미 실 워크스페이스를 읽는다). TS 쪽에 doc 추가 | S~M |
| m-12 | 3 | `src-tauri/src/vault.rs:95-96` | `chars().take(1600)`(**문자**)를 쓰면서 주석은 "선두 1600**바이트**만 보는 프런트와 동형"이라 적는다 — 한글 3바이트/문자라 최대 3배. **불일치를 알아본 뒤 반대로 서술했다.** 닫는 `---` 가 그 사이에 오면 같은 노트가 실행 경로별로 검증/미검증 | `FM_HEAD_BYTES` 상수를 양쪽에 두고 Rust 는 char 경계 보정 바이트 슬라이스 | S |
| m-13 | 3 | `web/src/lib/schema.ts:137` + 비교 6곳(`scheduler/windows.ts:52` · `layout.ts:124` · `DayPlanner.tsx:185,218` · `DayRing.tsx:102` · `SkeletonPanel.tsx:80,157,160`) | `RoutineBlock.type` 이 `z.string()` 인데 한국어 리터럴 `'수면'` 이 `awakeBounds` 를 통해 **전 스케줄의 가용 시간을 결정**한다. 라벨을 다듬으면 `[0,1440]` 이 돼 **새벽 3시에 공부가 배정된다**(`windows.ts:48-49` 가 그 증상을 이력으로 적어 둔 자리) | `BLOCK_SLEEP`·`BLOCK_CLASS` 상수 + `BLOCK_TYPES as const` → `type BlockType`, 비교 6곳을 상수로 | M |
| m-14 | 3 | `web/src/lib/persistence.ts:49-125` | `degreeSeed()` 가 **실제 성적표 40과목(F 2건 · GPA 2.71)** 을 `defaults()` 에 무조건 싣는다. "초기화"의 결과가 빈 상태가 아니라 옛 성적표 복원이고, 트랙 A 스냅샷·`npm run dev` 가 전부 그 데이터 위에서 돈다. 같은 파일 `:118` 은 *"요건 임계는 … 리터럴 재기입 금지"* 라 적는다 | `degree: { ...DEGREE_REQ, semesters: [] }` 로 기본을 비우고, 시드는 설정의 명시 행위·e2e 픽스처만 부른다(`isPristineState` 의 `ACTIVITY_KEYS` 에 `degree` 가 없어 온보딩 판정은 불변 — 확인함) | M |
| m-15 | 2 | `web/src/hooks/useKeymap.ts:21` ↔ `hooks/interactions.ts:12` | 전 `src/` 정적 그래프에서 나온 **유일한 진짜 순환**. 지금은 둘 다 함수만 export 해서 안 터지지만, `interactions.ts` 에 모듈 평가 시점 계산이 하나 생기면 부팅에서 TDZ 로 죽는다(`main.tsx` SD-7 계약이 같은 부류의 사고였다) | `isTyping` 을 `lib/typing.ts` 로 내린다(경계상 `hooks → lib` 허용). `interactions.ts` 는 재수출로 소비처 보존 | S |
| m-16 | 2 | `web/test/invariants.test.ts` (`:320`·`:551`·`:616`·`:703`·`:875`·`:935`·`:1031`·`:1100`·`:1164`·`:1217`·`:1291`) | 같은 파일 워커가 **11벌**, 주석 제거기가 **4벌·의미 3가지**, 루트 상수가 `SRC`/`SRC7`/`SRC8`/`SRC11`/`SRC13` 로 그림자 선언. **가장 최근 추가된 불변식 ⑬(`:1298`)만 규율을 안 받았다** — 이 파일이 네 번(`:648`·`:716`·`:892`·`:1041`) *"근거를 남길수록 게이트가 빨개지면 역인센티브"* 라 못박고 처방까지 적었는데, ⑬은 원문을 가공 없이 스캔한다 → 주석에 옛 마크업을 인용하면 위반이 되고 **고치는 유일한 길이 프로덕션 CSS 변경**이다. 반대 방향도 있다: `:761`·`:784`·`:807` 의 `/\/\/.*$/gm` 이 문자열 속 `https://` 를 잘라 **오검**한다(⑦·⑧은 `(^\|[^:])//` 로 이미 피했다) | `test/_sources.ts` 신설 — `filesUnder()` + `strip()` 한 벌. 13 describe 가 그것만 쓰면 **다음 불변식이 규율을 자동 상속**한다 | M |
| m-17 | 2 | `web/src/lib/observations.ts`(99) · `icsFeed.ts`(112) · `perf.ts`(100) · `conflictView.ts`(50) | 이식 근거가 "테스트 가능성"인데 테스트 트리 전량에서 import 0건. `observations.ts` 가 가장 나쁘다 — **백업의 범위를 정한다**(`shell/actions.ts:200`·`:244`). 조용히 빈 값을 주면 관측 원장이 백업에서 빠지고 사용자는 "백업했다" 토스트를 받는다. H-14 가 이 층을 만든 이유가 정확히 그 재발인데 그걸 잡는 검사가 없다 | 왕복 테스트 1건씩. ⚠ **분모를 먼저 단언**한다(빈 결과를 성공으로 읽지 않게) | S |
| m-18 | 2 | `web/src/shell/actions.ts`(823) · `shell/index.ts:12`·`:55-97` | 머리주석은 "데이터·백업·테마"인데 실제로는 여섯(백업/내보내기/테마/캡처/**팔레트 동사 카탈로그**/볼트임포트). 그리고 명령 카탈로그가 이 층에 **둘**(`palette.ts` 의 `PaletteCommand[]` · `actions.ts:583-735` 의 `HitVerb[]`) — M-9 의 중복이 나온 자리가 정확히 여기다. `import * as A from './actions'` + `ui`/`io`/`actions` 객체는 서비스 로케이터라 `boundaries` 가 배럴 뒤를 못 본다(`eslint.config.js:291-292` 가 `components → shell` 을 막으며 든 근거가 `features` 에도 성립하는데 거기선 열려 있다) | ①성격별 분할(`backup`·`exporters`·`verbs`·`chrome`·`vaultImport`) ②`ui`/`io`/`actions` 객체를 named export 로 폄(누가 백업을 부르는지 grep 가능해진다) ③`verbsFor` 를 `palette.ts` 옆으로 | L |
| m-19 | 2 | `web/test/phase{4,5,6,7,8}.test.tsx` | 이름이 마이그레이션 시점이라 **무엇을 지키는지 이름이 말하지 않고**, 전제가 사문화됐다: `phase5:11` 이 삭제된 `serve.js` 를 근거로 들고, `:12` 가 은퇴한 `mastery` 를 "서버/외부 탭"이라 부르며, `phase6:34` 의 `expect(globalThis.state).toBeUndefined()` 는 **영원히 실패할 수 없는** 단언이다. 그리고 트리 전체에 명명 규칙이 6가지 섞여 "`lib/records.ts` 에 테스트가 있나?"를 파일명으로 답할 수 없다(답: `ideasLib.test.ts`) | 계약으로 개명 + 묘비명 삭제: `appStateTabs` · `externalTabFallback` · `nativeShell` · `railKeyboard` · `todayHero`+`paletteRecent`. `ideasLib` 는 6모듈이므로 분해. ⚠ 묶음 자체는 문제가 아니다 — `semesterAxis.test.ts:3-6` 은 정당화를 적었다 | M |
| m-20 | 3 | `web/vite.config.ts:65` | 삭제된 `serve.js` 프록시를 **현재형**으로 설명 — 같은 파일 `:261` 이 반박한다. `npm run dev` 에서 왜 산출물이 안 뜨는지 조사하는 사람을 프록시 설정으로 보낸다 | 65행 삭제 | S |
| m-21 | 3 | `web/src/lib/api.ts:94` | "도구별 상한 **60~180s**" — 실제 `TOOLS[].timeout_ms` 는 60/120s. `180s` 는 삭제된 serve.js 캡. 이 줄이 "얼마나 기다려야 하는가"의 유일한 프런트 문서라 3분 스피너를 정상으로 오판하게 한다 | 수를 빼고 `tools.rs` 의 `TOOLS[].timeout_ms` 를 가리킨다 | S |
| m-22 | 3 | `web/src/lib/utils.ts:17-22` | "도메인 규칙의 SSOT"라 선언한 `reviewBlockMin` 안에 이름 없는 상수 셋(15 / 0.25 / 120). `120` 은 `persistence.ts:141`·`scheduler/engine.ts:41` 에도 리터럴 — **세 벌**. 그 함수가 없애려던 형태 | `DEFAULT_MODULE_MIN`·`REVIEW_BLOCK_RATIO`·`REVIEW_BLOCK_MIN_MIN` 로 명명하고 세 곳이 첫 상수를 쓰게 | S |
| m-23 | 3 | `web/src/lib/anki.ts:60` · `src-tauri/src/anki.rs:32` | AnkiConnect 포트 `8765` 가 두 언어에 이름 없이 복제. 애드온 설정으로 바꿀 수 있는 값인데 주입 경로가 없다(`ollama.rs:47` 은 같은 문제를 `OLLAMA_BASE_URL` 로 이미 풀었다) | 양쪽에 `ANKI_CONNECT_URL` 이름을 주고 서로를 가리키게 | S |
| m-24 | 3 | `web/src/lib/utils.ts:144` ↔ `features/schedule/DayPlannerTrayAdder.tsx:39` | `BLOCK_TYPES` 라는 **같은 이름이 다른 두 도메인**(일과 유형→CSS 토큰 `Record` vs 세션 유형→라벨 배열). 둘 다 "하루 계획" 코드에 살고 같은 화면군에서 쓰인다 → 복붙 시 한쪽은 CSS 변수, 한쪽은 `undefined`. 후자는 `SessionType` 결속도 0(짝인 `SESSION_TYPE_META` 는 `Record<SessionType,…>` 로 이미 잠겨 있다) | 개명(`SESSION_ADD_BUTTONS`) + `Record<SessionType,true>` 완전성 검사(`:122` 의 `!` 도 사라진다) | S |
| m-25 | 나 | `web/src/styles/global/features.css:9-16` | 전역 `prefers-reduced-motion` 리셋이 **두 벌**이고(`motion.css:163-176` 이 상위집합), 레이어 규칙이 문서와 반대로 작동한다 — `!important` 선언의 캐스케이드 레이어 우선순위는 일반 선언과 **반대**라 **언레이어드가 가장 약하다**. 즉 `index.css` 머리주석이 근거로 삼은 "`motion.css` 는 언레이어드라 이긴다"가 이 구간에선 성립하지 않고 `features.css`(layer components)가 이긴다. 지금은 두 값이 모두 사실상 0 이라 무해하지만 **어느 쪽이 이기는지가 문서와 반대**다. 그리고 이 블록은 머리주석이 스스로 "Phase 9 이전 완료"라 부르는 잔재다 | `features.css:9-16` 삭제 — `motion.css` 하나가 소유 | S |

---

### Nit

| # | 축 | 위치 | 문제 | 비용 |
|---|---|---|---|---|
| n-1 | 1 | `web/src/lib/cloud/merge.ts:155` | `reloadDocs` 조건이 `batch.rows` 만 본다 — `docs` **삭제** 배치에서 `db/docs.ts` 의 `_cache` 가 재시작까지 지워진 값을 돌려준다(H1 이 고친 것과 같은 형태 · 삭제 축만 빠짐). 현재 도달 불가이나 `contract.ts:97` 이 예고한 커밋이 오면 조용히 틀린다. 수정: `\|\| batch.tombstones.some((t) => t.tbl === 'docs')` | S |
| n-2 | 1 | `server/src/index.ts:273` | "맵이 무한히 자라지 않게" 주석과 달리 프루닝이 **만료 항목만** 지운다 → 창 안에 새 버킷이 계속 들어오면 삭제 대상 0, 상한 없음. 항목은 전역 리미터 **앞**에서 무조건 삽입되므로 429 트래픽도 맵을 키운다. 수정: 프루닝 뒤에도 넘치면 `hits.clear()` | S |
| n-3 | 4 | `web/src/lib/scheduler/engine.ts:86` | 일자 생성 루프가 `parseISO(start)` 를 547회 재파싱. **바로 이웃** `priority.ts:108-118` 의 H29 주석이 같은 결함을 명시하고 `const from = parseISO(start)` 로 고쳤는데 이 루프엔 안 왔다 | S |
| n-4 | 4 | `web/src/lib/contentSearch.ts:85`·`:97` | 질의와 무관한 전량 스캔 둘(`openBacklog` 300 · `weakSpots` cbms 800 + sort)이 키 입력마다 재계산. 참조 캐시 2줄 | S |
| n-5 | 3 | `app/App.tsx:150`("15개"→19) · `app/RailSidebar.tsx:250`("열넷"→15) · `app/CommandPalette.tsx:133`("48개") | 현재형 개수 주석 3곳이 실측과 다름. RailSidebar 것은 **청킹 판단의 근거 수**다 | S |
| n-6 | 3 | `web/src/lib/tauri.ts` | `shell*` 접두 규칙이 문서화도 일관도 안 됨(`getArtifact`↔`artifactRead` 가 관찰된 규칙의 예외). 머리주석 한 줄 + 개명 또는 예외 명시 | S |
| n-7 | 3 | `src-tauri/src/tools.rs:395` | `env::var("PYTHON")` 이 파이썬 실행 파일의 유일한 주입 경로인데 설정 UI·`tauri.conf.json`·README 어디에도 없다. 최소 수정: spawn 실패 메시지에 그 경로를 노출 | S |

---

## 확인하고 **버린** 가설 — 재조사하지 말 것

이 절이 지적 목록만큼 중요하다. 아래는 각 축이 실제로 코드를 열어 확인한 뒤 기각한 것이다.

**보안·정확성(축1)** — 경로 조작(`vault.rs:352` `safe_join` 이 `Normal` 컴포넌트만 통과 + `starts_with` 재확인;
`artifact.rs` 는 선형 화이트리스트) · `tools.rs` 셸 인젝션(인자 배열 전달 · `shell` 미경유 · dash 접두 거부 + 200자 절단) ·
서버 SQL 인젝션(`tbl` 이 `z.enum` · 순회는 `TABLE_COLS` 키에서만) · 토큰 검증 누락 라우트(무인증 4종 전부
`rateGuard` + 근거 주석) · 기기 폐기 후 잔존 창(매 요청 `revoked_at` 조회 + `SyncHub./close`) ·
pull 페이지네이션 유실/무한루프(`ceilingOf` 가 `cap > since` 보장) · `nextStamp` 단조성 · `applyPull` 중간 실패
시 기준선/병합창(양쪽 `finally` 확인) · 에코 루프 · **리스너/타이머/소켓 누수 전량** · `cloud_http` SSRF
(https 강제 · `/api/**` · `redirect::Policy::none()` 이 3xx 로 `Authorization` 이 새는 경로를 닫는다).

**성능(축4)** — `selectors.keyed()` 캐시 미스(원소 단위 비교라 히트) · **D1 인덱스 누락 없음**
(`004_outbox.sql:2-8` 이 pull 이 필터·정렬하는 7표 전부 + `003:21` 툼스톤 + `009:64` 재작성 후 재생성) ·
원장 무한 성장(visits 90일 · daySignals · idleLedger · undoStack 512KB · telemetry 20건 — 전부 상한) ·
볼트 stat 폭발(핫패스 아님 · 700ms 디바운스) · `semantic.ts` 벡터 캐시(프로덕션 소비처 0) ·
캔버스 프레임 예산(12fps 캡 + `document.hidden`/`hasFocus` 정지 + 컨텍스트 손실 시 루프 중단 +
alpha 냉각 + Barnes–Hut 자동 전환) · `key={i}`(인덱스가 곧 정체성인 자리뿐).

**구조(축2)** — `shell/index.ts` 배럴의 레이어 우회(H10 이후 `components`·`hooks`·`store`·`lib`·`phone`
전부 막힘 · 실측 위반 0 — 문제는 우회가 아니라 배럴 뒤의 응집도) · `useApp` 신의 객체(액션 11개 전부
`commit(recipe)` 한 줄 · `store/*` 간 import 9건 전량 단방향 DAG) · 폰/데스크톱 판정 복제(대부분 실제로
lib 공유 · 남은 것은 러너 하나 = M-10) · `SCHEDULE_INPUT_KEYS` 불변식의 픽스처 의존(Proxy 재현으로 기각) ·
`@/features/*` 글롭이 깊은 경로를 놓침(잡는다 — 놓치는 것은 상대경로 = m-3).

**표면(축3)** — `retrieval`↔`retrievalLatency`·`resume`↔`resumeCursor`·`syncLedger` 3층·`semester*`6·
`day*`7·`review*`3(전부 머리주석이 대상을 가른다) · 부정형 불리언(1건뿐 무해) · `isX` 부작용(26개 전수
순수 확인) · **단위 없는 기간 필드(전수 grep — 전부 단위 접미 있음. 이 축은 건강하다)** ·
`cloud/*` 매직넘버(전부 명명 + 근거) · `spacedReview` 임계(`REVIEW_OFFSETS` 파생 · 임의 계수 0) ·
**절대경로·사용자명 하드코딩(`C:\Users` 매치는 `telemetry.ts:96-110` 의 마스킹 정규식뿐 — 오히려 방어.
`paths.rs` 는 모범적이다)** · server 상수·시크릿 · 버전 리터럴(`release-verify.mjs:56-58` 이 게이트로 대조).

---

## 우선순위 로드맵

### 1주차 — 무증상 오동작을 멈춘다 (전부 S · 합계 ~1일)

1. **M-1** pull 상한 — 한 줄 이동. 지금은 잠복이지만 발동하면 자가복구가 없다.
2. **M-6** redo — `inverseStamp`. 함께 `test/cloudUndo.test.ts` 에 **redo 왕복 케이스**를 넣는다(지금 0건).
3. **M-2** 44px 앵커 deps. 가장 자주 보는 화면의 가장 큰 숫자가 틀려 있다.
4. **M-7** CBMS `CbmsCodeSchema.options` — 백업 복원이 데이터를 지울 수 있는 유일한 자리.
5. **m-10** `data` 원시값 제한 — 무한 5xx 루프의 입구를 닫는다.

### 2주차 — 스케줄러 재계산 (M-3·M-4·M-5·n-3 · S+S+M+S)

넷은 **한 덩어리다**: 전부 `schedule()` / `chapterReviews` 안이고 같은 관용구(인덱스·1회 계산)로 풀린다.
착수 전에 `importRoundtripLarge` 규모로 `schedule()` 1회 시간을 재고, 고친 뒤 같은 방법으로 다시 잰다 —
이 저장소는 `events.ts` 머리주석에서 이미 그 형식을 썼다. **그 실측표를 남기는 것까지가 한 짝이다.**
함께: **m-6 의 세 주석 정정**(그 오해가 이 비용을 검토 밖에 두었다).

### 3주차 — R1 에 집행자를 붙인다 (M-8·M-9·m-3·m-11·m-16)

개별 수정은 전부 S 지만, **각각에 집행자를 붙이는 것이 본체다**:

- M-8 → `Record<DegreeCat,…>` (타입이 라벨 변경을 잡는다)
- M-9 → `applyWeeklyHours` 순수 recipe (호출부가 한 줄이 되면 복제 유인이 사라진다)
- m-3 → eslint `patterns` 3줄 (코드 변경 0)
- m-11 → Rust `#[test]` 양방향 대조
- m-16 → `test/_sources.ts` (다음 불변식이 규율을 상속한다)

### 4주차 — R3 · 테스트 하네스 (M-12·M-13·M-14·m-19)

순서가 중요하다: **M-12·M-13 을 먼저** 하면 `asyncUtilTimeout`·`testTimeout` 인상과
`today.test.tsx` 의 벽시계 수용이 근거를 잃고 함께 걷힌다. 그 다음 **M-14** 로 래칫을 분포 기준으로
내리면 M-2 가 나온 사각이 닫힌다. m-19 개명은 그 김에.

### 백로그 (독립적 · 언제든)

m-1·m-2·m-4·m-5·m-7·m-8·m-9·m-12~m-15·m-17·m-20~m-25 · n-1~n-7.
**m-18(shell 분해 · L)은 M-9 를 먼저 한 뒤 판단한다** — 그 중복이 사라지고 나면 분해 범위가 줄 수 있다.

---

## 부수 관찰 (지적 아님 · 기록)

- `TabMeta`(`shell/tabs.ts:76-97`)는 `role` 에 따라 유효 필드가 갈리는 **union 을 struct 로 쓴 형태**다.
  그래서 `App.tsx:169` 가 `t.to!` 를 쓰고, 그걸 런타임 테스트 둘이 지킨다. `role` discriminated union 이면
  두 케이스가 컴파일 에러로 승격되고 `!` 가 사라진다 — 다만 소비처 순회 타입이 전부 좁혀지므로 비용 M 이고
  현재 실해가 없어 항목으로 올리지 않았다.
- `store/selectors.ts:114-120` 의 `capCache` 만 `keyed()`(`:84`)를 안 쓰고 루트 참조 캐시를 쓴다.
  H9 가 *"규칙을 함수 하나로 만들어 다음 셀렉터가 자동으로 같은 규칙을 쓰게 한다"* 며 만든 함수인데
  한 곳이 안 옮겨졌다. `studyMinByWeekday` 는 스케줄 입력의 부분집합만 읽어 실해는 없다(R1 의 축소판).
- CI 는 검토 범위에서 가장 건강한 축이다 — 액션 SHA 핀 + gitleaks 체크섬 대조 + 일회용 서명키(진짜 키를
  GitHub 에 두지 않으면서 서명 경로를 실제로 돌린다) + `LEARNING_HUB_NO_REAL_ENV` 로 실물 의존 검사만
  명시적으로 끄고 그 사실을 `--show-output` 으로 로그에 남긴다.

---

# 처리 결과 (2026-08-20)

## 요약

| | 수 | 상태 |
|---|---|---|
| Critical | 0 | — |
| Major | 14 | **14 수정** (M-11·M-14 는 범위 조정 · 아래 ⚠) |
| Minor | 25 | **25 수정** (m-18 은 범위 축소 · 아래 ⚠) |
| Nit | 7 | **7 수정** |
| 수정 중 새로 발견 | 3 | **3 수정** |

## ⚠ 실측이 리뷰를 정정한 것 (숨기지 않는다)

1. **M-14 의 `max-lines` 축은 과한 지적이었다.** 재측정하니 한도 727 vs 실측 720 — 여유 1% 로
   **이미 조여져 있다.** 리뷰가 복잡도 래칫(62 vs 59)과 한 묶음으로 지적했는데, 그 둘은 다른
   상태였다. `max-lines` 는 손대지 않았고 그 판단을 `eslint.config.js` 주석에 적었다.
2. **m-4 의 처방(`knip.jsonc` 의 `entry` 조정)은 안 통한다.** 프로브로 실측했다 — knip 의 vitest
   플러그인이 `test/**` 를 **자동으로 entry 에 다시 넣는다.** 설정으로는 못 고치는 축이라,
   대신 **불변식 ⑭**(`test/invariants.test.ts` + `test/_sources.ts` 의 import 그래프)를 만들었다.
   프로브로 잡히는 것을 확인했다(더미 모듈 → 실패 → 정리).
3. **M-11 은 정책만 뽑았다.** 리뷰가 제안한 `createPersistEngine` 전체 추출은 `useApp` 의 160줄
   델리킷한 클로저를 재배선하는 일이라, 실제 결함("백오프 수열이 무검증")만 겨눠
   `lib/db/write.nextRetryMs` 로 내리고 **수열·상한·리셋을 4케이스로 잠갔다.** 나머지(디바운스·
   rebase 큐·언로드 안전망)는 그대로다 — 그 축들엔 이미 테스트가 있다.

## ⚠ 범위를 축소한 것

- **m-18(shell 분해 · L)** — 셋 중 둘만 했다.
  · ✅ **명령 카탈로그를 한 파일로**: `verbsFor`·`contentSearch`·`semanticPalette`·`captureSubjects`·
    `commitCapture` 를 **`shell/verbs.ts`** 로 분리(actions.ts 823 → 608줄). 팔레트 카탈로그가
    `palette.ts` 옆에 선다.
  · ✅ **배럴의 네임스페이스 import 제거**: `import * as A` → 이름 19개 열거. 배럴이 `actions` 에서
    무엇을 쓰는지 **선언으로** 말하고 knip 도 미사용을 본다.
  · ⏸ **`ui`/`io`/`actions` 객체를 named export 로 펴는 것은 안 했다.** 46파일·80여 호출부를
    건드리는데, 그 세 객체는 **이미 노출 함수를 명시로 열거**하고 있어(서비스 로케이터의 나쁜
    성질인 "무엇이 들어 있는지 모른다"가 성립하지 않는다) 얻는 것이 grep 형태 하나뿐이다.
    레이어 탈출도 실측 0건이다(H10 이후 `components`·`store`·`lib`·`phone` 이 배럴을 못 문다).

## 수정 중 새로 발견해 함께 고친 것

| 무엇 | 어디 | 어떻게 찾았나 |
|---|---|---|
| **전부 빈 행의 미리보기가 `(빈 값)` 이 아니라 `· ·` 로 렌더** | `lib/conflictView.ts:32` | m-17 로 새로 붙인 테스트가 첫 실행에서 잡았다. `.join(' · ')` 뒤 `.trim()` 은 구분자를 안 걷는다 — 값 부재가 화면에서 값처럼 보이던, 이 저장소가 반복해 물린 그 형태다 |
| **`blockColor` 이름 충돌** | `lib/utils.ts` | m-24(같은 이름 다른 도메인)를 고치다 **같은 실수를 반복할 뻔했다** — 그 파일엔 이미 *계획 블록*용 `blockColor` 가 있었다. 새 것을 `routineBlockColor` 로 명명 |
| **`nanoid` high CVE**(GHSA-2v37-7h3g-55p8) | `stylelint → postcss → nanoid` | 게이트가 잡았다(내 변경과 무관한 신규 권고). 저장소 규율대로 원장이 아니라 **상향**으로 해소(3.3.17 → 3.3.18) |

## 사용자 결정이 필요했던 둘

- **m-4 `lib/since.ts`** → **되살렸다.** `store/selectors.selectNavSignals` 가 아니라
  `app/RailSidebar` 에서 조립한다 — `seenAt` 은 `useUI`(기기별)에 살아서 `keyed` 캐시 키
  (`AppState`)로는 무효화가 안 걸리기 때문이다. 판정=lib · 시점=훅 · 표시=화면 세 층은 유지.
  기존 신호가 있는 탭은 덮지 않는다(더 급한 말을 잃지 않게).
- **`lib/predictionScore.ts`** → **지웠다**(테스트와 함께). 부모 워크스페이스에서 「예측 원장·
  캘리브레이션」이 2026-08-13 에 «오독»으로 철거된 것과 같은 축이고, 이 앱에서 한 번도
  렌더된 적이 없다.

## 새로 생긴 집행자 (R1 의 처방 — "선언에 집행자를 붙인다")

| 무엇을 지키나 | 집행자 |
|---|---|
| feature 밖으로 나가는 **상대경로** | `eslint.config.js` `no-restricted-imports` 패턴 2개 (코드 변경 0) |
| 라벨→졸업요건 **매핑** | `Record<DegreeCat, …>` — 라벨을 바꾸면 컴파일 에러 |
| 세션 유형 **집합** | `Record<SessionType, true>` 완전성 검사(`DayPlannerTrayAdder`) |
| `SKIP` 폴더 목록의 **언어 경계 사본** | `vault.rs` 의 `스킵_목록이_프런트와_같다`(양방향 대조) |
| **테스트만 쓰는 프로덕션 모듈** | 불변식 ⑭ (knip 이 원리적으로 못 보는 축) |
| 다음 불변식의 **주석 처리 규율** | `test/_sources.ts` 의 `strip`/`filesUnder` 한 벌 |
| 쓰기 실패 **백오프 수열** | `test/persistBackoff.test.ts`(4케이스) |
| **redo 왕복** | `test/cloudUndo.test.ts` ⑤절(3케이스 · 되돌리면 실패하는 것 확인) |
| 백업의 **관측 원장 범위** | `test/observations.test.ts`(5케이스 · 분모 먼저 단언) |
| 복잡도 **분포** | 임계 62 → **25** + 초과 16파일 기한부 원장(만료 2026-11-20) |

## [미열람] 206 정독 — 그 구간에서 나온 것 (2026-08-20)

리뷰 제출 시점의 커버리지는 **정독 99 / 구조열람 299 / [미열람] 206** 이었고, 미열람 구간에
대해서는 아무 주장도 하지 않았다. 사용자 지시로 전량(테스트 188 · 마이그레이션 11 · CSS 7 ·
러너·빌드 설정 24 · Rust examples·Cargo.toml 등)을 읽었다. **커버리지는 이제 정독 305 / 구조열람
299 / 미열람 0** 이다.

### N-1 (Major) — 원시 NUL 바이트가 소스 3파일을 **git 에서 바이너리로** 만들고 있었다

`web/src/lib/visits.ts:32`(외 4곳) · `web/test/dbRowVerify.test.ts:59` · `web/test/dbUnavailable.test.ts:37`

`Map` 키 구분자로 `\x00` 을 쓰는 것은 정당한 관용구다(ID 에 나올 수 없는 문자). 문제는 그것이
**이스케이프가 아니라 원시 바이트**로 소스에 박혀 있었다는 것이다. `.gitattributes` 가
`*.ts text eol=lf` 라 선언해도 **git 의 바이너리 판정이 이긴다**(앞 8000바이트에 NUL 이 있으면
binary) → 그 세 파일의 `git diff` 는 영원히 `Bin 6024 -> 5979 bytes` 였다. 즉 **프로덕션 소스
하나를 포함해 셋이 코드리뷰에서 보이지 않는 채로 바뀌어 왔다.**

게이트 전량(tsc·eslint·vitest·prettier)이 녹색이었다 — JS 문자열 리터럴 안의 원시 NUL 은 문법상
합법이라 어느 검사기도 볼 이유가 없다. 런타임 동작은 이스케이프와 **문자 그대로 동일**하다:
이건 *도구가 파일을 읽는 방식*의 문제이고, 그래서 처방도 정적 검사가 아니라 불변식이다.

**수정**: 원시 바이트 8개를 `\x00` 이스케이프로 치환(동작 변화 0) + **불변식 ⑮**
(`test/invariants.test.ts` — `web/src`·`web/test` 어느 파일도 NUL 을 담지 않는다). 심은 위반을
정확히 잡고 제거 후 통과함을 프로브로 확인했다.

### N-2 (Major) — 역방향 토큰 검사의 **사각에 고아 53개**가 쌓여 있었다

`web/scripts/check-tokens.mjs:127` · `web/src/styles/tokenBridge.css` · `web/src/styles/tokens.css`

`check-tokens.mjs` 는 "선언됐는데 안 쓰이는 토큰"을 잡는 역방향 검사를 갖고 있고, 그 주석이
범위를 좁힌 이유를 이렇게 적었다: *"`tokenBridge.css` 의 `@theme` 항목은 Tailwind 가 유틸을
생성해 소비하지 `var()` 로 참조하지 않는다 → 전량 오탐이 된다."*

**앞 절반은 맞고 결론이 틀렸다.** 오탐이 되는 것은 `var()` **문법으로 찾을 때**뿐이고, 소비
흔적은 다른 문법으로 실재한다 — 유틸 클래스 이름(`--text-markets-title` → `text-markets-title`).
즉 검사가 불가능했던 게 아니라 기법이 없었다.

그 사각에 실제로 쌓여 있었다. P10 W4(2026-08-07)가 화면 다섯(`control`·`discovery`·`atlas`·
`markets`·`reads`)을 지웠는데 **그 화면들의 토큰은 남았고**, 두 파일의 주석은 없는 UI 를
현재형으로 설명하고 있었다 — 역방향 검사가 막으려던 실패 형태 그대로다.

| 무엇 | 수 |
|---|---|
| `tokenBridge.css` `@theme` 고아 | **40** |
| 그 아래에서 함께 드러난 `tokens.css` 고아 | **12** (브리지가 유일한 소비처였다 = 사각이 두 층을 가렸다) |
| `ds.css` 의 소비처 0 클래스 | **1** (`.ds-sub`) |

**수정**: 40 + 12 삭제, 오귀속 주석 재작성(살아남은 토큰은 실제 소비처로), 그리고 집행자 둘 신설 —
`@theme` 고아 검사(네임스페이스별 유틸 접두사 대조)와 `ds-*` 고아 검사. 둘 다 심은 위반을 잡는
것을 프로브로 확인했다. **시각 스냅샷 167장이 한 장도 안 움직였다** — 진짜 고아였다는 증거다.

⚠ `.ds-sub`(Q-10 · 2026-08-02 신설 · 소비처 0)는 **지우지 않고 기한부 원장에 올렸다**(만료
2026-11-20). `ds.css` 는 같은 부류를 이미 셋 지웠지만(`ds-card`·`ds-muted`·`ds-canvas`) 저 셋과
달리 정의에 실체가 있고(대비를 안 깎는 유일한 위계 수단) 근거도 유효하다. 쓸 자리를 정하는 것은
설계 결정이라 리뷰가 대신하지 않는다.

### ⚠ 이 절에서 **검사기가 나를 정정한 것** — `--bg2`

고아 40+12 를 지우자 `test/accentContrast.test.ts` 가 깨졌다. `--bg2` 는 화면이 직접 안 쓰지만
그 테스트가 **라이트 대비 계약의 밑면**(라이트 배경 4종 중 가장 어두운 면)을 고를 때 읽는다.
지웠다면 밑면이 `--panel2`(더 밝다)로 바뀌어 **a11y 계약이 조용히 느슨해졌을 것**이다 — 게이트는
녹색인 채로.

원인은 역방향 검사의 소비면이 `src` 뿐이었다는 것(내가 만든 게 아니라 **물려받은 범위**다).
즉 *렌더되지 않지만 계약을 진다* 는 세 번째 소비 형태가 있고, 검사기가 그것을 몰랐다.
`--bg2` 를 사유와 함께 복원하고, 세 역방향 검사의 소비면에 `test/` 를 포함시켰다(테스트가
`토큰(..., '--bg2')` 처럼 **이름만 문자열로** 넘기는 형태까지 걷는다 — 그걸 놓친 것이 직접 원인).

### 부수 관찰 — 고치지 않은 것

- **`it(` / `test(` 혼용**: `.ts` 는 129:2 로 `it(` 이 압도적인데 `.tsx` 는 16:26 으로 뒤집힌다.
  깨끗한 분할이 아니라 진짜 불일치다. 다만 처방이 43개 파일 일괄 개명이라 **동작 변화 0 에 diff 만
  큰 교환**이라 하지 않았다. 새 파일이 어느 쪽을 골라도 게이트는 침묵한다는 사실만 기록한다.
- **반픽셀 토큰 5종**(`--fs-micro-plus` 9.5 · `--fs-caption` 10.5 · `--fs-note` 11.5 ·
  `--fs-hint` 12.5 · `--fs-label` 13.5): `tokens.css` 머리주석이 *"반픽셀 금지"* 라 선언한 바로
  아래에 `⚠반픽셀` 주석을 달고 산다. W11 이 **의도적으로 1단계(이름만)에서 멈춘 것**이고 2단계
  (반올림)의 선행 조건(실렌더 1회)도 적혀 있다 — 즉 방치가 아니라 계획이다. 다만 이 저장소의
  다른 기한부 판단들과 달리 **만료일이 없다**. 판단에 유효기간이 없으면 방치가 된다는 것이 이
  저장소 자신의 규율이므로, 그 규율을 여기에도 적용할지는 설계 결정으로 남긴다.
- 마이그레이션 11종 · 러너/빌드 설정 24종 · `src-tauri/examples` 3종: **통과**.

## 남은 것

없음 — 원 46건 + 정독에서 나온 2건, 전부 닫혔다. **기한부 원장 둘**이 남는다:

| 원장 | 어디 | 만료 |
|---|---|---|
| 인지복잡도 예외 8파일 | `eslint.config.js` | 2026-11-20 |
| `.ds-sub`(소비처 0) | `scripts/check-tokens.mjs` 의 `ds_원장` | 2026-11-20 |

그때까지 해소되지 않으면 **게이트가 깨지게 두는 것이 계약**이다(이 저장소의 다른 원장 둘과 같은
규율 — 판단에 유효기간이 없으면 그건 판단이 아니라 방치다).

## 최종 게이트 (전량 · 2026-08-20)

| 게이트 | 결과 |
|---|---|
| `web verify`(codegen·tsc·eslint·stylelint·check:tokens·format·knip·coverage) | ✅ 184 파일 / **2,029 케이스** |
| `web audit`(SCA) | ✅ critical 0 · high 0 · moderate 0 |
| `web build` + `budget`(4축) | ✅ 데스크톱 511.0/555 · 폰 306.1/348 · wasm 392.5/450 · 오염 0 |
| `web e2e`(트랙 A 시각 + 모션) | ✅ **167 + 5** |
| `web e2e:a11y`(axe) | ✅ **65** |
| `server verify`(실 workerd·D1 왕복 포함) | ✅ **27** |
| `cargo test --lib` | ✅ **75** |
| `tauri:fmt` · `tauri:clippy` | ✅ |
| `e2e:shell`(트랙 B · 실 exe + WebView2) | ✅ **9** (부팅 130.5ms) |
