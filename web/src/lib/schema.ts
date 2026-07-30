/* ============================================================
   schema.ts — 경계의 데이터 계약(zod). 스키마=타입=런타임 가드를 일원화한다.
   레거시 모델 v3(localStorage KEY 'study_planner_v3')와 **바이트 호환**:
   필드/스키마를 그대로 옮겨 기존 백업 JSON이 100% 로드되게 한다.
   ※ migrate/validShape의 *동작*은 persistence.ts가 손코딩 그대로 보존(테스트 회귀 방지).
     여기 스키마는 (1) 타입 추론의 단일 원천 (2) 선택적 런타임 검증에 쓴다.
============================================================ */
import * as z from 'zod/mini';

export const ThemeSchema = z.enum(['light', 'dark']);
export type Theme = z.infer<typeof ThemeSchema>;

/** doneDs = 챕터를 끝낸 날(N-10 유지 사다리의 앵커). 옵셔널이라 기존 저장은 무마이그레이션.
 *  ⚠ 왜 필요한가: done 챕터는 스케줄러가 더 이상 블록을 안 만들어(`_chs` 가 `!done` 필터)
 *  **과거 날짜와의 링크까지 통째로 끊긴다** — 계획이 매번 재생성되기 때문이다. 그래서 "언제
 *  끝냈나"는 여기 남기지 않으면 앱 어디에도 없다(로드맵 N-10 의 "데이터는 전부 있다"는 전제
 *  정정). 없는 옛 챕터는 '모름'으로 다루고 유지 큐의 세션 상한이 그 불확실성을 감당한다. */
export const ChapterSchema = z.object({
  id: z.string(),
  name: z.string(),
  hours: z.number(),
  done: z.boolean(),
  doneDs: z.optional(z.string()),
});

export const ItemModeSchema = z.enum(['weekly', 'daily']);

export const ItemSchema = z.looseObject({
  id: z.string(),
  source: z.optional(z.string()),
  name: z.string(),
  color: z.optional(z.string()),
  mode: ItemModeSchema,
  weeklyHours: z.optional(z.number()),
  dailyMin: z.optional(z.number()),
  deadline: z.optional(z.string()),
  chapters: z._default(z.array(ChapterSchema), []),
});

export const RoutineBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  start: z.string(),
  end: z.string(),
  days: z.array(z.number()),
  // 요일별 시간 오버라이드(선택) — 키=요일(일0..토6) 문자열. 없으면 start/end 공통 적용.
  // 일과 블록도 수업처럼 요일마다 다른 시간을 가질 수 있게(blocksForWeekday가 단일 지점서 해석).
  times: z.optional(z.record(z.string(), z.object({ start: z.string(), end: z.string() }))),
});

/** doneDs = 실제 완료 날짜(감사 2026-07-16 ②#23) — 복습 사다리 앵커. 옵셔널이라 기존 저장 무마이그레이션
 *  (없으면 계획일 앵커 = 종전 동작). 계획일(completions 키)과 다르면 '늦게 완료'를 뜻한다. */
/* ⚠ `min` 은 **계획된 분**이다(체크 시점의 블록 길이). G-1 이전엔 회고 전량이 이 값을
   "집중한 시간"으로 읽었고, 그중 `adherenceFactor` 는 그 값으로 **계획 용량을 0.5~1.0배 실제로
   깎았다** — 즉 체크박스가 미래 일정을 바꾸는데 아무도 그 사실을 몰랐다. `actualMin` 은
   `useFocus` 가 아는 **실제 경과 분**이고, 있으면 그것을 쓴다(`completionMin`). 옵셔널이라
   기존 저장·서버 계약(값을 불투명하게 다룬다)·폰 모두 무마이그레이션. */
export const CompletionEntrySchema = z.object({
  done: z.boolean(),
  min: z.number(),
  doneDs: z.optional(z.string()),
  actualMin: z.optional(z.number()),
});
/** completions[ds][`${sid}|${type}`] = {done,min} */
export const CompletionsSchema = z.record(z.string(), z.record(z.string(), CompletionEntrySchema));

export const SummarySchema = z.object({
  id: z.string(),
  sid: z.string(),
  name: z.string(),
  s1: z.string(),
  s2: z.string(),
  s3: z.string(),
  at: z.optional(z.number()), // 작성 시각(epoch ms) — 구버전엔 없음(로그 타임스탬프·정렬용)
});

export const CbmsCodeSchema = z.enum(['C', 'B', 'M', 'S', 'T']);
export const CbmsSchema = z.object({
  id: z.string(),
  ds: z.string(),
  sid: z.string(),
  name: z.string(),
  chapter: z.string(),
  code: CbmsCodeSchema,
  note: z.string(),
  conf: z.optional(z.boolean()), // 구버전엔 없음 — '찍어서 맞음' 플래그(F-06)
  at: z.optional(z.number()), // 작성 시각(epoch ms) — 구버전엔 없음(로그 타임스탬프)
});

