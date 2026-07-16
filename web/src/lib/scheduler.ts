/* ============================================================
   scheduler.ts — 통합 스케줄 엔진 (모델 v3). 레거시 js/scheduler.js 이식.
   전역 state를 읽던 것을 모두 *state 인자*로 파라미터화(순수 함수 → Vitest 가능).
   동작은 scheduler.test.js 회귀와 100% 동일하게 보존.

   핵심: 하루 가용시간(일과 빈 구간/덮어쓰기)을 모듈(기본 2h)로 쪼개고, 과목의
   '주당 목표 시간'만큼 모듈을 그 주에 인터리빙·마감 우선으로 분배. 챕터 포인터가
   전진하고, 복습은 배운 챕터를 +1·3·7·16일에 생성 — 앵커는 실제 완료일(doneDs · ②#23),
   백지복습 최근 실패 과목은 단축 사다리(1·2·4·8·16)·통과 과목은 +34일 꼬리 1회로 적응.
   daily(Anki)는 매일 먼저 확보.
============================================================ */
import {
  BLOCK_TYPES,
  REVIEW_OFFSETS,
  REVIEW_OFFSETS_WEAK,
  REVIEW_TAIL_OFFSET,
  addDays,
  clamp,
  dayDiff,
  iso,
  mondayOf,
  parseISO,
  toMin,
  todayISO,
} from './utils';
import type {
  AppState,
  Day,
  FreeWindows,
  Item,
  ItemStat,
  LayoutResult,
  LayoutSession,
  RoutineBlock,
  ScheduleItem,
  ScheduleResult,
  TimelineEntry,
} from './types';

interface SchedChapter {
  name: string;
  hours: number;
}
interface SchedSession {
  di: number;
  ds: string;
  chapters: string[];
}
/** 스케줄링 중 과목에 붙는 작업용 필드(레거시 s._* 그대로). 원본 state.items는 안 건드림. */
interface SchedSubject extends Item {
  _allTotal: number;
  _done0: number;
  _hadChapters: boolean;
  _chs: SchedChapter[];
  _cum: number;
  _idx: number;
  _totalH: number;
  _dlIdx: number;
  _schedMin: number;
  _sessions: SchedSession[];
  _carry: number;
  _masteryNeed: number;
  _weekTgt: number;
  _weekDone: number;
}

export function blocksForWeekday(state: AppState, wd: number): RoutineBlock[] {
  // 요일별 시간 오버라이드(times[wd])가 있으면 그 시간으로 해석 — 단일 지점이라 링·빈시간·레이아웃 전부 자동 반영.
  return state.routine
    .filter((b) => b.days.includes(wd))
    .map((b) => {
      const t = b.times?.[String(wd)];
      return t ? { ...b, start: t.start, end: t.end } : b;
    })
    .sort((a, b) => toMin(a.start) - toMin(b.start));
}
/** 깨어있는 시간 [wake0,wake1] — 수면 블록(들)로 결정(없으면 00:00~24:00).
 *  모델: 수면은 하루의 양 끝을 차지하고 자정을 가로지른다 → 깨어있는 구간은 단일 창 [wake0,wake1],
 *  수면은 그 여집합 [wake1,1440]∪[0,wake0]. 수면을 어떻게 입력하든 동일하게 해석한다:
 *  단일 칸 `23:00–07:00`(자정 넘김)이든, `00:00–07:00`+`23:00–24:00` 두 칸이든.
 *   - wake0 = 하루 시작(0)에 붙은 수면의 끝(= 기상). 그런 수면이 없으면 0.
 *   - wake1 = 하루 끝(1440)에 붙은 수면의 시작(= 취침). 그런 수면이 없으면 1440.
 *  자정 넘김(start>end)은 [start,1440]·[0,end] 두 구간으로 분할해 판정한다.
 *  (옛 구현은 sleep[0]만 보고 start===0 / end>=1380 휴리스틱이라 `23:00–07:00` 한 칸을 통째로
 *   놓쳐 심야에 공부를 배정하는 버그가 있었다.) */
