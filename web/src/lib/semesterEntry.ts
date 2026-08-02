/* ============================================================
   semesterEntry.ts — **학기의 입구**: 개강 리허설(T-15) · 다음 학기 부하 시뮬(T-16). 순수.

   ## 왜 한 파일인가

   둘 다 _개강 전에만_ 답이 있는 질문이고, 입력이 같다(다가오는 학기 + 그 과목들 + 가용 시간).
   T-15 는 **무엇을 해 둘까**, T-16 은 **감당 되나** — 순서상 T-16 이 먼저 답해야 T-15 의 목록이
   말이 된다(감당 안 되는 학기의 리허설은 과목을 빼는 것부터다).

   ## 왜 필요한가 (발산 5회차)

   여정 28단계 중 앱이 덮는 것이 **3단계**였고 셋 다 학기 *중반*이었다. 입구(수강신청 → 개강)와
   출구(종강 → 처분)가 통째로 비어 있었다 — T-1 이 날짜를 넣었고, T-4 가 국면을 처방으로 바꿨고,
   여기가 그 국면 안에서 **할 일**을 만든다.

   ## 규율

   1. **추정의 근거를 함께 돌려준다**(`basis`). "12시간"만 주면 그 수를 믿을지 판단할 수 없다 —
      실투입에서 나온 수와 기본값에서 나온 수는 신뢰도가 다르고, 화면은 그 차이를 말해야 한다.
      ⚠ 이 앱은 이미 같은 실수를 한 번 피했다(`estimateCalibration` 이 표본 미달이면 `null`).
   2. **학점당 시간은 과거에서 배운다.** 상수를 박으면 이 사용자의 실제와 무관한 수가 된다.
      표본이 없으면 **기본값을 쓰되 그 사실을 말한다**(`basis: 'default'`).
   3. **리허설 항목은 파생이다 — 저장하지 않는다.** 체크 상태만 저장하면 항목이 바뀔 때
      고아 키가 남는다. 대신 "이 항목이 이미 충족됐나"를 데이터에서 **계산한다** — 그러면
      사용자가 체크할 것이 없고, 목록은 자동으로 줄어든다.
============================================================ */
import type { AppState, Course, Item, Semester } from './types';
import { itemOfCourse, semesterPhase } from './semester';
import { prereqGaps } from './prereq';
import { studyMinByWeekday } from './scheduler';

/** 학점 1점이 실제로 먹은 시간(h). 표본이 없으면 기본값. */
export interface CreditRate {
  hoursPerCredit: number;
  /** 이 값이 어디서 왔나 — 화면이 신뢰도를 말할 수 있게. */
  basis: 'measured' | 'default';
  /** 표본이 된 과거 과목 수(`default` 면 0). */
  samples: number;
}

/** 표본이 없을 때 쓰는 값. **한 학기 3학점 과목 ≈ 45h**(주 3h × 15주)라는 교과서적 기본치다. */
export const DEFAULT_HOURS_PER_CREDIT = 15;

/**
 * 지난 학기들에서 **학점당 실제 투입 시간**을 배운다.
 *
 * 표본 = `Course.itemId` 로 실행 과목에 이어져 있고 챕터 시간이 잡혀 있는 과목. 중앙값을 쓰는
 * 이유는 한 과목의 이상치(재수강·중도포기)가 평균을 통째로 끌기 때문이다.
 * ⚠ **현재·미래 학기는 표본이 아니다** — 아직 안 끝난 과목의 시간은 계획이지 실적이 아니다.
 */
export function creditRate(state: Pick<AppState, 'degree' | 'items' | '_today'>, ds: string): CreditRate {
  const byId = new Map((state.items || []).map((i) => [i.id, i]));
  const rates: number[] = [];
  for (const sem of state.degree?.semesters || []) {
    if (!sem.endDs || sem.endDs >= ds) continue; // 끝난 학기만
    for (const c of sem.courses || []) {
      const it = c.itemId ? byId.get(c.itemId) : undefined;
      if (!it || !c.credits) continue;
      const h = (it.chapters || []).reduce((a, ch) => a + (ch.hours || 0), 0);
      if (h > 0) rates.push(h / c.credits);
    }
  }
  if (!rates.length) return { hoursPerCredit: DEFAULT_HOURS_PER_CREDIT, basis: 'default', samples: 0 };
  rates.sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  const med = rates.length % 2 ? rates[mid]! : (rates[mid - 1]! + rates[mid]!) / 2;
  return { hoursPerCredit: Math.round(med * 10) / 10, basis: 'measured', samples: rates.length };
}

/** 시뮬레이션 한 줄 — 과목 하나의 예상 부하. */
export interface LoadRow {
  course: Course;
  item: Item | null;
  estH: number;
  /** `chapters` = 실행 과목의 챕터 시간 합(가장 믿을 만함) · `credits` = 학점 × 학점당 시간. */
  basis: 'chapters' | 'credits';
}

export interface LoadSim {
  semester: Semester;
  rows: LoadRow[];
  /** 학기 전체 예상 시간(h). */
  totalH: number;
  /** 주당 예상 시간(h) — 학기 길이로 나눈 값. 길이를 모르면 15주로 본다. */
  weeklyH: number;
  /** 주당 가용 시간(h) — 일과·수면·수업을 뺀 실제 자유창. */
  capacityH: number;
  /** `weeklyH / capacityH`. 1.0 을 넘으면 **주당 시간이 모자란다**. */
  ratio: number;
  rate: CreditRate;
  /** 학기 주 수(파생). */
  weeks: number;
}

