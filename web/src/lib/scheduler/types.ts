/* ============================================================
   scheduler/types.ts — 엔진 내부 작업용 타입(외부로 새지 않는다).
   state.items를 건드리지 않고 스케줄링 중에만 붙이는 `_*` 필드들(레거시 s._* 그대로).
============================================================ */
import type { Exam, Item } from '../types';

export interface SchedChapter {
  id: string;
  name: string;
  hours: number;
  /** 어느 시험 범위든 안에 드는가. 시험이 없으면 전부 true(= 종전 동작). */
  inScope: boolean;
  /** T-1. 이 챕터를 덮는 **시험 구간의 순번**(`_segs` 인덱스). -1 = 어느 시험도 안 덮는다.
   *  ⚠ 시험이 0~1개면 `inScope` 와 정보량이 같다(0 또는 -1) — 그래서 종전 동작이 보존된다. */
  segIdx: number;
}
/** T-1. 시험 하나가 만드는 **마감 구간**. 날짜순이고 챕터 순서와 어긋나지 않는다(`examScopes`). */
export interface SchedSegment {
  exam: Exam;
  /** 시험 날짜의 `days` 인덱스(clamp 됨). */
  dlIdx: number;
  /** 이 구간이 덮는 **남은** 챕터들의 시간 합(h). */
  hours: number;
  /** 이 구간 끝까지의 누적 시간(h) — `_cum` 과 직접 비교해 구간별 커버율을 낸다. */
  cumEndH: number;
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
  /** T-1. 시험 구간들(날짜순). 시험이 없으면 빈 배열이고, 그때 모든 판정이 종전 경로로 떨어진다. */
  _segs: SchedSegment[];
  /** **마지막** 시험의 날짜 인덱스(시험 없으면 horizon). 과목 전체의 바깥 울타리다.
   *  ⚠ 새 챕터 배치는 이것이 아니라 **현재 챕터가 속한 구간의 `dlIdx`** 를 본다(`curDl`) —
   *  중간고사 범위 챕터를 기말 날짜까지 미루면 중간을 못 본 채 시험을 치기 때문이다.
   *  복습 꼬리는 여전히 이 값으로 자른다(복습은 시험을 건너 이어져야 한다). */
  _dlIdx: number;
  _schedMin: number;
  _sessions: SchedSession[];
  _carry: number;
  _masteryNeed: number;
  _weekTgt: number;
  _weekDone: number;
}