export function awakeBounds(blocks: RoutineBlock[]): [number, number] {
  let wake0 = 0;
  let wake1 = 1440;
  blocks
    .filter((b) => b.type === '수면')
    .forEach((b) => {
      const s = toMin(b.start);
      const e = toMin(b.end);
      const segs: [number, number][] =
        s <= e
          ? [[s, e]]
          : [
              [s, 1440],
              [0, e],
            ];
      segs.forEach(([a, c]) => {
        if (a <= 0 && c > wake0) wake0 = c; // 하루 시작에 붙은 수면 → 기상 시각
        if (c >= 1440 && a < wake1) wake1 = a; // 하루 끝에 붙은 수면 → 취침 시각
      });
    });
  return wake0 <= wake1 ? [wake0, wake1] : [0, 1440];
}
/** 요일의 '공부 가능' 빈 구간 = 깨어있는 시간 − 모든 고정 블록(수면 포함).
 *  가장자리 수면은 awakeBounds가 [wake0,wake1] 밖으로 밀어 클램프 시 폭0으로 사라지고,
 *  한낮 수면(낮잠, 예: 13:00–14:00)만 점유로 남아 공부시간 이중계상을 막는다(X-2). */
export function freeWindowsForWeekday(state: AppState, wd: number): FreeWindows {
  const blocks = blocksForWeekday(state, wd);
  const [wake0, wake1] = awakeBounds(blocks);
  const occ = blocks
    .flatMap((b): [number, number][] => {
      // 자정을 걸치는 블록(예: 23:00–01:00)은 두 구간으로 분할 — 안 하면 e<s로 걸러져
      // 그 시간이 '공부 가능'으로 잘못 남는다(수면과 동일 규칙).
      const s = toMin(b.start);
      const e = toMin(b.end);
      return s <= e
        ? [[s, e]]
        : [
            [s, 1440],
            [0, e],
          ];
    })
    .map(([s, e]): [number, number] => [Math.max(wake0, s), Math.min(wake1, e)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  occ.forEach(([s, e]) => {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  });
  const windows: { s: number; e: number }[] = [];
  let p = wake0;
  merged.forEach(([s, e]) => {
    if (s > p) windows.push({ s: p, e: s });
    p = Math.max(p, e);
  });
  if (p < wake1) windows.push({ s: p, e: wake1 });
  const freeMin = windows.reduce((t, w) => t + (w.e - w.s), 0);
  return { wake0, wake1, windows, freeMin };
}
/** 요일별 공부 가능 시간(분). */
export function studyMinByWeekday(state: AppState): number[] {
  const arr = [0, 0, 0, 0, 0, 0, 0];
  for (let wd = 0; wd < 7; wd++) arr[wd] = freeWindowsForWeekday(state, wd).freeMin;
  return arr;
}
/** 특정 날짜의 가용 공부 분 (덮어쓰기 우선). */
export function dayStudyMin(state: AppState, ds: string, wd: number, capWd: number[]): number {
  const ov = state.dayOverrides && state.dayOverrides[ds];
  if (ov !== undefined && ov !== null && ov !== '') {
    // 비수치 오버라이드(+ov=NaN)가 그날 studyMin을 오염시키지 않게 가드 — 부적합하면 요일 기본값으로 폴백(L-10).
    const n = +ov;
    if (Number.isFinite(n)) return Math.round(n * 60);
  }
  return capWd[wd] ?? 0;
}
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
    if (m) for (const k in m) dm += +m[k]!.min || 0;
    doneMin += dm;
    if (dm > 0) activeDays++;
  }
  if (activeDays < ADAPT_MIN_DAYS || capMin <= 0) return 1;
  return clamp(doneMin / capMin, 0.5, 1.0);
}

