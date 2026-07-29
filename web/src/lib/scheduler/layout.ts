/* ============================================================
   scheduler/layout.ts — 하루치 세션을 '시각'에 앉히는 층(엔진이 '무엇을·얼마나'를 정한 뒤).
   피크 시간대 우선 배치 · 자유 구간 차감 · 남는 분(over) 표시까지.
============================================================ */
import { BLOCK_TYPES, toMin } from '../utils';
import { eventIntervals } from '../events';
import { interleaveByKey } from '../spacedReview';
import { blocksForWeekday, freeWindowsForDay, subtractIntervals } from './windows';
import type { AppState, Day, LayoutResult, LayoutSession, ScheduleItem, TimelineEntry } from '../types';

/** now(자정 기준 분) 이후 남은 '공부 가능' 자유 시간(분) — layoutDay.free 창을 now로 클램프해 합산.
 *  이미 지난 창은 0, now가 창 중간이면 남은 뒷부분만. 오늘 얼마나 더 할 수 있나(홈 리드아웃)의 단일 계산. */
export function freeMinAfter(free: [number, number][], nowMin: number): number {
  return free.reduce((t, [s, e]) => t + Math.max(0, e - Math.max(s, nowMin)), 0);
}

/* 피크 시간대(방법론 1절) — [시작분,끝분] 또는 null. */
/** 세션 배열 → 'sid|type' → 첫 세션의 {start,end} 맵(첫-세션-우선). layoutDay 결과를 소비하는
 *  Today·focusState가 각자 인라인으로 짜던 축약을 하나로(중복 제거 · 규칙 변경 시 단일 수정). */
export function sessionTimeMap(
  sessions: LayoutSession[],
): Record<string, { start: number | null; end: number | null }> {
  const by: Record<string, { start: number | null; end: number | null }> = {};
  sessions.forEach((se) => {
    const k = se.sid + '|' + se.type;
    if (by[k] == null) by[k] = { start: se.start, end: se.end };
  });
  return by;
}

export function peakRange(state: AppState): [number, number] | null {
  const a = state.peakStart;
  const b = state.peakEnd;
  if (!a || !b) return null;
  const s = toMin(a);
  const e = toMin(b);
  return e > s ? [s, e] : null;
}
/* 하루 타임라인: 모듈/복습/Anki에 실제 시각 배정 + 빈 시간 계산.
   피크 시간대가 있으면 고인지부하(new·mock)를 피크 구간에 먼저 배치(방법론 1절). */