export const BacklogSchema = z.object({
  id: z.string(),
  ds: z.string(),
  sid: z.string(),
  name: z.string(),
  topic: z.string(),
  note: z.string(),
  done: z.boolean(),
  doneDs: z.string(),
  at: z.optional(z.number()), // 작성 시각(epoch ms) — 구버전엔 없음(로그 타임스탬프)
});

export const BlankResultSchema = z.object({
  id: z.string(),
  ds: z.string(),
  sid: z.string(),
  name: z.string(),
  passed: z.boolean(),
  note: z.string(),
});

export const RetentionSchema = z.object({
  wk: z.string(),
  at: z.string(),
  due: z.number(),
  cards: z.number(),
});

export const WeeklySchema = z.object({
  checks: z.record(z.string(), z.boolean()),
  note: z.string(),
});

export const RitualSchema = z.object({
  plan: z.boolean(),
  shutdown: z.boolean(),
  note: z.string(),
});

// 학기 과목. (이 스키마들은 영속 데이터 검증이 아니라 *타입 출처*로만 쓰인다 — validShape는 손코딩,
//  AppStateSchema는 어디서도 .parse되지 않음. 그래서 실제 필드로 정밀화해도 기존 데이터 호환에 영향 0.)
export const CourseSchema = z.object({
  id: z.string(),
  name: z.string(),
  credits: z.number(),
  category: z.string(),
  status: z.string(),
  grade: z.optional(z.string()),
});
export const SemesterSchema = z.object({
  id: z.string(),
  name: z.string(),
  courses: z._default(z.array(CourseSchema), []),
});
export const DegreeSchema = z.object({
  targetTotal: z.number(),
  reqMajorReq: z.number(),
  reqMajorSel: z.number(),
  reqLiberal: z.number(),
  semesters: z.array(SemesterSchema),
  targetGpa: z.optional(z.number()), // 목표 졸업 GPA(역산 계산기) — 옵셔널이라 기존 저장 상태 무마이그레이션.
});

export const AnkiSchema = z.object({ source: z.string() });

/* ── 일일 배치 오버라이드(계획 개편 §4-1) ─────────────────────────────
   자동초안 위에 얹는 수동 배치. 옵셔널·passthrough라 기존 저장 100% 호환(무마이그레이션).
   dayOverrides(그날 가용 *시간 수*)와 직교 — 이건 그날 *배치*의 진리다. */
export const PlacedBlockSchema = z.object({
  id: z.string(),
  type: z.enum(['anki', 'new', 'rev', 'blank', 'mock']), // SessionType
  sid: z.string(), // 과목 id('mock'은 모의)
  name: z.string(),
  color: z.optional(z.string()),
  start: z.optional(z.number()), // 자정 기준 분(명시 배치) — layoutDay가 존중. 없으면 미지정(트레이).
  min: z.number(),
  chapters: z.optional(z.array(z.string())),
  pinned: z.optional(z.boolean()), // 자동 재계산에서 보존
  // 블록별 완료(수동 날 · 같은 sid|type 여러 블록을 독립 체크). completions[ds][sid|type] 집계는
  // setBlockDone이 이 플래그들의 OR/합으로 미러링해 하류(스케줄러 복습씨앗·통계·.ics)는 무변경.
  done: z.optional(z.boolean()),
});
export const DayPlanSchema = z.object({
  mode: z.enum(['auto', 'manual']), // manual = 그날 배치의 진리는 사용자
  blocks: z.array(PlacedBlockSchema),
});

/* ── 자유 할 일(계획 개편 §4-4) ────────────────────────────────────────
   과목에 안 묶인 할 일(과제 제출·도서 반납). 공부 블록(스케줄러 소유)과 별개 독립 리스트(저위험 분리).
   신규·옵셔널·무마이그레이션. */
export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  sid: z.optional(z.string()), // 연결 과목(선택) — 색·필터용. 없으면 순수 자유 할 일
  color: z.optional(z.string()),
  ds: z.optional(z.string()), // 배정 날짜(YYYY-MM-DD). 없으면 '언젠가'(인박스)
  start: z.optional(z.number()), // 시각(분). 없으면 그날 미지정 트레이
  min: z.optional(z.number()), // 소요(선택) — 캘린더 블록 높이
  /* ⚠ 이 필드는 2026-07-29 까지 **쓰기 0·읽기 0** 이었다(스키마·동기화 계약엔 있는데 사용자는
     넣을 수도 볼 수도 없었다). 같은 날 배선했다 — 쓰기는 `DayPlanner` 편집 바의 날짜 입력,
     읽기는 트레이 칩의 D-day 배지(`ddayInfo`). 둘 중 하나만 있으면 나머지 하나가 영원히
     빈다는 것이 이 필드가 죽어 있던 이유다.
     ⚠ `Item.deadline`(과목 마감)과 **다른 것**이다 — 이름이 같아 혼동하기 쉽다. */
  deadline: z.optional(z.string()), // ⏰ 마감(선택 · 할 일 전용)
  done: z.optional(z.boolean()),
  doneDs: z.optional(z.string()),
  at: z.optional(z.number()), // 생성 시각(로그·정렬)
  repeat: z.optional(z.enum(['daily', 'weekly'])), // 반복(선택) — 완료 시 다음 occurrence를 새 task로 spawn
});