export function schedule(state: AppState): ScheduleResult {
  // 시작일 방어 — 사용자가 시작일을 빈 값으로 지우면 parseISO('')=Invalid → dayDiff=NaN →
  // horizon=Math.max(6,NaN)=NaN → 루프가 0회 → days=[]로 전 탭이 빈 화면이 됐다. 오늘로 폴백.
  const start = Number.isNaN(parseISO(state.startDate).getTime()) ? todayISO(state) : state.startDate;
  const items = state.items.filter((s) => s.name);
  const warnings: string[] = [];
  const capWd = studyMinByWeekday(state);
  const ML = state.moduleLen || 120;
  const revFrac = (state.reviewRatio || 0) / 100;
  const weeklyRaw = items.filter((s) => s.mode !== 'daily' && +(s.weeklyHours || 0) > 0);
  const daily = items.filter((s) => s.mode === 'daily' && +(s.dailyMin || 0) > 0);
  if (!items.length)
    return { days: [], itemStat: [], weekHours: {}, chapterLog: [], warnings, capUsed: 0, capTotal: 0, ML };

  /* 1) 기간(horizon) */
  const lastDL = items.reduce((m, s) => (s.deadline && s.deadline > m ? s.deadline : m), '');
  let weeksNeed = 8;
  weeklyRaw.forEach((s) => {
    const th = itemTotalHours(s);
    if (th > 0) weeksNeed = Math.max(weeksNeed, Math.ceil(th / Math.max(0.1, +(s.weeklyHours || 0))));
  });
  weeksNeed = Math.min(weeksNeed, 26);
  const endByPace = iso(addDays(mondayOf(parseISO(start)), weeksNeed * 7 + 6));
  const endDate = lastDL && lastDL > endByPace ? lastDL : endByPace;
  const today = todayISO(state);
  // 마감 경로도 상한(18개월) — 먼 미래 마감 하나가 수천 일 배열을 만들어 편집마다 재계산 지연.
  // X-10: 경과한 startDate/짧은·과거 계획(가벼운 콘텐츠·마감없음)이어도 표시창이 오늘을 포함하도록
  //       전방 확장 — 없으면 lastDay가 오늘 이전에서 끝나 복귀 사용자에게 빈 앱이 된다. 세 번째 항이
  //       오늘까지 보장하며(동일 546 상한), 페이스 계산엔 개입하지 않는 표시-only 확장이다.
  const horizon = Math.max(6, Math.min(dayDiff(start, endDate), 546), Math.min(dayDiff(start, today), 546));

  /* 2) 일자 생성 + (적응형) 가용 용량 */
  const adapt = adherenceFactor(state, start, horizon, capWd, today);
  const days: Day[] = [];
  for (let i = 0; i <= horizon; i++) {
    const date = addDays(parseISO(start), i);
    const ds = iso(date);
    const wd = date.getDay();
    let sMin = dayStudyMin(state, ds, wd, capWd);
    if (adapt < 1 && ds >= today) sMin = Math.round(sMin * adapt); // 오늘/미래만 축소(과거 원본 유지)
    days.push({ ds, date, wd, studyMin: sMin, used: 0, modLeft: 0, revLeft: 0, items: [] });
  }
  const adaptApplied = adapt < 1;

  /* 3) daily(Anki) 먼저 — 매일 고정 분 확보 */
  daily.forEach((s) => {
    const dlIdx = clamp(s.deadline ? dayDiff(start, s.deadline) : horizon, 0, days.length - 1);
    for (let j = 0; j <= dlIdx; j++) {
      const d = days[j]!;
      if (d.studyMin - d.used <= 0) continue;
      const m = Math.min(+(s.dailyMin || 0), d.studyMin - d.used);
      if (m <= 0) continue;
      d.items.push({ type: 'anki', sid: s.id, name: s.name, min: Math.round(m), color: s.color });
      d.used += m;
    }
  });
  /* 남은 시간 → 학습 모듈 + 복습예산 */
  days.forEach((d) => {
    const rem = Math.max(0, d.studyMin - d.used);
    const learn = Math.round(rem * (1 - revFrac));
    d.modLeft = Math.floor(learn / ML); // 그날 가능한 학습 모듈 수
    d.revLeft = rem - d.modLeft * ML; // 나머지 = 복습예산
  });

  /* 4) 과목 진행 상태 초기화 (챕터 포인터) — done 챕터는 계획에서 제외 */
  const weekly: SchedSubject[] = weeklyRaw.map((it) => {
    const all = it.chapters || [];
    const chs = all.filter((c) => !c.done).map((c) => ({ name: c.name, hours: Math.max(0.1, +c.hours || 1) }));
    return {
      ...it,
      _allTotal: all.length,
      _done0: all.filter((c) => c.done).length,
      _hadChapters: all.length > 0,
      _chs: chs,
      _cum: 0,
      _idx: 0,
      _totalH: chs.reduce((t, c) => t + c.hours, 0),
      _dlIdx: it.deadline ? clamp(dayDiff(start, it.deadline), 0, days.length - 1) : horizon,
      _schedMin: 0,
      _sessions: [],
      _carry: 0,
      _masteryNeed: masteryNeed(state, it.name),
      _weekTgt: 0,
      _weekDone: 0,
    };
  });
  function advance(s: SchedSubject, addMin: number): string[] {
    if (!s._chs.length) return [];
    const addH = addMin / 60;
    const from = s._cum;
    const to = Math.min(s._totalH, s._cum + addH);
    const covered: string[] = [];
    let acc = 0;
    for (let k = 0; k < s._chs.length; k++) {
      const ch = s._chs[k]!;
      const cs = acc;
      const ce = acc + ch.hours;
      if (ce > from + 1e-6 && cs < to - 1e-6) {
        covered.push(ch.name);
        if (to >= ce - 1e-6) s._idx = Math.max(s._idx, k + 1);
      }
      acc = ce;
    }
    s._cum = to;
    return covered;
  }
  function chaptersLeft(s: SchedSubject): boolean {
    if (!s._hadChapters) return true; // 챕터 없는 과목: 무기한 진행
    if (!s._chs.length) return false; // 모든 챕터 완료
    return s._cum < s._totalH - 1e-6;
  }

  /* 5) 주(週) 단위 학습 모듈 배분 */
  interface ReviewTask {
    idx: number;
    sid: string;
    name: string;
    color?: string;
    chapters: string[];
    min: number;
  }
  const reviewTasks: ReviewTask[] = [];
  const reviewViaAnki = state.reviewViaAnki === true && daily.length > 0;
  const firstMon = mondayOf(parseISO(start));
  for (let w = 0; w * 7 <= horizon + 6; w++) {
    const wStart = addDays(firstMon, w * 7);
    const widx: number[] = [];
    for (let k = 0; k < 7; k++) {
      const di = dayDiff(start, iso(addDays(wStart, k)));
      if (di >= 0 && di < days.length) widx.push(di);
    }
    if (!widx.length) continue;
    // 과목별 이번 주 목표 모듈 — 분수 모듈을 캐리오버해 과/미배정 방지.
    // SD-4: 시작일이 월요일이 아니면 첫 주(w===0)는 부분주 — 7일치 목표를 짧은 첫 주에 통째로
    //       잡으면 미달충(정수 모듈 유실)되던 것을, 실제 가용 일수 비중(widx.length/7)만큼만
    //       앵커하고 나머지는 _carry로 이월한다. 온전한 주(widx.length===7)는 wkFrac=1로 무변경.
    const wkFrac = w === 0 ? widx.length / 7 : 1;
    weekly.forEach((s) => {
      if (!chaptersLeft(s)) {
        s._weekTgt = 0;
        s._weekDone = 0;
        return;
      }
      const perWeek = ((+(s.weeklyHours || 0) * 60) / ML) * wkFrac;
      const avail = s._carry + perWeek;
      const tgt = Math.floor(avail + 1e-9);
      s._carry = avail - tgt;
      s._weekTgt = tgt;
      s._weekDone = 0;
    });
    // 슬롯 채우기: 날짜순 → 마감 임박 & (그래프) 약한 & 덜 채운 과목
    let lastSid: string | null = null;
    widx.forEach((di) => {
      const day = days[di]!;
      let cap = day.modLeft;
      while (cap > 0) {
        const cand = weekly.filter((s) => s._weekDone < s._weekTgt && chaptersLeft(s) && di <= s._dlIdx);
        if (!cand.length) break;
        cand.sort((a, b) => {
          const ua = a._dlIdx - di;
          const ub = b._dlIdx - di; // ① 마감 임박(하드 제약)
          if (ua !== ub) return ua - ub;
          if (a._masteryNeed !== b._masteryNeed) return b._masteryNeed - a._masteryNeed; // ② 약한 과목
          return a._weekDone / a._weekTgt - b._weekDone / b._weekTgt; // ③ 덜 채운 과목
        });
        const pick = cand.find((s) => s.id !== lastSid) ?? cand[0]!; // 같은 과목 연속 회피
        const covered = advance(pick, ML);
        // 같은 날 같은 과목 학습 모듈은 병합 — 완료 키가 sid|type이라 행이 2개면
        // 하나 체크가 다른 하나도 체크되는 충돌(rev 병합과 동일 불변식).
        const exNew = day.items.find((it) => it.type === 'new' && it.sid === pick.id);
        if (exNew) {
          exNew.min += ML;
          covered.forEach((c) => {
            if (exNew.chapters && !exNew.chapters.includes(c)) exNew.chapters.push(c);
          });
        } else {
          day.items.push({
            type: 'new',
            sid: pick.id,
            name: pick.name,
            color: pick.color,
            min: ML,
            chapters: covered.slice(),
            mod: true,
          });
        }
        pick._weekDone++;
        pick._schedMin += ML;
        pick._sessions.push({ di, ds: day.ds, chapters: covered });
        lastSid = pick.id;
        cap--;
        day.used += ML;
        // 복습 예약(그날 배운 챕터 근거) — reviewViaAnki면 Anki/FSRS가 소유하므로 생략
        if (!reviewViaAnki) {
          // ②#23 최소 적응(감사 2026-07-16 · 카드 레벨은 Anki/FSRS 소유 — 여긴 개념 레벨):
          // ① 앵커 = 실제 완료일(doneDs) — 늦게 완료해도 복습이 계획일 기준으로 앞당겨 고정되지 않게.
          //    미완료/구버전 기록(doneDs 없음)은 종전대로 계획일 앵커(무마이그레이션).
          // ② 사다리 = 백지복습 성과 반영 — 최근 실패 과목은 단축(1·2·4·8·16), 통과 과목은
          //    16일 종결 뒤 +34일 꼬리 1회(엔진이 영영 복습을 안 만들던 창을 연장).
          const comp = state.completions?.[day.ds]?.[pick.id + '|new'];
          const anchor = comp?.done && comp.doneDs ? clamp(dayDiff(start, comp.doneDs), 0, days.length - 1) : di;
          const blank = latestBlank(state, pick.id);
          const offsets =
            blank === false
              ? REVIEW_OFFSETS_WEAK
              : blank === true
                ? [...REVIEW_OFFSETS, REVIEW_TAIL_OFFSET]
                : REVIEW_OFFSETS;
          offsets.forEach((off) => {
            const ti = anchor + off;
            if (ti < days.length && ti <= pick._dlIdx)
              reviewTasks.push({
                idx: ti,
                sid: pick.id,
                name: pick.name,
                color: pick.color,
                chapters: covered.slice(),
                min: Math.max(15, Math.round(ML * 0.25)),
              });
          });
        }
      }
    });
  }

  /* 6) 복습 배치 — 복습예산 우선, 없으면 모듈 잔여, 그래도 없으면 여유 큰 날. "no silent caps". */
  reviewTasks.sort((a, b) => a.idx - b.idx);
  let revMissed = 0;
  let revOver = 0;
  reviewTasks.forEach((t) => {
    const end = Math.min(days.length - 1, t.idx + 6);
    let tg = -1;
    for (let j = t.idx; j <= end; j++)
      if (days[j]!.revLeft >= t.min) {
        tg = j;
        break;
      }
    if (tg < 0)
      for (let j = t.idx; j <= end; j++)
        if (days[j]!.studyMin - days[j]!.used >= t.min) {
          tg = j;
          break;
        }
    if (tg < 0) {
      let br = -1;
      for (let j = t.idx; j <= end; j++) {
        const rm = days[j]!.studyMin - days[j]!.used;
        if (rm > br) {
          br = rm;
          tg = j;
        }
      }
    }
    if (tg < 0) {
      revMissed++;
      return;
    } // 창 안 모든 날 초과 → 미배치
    if (days[tg]!.studyMin - days[tg]!.used < t.min) revOver++; // 여유 없는 날에 넘겨 끼움
    const d = days[tg]!;
    const ex = d.items.find((it) => it.type === 'rev' && it.sid === t.sid);
    if (ex) {
      ex.min += t.min;
      t.chapters.forEach((c) => {
        if (ex.chapters && !ex.chapters.includes(c)) ex.chapters.push(c);
      });
    } else {
      d.items.push({ type: 'rev', sid: t.sid, name: t.name, color: t.color, min: t.min, chapters: t.chapters.slice() });
    }
    d.used += t.min;
    d.revLeft = Math.max(0, d.revLeft - t.min);
  });
  if (revMissed > 0)
    warnings.push(
      `⚠ 복습 ${revMissed}개가 용량 부족으로 미배치됐어요 — 주당 시간↑·복습비중↑ 또는 가용시간 확보를 검토하세요.`,
    );
  if (revOver > 0)
    warnings.push(
      `⚠ 복습 ${revOver}개가 여유 없는 날에 끼워졌어요(그날 계획이 가용시간을 초과) — 일부 복습을 줄이거나 날을 비우세요.`,
    );

  /* 6.5) 백지 복습(방법론 9절) — 단원(챕터) 단위로 마지막 학습 직후 여유 날에 1개씩. */
  if (state.blankReviewWeekly === true) {
    const blankMin = Math.max(30, Math.round(ML * 0.4));
    interface BlankTask {
      afterIdx: number;
      sid: string;
      name: string;
      color?: string;
      chapters: string[];
      min: number;
    }
    const blankTasks: BlankTask[] = [];
    weekly.forEach((s) => {
      const lastDiOf: Record<string, number> = {};
      (s._sessions || []).forEach((se) => {
        (se.chapters || []).forEach((c) => {
          lastDiOf[c] = Math.max(lastDiOf[c] == null ? -1 : lastDiOf[c], se.di);
        });
      });
      Object.keys(lastDiOf).forEach((ch) => {
        blankTasks.push({
          afterIdx: lastDiOf[ch]!,
          sid: s.id,
          name: s.name,
          color: s.color,
          chapters: [ch],
          min: blankMin,
        });
      });
    });
    blankTasks.sort((a, b) => a.afterIdx - b.afterIdx);
    blankTasks.forEach((t) => {
      const end = Math.min(days.length - 1, t.afterIdx + 6);
      let tg = -1; // 학습 직후 며칠 내 여유 큰 날 — 뒤에서부터
      for (let j = end; j >= t.afterIdx; j--) {
        if (days[j]!.studyMin - days[j]!.used >= t.min) {
          tg = j;
          break;
        }
      }
      if (tg < 0) return; // 용량 없으면 건너뜀(과적재 방지)
      days[tg]!.items.push({
        type: 'blank',
        sid: t.sid,
        name: t.name,
        color: t.color,
        min: t.min,
        chapters: t.chapters.slice(),
      });
      days[tg]!.used += t.min;
    });
  }

  /* 6.6) 모의시험(방법론 12절) — N주마다 1회, 그 주말 여유 날에 1모듈. */
  const mockN = +state.mockEveryWeeks || 0;
  if (mockN > 0) {
    for (let w = 0; w * 7 <= horizon + 6; w++) {
      if ((w + 1) % mockN !== 0) continue;
      const wStart = addDays(firstMon, w * 7);
      let tg = -1;
      for (let k = 6; k >= 0; k--) {
        const di = dayDiff(start, iso(addDays(wStart, k)));
        if (di < 0 || di >= days.length) continue;
        if (days[di]!.studyMin - days[di]!.used >= ML) {
          tg = di;
          break;
        }
      }
      if (tg < 0) continue;
      const learnedBefore = days.slice(0, tg + 1).some((d) => d.items.some((it) => it.type === 'new'));
      if (!learnedBefore) continue; // 배운 게 있어야 모의시험 의미
      days[tg]!.items.push({ type: 'mock', sid: 'mock', name: '모의시험', color: '#b794f6', min: ML, chapters: [] });
      days[tg]!.used += ML;
    }
  }

  /* 7) 통계 */
  const itemStat: ItemStat[] = weekly.map((s) => {
    const total = s._allTotal;
    const doneCh = Math.min(s._done0 + s._idx, total);
    let lastIdx = -1;
    for (let j = days.length - 1; j >= 0; j--)
      if (days[j]!.items.some((it) => it.sid === s.id && it.type === 'new')) {
        lastIdx = j;
        break;
      }
    const finishDate = lastIdx >= 0 ? days[lastIdx]!.ds : null;
    const finished = !chaptersLeft(s);
    const late = finished && finishDate && s.deadline ? Math.max(0, dayDiff(s.deadline, finishDate)) : 0;
    // _hadChapters 가드 — 챕터 없는 과목은 chaptersLeft()가 늘 true라 finished가 영영 false다.
    // 그 상태에서 마감만 있으면 "다 못 끝내요" 경고가 영구히 뜨는 오탐이라 실제 챕터가 있던 과목만 경고.
    if (s.deadline && s._hadChapters && !finished)
      warnings.push(`⚠ "${s.name}": 마감(${s.deadline})까지 주 ${s.weeklyHours}h로는 챕터를 다 못 끝내요. 주당 시간↑.`);
    else if (late > 0) warnings.push(`⚠ "${s.name}": 학습 종료(${finishDate})가 마감(${s.deadline}) 초과.`);
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      weeklyHours: +(s.weeklyHours || 0),
      totalCh: total,
      doneCh,
      totalH: Math.round(s._totalH * 10) / 10,
      schedH: Math.round((s._schedMin / 60) * 10) / 10,
      deadline: s.deadline,
      finishDate,
      finished,
      late,
    };
  });
  daily.forEach((s) => {
    const planned = days.filter((d) => d.items.some((it) => it.sid === s.id)).length;
    itemStat.push({
      id: s.id,
      name: s.name,
      color: s.color,
      daily: true,
      dailyMin: +(s.dailyMin || 0),
      days: planned,
      schedH: Math.round(((planned * +(s.dailyMin || 0)) / 60) * 10) / 10,
    });
  });

  /* 주별 과목 시간 + 챕터 학습 로그 */
  const weekHours: Record<string, Record<string, number>> = {};
  const chapterLog: ScheduleResult['chapterLog'] = [];
  days.forEach((d) => {
    const wk = iso(mondayOf(d.date));
    d.items.forEach((it) => {
      if (it.type === 'anki' || it.type === 'new') {
        weekHours[wk] = weekHours[wk] || {};
        weekHours[wk][it.sid] = (weekHours[wk][it.sid] || 0) + it.min / 60;
      }
      if (it.type === 'new' && it.chapters && it.chapters.length)
        chapterLog.push({ ds: d.ds, date: d.date, name: it.name, color: it.color, chapters: it.chapters });
    });
  });

  let capTotal = 0;
  let capUsed = 0;
  days.forEach((d) => {
    capTotal += d.studyMin;
    capUsed += d.used;
  });
  return {
    days,
    itemStat,
    weekHours,
    chapterLog,
    warnings: [...new Set(warnings)],
    capUsed,
    capTotal,
    ML,
    adapt,
    adaptApplied,
    reviewViaAnki,
  };
}

