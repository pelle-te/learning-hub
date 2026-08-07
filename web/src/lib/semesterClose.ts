/* ============================================================
   semesterClose.ts — **N-3 학기 결산**: 끝난 학기를 *다음 학기의 입력*으로 되돌린다. 순수.

   ## 왜 필요한가

   지금 학기의 출구는 **그냥 안 함**이다. 성적이 나와도 앱에 안 들어오고(`Course.grade` 채움률이
   그 증거다), 그래서 이 앱이 이미 갖고 있는 학습 장치 하나가 영원히 잠들어 있다:
   `semesterEntry.creditRate()` 는 _"끝난 학기의 실투입에서 학점당 시간을 배운다"_ 고 적혀 있는데,
   그 표본은 **성적이 아니라 링크와 챕터 시간**에서 온다 — 즉 학기를 닫는 의식이 없으니 아무도
   그 표본을 만들지 않는다. 결산은 새 계산을 만드는 것이 아니라 **있는 계산에 표본을 먹인다.**

   ## ⚠ 결산은 성적표가 아니다

   여기서 안 만드는 것: 과목별 등급 예측 · 재수강 추천 · 학점 시뮬레이션(그건 `degree.ts` 의
   `gpaForecast`·`retakeCandidates` 가 이미 한다). 이 화면이 답하는 질문은 **하나**다 —
   *"이 학기에서 다음 학기가 배울 수 있는 것은 무엇인가."* 그 답은 셋이다:
     ① 학점당 실제 시간(다음 학기 부하 시뮬의 입력)
     ② 추정 대 실측의 배율(계획 숫자의 보정 · A-5/A-11 과 같은 값)
     ③ 아직 안 넣은 성적(= 그 학기가 아직 닫히지 않았다는 유일한 관측 가능한 신호)

   ⚠ **여기서 아무것도 쓰지 않는다.** 결산은 읽기이고, 쓰기(성적 입력)는 화면이 기존 편집 경로로
   한다 — 결산이 값을 직접 고치면 "그 학기는 왜 저 숫자가 됐나"를 되짚을 수 없다.
============================================================ */
import type { AppState, Course, Item, Semester } from './types';
import { itemOfCourse } from './semester';
import { GRADE_POINTS, semesterGpa, semesterStat } from './degree';
import { dayDiff, todayISO } from './utils';

/** 결산 한 줄 — 과목 하나. */
export interface CloseRow {
  course: Course;
  item: Item | null;
  /** 실제로 들어간 시간(h) — `completions` 기록. 링크가 없으면 null(셀 수 없다). */
  investedH: number | null;
  /** 계획했던 시간(h) — 챕터 시간 합. 챕터가 없으면 null. */
  plannedH: number | null;
  /** `investedH / plannedH`. 1.2 면 *내 추정이 20% 낙관적이었다*. 둘 중 하나라도 없으면 null. */
  ratio: number | null;
  /** 학점당 실제 시간(h) — 다음 학기 부하 시뮬이 배우는 값. */
  hoursPerCredit: number | null;
  /** 성적을 넣었나 — 안 넣은 것이 곧 "이 학기가 안 닫혔다". */
  graded: boolean;
}

export interface SemesterReport {
  semester: Semester;
  rows: CloseRow[];
  /** 이 학기 총 투입(h). */
  totalInvestedH: number;
  /** 이 학기 총 계획(h). */
  totalPlannedH: number;
  /** 전체 배율(총 투입 / 총 계획). 계획이 0이면 null. */
  ratio: number | null;
  /** 학점당 시간의 중앙값 — `creditRate` 가 다음 학기에 쓸 값과 **같은 규칙**(중앙값)이다. */
  hoursPerCredit: number | null;
  /** 학기 GPA(성적이 하나도 없으면 null). */
  gpa: number | null;
  /** 성적을 아직 안 넣은 과목들 — 결산의 유일한 **할 일**. */
  missingGrades: Course[];
  /** 이 학기가 이미 끝났나(오늘 기준). */
  ended: boolean;
}

