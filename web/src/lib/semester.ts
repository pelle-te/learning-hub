/* ============================================================
   semester.ts — **T-1 학기 계약**의 읽기 SSOT (순수 · React 무관)

   왜 이 파일이 생겼나 (2026-08-02 · 발산 5회차 T-1):
   블라인드 7각도가 **세 곳에서 만났고** 그중 하나가 _"여정의 입구와 출구가 통째로 비어 있다 —
   **'학기'가 데이터에 없다**"_ 였다. 근거는 셋이 독립적으로 왔다:
     · 각도 7 — 학습 여정 28단계 중 앱이 덮는 것은 **3단계**이고 셋 다 학기 *중반*이다.
     · 각도 3 — 시그니처 7종이 **전부 지금 상태**를 그린다(시간축이 수개월인 것 0).
     · 메인 직독 — `Semester` 에 **날짜가 없고**, `Course`(학점·성적)와 `Item`(챕터·마감)이
       **서로를 전혀 참조하지 않는다.** 같은 과목이 6화면에 흩어진 근본 원인이 이것이다.

   이 파일이 지키는 규율 셋:
   1. **읽기는 여기 하나로 모은다.** `item.exams` 와 옛 `item.deadline`/`deadlineThru` 를 **둘 다
      직접 읽는 코드를 만들지 말 것** — 두 원천을 각자 해석하면 화면마다 갈린다. `examsOf()` 가
      옛 필드를 시험 1개로 승격시켜 돌려주므로 호출부는 `exams` 만 아는 세계에 산다.
   2. **동작 보존이 계약이다.** 시험이 0~1개면 `examScopes()` 의 결과가 옛 `deadlineThru` 계산과
      **한 글자도 다르지 않다**(`scheduler.test.ts` 가 이걸 잠근다). 새 동작은 시험이 2개일 때만.
   3. **여기서 파생하고 저장하지 않는다.** 국면(학기중/방학/개강 전)·주차는 전부 날짜에서 계산한다 —
      저장하면 자정을 넘길 때마다 낡는다(과목 색이 저장값이 아닌 것과 같은 논증).
============================================================ */
import type { AppState, Chapter, Course, Exam, Item, Semester } from './types';
import { dayDiff, todayISO } from './utils';

/** 시험 최대 개수(v1). ⚠ **이 상수를 올리는 것이 금도금 미끄럼틀의 첫 걸음이다** — `schema.ts` 의
 *  `ExamSchema` 머리주석이 무엇을 안 만들기로 했는지 적어 뒀다. 올리려면 근거를 들고 그 주석부터. */
export const MAX_EXAMS = 2;

/** 시험 종류의 표시 이름. 자유입력을 만들지 않는 이유도 같다(유형이 늘면 가중치가 따라온다). */
export const EXAM_LABEL: Record<Exam['kind'], string> = { mid: '중간', final: '기말' };

/**
 * 과목의 시험들을 **날짜순**으로 돌려준다 — 이 앱에서 시험을 읽는 **유일한 입구**.
 *
 * 옛 저장(`deadline`/`deadlineThru`)은 여기서 **시험 1개로 승격**된다. 그래서 `exams` 를 한 번도
 * 안 쓴 사용자에게도 아래 모든 계산이 종전과 동일하게 성립한다(무마이그레이션).
 * ⚠ 승격된 시험의 `kind` 는 `'final'` 이다 — 옛 모델의 마감은 "이 과목의 끝"을 뜻했으므로.
 */
export function examsOf(item: Pick<Item, 'exams' | 'deadline' | 'deadlineThru'>): Exam[] {
  const list = item.exams?.length
    ? item.exams
    : item.deadline
      ? [{ id: `${item.deadline}-legacy`, kind: 'final' as const, date: item.deadline, thru: item.deadlineThru }]
      : [];
  return [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, MAX_EXAMS);
}

/** 과목이 시험을 하나라도 갖고 있나(= 마감 모델이 켜져 있나). */
export function hasExams(item: Pick<Item, 'exams' | 'deadline' | 'deadlineThru'>): boolean {
  return examsOf(item).length > 0;
}

/**
 * 그 날짜에 있는 시험들(없으면 빈 배열). **달력·주 그리드의 마감 표식은 이걸 써야 한다.**
 *
 * ⚠⚠ 종전엔 세 곳이 `it.deadline === ds` 로 **원시 필드**를 직접 읽었다(H-1 · 2026-08-06 감사).
 * 그런데 시험을 편집하면 `SubjectDefinition` 이 `delete it.deadline` 을 한다 — 즉 **시험을 넣는
 * 순간 월 캘린더·주 그리드에서 그 과목 마감이 조용히 사라졌다.** 새 모델을 켠 것이 옛 표시를
 * 끄는 형태이고, 어디에도 오류가 안 난다. `examsOf` 가 *유일한 입구*라고 적혀 있었는데 이 셋이
 * 그 밖에 있었다 — 입구를 선언만 하면 새 소비처가 옆문으로 들어온다.
 * 그리고 시험이 둘이면 **표식도 둘**이어야 한다(옛 필드는 애초에 한 날짜만 표현할 수 있었다).
 */
