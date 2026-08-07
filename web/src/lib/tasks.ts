/* ============================================================
   tasks.ts — 자유 할 일(계획 개편 §4-4) 순수 CRUD·선택자.
   과목 파생 공부 블록(스케줄러 소유)과 별개인 독립 리스트. 스케줄러 입력 아님(UI 오버레이).
   스토어 액션이 mutate 안에서 변형 헬퍼를 호출(→ persist), 컴포넌트는 선택자로 파생만 읽는다.
   완료 규칙은 공부 블록의 completions와 분리 — task.done(단순 체크). doneDs는 앱의 '오늘'(todayISO, _today 시드 존중).
============================================================ */
import { rid, todayISO, iso, addDays, parseISO } from './utils';
import type { AppState, Task } from './types';

/** state.tasks 보장(없으면 초기화) — 무마이그레이션 옵셔널 필드라 첫 쓰기 때 생성. */
function ensure(state: AppState): Task[] {
  return (state.tasks = state.tasks || []);
}

/* ── 변형(스토어 mutate 안에서 호출 · 이후 persist) ───────────────────── */

/** 새 자유 할 일 추가 — id·at 자동 부여. 반환=생성된 Task(undefined 필드는 직렬화 시 자동 탈락). */
export function addTask(state: AppState, input: Partial<Task> & { title: string }): Task {
  const task: Task = {
    id: input.id ?? rid(),
    title: input.title,
    sid: input.sid,
    color: input.color,
    ds: input.ds,
    start: input.start,
    min: input.min,
    deadline: input.deadline,
    done: input.done,
    doneDs: input.doneDs,
    at: input.at ?? Date.now(),
    repeat: input.repeat,
  };
  ensure(state).push(task);
  return task;
}

/** 필드 부분 수정(제목·과목·소요·마감 등). id 미존재면 무동작. */
export function updateTask(state: AppState, id: string, patch: Partial<Task>): void {
  const t = ensure(state).find((x) => x.id === id);
  if (t) Object.assign(t, patch);
}

/** 삭제. */
export function removeTask(state: AppState, id: string): void {
  state.tasks = ensure(state).filter((t) => t.id !== id);
}

/** 완료 토글 — on이면 done + doneDs(오늘), 아니면 미완으로 되돌림(doneDs 제거).
 *  반복(repeat) 할일은 완료 시 다음 occurrence를 새 task로 spawn한다(원 cadence=ds+간격 유지).
 *  가상 인스턴스·별도 state 없이 concrete task 체인으로 굴려 완료 상태가 occurrence별로 독립적이다. */
export function toggleTaskDone(state: AppState, id: string, on: boolean): void {
  const t = ensure(state).find((x) => x.id === id);
  if (!t) return;
  if (on) {
    t.done = true;
    t.doneDs = todayISO(state);
    if (t.repeat && t.ds) spawnNext(state, t);
  } else {
    t.done = false;
    delete t.doneDs;
  }
}

/** 반복 할일의 다음 occurrence 생성 — daily=+1일·weekly=+7일. 같은 날 미완 중복이 있으면 생략(멱등). */
function spawnNext(state: AppState, t: Task): void {
  const nextDs = iso(addDays(parseISO(t.ds as string), t.repeat === 'daily' ? 1 : 7));
  const dup = (state.tasks || []).some(
    (x) => x.ds === nextDs && x.title === t.title && x.repeat === t.repeat && !x.done,
  );
  if (dup) return;
  addTask(state, {
    title: t.title,
    sid: t.sid,
    color: t.color,
    ds: nextDs,
    start: t.start,
    min: t.min,
    deadline: t.deadline,
    repeat: t.repeat,
  });
}

/** 시간박기 — 그날(ds) 특정 시각(분)에 배치. ds도 함께 확정(트레이→캘린더). */
export function placeTask(state: AppState, id: string, ds: string, start: number): void {
  const t = ensure(state).find((x) => x.id === id);
  if (!t) return;
  t.ds = ds;
  t.start = start;
}

/** 미지정 복귀 — 시각 제거(캘린더→트레이). ds는 유지(그날 트레이). */
export function unplaceTask(state: AppState, id: string): void {
  const t = ensure(state).find((x) => x.id === id);
  if (t) delete t.start;
}

/* ── 선택자(순수 파생 · 읽기 전용) ────────────────────────────────────── */

/** 그날(ds)에 배정된 모든 자유 할 일. */
export function tasksForDay(state: AppState, ds: string): Task[] {
  return (state.tasks || []).filter((t) => t.ds === ds);
}
/** 그날 미지정(트레이) 후보 — ds 일치 · 시각 없음 · 미완. 드래그로 시각 부여 대상. */
export function untimedTasksForDay(state: AppState, ds: string): Task[] {
  return (state.tasks || []).filter((t) => t.ds === ds && t.start == null && !t.done);
}
/** 그날 시각이 박힌(타임박스) 자유 할 일 — 캘린더에 카드로 렌더. */
export function timedTasksForDay(state: AppState, ds: string): Task[] {
  return (state.tasks || []).filter((t) => t.ds === ds && t.start != null);
}
/** 그날 미완 할 일 수(§6-5 월 히트맵 배지). */
export function openTasksForDay(state: AppState, ds: string): Task[] {
  return (state.tasks || []).filter((t) => t.ds === ds && !t.done);
}
/** 인박스('언젠가') — 날짜 미정 할 일. */
export function inboxTasks(state: AppState): Task[] {
  return (state.tasks || []).filter((t) => t.ds == null);
}

