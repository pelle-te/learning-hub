/* ============================================================
   schema.ts — 경계의 데이터 계약(zod). 스키마=타입=런타임 가드를 일원화한다.
   레거시 모델 v3(localStorage KEY 'study_planner_v3')와 **바이트 호환**:
   필드/스키마를 그대로 옮겨 기존 백업 JSON이 100% 로드되게 한다.
   ※ migrate/validShape의 *동작*은 persistence.ts가 손코딩 그대로 보존(테스트 회귀 방지).
     여기 스키마는 (1) 타입 추론의 단일 원천 (2) 선택적 런타임 검증에 쓴다.
============================================================ */
import { z } from 'zod';

export const ThemeSchema = z.enum(['light', 'dark']);
export type Theme = z.infer<typeof ThemeSchema>;

export const ChapterSchema = z.object({
  id: z.string(),
  name: z.string(),
  hours: z.number(),
  done: z.boolean(),
});

export const ItemModeSchema = z.enum(['weekly', 'daily']);

export const ItemSchema = z
  .object({
    id: z.string(),
    source: z.string().optional(),
    name: z.string(),
    color: z.string().optional(),
    mode: ItemModeSchema,
    weeklyHours: z.number().optional(),
    dailyMin: z.number().optional(),
    deadline: z.string().optional(),
    chapters: z.array(ChapterSchema).default([]),
  })
  .passthrough();

export const RoutineBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  start: z.string(),
  end: z.string(),
  days: z.array(z.number()),
  // 요일별 시간 오버라이드(선택) — 키=요일(일0..토6) 문자열. 없으면 start/end 공통 적용.
  // 일과 블록도 수업처럼 요일마다 다른 시간을 가질 수 있게(blocksForWeekday가 단일 지점서 해석).
  times: z.record(z.object({ start: z.string(), end: z.string() })).optional(),
});

/** doneDs = 실제 완료 날짜(감사 2026-07-16 ②#23) — 복습 사다리 앵커. 옵셔널이라 기존 저장 무마이그레이션
 *  (없으면 계획일 앵커 = 종전 동작). 계획일(completions 키)과 다르면 '늦게 완료'를 뜻한다. */
export const CompletionEntrySchema = z.object({ done: z.boolean(), min: z.number(), doneDs: z.string().optional() });
/** completions[ds][`${sid}|${type}`] = {done,min} */
export const CompletionsSchema = z.record(z.record(CompletionEntrySchema));

export const SummarySchema = z.object({
  id: z.string(),
  sid: z.string(),
  name: z.string(),
  s1: z.string(),
  s2: z.string(),
  s3: z.string(),
  at: z.number().optional(), // 작성 시각(epoch ms) — 구버전엔 없음(로그 타임스탬프·정렬용)
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
  conf: z.boolean().optional(), // 구버전엔 없음 — '찍어서 맞음' 플래그(F-06)
  at: z.number().optional(), // 작성 시각(epoch ms) — 구버전엔 없음(로그 타임스탬프)
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
  at: z.number().optional(), // 작성 시각(epoch ms) — 구버전엔 없음(로그 타임스탬프)
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
  checks: z.record(z.boolean()),
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
  grade: z.string().optional(),
});
export const SemesterSchema = z.object({
  id: z.string(),
  name: z.string(),
  courses: z.array(CourseSchema).default([]),
});
export const DegreeSchema = z.object({
  targetTotal: z.number(),
  reqMajorReq: z.number(),
  reqMajorSel: z.number(),
  reqLiberal: z.number(),
  semesters: z.array(SemesterSchema),
  targetGpa: z.number().optional(), // 목표 졸업 GPA(역산 계산기) — 옵셔널이라 기존 저장 상태 무마이그레이션.
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
  color: z.string().optional(),
  start: z.number().optional(), // 자정 기준 분(명시 배치) — layoutDay가 존중. 없으면 미지정(트레이).
  min: z.number(),
  chapters: z.array(z.string()).optional(),
  pinned: z.boolean().optional(), // 자동 재계산에서 보존
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
  sid: z.string().optional(), // 연결 과목(선택) — 색·필터용. 없으면 순수 자유 할 일
  color: z.string().optional(),
  ds: z.string().optional(), // 배정 날짜(YYYY-MM-DD). 없으면 '언젠가'(인박스)
  start: z.number().optional(), // 시각(분). 없으면 그날 미지정 트레이
  min: z.number().optional(), // 소요(선택) — 캘린더 블록 높이
  deadline: z.string().optional(), // ⏰ 마감(선택)
  done: z.boolean().optional(),
  doneDs: z.string().optional(),
  at: z.number().optional(), // 생성 시각(로그·정렬)
  repeat: z.enum(['daily', 'weekly']).optional(), // 반복(선택) — 완료 시 다음 occurrence를 새 task로 spawn
});

