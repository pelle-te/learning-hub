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
  Backlog,
  BlankResult,
  Weekly,
  Ritual,
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
  deadline?: string;
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
  /** `deadlineThru` 로 범위가 좁혀져 있는가 — 화면이 "전부"와 "시험 범위"를 구분해 말하게 한다. */
  scoped: boolean;
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