/** now(자정 기준 분) 이후 남은 '공부 가능' 자유 시간(분) — layoutDay.free 창을 now로 클램프해 합산.
 *  이미 지난 창은 0, now가 창 중간이면 남은 뒷부분만. 오늘 얼마나 더 할 수 있나(홈 리드아웃)의 단일 계산. */
export function freeMinAfter(free: [number, number][], nowMin: number): number {
  return free.reduce((t, [s, e]) => t + Math.max(0, e - Math.max(s, nowMin)), 0);
}

/* 피크 시간대(방법론 1절) — [시작분,끝분] 또는 null. */
/** 세션 배열 → 'sid|type' → 첫 세션의 {start,end} 맵(첫-세션-우선). layoutDay 결과를 소비하는
 *  Today·focusState가 각자 인라인으로 짜던 축약을 하나로(중복 제거 · 규칙 변경 시 단일 수정). */
export function sessionTimeMap(
  sessions: LayoutSession[],
): Record<string, { start: number | null; end: number | null }> {
  const by: Record<string, { start: number | null; end: number | null }> = {};
  sessions.forEach((se) => {
    const k = se.sid + '|' + se.type;
    if (by[k] == null) by[k] = { start: se.start, end: se.end };
  });
  return by;
}

export function peakRange(state: AppState): [number, number] | null {
  const a = state.peakStart;
  const b = state.peakEnd;
  if (!a || !b) return null;
  const s = toMin(a);
  const e = toMin(b);
  return e > s ? [s, e] : null;
}
/** 빈 구간 배열에서 여러 [a,b]를 빼서 새 배열을 만든다(중간을 빼면 둘로 쪼갬). */
export function subtractIntervals(segs: [number, number][], intervals: [number, number][]): [number, number][] {
  let res: [number, number][] = segs.map((x) => [x[0], x[1]]);
  intervals.forEach(([a, b]) => {
    const out: [number, number][] = [];
    res.forEach(([s, e]) => {
      if (b <= s || a >= e) {
        out.push([s, e]);
        return;
      }
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
    });
    res = out.filter(([s, e]) => e > s);
  });
  return res;
}