function examsOn(item: Pick<Item, 'exams' | 'deadline' | 'deadlineThru'>, ds: string): Exam[] {
  return examsOf(item).filter((e) => e.date === ds);
}

/** 그 날짜에 시험이 있는 **이름 있는 과목**들을 시험 하나당 한 줄로 편다. 위 주석이 근거를 갖는다. */
export function examMarks(items: readonly Item[], ds: string): { id: string; name: string; exam: Exam }[] {
  return items.flatMap((it) => (it.name ? examsOn(it, ds).map((exam) => ({ id: it.id, name: it.name, exam })) : []));
}

/**
 * **다가오는** 시험(오늘 이후 중 가장 가까운 것). 없으면 null.
 *
 * ⚠ 화면의 D-day 는 **마지막 시험이 아니라 이것**을 써야 한다 — 중간고사가 코앞인데 기말까지의
 * D-60 을 보여주면 그 숫자는 거짓말이다. 옛 모델은 마감이 하나뿐이라 이 구분이 존재할 수 없었고,
 * 그래서 모든 화면이 자동으로 "마지막 마감"을 그렸다.
 */
export function nextExamOf(item: Pick<Item, 'exams' | 'deadline' | 'deadlineThru'>, ds: string): Exam | null {
  return examsOf(item).find((e) => e.date >= ds) || null;
}

/** 시험 하나가 덮는 챕터 구간. `fromIdx`..`thruIdx` 는 **원본 `chapters` 배열의 인덱스**(포함). */
export interface ExamScope {
  exam: Exam;
  fromIdx: number;
  thruIdx: number;
}

/**
 * 시험들을 챕터 배열 위의 **연속 구간**으로 편다.
 *
 * 규칙 — 시험 i 의 범위는 `직전 시험의 thru 다음`부터 `자기 thru`까지다. `thru` 가 없거나 그 id 를
 * 못 찾으면 **끝까지**로 폴백한다(옛 id 하나 때문에 마감 판정이 통째로 멈추는 것보다, 종전 동작으로
 * 되돌아가는 편이 안전하다 — `engine.ts` 가 P-10 에서 내린 것과 같은 판단).
 *
 * ⚠ **시험이 0~1개면 결과가 옛 계산과 동일하다**: 구간 하나가 `0..scopeEnd` 이고 `scopeEnd` 는
 * `deadlineThru` 를 찾은 인덱스(못 찾으면 마지막)다.
 * ⚠ 날짜순으로 정렬돼 있는데 `thru` 가 역행하면(중간고사 범위가 기말보다 뒤) 구간이 비므로
 * `fromIdx > thruIdx` 가 될 수 있다 — 호출부는 **빈 구간을 정상 값으로** 다뤄야 한다.
 */
export function examScopes(item: Pick<Item, 'exams' | 'deadline' | 'deadlineThru' | 'chapters'>): ExamScope[] {
  const all: Chapter[] = item.chapters || [];
  const exams = examsOf(item);
  const out: ExamScope[] = [];
  let cursor = 0;
  exams.forEach((exam, i) => {
    const found = exam.thru ? all.findIndex((c) => c.id === exam.thru) : -1;
    const isLast = i === exams.length - 1;
    // 마지막 시험은 `thru` 가 없으면 끝까지 덮는다. 중간 시험이 `thru` 없이 오면 범위를 알 수 없어
    // 역시 끝까지로 두는데, 그러면 뒤 시험이 빈 구간이 된다 — 화면이 그 상태를 경고로 말한다.
    const thruIdx = found >= 0 ? found : isLast || !exam.thru ? all.length - 1 : all.length - 1;
    out.push({ exam, fromIdx: cursor, thruIdx });
    cursor = Math.max(cursor, thruIdx + 1);
  });
  return out;
}

/** 챕터 인덱스 → 그 챕터를 덮는 시험 구간의 순번(없으면 -1 = 어느 시험 범위에도 안 든다). */
export function scopeIndexFor(scopes: ExamScope[], chapterIdx: number): number {
  return scopes.findIndex((s) => chapterIdx >= s.fromIdx && chapterIdx <= s.thruIdx);
}

/* ── 학기 국면 ──────────────────────────────────────────────────────────── */

