/* ============================================================
   scheduler/priority.ts — "무엇을 얼마나 먼저" 판단하는 신호들.
   총량 환산 · 지식상태(숙달도) 슬림화/조회 · 백지복습 최근 결과 · 적응형 용량 계수.
============================================================ */
import { clamp, dayDiff, iso, addDays, parseISO } from '../utils';
import { matchSubjectIndex } from '../subjectMatch';
import { dayStudyMin } from './windows';
import { completionMin } from '../persistence';
import type { AppState, Item } from '../types';

export function itemTotalHours(it: Item): number {
  return (it.chapters || []).reduce((t, c) => t + (+c.hours || 0), 0);
}

/* ── 그래프 우선순위(B): 지식엔진 과목 숙달도를 배분에 역연동(약한 과목 먼저) ── */
/** _knowState write-through 슬림화(감사 2026-07-16 ②#25) — 스케줄러(subjectMastery)가 읽는 건
 *  subjects[].{subject,mastery}뿐인데 전체 Knowledge(노트별 concepts 배열 포함)를 state에 넣으면
 *  매 400ms flush 직렬화 비용 + localStorage 5MB 쿼터를 잠식한다(볼트 수천 노트 시 수백 KB~MB).
 *  전체 아티팩트는 react-query 캐시(['knowledge'])가 소유 — state엔 스케줄 입력만. */
export function slimKnowState(k: unknown): { subjects: { subject: string; mastery: number }[] } {
  const subjects = (k as { subjects?: unknown })?.subjects;
  if (!Array.isArray(subjects)) return { subjects: [] };
  const out: { subject: string; mastery: number }[] = [];
  for (const s of subjects) {
    const subject = (s as { subject?: unknown })?.subject;
    const mastery = (s as { mastery?: unknown })?.mastery;
    if (typeof subject === 'string' && typeof mastery === 'number') out.push({ subject, mastery });
  }
  return { subjects: out };
}

/** 과목의 최신 백지복습 결과(②#23) — true=통과 · false=실패 · null=기록 없음(ds 사전순 최신). */
export function latestBlank(state: AppState, sid: string): boolean | null {
  let bestDs = '';
  let passed: boolean | null = null;
  for (const r of state.blankResults || []) {
    if (r.sid !== sid) continue;
    if (r.ds >= bestDs) {
      bestDs = r.ds;
      passed = !!r.passed;
    }
  }
  return passed;
}

/** 지식엔진 과목 숙달도 조회 — 이름 매칭 규칙은 `lib/subjectMatch` 가 소유한다(E3).
 *  ⚠ 규칙을 여기 인라인으로 두었더니 **실패가 조용했고**(안 붙어도 null 만 돌아온다) 몇 과목이
 *  안 붙는지 아무 화면에도 없었다 — 그 규칙이 `masteryNeed` 를 통해 배분을 구동하는데도.
 *  이제 같은 규칙이 조인 리포트(`subjectJoin`)를 먹이므로 계측과 배분이 갈릴 수 없다. */
export function subjectMastery(state: AppState, name: string): number | null {
  const k = state._knowState;
  if (!k || !Array.isArray(k.subjects)) return null;
  const i = matchSubjectIndex(
    name,
    k.subjects.map((s) => s.subject || ''),
  );
  if (i < 0) return null;
  const m = k.subjects[i]?.mastery;
  return typeof m === 'number' ? m : null;
}
export function masteryNeed(state: AppState, name: string): number {
  if (state.graphPriority !== true) return 0; // 기본 off → 영향 0
  const m = subjectMastery(state, name);
  return m == null ? 0 : 1 - clamp(m, 0, 1); // 약할수록 큰 우선순위
}

/* ── 적응형 용량(방법론 1·10절: "계획은 가설") ── */
export const ADAPT_WINDOW = 14;
export const ADAPT_MIN_DAYS = 3;
export function adherenceFactor(
  state: AppState,
  start: string,
  horizon: number,
  capWd: number[],
  today: string,
): number {
  if (state.adaptiveCapacity === false) return 1;
  const c = state.completions || {};
  let doneMin = 0;
  let capMin = 0;
  let activeDays = 0;
  /* ⚠⚠ **버릴 날을 만들려고 Date 를 할당하지 않는다(H29 · 2026-07-31 `/감사 근본`).**

     창은 `ADAPT_WINDOW`(14일) 고정인데 루프는 `startDate` 부터 돌면서 창 밖은 `continue` 로
     버렸다 — 즉 **루프 길이가 계정 나이에 비례**했고 그 대부분이 순수 낭비였다. 게다가 매 회
     `parseISO(start)` 를 다시 파싱했다. 실측(과목 5·일정 40):

         startDate 나이  30일 0.07ms · 200일 0.30ms · 900일 1.34ms · **1800일 2.64ms**

     같은 조건의 `schedule()` 전체가 0.82~8.65ms 이므로 **최대 30%가 이 낭비**였다.
     결과값은 정의상 동일하다 — 건너뛰던 구간을 애초에 안 도는 것뿐이다. */
  const from = parseISO(start);
  const begin = Math.max(0, dayDiff(start, today) - ADAPT_WINDOW);
  for (let i = begin; i <= horizon; i++) {
    const date = addDays(from, i);
    const ds = iso(date);
    if (ds >= today) break; // 과거만(날짜 오름차순)
    if (dayDiff(ds, today) > ADAPT_WINDOW) continue; // 방어적 — 위 `begin` 이 이미 걸러냈다
    capMin += dayStudyMin(state, ds, date.getDay(), capWd);
    const m = c[ds];
    let dm = 0;
    // G-1 — **실측이 있으면 실측**. 이 값이 곧 아래 계수가 되고, 그 계수가 미래 용량을 깎는다.
    if (m) for (const k in m) dm += completionMin(m[k]);
    doneMin += dm;
    if (dm > 0) activeDays++;
  }
  if (activeDays < ADAPT_MIN_DAYS || capMin <= 0) return 1;
  return clamp(doneMin / capMin, 0.5, 1.0);
}
