/* ============================================================
   scheduleView.ts — Schedule 탭의 하루치 뷰모델(순수). 컴포넌트에서 분리해 단위테스트 가능.
   scheduler(엔진 결과 ScheduleResult)와 layoutDay(시각배치)를 받아 카드/개요 공용 DayData로 빚는다.
============================================================ */
import { dayStudyMin, layoutDay } from './scheduler';
import { isDone } from './persistence';
import { iso, addDays } from './utils';
import type { AppState, ScheduleItem, ScheduleResult, SessionType } from './types';

export type Row =
  | { kind: 'now'; start: number }
  | { kind: 'free'; start: number; end: number }
  | { kind: 'block'; start: number; end: number; name: string; btype: string; color?: string }
  | { kind: 'study'; start: number | null; end: number | null; it: ScheduleItem; plannedMin: number };

export interface DayData {
  date: Date;
  ds: string;
  wd: number;
  isToday: boolean;
  studyMin: number;
  used: number;
  ratio: number;
  over: boolean;
  doneMinTot: number;
  planMin: number;
  freeMin: number;
  defMin: number;
  ovVal: number | string;
  rows: Row[];
  counts: { studies: number; revs: number; ankis: number; blanks: number; mocks: number };
}

/** 세션 타입 → 표시 메타(태그 클래스·짧은 라벨) — Schedule 목록·주간 캘린더 공유 정본. */
export const SESSION_TYPE_META: Record<SessionType, { cls: string; label: string }> = {
  new: { cls: 'new', label: '학습' },
  rev: { cls: 'rev', label: '복습' },
  blank: { cls: 'blank', label: '백지' },
  mock: { cls: 'mock', label: '모의' },
  anki: { cls: 'anki', label: 'Anki' },
};

export type DayIndex = Record<string, ScheduleResult['days'][number]>;
/** ds→Day 인덱스를 한 번만 만든다. computeDay가 7회 호출되며 매번 전체를 재구축하던 것을 호출부로 끌어올려
 *  렌더당 O(7·horizon)→O(horizon)로 줄인다(horizon은 마감 우선 최대 ~180일). */
export function indexDays(res: ScheduleResult): DayIndex {
  const byDs: DayIndex = {};
  (res.days || []).forEach((d) => (byDs[d.ds] = d));
  return byDs;
}

/** 하루치 계산(머리글/막대/타임라인 행/꼬리) — 카드뷰·개요뷰 공용. byDs는 indexDays로 1회 생성해 주입. */
export function computeDay(
  state: AppState,
  byDs: DayIndex,
  capWd: number[],
  nowMin: number,
  todayIso: string,
  curMon: Date,
  k: number,
): DayData {
  const date = addDays(curMon, k);
  const ds2 = iso(date);
  const wd = date.getDay();
  const isToday = ds2 === todayIso;
  const defMin = capWd[wd] ?? 0;
  const studyMin = dayStudyMin(state, ds2, wd, capWd);
  const ovRaw = state.dayOverrides && state.dayOverrides[ds2] != null ? state.dayOverrides[ds2] : '';
  const planDay = byDs[ds2];
  const items = planDay ? planDay.items : [];
  const L = layoutDay(state, { ds: ds2, date, wd, studyMin, used: planDay?.used || 0, modLeft: 0, revLeft: 0, items });
  const used = planDay ? Math.round(planDay.used) : 0;
  const over = used > studyMin + 1;
  const ratio = studyMin ? Math.min(100, Math.round((used / studyMin) * 100)) : 0;

  const plannedByKey: Record<string, number> = {};
  items.forEach((it) => {
    const key = it.sid + '|' + it.type;
    plannedByKey[key] = (plannedByKey[key] || 0) + it.min;
  });
  const planMin = items.reduce((t, it) => t + it.min, 0);
  let doneMinTot = 0;
  Object.keys(plannedByKey).forEach((key) => {
    const [sid, type] = key.split('|');
    if (isDone(state, ds2, sid!, type as SessionType)) doneMinTot += plannedByKey[key]!;
  });

  // 일과 블록 + 학습 세션 + 빈 시간(+오늘이면 현재시각)을 시각순으로.
  const rows: Row[] = [];
  L.tl.forEach((x) => {
    if (x.kind === 'block')
      rows.push({
        kind: 'block',
        start: x.start,
        end: x.end,
        name: x.name || '',
        btype: x.btype || '',
        color: x.color,
      });
    else
      rows.push({
        kind: 'study',
        start: x.start,
        end: x.end,
        it: {
          type: x.type as SessionType,
          sid: x.sid as string,
          name: x.name || '',
          color: x.color,
          min: x.min || 0,
          chapters: x.chapters,
        },
        plannedMin: plannedByKey[(x.sid as string) + '|' + x.type] || x.min || 0,
      });
  });
  L.free.forEach(([s, e]) => rows.push({ kind: 'free', start: s, end: e }));
  if (isToday) rows.push({ kind: 'now', start: nowMin });
  rows.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  // 시각 못 잡은 항목(여유 없음) 보강 — 미배치.
  const shown = new Set(L.tl.filter((x) => x.kind === 'study').map((x) => x.sid + '|' + x.type));
  items.forEach((it) => {
    if (!shown.has(it.sid + '|' + it.type))
      rows.push({
        kind: 'study',
        start: null,
        end: null,
        it,
        plannedMin: plannedByKey[it.sid + '|' + it.type] || it.min,
      });
  });

  const counts = {
    studies: items.filter((it) => it.type === 'new').length,
    revs: items.filter((it) => it.type === 'rev').length,
    ankis: items.filter((it) => it.type === 'anki').length,
    blanks: items.filter((it) => it.type === 'blank').length,
    mocks: items.filter((it) => it.type === 'mock').length,
  };

  return {
    date,
    ds: ds2,
    wd,
    isToday,
    studyMin,
    used,
    ratio,
    over,
    doneMinTot,
    planMin,
    freeMin: L.freeMin,
    defMin,
    ovVal: ovRaw,
    rows,
    counts,
  };
}
