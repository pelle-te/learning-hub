/* ============================================================
   scheduleView.ts — Schedule 탭의 하루치 뷰모델(순수). 컴포넌트에서 분리해 단위테스트 가능.
   scheduler(엔진 결과 ScheduleResult)와 layoutDay(시각배치)를 받아 카드/개요 공용 DayData로 빚는다.
============================================================ */
import { parseCompletionKey } from './domainKeys';
import { dayStudyMin, layoutDay } from './scheduler';
import { isDone } from './persistence';
import { iso, addDays, dayDiff } from './utils';
import type { AppState, ItemStat, ScheduleItem, ScheduleResult, SessionType } from './types';

export interface DeadlineDday {
  name: string;
  color?: string;
  deadline: string;
  dday: number;
}
/** 마감 있고 미완료인 과목의 D-day 목록(가까운 순 정렬) — Today·Schedule·폰·`/alloc` 공유 SSOT.
 *  dday<0(마감 지남)·finished(다 끝낸 과목)는 제외해 두 탭이 항상 같은 '가장 가까운 마감'을 본다
 *  (N-9의 두 탭 복붙 파생을 하나로 수렴 → 규칙 변경 시 재드리프트 예방).
 *
 *  ⚠⚠ **기준은 `nextExam`(다가오는 시험)이지 `deadline`(마지막 시험)이 아니다**(H-2 · 2026-08-06
 *  감사). 종전엔 이 함수가 `deadline` 을 읽어서, 중간고사가 사흘 뒤인데 화면 전체가 기말까지의
 *  D-60 을 그렸다 — 그리고 이 함수가 SSOT 라 **다섯 화면이 한꺼번에** 그 값을 그렸다.
 *  근거 문장은 `semester.ts` 의 `nextExamOf` 가 소유한다. */
export function deadlineDdays(itemStat: ItemStat[] | undefined, todayIso: string): DeadlineDday[] {
  return (itemStat || [])
    .filter((st) => st.nextExam && !st.finished)
    .map((st) => ({
      name: st.name,
      color: st.color,
      deadline: st.nextExam as string,
      dday: dayDiff(todayIso, st.nextExam as string),
    }))
    .filter((st) => st.dday >= 0)
    .sort((a, b) => a.dday - b.dday);
}

/** 통계 '과목별 진행'에서 그 과목이 **지금 손봐야 할 것인가**(UX-2 · 0=평온 · 클수록 급함).
 *  등급은 그 화면이 이미 배지로 말하는 것과 **같은 술어**를 쓴다(배지는 '시간부족'인데 순서는
 *  무관하면 두 신호가 서로를 부정한다):
 *   3 마감초과(late>0) · 2 시간부족(마감 있는데 계획 안에 못 끝냄) · 1 마감 임박(D-7 이내) · 0 그 외.
 *  ⚠ '반복'(daily) 과목은 마감 개념이 없어 항상 0 이다 — 급하지 않은 게 아니라 이 축이 없다. */
export function subjectUrgency(st: ItemStat, todayIso: string): number {
  if (st.daily || !st.deadline) return 0;
  if ((st.late || 0) > 0) return 3;
  if (!st.finished) return 2;
  // ⚠ '임박'은 **다가오는** 시험 기준이다(H-2) — 마지막 시험으로 재면 중간고사 주간이 평온으로 나온다.
  const d = st.nextExam ? dayDiff(todayIso, st.nextExam) : -1;
  return d >= 0 && d <= 7 ? 1 : 0;
}

/** 통계 과목 목록의 **표시 순서**(UX-2). 위험군만 위로 올리는 *안정* 정렬.
 *
 *  왜 안정이어야 하는가: 이 목록은 매번 같은 자리에서 같은 과목을 찾는 화면이다. 급한 것만
 *  위로 올리고 **나머지 상대 순서는 그대로 두어야** 위치 기억이 살아남는다(전체 재정렬은 목록을
 *  매일 새 목록으로 만든다). `Array.prototype.sort` 는 명세상 안정이라 등급만 비교하면 된다.
 *
 *  ⚠ 표시용이다 — 데이터·색·마크업은 손대지 않는다. 정렬 토글 UI 도 붙이지 않는다(과설계).
 */
export function sortSubjectsByUrgency(itemStat: ItemStat[], todayIso: string): ItemStat[] {
  return [...itemStat].sort((a, b) => subjectUrgency(b, todayIso) - subjectUrgency(a, todayIso));
}

/* ── 타임라인 표시 범위 ───────────────────────────────────────────────────
   "일정이 있는 구간 ±여유"로 하루를 좁히는 계산 — 주간 캘린더(spanOf)와 일 편집기(인라인 lo/hi)에
   같은 알고리즘이 두 벌 있었다(스냅 60 vs 30, 폴백만 다름). number[] → {lo,hi} 순수함수인데 뷰
   안에 있어 테스트가 못 닿았다 → 여기로 이주하고 차이는 옵션으로 흡수한다. */
