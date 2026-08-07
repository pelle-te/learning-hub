/* ============================================================
   questions.ts — **T-7 문항 원장** + **T-2 시험 회수 창**. 순수 · React 무관.

   ## 왜 두 항목이 한 파일인가

   같은 것을 **다른 순간에** 적는다. T-7 은 아무 때나 여는 원장이고, T-2 는 시험 **직후 20분**
   에 한 번 여는 시트다. 전제가 다르고(직후의 기억이 나중보다 정확하다) 그래서 값에 표식이
   남지만(`fromRecall`), 저장 형태를 가르면 시험 2주 전에 **두 곳을 뒤져야** 한다 — 이 원장의
   존재 이유가 정확히 "한 곳에서 뒤진다"이므로 가르는 순간 값이 사라진다.

   ## 왜 `cbms`(오답 노트)로 안 되나

   `cbms` 는 **틀린 사건**의 기록이다. 문항은 *다시 풀 수 있는 대상*이라 수명이 다르다 — 시험
   2주 전에 열리는 것은 "무엇을 틀렸나"가 아니라 **그 문제 자체**다. 섞으면 오답 노트가 문제
   은행이 되고 오답의 시제(과거 사건)가 흐려진다(`mistakes.ts` 가 세운 시제 규율).

   ## ⚠ 이 파일의 존재 판정 — `chapterHotspots`

   T-7 의 "반나절 검증"은 _"최근 문제 10개를 4칸으로 적어 **2개 이상이 같은 챕터면 참**"_ 이었다.
   그 판정을 사람이 눈으로 하지 않도록 **코드가 답한다**. 밀집이 없으면 이 원장은 목록일 뿐이고,
   그 사실도 화면이 말해야 한다 — 값이 없는데 있는 척하는 화면이 이 저장소의 반복 실패다.
============================================================ */
import type { AppState, Exam, Item, Question } from './types';
import { examScopes } from './semester';
import { addDays, dayDiff, iso, parseISO, REVIEW_OFFSETS, REVIEW_TAIL_OFFSET } from './utils';

/** 회수 창이 열려 있는 기간(일). 시험 **당일과 다음 날**까지 — 직후 20분이 이상적이지만
 *  앱을 그 자리에서 열지 않는 일이 흔하고, 이틀이 지나면 전제 자체가 무너진다. */
export const RECALL_WINDOW_DAYS = 1;

export function questionsOf(state: Pick<AppState, 'questions'>): Question[] {
  return state.questions || [];
}

/** 한 과목의 문항 — **최신 먼저**(시험 전에 여는 화면이라 최근 것이 위에 와야 한다). */
export function questionsForSubject(state: Pick<AppState, 'questions'>, sid: string): Question[] {
  return questionsOf(state)
    .filter((q) => q.sid === sid)
    .sort((a, b) => (a.ds < b.ds ? 1 : a.ds > b.ds ? -1 : 0));
}

/** 챕터 밀집 한 줄. `n` 이 2 이상인 것이 T-7 의 판정 대상이다. */
export interface Hotspot {
  chapter: string;
  n: number;
}

/**
 * 같은 챕터에 몰린 문항 — **많은 순**. 챕터가 안 적힌 문항은 세지 않는다.
 *
 * ⚠ 이것이 T-7 이 값을 내는지의 관측 장치다(머리주석). 화면은 `hotspots.length === 0` 일 때
 * "아직 밀집이 없다"고 **말해야** 한다 — 밀집이 없는 원장은 시험 전에 열 이유가 없고,
 * 그 사실을 숨기면 앱이 자기 기능을 과대평가하게 된다.
 */
export function chapterHotspots(state: Pick<AppState, 'questions'>, sid?: string): Hotspot[] {
  const n = new Map<string, number>();
  for (const q of questionsOf(state)) {
    if (sid && q.sid !== sid) continue;
    if (!q.chapter) continue;
    n.set(q.chapter, (n.get(q.chapter) || 0) + 1);
  }
  return [...n.entries()]
    .map(([chapter, count]) => ({ chapter, n: count }))
    .filter((h) => h.n >= 2)
    .sort((a, b) => b.n - a.n);
}

/**
 * 이 시험 범위에 드는 문항 — 시험 2주 전에 여는 목록.
 *
 * 범위는 `examScopes`(T-1)가 정한 챕터 구간이고, 챕터가 안 적힌 문항은 **범위 밖으로 치지
 * 않는다**(과목 단위 문항이라 어느 시험에도 관련될 수 있다 → 뒤에 붙인다).
 */
export function questionsForExam(state: Pick<AppState, 'questions'>, item: Item, exam: Exam): Question[] {
  const scopes = examScopes(item);
  const scope = scopes.find((s) => s.exam.id === exam.id);
  const chapters = item.chapters || [];
  const inScope = new Set(
    scope ? chapters.slice(scope.fromIdx, scope.thruIdx + 1).map((c) => c.name) : chapters.map((c) => c.name),
  );
  const mine = questionsForSubject(state, item.id);
  return [...mine.filter((q) => q.chapter && inScope.has(q.chapter)), ...mine.filter((q) => !q.chapter)];
}

/** 회수 창 한 건 — "이 시험이 방금 끝났다". */
export interface RecallWindow {
  item: Item;
  exam: Exam;
  /** 시험 이후 경과일(0 = 오늘). */
  daysSince: number;
  /** 이 시험으로 이미 적은 문항 수 — 0 이면 화면이 권유하고, 있으면 이어 적기다. */
  written: number;
}

