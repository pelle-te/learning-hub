/* ============================================================
   tasks.ts — 자유 할 일(계획 개편 §4-4) 순수 CRUD·선택자.
   과목 파생 공부 블록(스케줄러 소유)과 별개인 독립 리스트. 스케줄러 입력 아님(UI 오버레이).
   스토어 액션이 mutate 안에서 변형 헬퍼를 호출(→ persist), 컴포넌트는 선택자로 파생만 읽는다.
   완료 규칙은 공부 블록의 completions와 분리 — task.done(단순 체크). doneDs는 앱의 '오늘'(todayISO, _today 시드 존중).
============================================================ */
import { rid, todayISO } from './utils';
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

/** 완료 토글 — on이면 done + doneDs(오늘), 아니면 미완으로 되돌림(doneDs 제거). */
export function toggleTaskDone(state: AppState, id: string, on: boolean): void {
  const t = ensure(state).find((x) => x.id === id);
  if (!t) return;
  if (on) {
    t.done = true;
    t.doneDs = todayISO(state);
  } else {
    t.done = false;
    delete t.doneDs;
  }
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
