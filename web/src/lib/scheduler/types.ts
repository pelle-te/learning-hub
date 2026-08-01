/* ============================================================
   scheduler/types.ts — 엔진 내부 작업용 타입(외부로 새지 않는다).
   state.items를 건드리지 않고 스케줄링 중에만 붙이는 `_*` 필드들(레거시 s._* 그대로).
============================================================ */
import type { Item } from '../types';

export interface SchedChapter {
  id: string;
  name: string;
  hours: number;
  /** 마감(`deadlineThru`)이 덮는 범위 안인가. `deadlineThru` 가 없으면 전부 true(= 종전 동작). */
  inScope: boolean;
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
  /** 마감 범위 안의 남은 시간(h). `deadlineThru` 없으면 `_totalH` 와 같다. 마감 판정의 분모이고,
   *  `_cum`(마감까지 실제로 커버된 시간)과의 차이가 곧 부족분이다 — P-9 컷 리스트의 입력. */
  _scopeH: number;
  _dlIdx: number;
  _schedMin: number;
  _sessions: SchedSession[];
  _carry: number;
  _masteryNeed: number;
  _weekTgt: number;
  _weekDone: number;
}
