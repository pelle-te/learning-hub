/* ============================================================
   semesterGoals.ts — **N-18 이번 학기 목표**를 앱의 수에 바인딩한다. 순수 · React 무관.

   ## 왜 필요한가

   장기 목표는 지금 **볼트 손저작**(= 다른 앱)에 있다. 그래서 앱이 매일 재는 수 — 투입 시간 ·
   끝낸 챕터 · GPA · 이행률 — 과 목표가 **한 번도 만나지 않는다.** 학기 말에 "그래서 됐나"를
   물으면 답할 근거가 사람의 기억뿐이고, 그 기억은 마지막 2주만 기억한다.

   ## ⚠ 목표 칸을 만드는 것은 이 항목이 아니다

   자유 텍스트 목표 칸은 30분이면 만들 수 있고 **그건 메모장이다**. 이 항목의 값은 목표를 적을 때
   *어느 수가 판정하나*를 함께 고르게 하는 것이다(로드맵의 가장 싼 검증이 정확히 그 문장이다).
   그래서 `metric` 은 **닫힌 넷**이고, 그 넷은 전부 앱이 이미 매일 재고 있는 값이다 — 새 관측
   장치를 만들지 않는다는 것이 이 파일의 제약이다.

   ## 규율

   1. **판정은 여기 하나.** 화면이 `metric` 을 보고 자기 계산을 하면 같은 목표가 화면마다 다른
      진척을 말한다(과목 색이 파생인 것과 같은 논증).
   2. **모르면 `null` 이고 0 이 아니다.** 성적을 아직 안 넣은 학기의 GPA 는 *0점*이 아니라
      *모름*이다 — 0으로 접으면 화면이 "목표에서 4.5 모자람"이라고 거짓말한다.
   3. **셋까지.** 넷째 목표는 우선순위가 없다는 뜻이고, 이 항목이 없애려는 것이 그것이다.
============================================================ */
import type { AppState, GoalMetric, Semester, SemesterGoal } from './types';
import { semesterGpa } from './degree';
import { itemsOfSemester } from './semester';
import { dayDiff, todayISO } from './utils';

/** 한 학기가 가질 수 있는 목표 수 — 읽기에서 자른다(저장은 막지 않는다: 자르면 사용자 입력이 사라진다). */
export const MAX_GOALS = 3;

/** 지표의 표시 어휘. ⚠ 화면이 문구를 새로 지으면 같은 지표를 화면마다 다르게 부른다. */
export const GOAL_METRIC: Record<GoalMetric, { label: string; unit: string; hint: string }> = {
  gpa: { label: '학기 평점', unit: '점', hint: '이 학기 완료 과목의 GPA' },
  hours: { label: '투입 시간', unit: 'h', hint: '이 학기 과목에 실제로 쓴 시간' },
  chapters: { label: '끝낸 챕터', unit: '개', hint: '이 학기 과목의 완료 챕터 수' },
  adherence: { label: '이행률', unit: '%', hint: '학기 시작 후 하루라도 공부한 날의 비율' },
};

export interface GoalStatus {
  goal: SemesterGoal;
  /** 지금 값. **모르면 null**(규율 2). */
  current: number | null;
  /** 목표에 닿았나. `current` 가 null 이면 false — 모르는 것은 달성이 아니다. */
  met: boolean;
  /** 0~1. 화면 게이지용(`current`/`target`). 모르면 null. */
  ratio: number | null;
}

/** 이 학기의 목표들(최대 셋). */
export function goalsOf(semester: Semester | null): SemesterGoal[] {
  return (semester?.goals || []).slice(0, MAX_GOALS);
}

/** 학기 기간 안의 날짜인가. 끝나지 않은 학기는 **오늘까지**로 본다(미래 날짜는 완료가 없다). */
function inSemester(ds: string, sem: Semester): boolean {
  if (sem.startDs && ds < sem.startDs) return false;
  if (sem.endDs && ds > sem.endDs) return false;
  return true;
}

/** 이 학기 과목들에 실제로 들어간 분 — `completions` 에서 직접 센다(계획이 아니라 기록). */
function investedMin(state: AppState, sem: Semester): number {
  const sids = new Set(itemsOfSemester(state, sem).map((i) => i.id));
  if (!sids.size) return 0;
  let min = 0;
  for (const [ds, day] of Object.entries(state.completions || {})) {
    if (!inSemester(ds, sem)) continue;
    for (const [key, v] of Object.entries(day)) {
      if (!sids.has(key.split('|')[0]!)) continue;
      min += Number(v?.actualMin ?? v?.min) || 0;
    }
  }
  return min;
}

/** 이 학기 과목의 완료 챕터 수. ⚠ `doneDs` 가 있으면 **학기 안에 끝낸 것만** 센다(옛 완료 제외). */
function doneChapters(state: AppState, sem: Semester): number {
  return itemsOfSemester(state, sem).reduce(
    (n, it) => n + (it.chapters || []).filter((c) => c.done && (!c.doneDs || inSemester(c.doneDs, sem))).length,
    0,
  );
}

/**
 * 이행률(%) — 학기 시작 후 **경과일 중 하루라도 완료 기록이 있는 날**의 비율.
 *
 * ⚠ *계획 대비 완료*가 아닌 이유: 그 비율은 스케줄러를 돌려야 나오고(무거운 값) 계획을 적게
 * 세울수록 좋아진다. 여기서 재려는 것은 **매일 손을 댔나**이고, 그건 완료 기록만으로 닫힌다.
 * ⚠ 시작일이 없는 학기는 `null`(모름) — 분모가 없다.
 */
function adherencePct(state: AppState, sem: Semester, ds: string): number | null {
  if (!sem.startDs || ds < sem.startDs) return null;
  const end = sem.endDs && sem.endDs < ds ? sem.endDs : ds;
  const elapsed = dayDiff(sem.startDs, end) + 1;
  if (elapsed <= 0) return null;
  const sids = new Set(itemsOfSemester(state, sem).map((i) => i.id));
  let active = 0;
  for (const [dsk, day] of Object.entries(state.completions || {})) {
    if (dsk < sem.startDs || dsk > end) continue;
    if (Object.keys(day).some((k) => !sids.size || sids.has(k.split('|')[0]!))) active++;
  }
  return Math.round((active / elapsed) * 100);
}

/** 지표의 현재 값. 모르면 null(규율 2). */
export function metricValue(state: AppState, sem: Semester, metric: GoalMetric, ds: string): number | null {
  switch (metric) {
    case 'gpa':
      return semesterGpa(sem);
    case 'hours':
      return Math.round((investedMin(state, sem) / 60) * 10) / 10;
    case 'chapters':
      return doneChapters(state, sem);
    case 'adherence':
      return adherencePct(state, sem, ds);
  }
}

/** 목표 하나의 상태. */
export function goalStatus(state: AppState, sem: Semester, goal: SemesterGoal, ds = todayISO(state)): GoalStatus {
  const current = metricValue(state, sem, goal.metric, ds);
  const target = goal.target;
  return {
    goal,
    current,
    met: current != null && target > 0 && current >= target,
    ratio: current != null && target > 0 ? Math.min(1, current / target) : null,
  };
}

/** 이 학기 목표 전부의 상태(최대 셋). */
export function goalStatuses(state: AppState, sem: Semester | null, ds = todayISO(state)): GoalStatus[] {
  if (!sem) return [];
  return goalsOf(sem).map((g) => goalStatus(state, sem, g, ds));
}