/* ── 주간 배분(재개편 v2 §12-3) ─────────────────────────────────────────
   weekMon(ISO 월요일) → sid → 7요일[분](index=wd, 0=일..6=토). '이번 주 어느 과목을 어느 요일에 얼마씩'.
   **매주 새로**(반복 템플릿 아님) · dayPlans(그날 시각 배치)와 직교(이건 그 주 요일 분배 예산).
   옵셔널·passthrough라 기존 저장 100% 호환(무마이그레이션). 배분 있는 주만 스케줄러가 배분 구동, 없으면 자동 불변(§12-4). */
export const WeekAllocSchema = z.record(z.record(z.array(z.number())));

/** 지식상태(_지식상태.json) — graphPriority 보정에 쓰는 과목 숙달도(서버/외부 캐시). */
export const KnowStateSchema = z
  .object({
    subjects: z.array(z.object({ subject: z.string(), mastery: z.number() }).passthrough()).optional(),
  })
  .passthrough();

export const AppStateSchema = z
  .object({
    schemaVersion: z.number(),
    theme: ThemeSchema,
    completions: CompletionsSchema,
    startDate: z.string(),
    moduleLen: z.number(),
    reviewRatio: z.number(),
    routine: z.array(RoutineBlockSchema),
    dayOverrides: z.record(z.union([z.number(), z.string()])),
    items: z.array(ItemSchema),
    summaries: z.record(z.array(SummarySchema)),
    cbms: z.array(CbmsSchema),
    backlog: z.array(BacklogSchema),
    blankResults: z.array(BlankResultSchema),
    retentionLog: z.array(RetentionSchema),
    weekly: z.record(WeeklySchema),
    rituals: z.record(RitualSchema),
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
    reviewTouches: z.record(z.string()).optional(),
    /** 일일 배치 오버라이드(§4-1) — 키=ds(YYYY-MM-DD). manual인 날은 그날 배치의 진리=사용자.
     *  옵셔널·무마이그레이션(구버전 저장 무손상 로드). RUNTIME_CACHE_KEYS 아님 → 영속·백업·.ics 대상. */
    dayPlans: z.record(DayPlanSchema).optional(),
    /** 자유 할 일(§4-4) — 과목 무관 할 일(과제·심부름). 공부 블록과 별개 독립 리스트. 신규·옵셔널·무마이그레이션. */
    tasks: z.array(TaskSchema).optional(),
    /** 주간 배분(§12-3) — 키=weekMon(ISO). 배분 있는 주는 스케줄러 new 블록을 이 요일 벡터로 구동(§12-4).
     *  없는 주는 자동(종전 100% 불변). 옵셔널·무마이그레이션. RUNTIME_CACHE_KEYS 아님 → 영속·백업 대상. */
    weekAlloc: WeekAllocSchema.optional(),
    // ── 런타임 캐시(영속/내보내기에서 제외 · RUNTIME_CACHE_KEYS) + 테스트 시드 ──
    _today: z.string().optional(),
    _knowState: KnowStateSchema.optional(),
    _vaultScan: z.unknown().optional(),
    _ankiFile: z.unknown().optional(),
    _ankiLive: z.unknown().optional(),
    _icsExport: z.unknown().optional(),
    _lastBackupAt: z.string().optional(),
    // 축하 모먼트 중복발화 방지 마커 — 영속(RUNTIME_CACHE_KEYS 아님)이라 재로드해도 재발화 안 함.
    _lastStreakCele: z.number().optional(), // 마지막으로 축하한 연속 학습일 임계(7·14·30·50·100)
    _degreeCele: z.boolean().optional(), // 졸업요건 100% 축하 완료 플래그
  })
  .passthrough();

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
export type WeekAlloc = z.infer<typeof WeekAllocSchema>;
export type AppState = z.infer<typeof AppStateSchema>;