function investedMinOf(state: AppState, sem: Semester, sid: string): number {
  let min = 0;
  for (const [ds, day] of Object.entries(state.completions || {})) {
    if (sem.startDs && ds < sem.startDs) continue;
    if (sem.endDs && ds > sem.endDs) continue;
    for (const [key, v] of Object.entries(day)) {
      if (key.split('|')[0] !== sid) continue;
      min += Number(v?.actualMin ?? v?.min) || 0;
    }
  }
  return min;
}

/** 중앙값 — 한 과목의 이상치(재수강·중도포기)가 평균을 끄는 것을 막는다(`creditRate` 와 같은 규칙). */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** 한 학기의 결산. ⚠ 읽기 전용 — 아무것도 안 쓴다(머리주석). */
export function semesterReport(state: AppState, semester: Semester, ds = todayISO(state)): SemesterReport {
  const rows: CloseRow[] = (semester.courses || []).map((course) => {
    const item = itemOfCourse(state, course);
    const invested = item ? investedMinOf(state, semester, item.id) / 60 : null;
    const plannedRaw = item ? (item.chapters || []).reduce((a, c) => a + (c.hours || 0), 0) : 0;
    const planned = item && plannedRaw > 0 ? plannedRaw : null;
    const investedH = invested == null ? null : r1(invested);
    return {
      course,
      item,
      investedH,
      plannedH: planned == null ? null : r1(planned),
      ratio: investedH != null && planned ? Math.round((investedH / planned) * 100) / 100 : null,
      /* ⚠ 0시간 과목은 표본이 아니다 — 링크만 걸고 한 번도 안 한 과목이 학점당 시간을 0으로
         끌어내리면 다음 학기 시뮬이 "감당 된다"고 거짓말한다. */
      hoursPerCredit: investedH && course.credits ? r1(investedH / course.credits) : null,
      graded: !!course.grade && course.grade in GRADE_POINTS,
    };
  });
  const totalInvestedH = r1(rows.reduce((a, r) => a + (r.investedH || 0), 0));
  const totalPlannedH = r1(rows.reduce((a, r) => a + (r.plannedH || 0), 0));
  const hpc = median(rows.map((r) => r.hoursPerCredit).filter((x): x is number => x != null));
  return {
    semester,
    rows,
    totalInvestedH,
    totalPlannedH,
    ratio: totalPlannedH > 0 ? Math.round((totalInvestedH / totalPlannedH) * 100) / 100 : null,
    hoursPerCredit: hpc == null ? null : r1(hpc),
    gpa: semesterGpa(semester),
    /* ⚠ '예정' 과목은 성적이 없는 것이 정상이다 — 결산의 할 일 목록에 넣으면 매 학기 지워지지
       않는 잔소리가 된다(`rehearsalSteps` 가 세운 *줄어드는 목록* 규율). */
    missingGrades: (semester.courses || []).filter((c) => c.status !== '예정' && !(c.grade && c.grade in GRADE_POINTS)),
    ended: !!semester.endDs && dayDiff(semester.endDs, ds) > 0,
  };
}

/**
 * **결산할 것이 남은** 끝난 학기들 — 최근 순.
 *
 * ⚠ *모든* 끝난 학기가 아니라 **할 일이 남은 것**만이다: 성적을 다 넣었고 과목도 없는 학기는
 * 결산할 것이 없다. 이 목록이 비면 화면이 사라지는 것이 옳다(`rehearsalSteps` 와 같은 계약).
 */
export function pendingCloseSemesters(state: AppState, ds = todayISO(state)): Semester[] {
  return (state.degree?.semesters || [])
    .filter((s) => s.endDs && dayDiff(s.endDs, ds) > 0)
    .filter((s) => semesterStat(s).tot > 0 && semesterReport(state, s, ds).missingGrades.length > 0)
    .sort((a, b) => (a.endDs! < b.endDs! ? 1 : -1));
}