/* ── 일정(Wave 5) ──────────────────────────────────────────────────────
   과목과 무관하고 반복도 아닌 **단발 일정**(약속·시험·행사). tasks(할 일: 체크해서 완료)와
   의미가 다르다 — 일정은 '그 시각에 일어나는 일'이라 완료 개념이 없고, 대신 **그 시간만큼
   공부 가용시간을 깎는다**(scheduler.dayStudyMin·freeWindowsForDay).
   반복 일과는 routine(요일 기반), 과목 파생 블록은 dayPlans — 셋과 직교한다.
   이름이 PlanEvent인 이유: `Event`는 DOM 전역과 충돌한다.
   ⚠ allDay는 일부러 없다 — '종일'의 가용시간 의미가 모호해(하루 전체를 0으로?) 과설계가 된다.
     종일이 필요하면 start=0·min=1440으로 표현되며, 그 해석은 산술 하나로 일관된다.
   신규·옵셔널·무마이그레이션(기존 저장본은 필드 부재 → 빈 배열로 동작). */
export const PlanEventSchema = z.object({
  id: z.string(),
  ds: z.string(), // 날짜(YYYY-MM-DD) — 일정은 반드시 날짜를 가진다(인박스 없음. 그게 할 일과의 차이)
  start: z.number(), // 자정 기준 분(0~1439)
  min: z.number(), // 길이(분) — start+min<=1440 클램프(events.ts)
  title: z.string(),
  note: z.optional(z.string()),
  color: z.optional(z.string()), // 캘린더 칩 색(선택) — Task와 같은 관례
  at: z.optional(z.number()), // 생성 시각(로그·정렬)
});

/* ── 주간 배분(재개편 v2 §12-3) ─────────────────────────────────────────
   weekMon(ISO 월요일) → sid → 7요일[분](index=wd, 0=일..6=토). '이번 주 어느 과목을 어느 요일에 얼마씩'.
   **매주 새로**(반복 템플릿 아님) · dayPlans(그날 시각 배치)와 직교(이건 그 주 요일 분배 예산).
   옵셔널·passthrough라 기존 저장 100% 호환(무마이그레이션). 배분 있는 주만 스케줄러가 배분 구동, 없으면 자동 불변(§12-4). */
export const WeekAllocSchema = z.record(z.string(), z.record(z.string(), z.array(z.number())));

/** 지식상태(_지식상태.json) — graphPriority 보정에 쓰는 과목 숙달도(서버/외부 캐시). */
export const KnowStateSchema = z.looseObject({
  subjects: z.optional(z.array(z.looseObject({ subject: z.string(), mastery: z.number() }))),
});

