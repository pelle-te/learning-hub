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

export interface ScheduleResult {
  days: Day[];
  itemStat: ItemStat[];
  weekHours: Record<string, Record<string, number>>;
  chapterLog: ChapterLogEntry[];
  warnings: string[];
  capUsed: number;
  capTotal: number;
  ML: number;
  adapt?: number;
  adaptApplied?: boolean;
  reviewViaAnki?: boolean;
}

/** layoutDay 산출 — 실제 시각이 배정된 세션·빈 시간. */
export interface LayoutSession extends ScheduleItem {
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
