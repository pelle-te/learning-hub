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
});

export const CompletionEntrySchema = z.object({ done: z.boolean(), min: z.number() });
/** completions[ds][`${sid}|${type}`] = {done,min} */
export const CompletionsSchema = z.record(z.record(CompletionEntrySchema));

export const SummarySchema = z.object({
  id: z.string(),
  sid: z.string(),
  name: z.string(),
  s1: z.string(),
  s2: z.string(),
  s3: z.string(),
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

export const CourseSchema = z.object({}).passthrough(); // 학기 과목 — Phase 4 졸업 탭에서 정밀화
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
});

export const AnkiSchema = z.object({ source: z.string() });

/** 지식상태(_지식상태.json) — graphPriority 보정에 쓰는 과목 숙달도(서버/외부 캐시). */
export const KnowStateSchema = z
  .object({
    subjects: z.array(z.object({ subject: z.string(), mastery: z.number() }).passthrough()).optional(),
  })
  .passthrough();
export type KnowState = z.infer<typeof KnowStateSchema>;

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
    // ── 런타임 캐시(영속/내보내기에서 제외 · RUNTIME_CACHE_KEYS) + 테스트 시드 ──
    _today: z.string().optional(),
    _knowState: KnowStateSchema.optional(),
    _vaultScan: z.unknown().optional(),
    _ankiFile: z.unknown().optional(),
    _ankiLive: z.unknown().optional(),
    _icsExport: z.unknown().optional(),
    _lastBackupAt: z.string().optional(),
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
export type Retention = z.infer<typeof RetentionSchema>;
export type Weekly = z.infer<typeof WeeklySchema>;
export type Ritual = z.infer<typeof RitualSchema>;
export type Degree = z.infer<typeof DegreeSchema>;
export type AppState = z.infer<typeof AppStateSchema>;