export interface TimeSpanOpts {
  /** 정시/반시 스냅 단위(분). 주간=60, 일 편집기=30. */
  snap?: number;
  /** 앞뒤 여유(분) — 첫/끝 일정이 화면 가장자리에 붙지 않게. */
  pad?: number;
  /** 최소 표시 폭(분) — 일정 하나뿐인 날 타임라인이 납작해지지 않게. */
  minSpan?: number;
  /** 일정이 하나도 없을 때의 창(분). 기본 08:00–(08:00+minSpan). */
  fallback?: { lo: number; hi: number };
  /** 하한/상한 클램프(분) — 일 편집기는 깨어있는 창(wake0~wake1)으로 조인다. 기본 0/1440. */
  min?: number;
  max?: number;
}

/** 일정 시각 목록(분)에서 표시 범위 [lo, hi]를 계산한다. mins가 비면 fallback 창.
 *  ±pad → snap 격자로 확장 → [min,max] 클램프 → minSpan 이중 클램프(hi 먼저, 그래도 좁으면 lo) 순.
 *  마지막 방어: 클램프 창 자체가 minSpan보다 좁아 hi<=lo가 되면 fallback으로 되돌린다. */
export function timeSpan(mins: number[], opts: TimeSpanOpts = {}): { lo: number; hi: number } {
  const snap = opts.snap ?? 60;
  const pad = opts.pad ?? 60;
  const minSpan = opts.minSpan ?? 9 * 60;
  const min = opts.min ?? 0;
  const max = opts.max ?? 1440;
  const fb = opts.fallback ?? { lo: 8 * 60, hi: 8 * 60 + minSpan };

  let lo: number;
  let hi: number;
  if (mins.length) {
    lo = Math.floor((Math.min(...mins) - pad) / snap) * snap;
    hi = Math.ceil((Math.max(...mins) + pad) / snap) * snap;
  } else {
    lo = fb.lo;
    hi = fb.hi;
  }
  lo = Math.max(min, lo);
  hi = Math.min(max, hi);
  if (hi - lo < minSpan) hi = Math.min(max, lo + minSpan);
  if (hi - lo < minSpan) lo = Math.max(min, hi - minSpan);
  if (hi <= lo) return { lo: fb.lo, hi: Math.min(1440, fb.hi) };
  return { lo, hi };
}

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
    const { sid, type } = parseCompletionKey(key);
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

/* ── 캘린더 겹침 배치(lane packing) ───────────────────────────────────────
   시간이 겹치는 일정을 나란한 세로 레인으로 나눠 서로 가리지 않게 한다(TickTick·Google 캘린더 규약).
   순수 함수라 캘린더 뷰(주/일)가 공유하고 테스트로 잠근다 — 픽셀·DOM 무관.

   규칙: ① 시작 시각 오름차순(같으면 긴 일정 먼저 — 큰 덩어리가 왼쪽) ② 시간이 이어지는 동안 한 '클러스터'
   ③ 클러스터 안에서 비어 있는 가장 왼쪽 레인에 배정 ④ 폭은 그 **클러스터의 레인 수**로 나눈다.
   폭을 전역 최대 레인 수로 나누지 않는 게 핵심 — 하루 중 한 번 3중 겹침이 났다고 나머지가 다 1/3로
   쪼그라들면 안 된다. */
export interface LaneItem<T> {
  item: T;
  start: number;
  end: number;
}
export interface PlacedItem<T> extends LaneItem<T> {
  /** 0부터. 이 일정이 앉은 레인. */
  lane: number;
  /** 이 일정이 속한 클러스터의 총 레인 수(=폭 분모). */
  lanes: number;
}

export function packLanes<T>(items: LaneItem<T>[]): PlacedItem<T>[] {
  const sorted = items
    .filter((e) => e.end > e.start)
    .slice()
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: PlacedItem<T>[] = [];
  let cluster: PlacedItem<T>[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const lanes = Math.max(...cluster.map((p) => p.lane)) + 1;
    for (const p of cluster) p.lanes = lanes;
    out.push(...cluster);
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const e of sorted) {
    if (e.start >= clusterEnd) flush(); // 앞 클러스터와 안 겹침 → 끊는다
    // 이 클러스터에서 비어 있는(=끝난) 가장 왼쪽 레인
    const laneEnds: number[] = [];
    for (const p of cluster) laneEnds[p.lane] = Math.max(laneEnds[p.lane] ?? -Infinity, p.end);
    let lane = 0;
    while (lane < laneEnds.length && (laneEnds[lane] ?? -Infinity) > e.start) lane++;
    cluster.push({ ...e, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  flush();
  return out;
}
