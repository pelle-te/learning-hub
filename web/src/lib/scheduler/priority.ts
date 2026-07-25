/* ============================================================
   scheduler/priority.ts — "무엇을 얼마나 먼저" 판단하는 신호들.
   총량 환산 · 지식상태(숙달도) 슬림화/조회 · 백지복습 최근 결과 · 적응형 용량 계수.
============================================================ */
import { clamp, dayDiff, iso, addDays, parseISO } from '../utils';
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

export function subjectMastery(state: AppState, name: string): number | null {
  const k = state._knowState;
  if (!k || !Array.isArray(k.subjects)) return null;
  const b = (name || '').replace(/\s/g, '');
  if (!b) return null; // 빈 질의 — a.indexOf('')가 전 과목을 매칭해 배분을 오염(L-9). 매칭 불가로 취급.
  // 정확 일치 우선, 없으면 포함 후보 중 길이차가 가장 작은 것 — 첫-포함 히트는
  // "물리"↔"물리화학" 같은 오매핑으로 graphPriority 배분을 조용히 오염시킨다.
  let best: number | null = null;
  let bestGap = Infinity;
  for (const s of k.subjects) {
    if (!s.subject) continue;
    const a = s.subject.replace(/\s/g, '');
    if (!a) continue; // 공백뿐인 과목명 — b.indexOf('')=0 역오염 방지(L-9).
    const m = typeof s.mastery === 'number' ? s.mastery : null;
    if (a === b) return m;
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) {
      const gap = Math.abs(a.length - b.length);
      if (gap < bestGap) {
        bestGap = gap;
        best = m;
      }
    }
  }
  return best;
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
  for (let i = 0; i <= horizon; i++) {
    const date = addDays(parseISO(start), i);
    const ds = iso(date);
    if (ds >= today) break; // 과거만(날짜 오름차순)
    if (dayDiff(ds, today) > ADAPT_WINDOW) continue; // 최근 N일만
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