/* 하루 타임라인: 모듈/복습/Anki에 실제 시각 배정 + 빈 시간 계산.
   피크 시간대가 있으면 고인지부하(new·mock)를 피크 구간에 먼저 배치(방법론 1절). */
export function layoutDay(state: AppState, day: Day): LayoutResult {
  const blocks = blocksForWeekday(state, day.wd);
  const { wake0, wake1, windows } = freeWindowsForWeekday(state, day.wd);
  const peak = peakRange(state);
  let segs: [number, number][] = windows.map((w) => [w.s, w.e]);
  const sessions: LayoutSession[] = [];
  const HIGH = (it: ScheduleItem) => it.type === 'new' || it.type === 'mock';
  function take(need: number, prefer: [number, number] | null): { placed: [number, number][]; need: number } {
    const placed: [number, number][] = [];
    const cand: [number, number][] = [];
    segs.forEach((seg) => {
      let [s, e] = seg;
      if (prefer) {
        s = Math.max(s, prefer[0]);
        e = Math.min(e, prefer[1]);
      }
      if (e > s) cand.push([s, e]);
    });
    cand.sort((a, b) => a[0] - b[0]);
    for (const [s, e] of cand) {
      if (need <= 0) break;
      const use = Math.min(e - s, need);
      placed.push([s, s + use]);
      need -= use;
    }
    if (placed.length) segs = subtractIntervals(segs, placed);
    return { placed, need };
  }
  function placeItem(it: ScheduleItem, prefer: [number, number] | null): void {
    let need = it.min;
    if (prefer) {
      const r = take(need, prefer);
      r.placed.forEach(([s, e]) => sessions.push({ ...it, start: s, end: e }));
      need = r.need;
    }
    if (need > 0) {
      const r = take(need, null);
      r.placed.forEach(([s, e]) => sessions.push({ ...it, start: s, end: e }));
      need = r.need;
    }
    if (need > 0) sessions.push({ ...it, start: null, end: null, over: need });
  }
  const order = peak ? [...day.items.filter(HIGH), ...day.items.filter((it) => !HIGH(it))] : day.items.slice();
  order.forEach((it) => placeItem(it, peak && HIGH(it) ? peak : null));
  const tl: TimelineEntry[] = [];
  blocks
    .filter((b) => b.type !== '수면')
    .forEach((b) => {
      const s = toMin(b.start);
      const e = toMin(b.end);
      // 자정 걸침 → 두 세그먼트(end<start인 깨진 항목 방지 — freeWindows 분할과 동일 규칙).
      const segs: [number, number][] =
        s <= e
          ? [[s, e]]
          : [
              [s, 1440],
              [0, e],
            ];
      segs.forEach(([ss, ee]) =>
        tl.push({
          kind: 'block',
          name: b.name,
          btype: b.type,
          start: ss,
          end: ee,
          color: BLOCK_TYPES[b.type],
        }),
      );
    });
  sessions.forEach((s) => {
    if (s.start != null)
      tl.push({
        kind: 'study',
        start: s.start,
        end: s.end as number,
        type: s.type,
        sid: s.sid,
        name: s.name,
        color: s.color,
        chapters: s.chapters,
        min: s.min,
      });
  });
  tl.sort((a, b) => a.start - b.start);
  const occ = tl
    .filter((x) => x.start != null)
    .map((x): [number, number] => [x.start, x.end])
    .sort((a, b) => a[0] - b[0]);
  const free: [number, number][] = [];
  let p = wake0;
  occ.forEach(([s, e]) => {
    if (s > p) free.push([p, s]);
    p = Math.max(p, e);
  });
  if (p < wake1) free.push([p, wake1]);
  const freeMin = free.reduce((t, [s, e]) => t + (e - s), 0);
  return { tl, free, freeMin, sessions };
}