/** 학기 길이를 모를 때 쓰는 주 수 — 한국 대학 정규 학기의 통상값. */
const DEFAULT_WEEKS = 15;

/**
 * 다가오는(또는 지정한) 학기의 부하를 잰다.
 *
 * ⚠ **가용 시간은 `studyMinByWeekday` 를 그대로 쓴다** — 여기서 새로 계산하면 스케줄러가 쓰는
 * 가용과 갈리고, 그러면 "감당 된다"고 말해 놓고 계획이 넘치는 상태가 된다.
 */
export function simulateSemester(state: AppState, semester: Semester, ds: string): LoadSim {
  const rate = creditRate(state, ds);
  const rows: LoadRow[] = (semester.courses || []).map((course) => {
    const item = itemOfCourse(state, course);
    const chH = (item?.chapters || []).reduce((a, c) => a + (c.hours || 0), 0);
    return chH > 0
      ? { course, item, estH: Math.round(chH * 10) / 10, basis: 'chapters' as const }
      : {
          course,
          item,
          estH: Math.round((course.credits || 0) * rate.hoursPerCredit * 10) / 10,
          basis: 'credits' as const,
        };
  });
  const totalH = Math.round(rows.reduce((a, r) => a + r.estH, 0) * 10) / 10;
  const weeks =
    semester.startDs && semester.endDs
      ? Math.max(1, Math.round((Date.parse(semester.endDs) - Date.parse(semester.startDs)) / (7 * 864e5)))
      : DEFAULT_WEEKS;
  const weeklyH = Math.round((totalH / weeks) * 10) / 10;
  const capacityH = Math.round((studyMinByWeekday(state).reduce((a, b) => a + b, 0) / 60) * 10) / 10;
  return {
    semester,
    rows,
    totalH,
    weeklyH,
    capacityH,
    ratio: capacityH > 0 ? Math.round((weeklyH / capacityH) * 100) / 100 : Infinity,
    rate,
    weeks,
  };
}

/* ── T-15 개강 리허설 ───────────────────────────────────────────────────── */

/** 개강 전에 **실제로 할 수 있는** 일 하나. `done` 은 데이터에서 계산한다(저장하지 않는다). */
export interface RehearsalStep {
  id: string;
  label: string;
  /** 왜 이걸 지금 하나 — 목록이 잔소리가 되지 않게 근거를 함께 준다. */
  why: string;
  done: boolean;
  /** 눌렀을 때 갈 곳(라우트). 없으면 화면 안에서 끝나는 항목. */
  to?: string;
}

/** 리허설을 여는 창(일). D-14 안쪽에서만 목록이 뜬다 — 그보다 이르면 잔소리다. */
export const REHEARSAL_WINDOW_DAYS = 14;

/**
 * 개강 리허설 목록. 국면이 `pre` 가 아니거나 D-14 밖이면 **빈 배열**(= 화면이 안 그린다).
 *
 * ⚠ 이 목록은 **줄어드는 것이 정상**이다. 항목이 데이터에서 충족 판정을 받으므로, 다 하면
 * 목록이 비고 화면은 사라진다 — 체크박스를 남겨 두면 "다 했는데 왜 아직 있나"가 된다.
 */
export function rehearsalSteps(state: AppState, ds: string): RehearsalStep[] {
  const p = semesterPhase(state, ds);
  if (p.kind !== 'pre' || p.semester === null || p.daysToStart === null) return [];
  if (p.daysToStart > REHEARSAL_WINDOW_DAYS) return [];
  const sem = p.semester;
  const courses = sem.courses || [];
  const linked = courses.filter((c) => itemOfCourse(state, c));
  const withChapters = linked.filter((c) => (itemOfCourse(state, c)?.chapters || []).length > 0);
  const withExams = linked.filter((c) => (itemOfCourse(state, c)?.exams || []).length > 0);
  const gapItems = linked
    .map((c) => itemOfCourse(state, c))
    .filter((i): i is Item => !!i)
    .filter((i) => prereqGaps(state, i).length > 0);

  return [
    {
      id: 'link',
      label: `수강 과목 ${courses.length}개를 실행 과목에 잇기`,
      why: '이어야 챕터·배분·시험이 한 과목으로 모입니다.',
      done: courses.length > 0 && linked.length === courses.length,
      to: '/degree',
    },
    {
      id: 'chapters',
      label: '과목마다 챕터 넣기',
      why: '챕터가 없으면 스케줄러가 배치할 것이 없습니다.',
      done: linked.length > 0 && withChapters.length === linked.length,
      to: '/items',
    },
    {
      id: 'exams',
      label: '중간·기말 날짜 넣기',
      why: '시험이 없으면 모든 챕터가 같은 급함으로 보입니다.',
      done: linked.length > 0 && withExams.length === linked.length,
      to: '/items',
    },
    {
      id: 'prereq',
      label: '선수 결손 메우기',
      why: '결손은 시험 때 발견되면 늦습니다 — 지금은 시간이 있습니다.',
      done: gapItems.length === 0,
      to: '/items',
    },
  ].filter((s) => !(s.id === 'prereq' && s.done && !linked.length));
}
