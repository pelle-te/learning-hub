/* ============================================================
   events.ts — 일정(Wave 5) 순수 CRUD·선택자.
   일정 = 과목과 무관하고 반복도 아닌 **단발 사건**(약속·시험·행사). '할 일'(tasks)과 의미가 다르다:
   할 일은 체크해서 완료하는 것, 일정은 **그 시각에 일어나는 것**이라 완료 개념이 없다.
   대신 일정은 **공부 가용시간을 깎는다**(scheduler.freeWindowsForDay·dayStudyMin) — 3시에 2시간 약속이
   있으면 그만큼 공부 가용이 줄고 자동초안이 그 자리를 피한다. 그래서 tasks와 달리 **스케줄러 입력**이다
   (→ store/selectors.SCHEDULE_INPUT_KEYS에 'events'가 반드시 있어야 재계산이 걸린다).

   스토어 액션이 mutate(immer draft) 안에서 변형 헬퍼를 호출(→ persist), 컴포넌트는 선택자로 파생만 읽는다.
   시간 관례는 앱 전체와 동일: **자정 기준 분**(0~1440) · 날짜는 ISO 'YYYY-MM-DD' · id는 rid().
============================================================ */
import { clamp, rid } from './utils';
import type { AppState, PlanEvent } from './types';

/** 하루의 분(모델 상한) — start+min은 이 값을 넘지 못한다(자정 걸침 일정은 만들지 않는다). */
export const DAY_MIN = 1440;

/** state.events 보장(없으면 초기화) — 무마이그레이션 옵셔널 필드라 첫 쓰기 때 생성.
 *  Array.isArray 가드: 손상/외부 JSON이 events를 배열 아닌 값으로 실어와도 .filter 크래시 대신 리셋된다. */
function ensure(state: AppState): PlanEvent[] {
  if (!Array.isArray(state.events)) state.events = [];
  return state.events;
}

/** 읽기 경로의 안전 접근(변형 없음 — 선택자가 draft가 아닌 state에도 쓰인다). */
function list(state: AppState): PlanEvent[] {
  return Array.isArray(state.events) ? state.events : [];
}

/** 시각·길이 정규화 — 경계 방어의 단일 지점(add·update가 공유).
 *  · start: 0~1439로 클램프(1440은 '하루의 끝'이라 시작점이 될 수 없다) · 정수화.
 *  · min: 최소 1분(0·음수는 폭0 구간이라 캘린더에서 잡을 수 없는 유령 일정이 된다).
 *  · start+min > 1440이면 그날 끝(1440)으로 자른다 — 자정 넘김을 만들지 않아야
 *    가용시간 차감(freeWindowsForDay)이 단일 구간 산술로 닫힌다. */
function normalize(start: number, min: number): { start: number; min: number } {
  const s = clamp(Math.round(Number.isFinite(start) ? start : 0), 0, DAY_MIN - 1);
  const raw = Math.round(Number.isFinite(min) ? min : 0);
  return { start: s, min: clamp(raw, 1, DAY_MIN - s) };
}

/* ── 변형(스토어 mutate 안에서 호출 · 이후 persist) ───────────────────── */

/** 새 일정 추가 — id·at 자동 부여, start/min 정규화. 반환=생성된 PlanEvent. */
export function addEvent(
  state: AppState,
  input: Partial<PlanEvent> & { ds: string; title: string; start: number; min: number },
): PlanEvent {
  const { start, min } = normalize(input.start, input.min);
  const ev: PlanEvent = {
    id: input.id ?? rid(),
    ds: input.ds,
    start,
    min,
    title: input.title,
    note: input.note,
    color: input.color,
    at: input.at ?? Date.now(),
  };
  ensure(state).push(ev);
  return ev;
}

/** 필드 부분 수정. start·min이 하나라도 오면 **둘을 함께** 재정규화한다 —
 *  한쪽만 검사하면 `min`만 늘렸을 때 start+min이 1440을 넘는 구멍이 남는다. id 미존재면 무동작. */
export function updateEvent(state: AppState, id: string, patch: Partial<PlanEvent>): void {
  const ev = ensure(state).find((x) => x.id === id);
  if (!ev) return;
  Object.assign(ev, patch);
  if (patch.start !== undefined || patch.min !== undefined) {
    const n = normalize(ev.start, ev.min);
    ev.start = n.start;
    ev.min = n.min;
  }
}

/** 삭제. */
export function removeEvent(state: AppState, id: string): void {
  state.events = ensure(state).filter((e) => e.id !== id);
}

/* ── 선택자(순수 파생 · 읽기 전용) ────────────────────────────────────── */

/** 그날(ds) 일정 — 시작 시각 오름차순(같으면 긴 것 먼저: 캘린더 레인 패킹 관례와 동일). */
export function eventsForDay(state: AppState, ds: string): PlanEvent[] {
  return list(state)
    .filter((e) => e.ds === ds)
    .sort((a, b) => a.start - b.start || b.min - a.min);
}

/** 그날 일정의 점유 구간 [시작,끝] 배열 — 가용시간 차감(scheduler)이 소비하는 유일한 형태.
 *  겹치는 일정(이중 약속)은 **병합하지 않는다**: subtractIntervals가 멱등이라 겹침이 이중 차감되지 않는다.
 *  비수치·폭0 레코드(외부 JSON 오염)는 여기서 걸러 스케줄러로 NaN이 흘러가지 않게 한다. */
export function eventIntervals(state: AppState, ds: string): [number, number][] {
  const out: [number, number][] = [];
  for (const e of list(state)) {
    if (e.ds !== ds) continue;
    if (!Number.isFinite(e.start) || !Number.isFinite(e.min)) continue;
    const { start, min } = normalize(e.start, e.min);
    if (min > 0) out.push([start, start + min]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** 그날 일정 총 분(겹침 병합 후) — 리드아웃 표시용. 가용시간 차감은 구간 기반이라 이 값을 쓰지 않는다
 *  (창 밖·수업 겹침을 반영해야 하므로 scheduler.eventStudyLossMin이 담당). */
export function eventMinutesForDay(state: AppState, ds: string): number {
  const merged: [number, number][] = [];
  for (const [s, e] of eventIntervals(state, ds)) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged.reduce((t, [s, e]) => t + (e - s), 0);
}
