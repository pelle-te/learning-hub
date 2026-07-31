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
  bumpEvents(); // H15 — 날짜 인덱스 무효화(제자리 push 는 참조를 안 바꾼다)
  return ev;
}

/** 필드 부분 수정. start·min이 하나라도 오면 **둘을 함께** 재정규화한다 —
 *  한쪽만 검사하면 `min`만 늘렸을 때 start+min이 1440을 넘는 구멍이 남는다. id 미존재면 무동작. */
export function updateEvent(state: AppState, id: string, patch: Partial<PlanEvent>): void {
  const ev = ensure(state).find((x) => x.id === id);
  if (!ev) return;
  bumpEvents(); // H15 — 필드 제자리 수정도 인덱스를 낡게 만든다
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
  bumpEvents(); // 참조가 바뀌므로 사실 불필요하지만, 쓰기 API 전부가 같은 계약을 지키게 둔다
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
  return dayIndex(state).get(ds) ?? EMPTY_INTERVALS;
}

const EMPTY_INTERVALS: [number, number][] = [];

/* ⚠⚠ **날짜별 인덱스 — 이 함수가 스케줄러 안에서 N+1 이었다(H15 · 2026-07-31 `/감사 근본`).**

   `eventIntervals` 는 호출마다 `state.events` **전량을 선형 스캔 + 정렬**했는데, 소비 경로가
   `dayStudyMin`(하루 2~3회) ← `engine` 의 **일자 생성 루프**(horizon 일수만큼)라 비용이 곱해졌다.
   실측 `schedule()` 1회(과목 5×챕터 25 고정):

       일정 0 / days 112 = 0.82ms      일정 0 / days 901 = 3.78ms
       일정 2000 / days 112 = 5.54ms   일정 2000 / days 901 = **29.52ms**

   일정에서 오는 증분이 +4.7ms → +25.7ms 로 **일수에 비례해 곱해진다**(≈901/112). 그리고
   `schedule()` 은 items·completions·events·dayPlans 중 **아무 슬라이스나** 바뀌면 재실행되므로,
   일정이 많고 `startDate` 가 오래된 사용자는 체크 한 번·타이핑 한 글자마다 그 값을 낸다.

   ⚠ 관용구는 새로 만들지 않았다 — `scheduler/windows.ts` 의 `wdCache`(참조 기준 1-엔트리 캐시)와
   **같은 형태**다. 키가 `state.events` 참조라, immer 가 그 슬라이스를 안 건드린 재계산에서는
   인덱스가 그대로 재사용된다.

   ⚠⚠ **참조만으로는 부족하다 — 그리고 그걸 테스트가 그 자리에서 잡았다.** 이 모듈의 뮤테이터는
   `state.events` 를 **제자리**로 바꾼다(`push`·필드 수정). immer 드래프트 아래서는 새 참조가
   나오지만, 순수 객체를 직접 다루는 경로(테스트·`rowsToState` 조립 중)는 참조가 그대로다 →
   낡은 인덱스가 조용히 살아난다. 그래서 **이 모듈의 쓰기 API 가 버전을 올린다.** 캐시 무효화를
   *바깥 규약*(“immer 를 통해서만 고친다”)에 맡기지 않는 것이 요점이다 — 그 규약은 이 파일이
   강제할 수 없고, 어긋났을 때의 증상이 "일정이 계획에서 사라진다"라 조용하다.

   ⚠ 반환 배열을 **호출부가 수정하지 않는다**는 전제 위에 있다(현 소비처는 전부 읽기 전용 —
   `subtractIntervals` 는 새 배열을 만든다). 빈 날은 공유 상수를 준다(할당 0). */
let evVersion = 0;
/** 이 모듈의 쓰기 API 가 부른다 — 날짜 인덱스를 무효화한다(위 ⚠⚠). */
function bumpEvents(): void {
  evVersion++;
}
let evIndexCache: { src: unknown; version: number; map: Map<string, [number, number][]> } | null = null;

function dayIndex(state: AppState): Map<string, [number, number][]> {
  const src = state.events;
  if (evIndexCache && evIndexCache.src === src && evIndexCache.version === evVersion) return evIndexCache.map;
  const map = new Map<string, [number, number][]>();
  for (const e of list(state)) {
    if (!Number.isFinite(e.start) || !Number.isFinite(e.min)) continue;
    const { start, min } = normalize(e.start, e.min);
    if (min <= 0) continue;
    const arr = map.get(e.ds);
    if (arr) arr.push([start, start + min]);
    else map.set(e.ds, [[start, start + min]]);
  }
  for (const arr of map.values()) arr.sort((a, b) => a[0] - b[0]);
  evIndexCache = { src, version: evVersion, map };
  return map;
}

/** 그날 일정 총 분(겹침 병합 후) — 리드아웃 표시용. 가용시간 차감은 구간 기반이라 이 값을 쓰지 않는다
 *  (창 밖·수업 겹침을 반영해야 하므로 scheduler.eventStudyLossMin이 담당). */
export function eventMinutesForDay(state: AppState, ds: string): number {
  /* ⚠ **여기서 새 튜플을 만드는 것이 계약이다(H15 후속).** `eventIntervals` 는 이제 **캐시된
     배열을 그대로** 돌려주므로, 반환값의 튜플을 제자리 수정하면 인덱스가 오염돼 다음 호출부터
     잘못된 구간을 준다(겹치는 일정이 있는 날에만 나타나는 조용한 오염). 아래 구조분해 →
     `push([s, e])` 가 이미 값 복사라 **현 코드는 안전하다** — 안전한 이유를 적어 두는 것이지
     결함을 고친 것이 아니다(다음 사람이 `last` 를 원본에서 끌어오지 않게). */
  const merged: [number, number][] = [];
  for (const [s, e] of eventIntervals(state, ds)) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e] as [number, number]);
  }
  return merged.reduce((t, [s, e]) => t + (e - s), 0);
}
