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
import { dayDiff } from './utils';

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
