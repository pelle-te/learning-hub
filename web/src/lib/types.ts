/* ============================================================
   types.ts — 영속 모델 타입(zod에서 추론)을 재노출 + 영속되지 않는 파생/런타임 타입.
   스케줄러 결과(schedule)·레이아웃(layoutDay)·저장소(KV)는 검증 대상이 아니라
   순수 계산 산출/인터페이스이므로 여기 인터페이스로 둔다.
============================================================ */
export type {
  Theme,
  Chapter,
  Item,
  RoutineBlock,
  CompletionEntry,
  Summary,
  CbmsCode,
  Cbms,
  /** T-7 문항 원장 한 건. */
  Question,
  /** T-9 지연 JOL 예측 한 건. ⚠ 해소는 저장하지 않는다(`lib/delayedJol` 머리주석). */
  JolAsk,
  Backlog,
  BlankResult,
  Weekly,
  Ritual,
  ExamKind,
  Exam,
  Course,
  Semester,
  Degree,
  PlacedBlock,
  DayPlan,
  Task,
  PlanEvent,
  WeekAlloc,
  AppState,
} from './schema';

/** localStorage 호환 최소 인터페이스 — 부팅/영속을 주입형으로(테스트는 Map 기반 KV). */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SessionType = 'anki' | 'new' | 'rev' | 'blank' | 'mock';

/** 하루 안에 배치된 학습/복습/Anki/백지/모의 블록. */
export interface ScheduleItem {
  type: SessionType;
  sid: string;
  name: string;
  color?: string;
  min: number;
  chapters?: string[];
  mod?: boolean;
  /** 명시 배치 시각(자정 기준 분 · §4-2) — dayPlans 수동 오버라이드가 실어보내면 layoutDay가 그 시각에 고정.
   *  없으면(자동초안) layoutDay가 빈 창에 자동 패킹(종전 동작). */
  start?: number;
}

export interface Day {
  ds: string;
  date: Date;
  wd: number;
  studyMin: number;
  used: number;
  modLeft: number;
  revLeft: number;
  items: ScheduleItem[];
}

export interface ItemStat {
  id: string;
  name: string;
  color?: string;
  weeklyHours?: number;
  totalCh?: number;
  doneCh?: number;
  totalH?: number;
  schedH: number;
  /**
   * 이 과목의 **끝** = 마지막 시험 날짜(T-1). `late`·`finished` 판정의 기준이다.
   *
   * ⚠⚠ **화면의 D-day 로 쓰지 말 것 — 그건 `nextExam` 이다**(H-2 · 2026-08-06 감사).
   * 중간고사가 코앞인데 기말까지의 D-60 을 보여주면 그 숫자는 거짓말이다. `semester.ts` 가
   * `nextExamOf` 를 만들며 그 문장을 그대로 적어 뒀는데도, 실제로는 `/today`·`/schedule`·
   * `/alloc`·`/items`·폰이 전부 이 필드를 그리고 있었다(선언이 코드에 안 닿은 형태).
   */
  deadline?: string;
  /** **다가오는** 시험 날짜(오늘 이후 중 가장 가까운 것 · 없으면 undefined). 화면 D-day 는 이것. */
  nextExam?: string;
  finishDate?: string | null;
  finished?: boolean;
  late?: number;
  daily?: boolean;
  dailyMin?: number;
  days?: number;
}

export interface ChapterLogEntry {
  ds: string;
  date: Date;
  name: string;
  color?: string;
  chapters: string[];
}

/** 마감 범위를 못 끝내는 과목 1건 — **P-9 컷 리스트의 입력**.
 *  옛 코드는 이걸 `warnings` 의 회색 텍스트 한 줄로 냈고 유일한 처방이 `주당 시간↑` 이었다.
 *  그건 사용자가 할 수 없는 것이라(주당 시간은 늘지 않는다) **액션이 0인 경고**였고, 그 결과
 *  엔진이 사용자를 labor-in-vain 쪽으로 밀었다. 부족분을 알면 처방은 "무엇을 뺄까"여야 한다.
 *  ⚠ 앱은 **이미 조용히 버리고 있다** — EDF 로 채우다 창이 끝나면 뒤쪽 챕터가 그냥 안 배치된다.
 *  이 구조는 없는 결정을 새로 만드는 게 아니라 **이미 내려지고 있는 결정을 돌려주는 것**이다. */
export interface Shortfall {
  sid: string;
  name: string;
  color?: string;
  deadline: string;
  /** 범위 내 남은 시간(h) */
  needH: number;
  /** 마감까지 실제로 들어가는 시간(h) */
  fitH: number;
  /** 부족분(h) = needH - fitH */
  gapH: number;
  /** 범위가 좁혀져 있는가 — 화면이 "전부"와 "시험 범위"를 구분해 말하게 한다. */
  scoped: boolean;
  /** T-1. 어느 시험의 부족분인가. 과목당 **시험마다 하나씩** 나올 수 있다(중간은 벅찬데 기말은
   *  여유로운 상태가 실재한다 — 옛 모델은 그 둘을 한 덩어리로 뭉개 하나의 경고만 냈다).
   *  옛 저장(시험 0~1개)에서는 종전처럼 과목당 최대 1건이라 화면이 달라지지 않는다. */
  examId: string;
  /** 화면에 쓰는 시험 이름(`중간`·`기말`). 옛 단일 마감에서 승격된 것은 `기말`이다. */
  examLabel: string;
  /** 컷 후보 — **남은 시간 큰 것부터 · 동률이면 뒤 챕터부터**. 이 규칙은 화면에도 적힌다. */
  candidates: { id: string; name: string; hours: number }[];
  /** 위 규칙으로 부족분을 덮는 최소 접두(챕터 id) — 기본 선택. 사용자가 뒤집을 수 있다. */
  suggest: string[];
}

export interface ScheduleResult {
  days: Day[];
  itemStat: ItemStat[];
  weekHours: Record<string, Record<string, number>>;
  chapterLog: ChapterLogEntry[];
  warnings: string[];
  shortfalls: Shortfall[];
  capUsed: number;
  capTotal: number;
  ML: number;
  adapt?: number;
  adaptApplied?: boolean;
  reviewViaAnki?: boolean;
}

/** layoutDay 산출 — 실제 시각이 배정된 세션·빈 시간. start는 배치 후 확정값(미배치=null)이라
 *  ScheduleItem.start(옵셔널 입력 힌트)를 Omit하고 number|null로 재선언한다. */
export interface LayoutSession extends Omit<ScheduleItem, 'start'> {
  start: number | null;
  end: number | null;
  over?: number;
}
export interface TimelineEntry {
  kind: 'block' | 'study';
  name?: string;
  btype?: string;
  start: number;
  end: number;
  color?: string;
  type?: SessionType;
  sid?: string;
  chapters?: string[];
  min?: number;
}
export interface LayoutResult {
  tl: TimelineEntry[];
  free: [number, number][];
  freeMin: number;
  sessions: LayoutSession[];
}

export interface FreeWindows {
  wake0: number;
  wake1: number;
  windows: { s: number; e: number }[];
  freeMin: number;
}
