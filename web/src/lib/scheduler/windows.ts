/* ============================================================
   scheduler/windows.ts — 하루의 '공부 가능 시간'을 구간으로 계산하는 층.
   일과(routine) 블록 → 깨어있는 창 → 자유 구간 → 일정(events) 차감 → 요일/날짜별 가용 분.
   엔진(schedule)과 배치(layout)가 모두 이 층 위에서 돈다.
============================================================ */
import { BLOCK_SLEEP, toMin } from '../utils';
import { eventIntervals } from '../events';
import { taskIntervals, untimedChoreMin } from '../tasks';
import type { AppState, FreeWindows, RoutineBlock } from '../types';

/** 빈 구간 배열에서 여러 [a,b]를 빼서 새 배열을 만든다(중간을 빼면 둘로 쪼갬). */
export function subtractIntervals(segs: [number, number][], intervals: [number, number][]): [number, number][] {
  let res: [number, number][] = segs.map((x) => [x[0], x[1]]);
  intervals.forEach(([a, b]) => {
    const out: [number, number][] = [];
    res.forEach(([s, e]) => {
      if (b <= s || a >= e) {
        out.push([s, e]);
        return;
      }
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
    });
    res = out.filter(([s, e]) => e > s);
  });
  return res;
}

export function blocksForWeekday(state: AppState, wd: number): RoutineBlock[] {
  // 요일별 시간 오버라이드(times[wd])가 있으면 그 시간으로 해석 — 단일 지점이라 링·빈시간·레이아웃 전부 자동 반영.
  return state.routine
    .filter((b) => b.days.includes(wd))
    .map((b) => {
      const t = b.times?.[String(wd)];
      return t ? { ...b, start: t.start, end: t.end } : b;
    })
    .sort((a, b) => toMin(a.start) - toMin(b.start));
}
/** 깨어있는 시간 [wake0,wake1] — 수면 블록(들)로 결정(없으면 00:00~24:00).
 *  모델: 수면은 하루의 양 끝을 차지하고 자정을 가로지른다 → 깨어있는 구간은 단일 창 [wake0,wake1],
 *  수면은 그 여집합 [wake1,1440]∪[0,wake0]. 수면을 어떻게 입력하든 동일하게 해석한다:
 *  단일 칸 `23:00–07:00`(자정 넘김)이든, `00:00–07:00`+`23:00–24:00` 두 칸이든.
 *   - wake0 = 하루 시작(0)에 붙은 수면의 끝(= 기상). 그런 수면이 없으면 0.
 *   - wake1 = 하루 끝(1440)에 붙은 수면의 시작(= 취침). 그런 수면이 없으면 1440.
 *  자정 넘김(start>end)은 [start,1440]·[0,end] 두 구간으로 분할해 판정한다.
 *  (옛 구현은 sleep[0]만 보고 start===0 / end>=1380 휴리스틱이라 `23:00–07:00` 한 칸을 통째로
 *   놓쳐 심야에 공부를 배정하는 버그가 있었다.) */
export function awakeBounds(blocks: RoutineBlock[]): [number, number] {
  let wake0 = 0;
  let wake1 = 1440;
  blocks
    .filter((b) => b.type === BLOCK_SLEEP)
    .forEach((b) => {
      const s = toMin(b.start);
      const e = toMin(b.end);
      const segs: [number, number][] =
        s <= e
          ? [[s, e]]
          : [
              [s, 1440],
              [0, e],
            ];
      segs.forEach(([a, c]) => {
        if (a <= 0 && c > wake0) wake0 = c; // 하루 시작에 붙은 수면 → 기상 시각
        if (c >= 1440 && a < wake1) wake1 = a; // 하루 끝에 붙은 수면 → 취침 시각
      });
    });
  return wake0 <= wake1 ? [wake0, wake1] : [0, 1440];
}
/** 요일의 '공부 가능' 빈 구간 = 깨어있는 시간 − 모든 고정 블록(수면 포함).
 *  가장자리 수면은 awakeBounds가 [wake0,wake1] 밖으로 밀어 클램프 시 폭0으로 사라지고,
 *  한낮 수면(낮잠, 예: 13:00–14:00)만 점유로 남아 공부시간 이중계상을 막는다(X-2). */
/* 요일 창 캐시 — 결과는 요일당 7가지뿐인데 계산은 routine 전체를 flatMap·map·filter·sort한다.
   `dayStudyMin`이 `eventStudyLossMin`을 거쳐 이걸 부르고, 그 `dayStudyMin`은 adherenceFactor 루프와
   일자 생성 루프에서 각각 horizon회 호출된다 — 일정이 있는 긴 계획이면 같은 7개 값을 수천 번 다시 만든다.
   화면 쪽도 마찬가지다(AvailRail·Items가 렌더마다 7회씩).
   state 참조가 바뀌면(=편집이 있으면) 통째로 버린다 — selectSchedule의 참조-캐시와 같은 규율.
   ⚠ 반환 객체를 **변형하지 말 것**(전 소비처가 읽기 전용으로 쓰는 것을 확인하고 캐시를 넣었다). */