/* ── 7-I4 **할 일이 먹는 시간**(발산 6회차 · 2026-08-07) ──────────────────
   ⚠⚠ 이 파일 이웃인 `events.ts` 가 자백하고 있었다: *"일정은 tasks 와 달리 **스케줄러
   입력**이다"*. 즉 3시에 2시간 약속이 있으면 가용이 줄지만, **오늘 3시간짜리 과제가
   있어도 앱은 "여유 3.2h" 라고 말한다.** 공학 전공 학기 시간의 큰 몫이 그렇게 모델 밖에
   있었고, 그 결과가 매주 반복되는 "왜 계획대로 안 됐지"다(발산 6회차 각도 7 · N-1).

   ⚠ **소요를 적은 것만** 센다. 안 적은 할 일에 임의 값을 씌우면 그 수는 관측이 아니라
   추측이고, 추측으로 창을 깎으면 사용자는 왜 여유가 줄었는지 화면 어디서도 못 읽는다.
   ⚠ **미완만** 센다 — 끝낸 일의 시간은 이미 지나갔고, `freeLeftMin` 에서 빠져 있다
   (`dayCapacity` 가 완료 블록을 안 세는 것과 같은 이중 차감 방지).

   ⚠⚠ **여기 있던 `choreMinForDay`(시각 유무를 안 가리는 총합)는 W8 에서 지웠다.** N-1 이
   시각 박힌 과제를 *구간*으로 창에서 빼기 시작하면서 그 값을 쓰면 **두 번 깎인다**. 남은
   소비처가 테스트 하나였는데, 그건 이 저장소가 반복해 잡아 온 *"쓰기 0 · 소비처 0"* 이다. */

/* ── N-1 **과제가 시간 예산의 1급 시민이 된다**(W8 · 2026-08-07) ────────────────
   7-I4(W2)는 **오늘 화면의 문장**만 고쳤다 — `dayCapacity` 가 창에서 할 일을 뺐다. 그런데
   *계획을 만드는 쪽*(`schedule()`)은 여전히 할 일을 모른다: 자동초안은 과제가 3시간 있는
   날에도 창을 가득 채워 학습 블록을 놓고, 그래서 그날은 **만들어지는 순간부터** 넘친다.
   오늘 화면이 그 사실을 사후에 말해 줄 뿐이었다(진단은 있고 처방이 없는 상태).

   ⚠⚠ 이것은 명시 결정 하나를 뒤집는다(로드맵 W0 표): T-1 이 _"가중치·과제·출석은 안 만든다"_
   고 못박았다. 그 경고가 겨눈 것은 **성적 회계**(과제 점수 · 반영 비율)이고 여기서 만드는 것은
   **시간 소비**다 — 그 둘을 가르는 것이 이 뒤집기의 전부다. 점수는 여전히 안 만든다.

   ⚠ **시각이 있는 것과 없는 것을 가른다.** 시각이 박힌 과제는 *구간*이라 창에서 빼야 겹침이
   정확하다(수업 시간과 겹치는 과제를 두 번 빼지 않는다 — `eventStudyLossMin` 이 세운 규율).
   시각이 없는 과제는 구간이 없으니 **총량**으로 뺀다. 한쪽으로 통일하면 둘 중 하나가 틀린다:
   전부 구간으로 보면 트레이의 과제가 통째로 안 세어지고(지금 상태), 전부 총량으로 보면
   수업과 겹치게 적은 과제가 이중 차감된다. */

/** 그날 **시각이 박힌** 미완 과제의 점유 구간 — 창 차감이 소비하는 유일한 형태(`events` 와 같은 계약).
 *  ⚠ 겹침을 병합하지 않는다: `subtractIntervals` 가 멱등이라 이중 차감이 생기지 않는다. */
export function taskIntervals(state: AppState, ds: string): [number, number][] {
  const out: [number, number][] = [];
  for (const t of state.tasks || []) {
    if (t.ds !== ds || t.done || t.start == null || !t.min) continue;
    if (!Number.isFinite(t.start) || !Number.isFinite(t.min)) continue;
    const s = Math.max(0, Math.min(1439, Math.round(t.start)));
    const e = Math.min(1440, s + Math.max(1, Math.round(t.min)));
    if (e > s) out.push([s, e]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** 그날 **시각이 없는**(트레이·인박스 아님 — 날짜만 정해진) 미완 과제의 총 분.
 *  ⚠ **시각이 박힌 것은 여기서 안 센다** — 그건 위 `taskIntervals` 가 구간으로 빼므로, 총합에
 *  또 넣으면 두 번 깎인다(옛 `choreMinForDay` 가 그 총합이었고 W8 에서 지웠다 · 위 ⚠⚠). */
export function untimedChoreMin(state: AppState, ds: string): number {
  return (state.tasks || []).reduce(
    (t, k) => (k.ds === ds && !k.done && k.start == null && k.min ? t + Math.max(0, k.min) : t),
    0,
  );
}