/**
 * 지금 열려 있는 회수 창들 — 최근에 끝난 시험. 없으면 빈 배열(= 화면이 안 그린다).
 *
 * ⚠ **미래 시험은 창이 아니다.** 그리고 창은 짧다 — 길게 두면 "직후의 기억"이라는 이 항목의
 * 유일한 근거가 사라지고, 그냥 늦게 적는 원장(T-7)과 구분되지 않는다.
 */
export function recallWindows(
  state: Pick<AppState, 'items' | 'questions'>,
  ds: string,
  examsOfItem: (item: Item) => Exam[],
): RecallWindow[] {
  const out: RecallWindow[] = [];
  for (const item of state.items || []) {
    for (const exam of examsOfItem(item)) {
      const since = dayDiff(exam.date, ds);
      if (since < 0 || since > RECALL_WINDOW_DAYS) continue;
      const written = questionsOf(state).filter(
        (q) => q.sid === item.id && q.fromRecall && dayDiff(exam.date, q.ds) >= 0 && dayDiff(q.ds, ds) >= 0,
      ).length;
      out.push({ item, exam, daysSince: since, written });
    }
  }
  return out;
}

/* ── A-14 **다시 만날 날** ─────────────────────────────────────────────────
   이 원장의 결함은 내용이 아니라 **시제**였다: 아카이브는 *사용자가 갈 때만* 존재하는데 갈
   이유가 발생하지 않는다. 챕터는 `spacedReview` 사다리가 불러 주고 오답은 약점 배분이 불러
   주는데, 문항만 부르는 사람이 없었다 — 그래서 시험 2주 전에 "그 문제"를 다시 만나려면
   **사용자가 그 원장을 기억해야** 했다(기억해야 하는 도구는 안 쓰인다).

   ⚠ **새 사다리를 만들지 않는다.** 간격은 앱의 복습 사다리 그대로다(`REVIEW_OFFSETS` + 꼬리).
   문항에만 다른 곡선을 주면 "왜 이건 3일이고 저건 4일인가"를 설명할 근거가 앱 안에 없다.
   ⚠ **다음 날짜를 저장하지 않는다** — `met` 에서 파생한다(저장하면 자정마다 낡는 값이 하나 더
   늘고, 그건 `semesterPhase` 가 이미 거절한 형태다). */

/** 이 문항을 **다시 만날 날**(ISO). 아직 한 번도 안 만났으면 적은 날 + 1일. */
export function nextMeetDs(q: Pick<Question, 'ds' | 'met'>): string {
  const met = q.met || [];
  const anchor = met.length ? met[met.length - 1]! : q.ds;
  const off = met.length < REVIEW_OFFSETS.length ? REVIEW_OFFSETS[met.length]! : REVIEW_TAIL_OFFSET;
  return iso(addDays(parseISO(anchor), off));
}

/** 오늘 다시 만날 문항 한 건. `over` = 지난 일수(0 = 오늘). */
export interface QuestionDue {
  q: Question;
  dueDs: string;
  over: number;
}

/**
 * `ds` 기준 **다시 만날 때가 된** 문항들 — 오래 지난 것부터.
 *
 * ⚠ 과목을 안 가린다: 문항은 시험 범위로 묶이기 전에 *내가 틀린 것*이고, 그 목록을 과목별로
 * 가르면 다시 이 원장을 **찾아가야** 한다(이 항목이 없애려는 마찰 그 자체).
 */
export function dueQuestions(state: Pick<AppState, 'questions'>, ds: string): QuestionDue[] {
  return questionsOf(state)
    .map((q) => ({ q, dueDs: nextMeetDs(q), over: dayDiff(nextMeetDs(q), ds) }))
    .filter((d) => d.over >= 0)
    .sort((a, b) => b.over - a.over);
}

/** "다시 봤다"를 기록한다 — 사다리를 한 칸 올린다. ⚠ 뮤테이터.
 *  ⚠ 같은 날 두 번 누르면 **한 번으로 친다**: 하루에 두 번 본 것은 인출 두 번이 아니다
 *  (`reviewTouches` 가 챕터에 대해 세운 것과 같은 규칙). */
export function markMet(state: AppState, id: string, ds: string): void {
  const q = (state.questions || []).find((x) => x.id === id);
  if (!q) return;
  q.met = q.met || [];
  if (q.met[q.met.length - 1] === ds) return;
  q.met.push(ds);
}

/** 문항을 넣는다. ⚠ 뮤테이터 — immer 초안 위에서 부른다.
 *
 *  ⚠ **빈 `prompt` 는 넣지 않는다.** 4칸 중 나머지 셋은 비어도 값이 있지만(챕터만 적어도
 *  밀집 판정에 들어간다) 문제 자체가 없으면 다시 풀 수 없어 원장의 목적을 못 채운다. */
export function addQuestion(state: AppState, q: Question): boolean {
  if (!q.prompt.trim()) return false;
  state.questions = state.questions || [];
  state.questions.push(q);
  return true;
}

/** 문항을 지운다. ⚠ 뮤테이터. */
export function removeQuestion(state: AppState, id: string): void {
  if (!state.questions) return;
  state.questions = state.questions.filter((q) => q.id !== id);
  if (!state.questions.length) delete state.questions;
}