/** 국면. `pre` = 개강 전(방학이지만 다음 학기가 정해져 있다) · `in` = 학기 중 · `off` = 아무 학기도
 *  아니다(다음 학기 미정). ⚠ **`off` 와 `pre` 를 합치지 말 것** — 처방이 정반대다(T-4). */
export type SemesterPhaseKind = 'in' | 'pre' | 'off';

export interface SemesterPhase {
  kind: SemesterPhaseKind;
  /** 현재(또는 다가오는) 학기. `off` 면 null. */
  semester: Semester | null;
  /** `in` 이면 학기 시작 후 경과일(0-based), 아니면 null. */
  dayIndex: number | null;
  /** `in` 이면 1-based 주차, 아니면 null — T-17 주차 싱크의 입력. */
  week: number | null;
  /** `pre` 면 개강까지 남은 일수(D-n), 아니면 null. */
  daysToStart: number | null;
  /** `in` 이면 종강까지 남은 일수, 아니면 null. */
  daysToEnd: number | null;
}

/** 날짜가 든 학기만 — 날짜 없는 학기는 국면 판정에 참여할 수 없다(그게 T-1 이전의 상태였다). */
function datedSemesters(state: Pick<AppState, 'degree'>): Semester[] {
  const list = state.degree?.semesters || [];
  return list
    .filter((s): s is Semester & { startDs: string } => !!s.startDs)
    .sort((a, b) => (a.startDs! < b.startDs! ? -1 : 1));
}

/**
 * 지금이 학기 중인가 · 방학인가 · 개강까지 며칠인가.
 *
 * ⚠ 이 값을 **저장하지 않는다** — 자정 하나로 낡는다. 그래서 `ds` 를 인자로 받고(테스트가 자정을
 * 넘길 수 있어야 한다) 기본값만 `todayISO(state)` 로 둔다(`_today` 시드 존중).
 */
export function semesterPhase(state: Pick<AppState, 'degree' | '_today'>, ds = todayISO(state)): SemesterPhase {
  const dated = datedSemesters(state);
  const none: SemesterPhase = {
    kind: 'off',
    semester: null,
    dayIndex: null,
    week: null,
    daysToStart: null,
    daysToEnd: null,
  };
  if (!dated.length) return none;

  const current = dated.find((s) => s.startDs! <= ds && (!s.endDs || ds <= s.endDs));
  if (current) {
    const dayIndex = dayDiff(current.startDs!, ds);
    return {
      kind: 'in',
      semester: current,
      dayIndex,
      week: Math.floor(dayIndex / 7) + 1,
      daysToStart: null,
      daysToEnd: current.endDs ? dayDiff(ds, current.endDs) : null,
    };
  }
  const upcoming = dated.find((s) => s.startDs! > ds);
  if (upcoming) {
    return { ...none, kind: 'pre', semester: upcoming, daysToStart: dayDiff(ds, upcoming.startDs!) };
  }
  return none;
}

/** 학기 중이면 그 학기, 개강 전이면 다가오는 학기. 국면이 필요 없을 때 쓰는 얇은 래퍼. */
export function activeSemester(state: Pick<AppState, 'degree' | '_today'>, ds?: string): Semester | null {
  return semesterPhase(state, ds).semester;
}

/* ── 두 우주 잇기 (Course ↔ Item) ───────────────────────────────────────── */

/** 실행 쪽 과목(`Item.id`) → 회계 쪽 과목(`Course`) + 그 학기. 링크가 없으면 null.
 *  ⚠ 순회로 답하는 이유는 `Course.itemId` 단방향이 정본이기 때문(`schema.ts` 참조). */
export function courseOfItem(
  state: Pick<AppState, 'degree'>,
  itemId: string,
): { course: Course; semester: Semester } | null {
  for (const semester of state.degree?.semesters || []) {
    const course = (semester.courses || []).find((c) => c.itemId === itemId);
    if (course) return { course, semester };
  }
  return null;
}

/** 회계 쪽 과목 → 실행 쪽 과목. 링크가 없거나 대상 `Item` 이 지워졌으면 null. */
export function itemOfCourse(state: Pick<AppState, 'items'>, course: Pick<Course, 'itemId'>): Item | null {
  if (!course.itemId) return null;
  return (state.items || []).find((i) => i.id === course.itemId) || null;
}

/** 이 학기에 **실행 짝이 없는** 과목들 — 과목 홈(T-24)·개강 리허설(T-15)이 "이어 붙일 것"으로 쓴다. */
export function unlinkedCourses(state: Pick<AppState, 'items'>, semester: Semester): Course[] {
  const ids = new Set((state.items || []).map((i) => i.id));
  return (semester.courses || []).filter((c) => !c.itemId || !ids.has(c.itemId));
}
