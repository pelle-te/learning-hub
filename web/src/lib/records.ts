/* ============================================================
   records.ts — 개인 기록·시즌 페이스·연속성(I-6/7/13) — 순수·무의존(서버 불필요).
   completions/rituals를 1회 순회해 '성취를 회수'하는 신호를 만든다. 처방(review)과 톤 분리:
   여기는 격려·리듬·연속성. 앱의 '오늘'(todayISO)을 주입받아 결정적으로 계산한다.
============================================================ */
import { addDays, dayDiff, iso, mondayOf, parseISO, todayISO } from './utils';
import type { AppState } from './types';

/** 하루별 완료 학습 분(done 세션의 min 합). 완료 없는 날은 키 없음. */
function dailyFocusMin(state: AppState): Record<string, number> {
  const comp = state.completions || {};
  const out: Record<string, number> = {};
  for (const ds of Object.keys(comp)) {
    let min = 0;
    let any = false;
    for (const k of Object.keys(comp[ds] || {})) {
      const e = comp[ds]![k];
      if (e?.done) {
        any = true;
        min += e.min || 0;
      }
    }
    if (any) out[ds] = min;
  }
  return out;
}

export interface PersonalBests {
  longestStreak: number; // 최장 연속 학습일
  currentStreak: number; // 오늘(또는 어제)까지 이어지는 현재 연속
  bestFocusMin: number; // 하루 최다 학습 분
  bestFocusDs: string; // 그 날('' = 기록 없음)
  mostSessionsWeek: number; // 한 주 최다 완료 세션
  totalDays: number; // 학습한 날 총수
}

/** 개인 기록(I-6) — completions 1회 순회로 최장/현재 연속·최고 집중일·주 최다 세션. 기록 없으면 전부 0. */
export function personalBests(state: AppState): PersonalBests {
  const dayMin = dailyFocusMin(state);
  const days = Object.keys(dayMin).sort();

  // 최장 연속: 인접일(dayDiff===1) 이어붙이기.
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const ds of days) {
    run = prev && dayDiff(prev, ds) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = ds;
  }

  // 현재 연속: 오늘 있으면 오늘, 없고 어제 있으면 어제부터 역방향(오늘 아직 안 했어도 어제까지 인정).
  const set = new Set(days);
  const today = todayISO(state);
  const yest = iso(addDays(parseISO(today), -1));
  let cursor = set.has(today) ? today : set.has(yest) ? yest : '';
  let cur = 0;
  while (cursor && set.has(cursor)) {
    cur++;
    cursor = iso(addDays(parseISO(cursor), -1));
  }

  // 최고 집중일.
  let bestFocusMin = 0;
  let bestFocusDs = '';
  for (const ds of days) {
    if (dayMin[ds]! > bestFocusMin) {
      bestFocusMin = dayMin[ds]!;
      bestFocusDs = ds;
    }
  }

  // 주별 완료 세션(월요일 시작).
  const comp = state.completions || {};
  const weekDone: Record<string, number> = {};
  for (const ds of Object.keys(comp)) {
    const wk = iso(mondayOf(parseISO(ds)));
    for (const k of Object.keys(comp[ds] || {})) if (comp[ds]![k]?.done) weekDone[wk] = (weekDone[wk] || 0) + 1;
  }
  const mostSessionsWeek = Object.values(weekDone).reduce((m, n) => Math.max(m, n), 0);

  return {
    longestStreak: longest,
    currentStreak: cur,
    bestFocusMin,
    bestFocusDs,
    mostSessionsWeek,
    totalDays: days.length,
  };
}

export interface SeasonPace {
  thisWeekMin: number; // 이번 주 완료 학습 분
  avgWeekMin: number; // 직전 baselineWeeks주 평균(이번주 제외)
  ahead: boolean; // 이번 주가 평균 이상인가(리듬 유지/초과)
  deltaPct: number; // (this-avg)/avg*100 반올림, avg 0이면 0
  weeks: { weekMon: string; min: number }[]; // 오래된→최신(이번주 포함) 스파크/서사용
}

/** 시즌 페이스(I-7) — '완료율'이 아니라 '리듬': 이번 주 학습량 vs 직전 몇 주 평균.
   시간 대비 앞섰나/뒤졌나를 서사화. baselineWeeks주 이력이 없으면 있는 만큼으로 평균. */
export function seasonPace(state: AppState, baselineWeeks = 4): SeasonPace {
  const mon0 = mondayOf(parseISO(todayISO(state)));
  const dayMin = dailyFocusMin(state);
  const weekMin = (mon: Date): number => {
    const from = iso(mon);
    const to = iso(addDays(mon, 6));
    let sum = 0;
    for (const ds of Object.keys(dayMin)) if (ds >= from && ds <= to) sum += dayMin[ds]!;
    return sum;
  };

  const weeks: { weekMon: string; min: number }[] = [];
  for (let i = baselineWeeks; i >= 0; i--) {
    const mon = addDays(mon0, -7 * i);
    weeks.push({ weekMon: iso(mon), min: weekMin(mon) });
  }
  const thisWeekMin = weeks[weeks.length - 1]!.min;
  const prior = weeks.slice(0, -1);
  const avgWeekMin = prior.length ? Math.round(prior.reduce((t, w) => t + w.min, 0) / prior.length) : 0;
  const deltaPct = avgWeekMin ? Math.round(((thisWeekMin - avgWeekMin) / avgWeekMin) * 100) : 0;
  return { thisWeekMin, avgWeekMin, ahead: thisWeekMin >= avgWeekMin, deltaPct, weeks };
}

export interface RitualChain {
  streak: number; // 오늘부터 역방향 연속 셧다운 일수
  days: { ds: string; done: boolean }[]; // 오래된→최신(마지막=오늘) 연속성 도트용
}

/** 셧다운 체인(I-13) — 최근 back일의 저녁 셧다운 의식 완료 도트 + 현재 연속(오늘부터 역방향).
   "Don't break the chain" — rituals[ds].shutdown 저활용 데이터를 연속성 신호로 부활. */
export function shutdownChain(state: AppState, back = 14): RitualChain {
  const today = parseISO(todayISO(state));
  const rituals = state.rituals || {};
  const days: { ds: string; done: boolean }[] = [];
  for (let i = back - 1; i >= 0; i--) {
    const ds = iso(addDays(today, -i));
    days.push({ ds, done: !!rituals[ds]?.shutdown });
  }
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i]!.done) streak++;
    else break;
  }
  return { streak, days };
}