let wdCache: { state: AppState; slots: (FreeWindows | undefined)[] } | null = null;

export function freeWindowsForWeekday(state: AppState, wd: number): FreeWindows {
  if (!wdCache || wdCache.state !== state) wdCache = { state, slots: new Array(7) };
  const hit = wdCache.slots[wd];
  if (hit) return hit;
  const out = computeFreeWindowsForWeekday(state, wd);
  wdCache.slots[wd] = out;
  return out;
}

function computeFreeWindowsForWeekday(state: AppState, wd: number): FreeWindows {
  const blocks = blocksForWeekday(state, wd);
  const [wake0, wake1] = awakeBounds(blocks);
  const occ = blocks
    .flatMap((b): [number, number][] => {
      // 자정을 걸치는 블록(예: 23:00–01:00)은 두 구간으로 분할 — 안 하면 e<s로 걸러져
      // 그 시간이 '공부 가능'으로 잘못 남는다(수면과 동일 규칙).
      const s = toMin(b.start);
      const e = toMin(b.end);
      return s <= e
        ? [[s, e]]
        : [
            [s, 1440],
            [0, e],
          ];
    })
    .map(([s, e]): [number, number] => [Math.max(wake0, s), Math.min(wake1, e)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  occ.forEach(([s, e]) => {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  });
  const windows: { s: number; e: number }[] = [];
  let p = wake0;
  merged.forEach(([s, e]) => {
    if (s > p) windows.push({ s: p, e: s });
    p = Math.max(p, e);
  });
  if (p < wake1) windows.push({ s: p, e: wake1 });
  const freeMin = windows.reduce((t, w) => t + (w.e - w.s), 0);
  return { wake0, wake1, windows, freeMin };
}
/** **날짜**의 공부 가능 빈 구간 — 요일 창(freeWindowsForWeekday)에서 **그날 일정(events)을 점유로 뺀** 결과.
 *  요일 창은 반복(routine) 기반이라 날짜별 단발 일정을 담을 수 없다 → 날짜를 아는 변형을 얹는다.
 *  ⚠ 기존 freeWindowsForWeekday의 시그니처·거동은 **불변**(호출처 다수 · 회귀 위험) — 여기서 재사용만 한다.
 *  일정이 없는 날은 요일 창을 **그대로 반환**(추가 계산 0) → 거동 100% 종전(자동 불변식).
 *  wake0/wake1(깨어있는 경계)은 일정이 바꾸지 않는다 — 일정은 창 안의 점유일 뿐 기상/취침이 아니다. */
/** 그날 창을 먹는 **점유 구간 전부** — 일정(events) ∪ 시각이 박힌 미완 과제(N-1).
 *
 *  ⚠⚠ 과제가 여기 들어온 것이 N-1 이다(W8 · 2026-08-07). 종전엔 캘린더가 과제 카드를 그리면서
 *  스케줄러는 그 시간에 학습 블록을 **그대로 겹쳐 놓았다** — 화면에는 둘 다 있는데 시간은 한
 *  번뿐이라, 그 날은 만들어지는 순간부터 넘쳤다. 근거·구간과 총량을 가르는 이유는
 *  `lib/tasks.ts` 의 N-1 주석이 SSOT.
 *  ⚠ 배열을 새로 만든다 — `eventIntervals` 는 **캐시된 배열을 그대로** 돌려주므로 여기에
 *  `push` 하면 그 인덱스가 오염된다(그 함수 주석이 경고한 형태). */
function dayOccupancy(state: AppState, ds: string): [number, number][] {
  const ev = eventIntervals(state, ds);
  const tk = taskIntervals(state, ds);
  if (!tk.length) return ev;
  return [...ev, ...tk].sort((a, b) => a[0] - b[0]);
}

export function freeWindowsForDay(state: AppState, ds: string, wd: number): FreeWindows {
  const base = freeWindowsForWeekday(state, wd);
  const occ = dayOccupancy(state, ds);
  if (!occ.length) return base;
  const segs = subtractIntervals(
    base.windows.map((w): [number, number] => [w.s, w.e]),
    occ,
  );
  const windows = segs.map(([s, e]) => ({ s, e }));
  return { wake0: base.wake0, wake1: base.wake1, windows, freeMin: windows.reduce((t, w) => t + (w.e - w.s), 0) };
}

/** 그날 **점유 구간**(일정 + 시각 박힌 과제)이 '공부 가능 시간'에서 실제로 깎는 분
 *  = 요일 자유창 총합 − 점유를 뺀 창 총합.
 *
 *  ⚠ 이중 차감 방지의 핵심: 길이를 그냥 빼지 않고 **창과의 교집합**만 뺀다. 그래서
 *   · 수업/일과와 겹치는 일정(이미 공부시간이 아님) → 추가 차감 0
 *   · 수면 등 깨어있는 창 밖의 일정 → 차감 0
 *   · 겹치는 둘(이중 약속 · 과제와 겹친 약속) → 합집합만큼만 1회 차감(subtractIntervals 멱등)
 *  이 유도 방식이 "가장 정직한" 경로다 — (a)총량과 (b)구간이 같은 창 계산에서 파생돼 서로 어긋날 수 없다.
 *  ⚠ 옛 이름은 `eventStudyLossMin` 이었다 — N-1 이 과제를 같은 축에 넣으며 이름이 좁아졌다.
 *  이름이 `event` 면 소비처가 "과제는 왜 여기 있나"를 매번 다시 물어야 한다(`railTabs` 개명과 같은 판단). */
export function dayOccupancyLossMin(state: AppState, ds: string, wd: number): number {
  /* 점유 없는 날은 창 계산 자체를 생략한다.
     ⚠ 종전 이 줄은 "(핫패스 비용 0)"이라 적었는데 **거짓이었다** — 그 판정인 `dayOccupancy`
     자체가 `taskIntervals` 를 통해 과제 전량을 스캔하고 있었다(2026-08-20 리뷰 M-3). 지금은
     `events`·`tasks` 둘 다 날짜 인덱스 조회라 실제로 상수 시간이다. 인덱스를 빼면 이 문장이
     다시 거짓이 된다 — 그때는 이 주석부터 고쳐라. */
  if (!dayOccupancy(state, ds).length) return 0;
  return Math.max(0, freeWindowsForWeekday(state, wd).freeMin - freeWindowsForDay(state, ds, wd).freeMin);
}

/** 요일별 공부 가능 시간(분). */
export function studyMinByWeekday(state: AppState): number[] {
  const arr = [0, 0, 0, 0, 0, 0, 0];
  for (let wd = 0; wd < 7; wd++) arr[wd] = freeWindowsForWeekday(state, wd).freeMin;
  return arr;
}
/** 특정 날짜의 가용 공부 분 (덮어쓰기 우선 · 그날 일정만큼 차감).
 *  기준선 = dayOverrides[ds](있으면) 아니면 capWd[wd]. 거기서 **그날 일정이 실제로 먹는 분**을 뺀다.
 *
 *  ⚠ 왜 dayOverrides에도 일정을 빼는가(설계 판단): dayOverrides는 "이 날은 N시간 공부하겠다"는
 *   *공부 가능 시간의 선언*이지 '일정 포함 총량'이 아니다. 일정은 그 선언과 **직교한 사건**이므로
 *   똑같이 깎는 게 일관된다 — 안 그러면 오버라이드를 준 날만 3시 약속이 공부시간으로 계상돼
 *   그날만 과편성되는 비대칭이 생긴다. (사용자가 일정을 감안한 값을 넣고 싶다면 오버라이드를 그만큼
 *   더 크게 적으면 되고, 그 조작은 관찰 가능하다. 반대는 불가능 — 무음 과편성이라 안 보인다.)
 *
 *  ⚠ 이중 차감: eventStudyLossMin이 '요일 자유창과의 교집합'만 돌려주므로 수업/일과·수면과 겹치는
 *   일정은 여기서 추가로 깎이지 않는다(그 시간은 애초에 capWd에 없다). 근거는 그 함수 주석 참조.
 *  ⚠ 음수 방지 — 종일 일정이 오버라이드보다 길어도 0 아래로 내려가지 않는다. */
export function dayStudyMin(state: AppState, ds: string, wd: number, capWd: number[]): number {
  /* ⚠ N-1(W8) — 점유 구간 차감에 **시각 없는 과제의 총량**을 더한다. 트레이의 과제는 구간이
     없어 창 산술에 안 잡히는데, 시간은 똑같이 먹는다. 오버라이드에도 똑같이 빼는 이유는 위
     ⚠ 문단(일정)과 같다: 오버라이드는 *공부 가능 시간의 선언*이지 '과제 포함 총량'이 아니다. */
  const loss = dayOccupancyLossMin(state, ds, wd) + untimedChoreMin(state, ds);
  const ov = state.dayOverrides && state.dayOverrides[ds];
  if (ov !== undefined && ov !== null && ov !== '') {
    // 비수치 오버라이드(+ov=NaN)가 그날 studyMin을 오염시키지 않게 가드 — 부적합하면 요일 기본값으로 폴백(L-10).
    const n = +ov;
    if (Number.isFinite(n)) return Math.max(0, Math.round(n * 60) - loss);
  }
  return Math.max(0, (capWd[wd] ?? 0) - loss);
}
