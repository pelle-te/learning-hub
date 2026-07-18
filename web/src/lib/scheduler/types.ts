/* ============================================================
   scheduler/types.ts — 엔진 내부 작업용 타입(외부로 새지 않는다).
   state.items를 건드리지 않고 스케줄링 중에만 붙이는 `_*` 필드들(레거시 s._* 그대로).
============================================================ */
import type { Item } from '../types';

export interface SchedChapter {
  name: string;
  hours: number;
}
export interface SchedSession {
  di: number;
  ds: string;
  chapters: string[];
}
/** 스케줄링 중 과목에 붙는 작업용 필드(레거시 s._* 그대로). 원본 state.items는 안 건드림. */
export interface SchedSubject extends Item {
  _allTotal: number;
  _done0: number;
  _hadChapters: boolean;
  _chs: SchedChapter[];
  _cum: number;
  _idx: number;
  _totalH: number;
  _dlIdx: number;
  _schedMin: number;
  _sessions: SchedSession[];
  _carry: number;
  _masteryNeed: number;
  _weekTgt: number;
  _weekDone: number;
}