export function layoutDay(state: AppState, day: Day): LayoutResult {
  const blocks = blocksForWeekday(state, day.wd);
  // 날짜 창(Wave 5) — 그날 일정 구간이 이미 빠진 창. 자동초안(아래 take/placeItem)이 여기서만 자리를 잡으므로
  // 일정 시간대에는 블록이 놓이지 않는다. 일정 없는 날은 freeWindowsForWeekday와 동일 객체(거동 불변).
  const { wake0, wake1, windows } = freeWindowsForDay(state, day.ds, day.wd);
  const evOcc = eventIntervals(state, day.ds);
  const peak = peakRange(state);
  let segs: [number, number][] = windows.map((w) => [w.s, w.e]);
  const sessions: LayoutSession[] = [];
  const HIGH = (it: ScheduleItem) => it.type === 'new' || it.type === 'mock';
  function take(need: number, prefer: [number, number] | null): { placed: [number, number][]; need: number } {
    const placed: [number, number][] = [];
    const cand: [number, number][] = [];
    segs.forEach((seg) => {
      let [s, e] = seg;
      if (prefer) {
        s = Math.max(s, prefer[0]);
        e = Math.min(e, prefer[1]);
      }
      if (e > s) cand.push([s, e]);
    });
    cand.sort((a, b) => a[0] - b[0]);
    for (const [s, e] of cand) {
      if (need <= 0) break;
      const use = Math.min(e - s, need);
      placed.push([s, s + use]);
      need -= use;
    }
    if (placed.length) segs = subtractIntervals(segs, placed);
    return { placed, need };
  }
  function placeItem(it: ScheduleItem, prefer: [number, number] | null): void {
    let need = it.min;
    if (prefer) {
      const r = take(need, prefer);
      r.placed.forEach(([s, e]) => sessions.push({ ...it, start: s, end: e }));
      need = r.need;
    }
    if (need > 0) {
      const r = take(need, null);
      r.placed.forEach(([s, e]) => sessions.push({ ...it, start: s, end: e }));
      need = r.need;
    }
    if (need > 0) sessions.push({ ...it, start: null, end: null, over: need });
  }
  // 명시 배치(start!=null · §4-2) — 그 시각을 먼저 점유하고 segs에서 뺀다(수동 타임박스). 나머지 auto만 패킹.
  // 명시 배치가 하나도 없으면 fixed=[]·auto=day.items → 아래 auto 패킹이 종전과 100% 동일(자동 불변).
  const fixed = day.items.filter((it) => it.start != null);
  const auto = day.items.filter((it) => it.start == null);
  fixed.forEach((it) => {
    const s = it.start as number;
    const e = s + it.min;
    segs = subtractIntervals(segs, [[s, e]]);
    sessions.push({ ...it, start: s, end: e });
  });
  /** 인터리빙 키 — 과목이다(같은 과목의 여러 블록이 연달아 오지 않게). */
  const sidOf = (it: ScheduleItem): string => it.sid;

  /* ── E25 계획도 과목을 섞는다(2026-07-29) ──────────────────────────────
     종전엔 `auto.slice()` — **생성 순 = 배치 순**이라 같은 과목 블록이 연달아 놓였다. 그런데
     이 앱은 복습 12장에 대해선 인터리빙을 지키고 있었다(`interleaveBySubject`) — 즉 규칙이
     작은 쪽에만 적용되고 **하루 6시간의 본 학습에는 안 적용**되는 비대칭이었다.

     ⚠ peak 규칙과의 충돌을 이렇게 푼다: **peak 이 티어를 정하고, 인터리빙이 그 안을 정한다.**
     복습 큐가 이미 쓰는 구조 그대로다(위험 티어=바깥 · 과목 라운드로빈=안). 둘 다 순서를
     주장하는데 한쪽만 존재해서 충돌이 안 보였던 자리다.
     ⚠ **블록 구성·분·개수는 안 바뀐다** — 순열이다. 되돌리기가 싸다는 것이 이 안의 안전장치이고,
       `dayPlans.mode='manual'` 이 그날 배치의 최종 진리라는 계약도 그대로다.
     ⚠ 이득 부호는 **미확인**이다(로드맵 원문): 인터리빙 이득은 *같은 종류의 문제를 섞을 때*
       크고 여기 블록은 이미 과목별 큰 덩어리라, 컨텍스트 전환 비용이 이길 수 있다. 순열이라
       되돌리기가 한 줄이므로 지르되, 그 불확실을 여기 적어 둔다. */
  const order = peak
    ? [
        ...interleaveByKey(auto.filter(HIGH), sidOf),
        ...interleaveByKey(
          auto.filter((it) => !HIGH(it)),
          sidOf,
        ),
      ]
    : interleaveByKey(auto, sidOf);
  order.forEach((it) => placeItem(it, peak && HIGH(it) ? peak : null));
  const tl: TimelineEntry[] = [];
  blocks
    .filter((b) => b.type !== '수면')
    .forEach((b) => {
      const s = toMin(b.start);
      const e = toMin(b.end);
      // 자정 걸침 → 두 세그먼트(end<start인 깨진 항목 방지 — freeWindows 분할과 동일 규칙).
      const segs: [number, number][] =
        s <= e
          ? [[s, e]]
          : [
              [s, 1440],
              [0, e],
            ];
      segs.forEach(([ss, ee]) =>
        tl.push({
          kind: 'block',
          name: b.name,
          btype: b.type,
          start: ss,
          end: ee,
          color: BLOCK_TYPES[b.type],
        }),
      );
    });
  sessions.forEach((s) => {
    if (s.start != null)
      tl.push({
        kind: 'study',
        start: s.start,
        end: s.end as number,
        type: s.type,
        sid: s.sid,
        name: s.name,
        color: s.color,
        chapters: s.chapters,
        min: s.min,
      });
  });
  tl.sort((a, b) => a.start - b.start);
  const occ = tl
    .filter((x) => x.start != null)
    .map((x): [number, number] => [x.start, x.end])
    .sort((a, b) => a[0] - b[0]);
  const raw: [number, number][] = [];
  let p = wake0;
  occ.forEach(([s, e]) => {
    if (s > p) raw.push([p, s]);
    p = Math.max(p, e);
  });
  if (p < wake1) raw.push([p, wake1]);
  // 일정 구간을 빈 시간에서 제외(Wave 5) — 일정은 tl에 넣지 않는다(TimelineEntry.kind 계약을 건드리면
  // 소비처가 일정을 'study'로 오독한다). 대신 free에서만 빼 "지금 더 할 수 있는 시간"(freeMinAfter·
  // 오늘 리드아웃)이 약속 시간을 공부 가능으로 세지 않게 한다. 일정 없는 날은 무동작(종전 100% 동일).
  const free = evOcc.length ? subtractIntervals(raw, evOcc) : raw;
  const freeMin = free.reduce((t, [s, e]) => t + (e - s), 0);
  return { tl, free, freeMin, sessions };
}