export const AppStateSchema = z.looseObject({
  schemaVersion: z.number(),
  theme: ThemeSchema,
  completions: CompletionsSchema,
  startDate: z.string(),
  moduleLen: z.number(),
  reviewRatio: z.number(),
  routine: z.array(RoutineBlockSchema),
  dayOverrides: z.record(z.string(), z.union([z.number(), z.string()])),
  items: z.array(ItemSchema),
  summaries: z.record(z.string(), z.array(SummarySchema)),
  cbms: z.array(CbmsSchema),
  backlog: z.array(BacklogSchema),
  blankResults: z.array(BlankResultSchema),
  retentionLog: z.array(RetentionSchema),
  weekly: z.record(z.string(), WeeklySchema),
  rituals: z.record(z.string(), RitualSchema),
  /* 이어하기 커서(N-7) — **기기 id → 커서**. 옵셔널이라 기존 저장은 무마이그레이션.
       `ds_map` 슬라이스라 기기당 1행이고, 각 기기가 자기 행만 써서 병합 충돌이 없다.
       6시간 TTL 은 읽는 쪽(`latestResume`)이 판정한다 — 저장된 값을 시간이 지났다고 지우는
       배경 작업을 만들면 그게 또 하나의 동기화 쓰기가 되고, 그 쓰기는 아무도 안 읽는다. */
  resume: z.optional(
    z.record(
      z.string(),
      z.object({
        kind: z.enum(['review', 'focus', 'journal']),
        label: z.string(),
        at: z.number(),
        progress: z.optional(z.string()),
        /* E26(2026-07-29) — 집중 세션의 종료 시각(epoch ms). `kind:'focus'` 에만 실린다.
             ⚠ 서버 DDL·zod 가 0인 이유: `resume` 은 `ds_map` 슬라이스이고 그 `value` 는 **JSON
             문자열이라 서버에 불투명**하다. 즉 이 필드는 클라 계약에만 존재한다.
             ⚠ optional 이라 옛 저장본은 무마이그레이션으로 그대로 읽힌다. */
        endsAt: z.optional(z.number()),
      }),
    ),
  ),
  blankReviewWeekly: z.boolean(),
  mockEveryWeeks: z.number(),
  adaptiveCapacity: z.boolean(),
  peakStart: z.string(),
  peakEnd: z.string(),
  reviewViaAnki: z.boolean(),
  graphPriority: z.boolean(),
  degree: DegreeSchema,
  anki: AnkiSchema,
  /** reviewTouches[`${sid}|${chapter}`] = ds(YYYY-MM-DD) — ReviewRun의 챕터 단위 인출 기록.
   *  위험모델(spacedReview)의 lastDs를 계획 밖 복습에서도 갱신(감사 #22). 구버전엔 없음. */
  reviewTouches: z.optional(z.record(z.string(), z.string())),
  /** 일일 배치 오버라이드(§4-1) — 키=ds(YYYY-MM-DD). manual인 날은 그날 배치의 진리=사용자.
   *  옵셔널·무마이그레이션(구버전 저장 무손상 로드). RUNTIME_CACHE_KEYS 아님 → 영속·백업·.ics 대상. */
  dayPlans: z.optional(z.record(z.string(), DayPlanSchema)),
  /** 자유 할 일(§4-4) — 과목 무관 할 일(과제·심부름). 공부 블록과 별개 독립 리스트. 신규·옵셔널·무마이그레이션. */
  tasks: z.optional(z.array(TaskSchema)),
  /** 일정(Wave 5) — 과목 무관 단발 일정(약속·시험·행사). **스케줄 입력**이다(그 시간만큼 가용시간을 깎는다)
   *  → SCHEDULE_INPUT_KEYS에 반드시 포함. 신규·옵셔널·무마이그레이션. RUNTIME_CACHE_KEYS 아님 → 영속·백업 대상. */
  events: z.optional(z.array(PlanEventSchema)),
  /** 주간 배분(§12-3) — 키=weekMon(ISO). 배분 있는 주는 스케줄러 new 블록을 이 요일 벡터로 구동(§12-4).
   *  없는 주는 자동(종전 100% 불변). 옵셔널·무마이그레이션. RUNTIME_CACHE_KEYS 아님 → 영속·백업 대상. */
  weekAlloc: z.optional(WeekAllocSchema),
  // ── 런타임 캐시(영속/내보내기에서 제외 · RUNTIME_CACHE_KEYS) + 테스트 시드 ──
  _today: z.optional(z.string()),
  _knowState: z.optional(KnowStateSchema),
  _vaultScan: z.optional(z.unknown()),
  _ankiFile: z.optional(z.unknown()),
  _ankiLive: z.optional(z.unknown()),
  _icsExport: z.optional(z.unknown()),
  _lastBackupAt: z.optional(z.string()),
  // 축하 모먼트 중복발화 방지 마커 — 영속(RUNTIME_CACHE_KEYS 아님)이라 재로드해도 재발화 안 함.
  _lastStreakCele: z.optional(z.number()), // 마지막으로 축하한 연속 학습일 임계(7·14·30·50·100)
  _degreeCele: z.optional(z.boolean()), // 졸업요건 100% 축하 완료 플래그
});

export type Chapter = z.infer<typeof ChapterSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type RoutineBlock = z.infer<typeof RoutineBlockSchema>;
export type CompletionEntry = z.infer<typeof CompletionEntrySchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type CbmsCode = z.infer<typeof CbmsCodeSchema>;
export type Cbms = z.infer<typeof CbmsSchema>;
export type Backlog = z.infer<typeof BacklogSchema>;
export type BlankResult = z.infer<typeof BlankResultSchema>;
export type Weekly = z.infer<typeof WeeklySchema>;
export type Ritual = z.infer<typeof RitualSchema>;
export type Degree = z.infer<typeof DegreeSchema>;
export type PlacedBlock = z.infer<typeof PlacedBlockSchema>;
export type DayPlan = z.infer<typeof DayPlanSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type PlanEvent = z.infer<typeof PlanEventSchema>;
export type WeekAlloc = z.infer<typeof WeekAllocSchema>;
export type AppState = z.infer<typeof AppStateSchema>;
