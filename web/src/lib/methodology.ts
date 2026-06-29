/* ============================================================
   methodology.ts — 학습방법론 데이터 레이어. 레거시 js/data-methodology.js 이식.
   3문장 요약·CBMS 오답·보충 백로그·백지 결과·주간 리뷰·Anki 카드·유지율·아카이빙.
   레거시는 전역 state 변형 + persist()/toast()/download를 섞었다 → 여기선
   *순수*하게: reads는 state를 받아 값 반환, 뮤테이터는 받은 state를 변형(Immer draft
   또는 평범한 객체 모두 동작). persist/다운로드/토스트는 store·features가 조립한다.
============================================================ */
import { addDays, iso, mondayOf, rid, todayISO } from './utils';
import { SCHEMA_VERSION } from './persistence';
import type { AppState, Backlog, BlankResult, CbmsCode, Ritual, Summary, Weekly } from './types';

/* ── 3문장 요약(3절) ── */
export function summariesFor(state: AppState, ds: string): Summary[] {
  state.summaries = state.summaries || {};
  return state.summaries[ds] || [];
}
export function addSummary(
  state: AppState,
  ds: string,
  sid: string,
  name: string,
  s1: string,
  s2: string,
  s3: string,
): void {
  state.summaries = state.summaries || {};
  const arr = (state.summaries[ds] = state.summaries[ds] || []);
  arr.push({ id: rid(), sid: sid || '', name: name || '', s1: s1 || '', s2: s2 || '', s3: s3 || '' });
}
export function delSummary(state: AppState, ds: string, id: string): void {
  const arr = state.summaries && state.summaries[ds];
  if (!arr) return;
  state.summaries[ds] = arr.filter((x) => x.id !== id);
  if (!state.summaries[ds].length) delete state.summaries[ds];
}
export function summaryCount(state: AppState): number {
  let n = 0;
  const m = state.summaries || {};
  for (const ds in m) n += m[ds]!.length;
  return n;
}

/* ── CBMS 오답 분류(6·12절) — code ∈ C/B/M/S/T ── */
export const CBMS_INFO: Record<CbmsCode, { label: string; tip: string; color: string }> = {
  C: { label: '개념', tip: '교재 해당 단원 다시 정독(2절 ①로 복귀)', color: '#ff8fa3' },
  B: { label: '경계', tip: '그 문제 유형의 체크리스트 만들기', color: '#ffb454' },
  M: { label: '수학', tip: '도출 단계 백지 연습(손으로 끝까지)', color: '#6ea8fe' },
  S: { label: '실수', tip: '검산 습관 + 단위 체크 자동화', color: '#7ee0c0' },
  T: { label: '시간', tip: '자주 막히는 계산 손에 익히기 + 시간 분배 훈련', color: '#b794f6' },
};
/** conf: '찍어서 맞음/확신 없었음' 플래그(6절·E5). */
export function addCbms(
  state: AppState,
  ds: string,
  sid: string,
  name: string,
  chapter: string,
  code: CbmsCode,
  note: string,
  conf?: boolean,
): void {
  state.cbms = state.cbms || [];
  state.cbms.push({
    id: rid(),
    ds: ds || iso(new Date()),
    sid: sid || '',
    name: name || '',
    chapter: chapter || '',
    code: code || 'C',
    note: note || '',
    conf: !!conf,
  });
}
export function delCbms(state: AppState, id: string): void {
  state.cbms = (state.cbms || []).filter((x) => x.id !== id);
}
/** [fromDs,toDs] 구간(포함) 코드별 카운트. 인자 없으면 전체. */
export function cbmsCounts(state: AppState, fromDs?: string, toDs?: string): Record<CbmsCode, number> {
  const out: Record<CbmsCode, number> = { C: 0, B: 0, M: 0, S: 0, T: 0 };
  (state.cbms || []).forEach((e) => {
    if (fromDs && e.ds < fromDs) return;
    if (toDs && e.ds > toDs) return;
    if (out[e.code] != null) out[e.code]++;
  });
  return out;
}
export function cbmsBetween(state: AppState, fromDs?: string, toDs?: string) {
  return (state.cbms || []).filter((e) => (!fromDs || e.ds >= fromDs) && (!toDs || e.ds <= toDs));
}

/* ── 백지 복습 결과(9절·E4) — 통과/막힘 실측. 하루·과목당 1개(중복 갱신).
   막힘+메모는 CBMS(C 개념)로 자동 연결(직전이 이미 막힘이면 중복 생성 금지). ── */
export function setBlankResult(
  state: AppState,
  ds: string,
  sid: string,
  name: string,
  passed: boolean,
  note: string,
  chapter: string,
): void {
  state.blankResults = state.blankResults || [];
  const prior = blankResultFor(state, ds, sid);
  state.blankResults = state.blankResults.filter((x) => !(x.ds === ds && x.sid === (sid || '')));
  state.blankResults.push({
    id: rid(),
    ds: ds || iso(new Date()),
    sid: sid || '',
    name: name || '',
    passed: !!passed,
    note: note || '',
  });
  if (!passed && (note || chapter) && !(prior && !prior.passed))
    addCbms(state, ds, sid, name, chapter || '', 'C', '[백지복습 막힘] ' + (note || ''), false);
}
export function blankResultFor(state: AppState, ds: string, sid: string): BlankResult | null {
  return (state.blankResults || []).find((x) => x.ds === ds && x.sid === (sid || '')) || null;
}
export function clearBlankResult(state: AppState, ds: string, sid: string): void {
  state.blankResults = (state.blankResults || []).filter((x) => !(x.ds === ds && x.sid === (sid || '')));
}
/** [fromDs,toDs] 백지 통과율. 기록 없으면 null('미측정'을 '근사'와 구분). */
export function blankPassRate(
  state: AppState,
  fromDs?: string,
  toDs?: string,
): { total: number; passed: number } | null {
  const rs = (state.blankResults || []).filter((x) => (!fromDs || x.ds >= fromDs) && (!toDs || x.ds <= toDs));
  if (!rs.length) return null;
  return { total: rs.length, passed: rs.filter((x) => x.passed).length };
}

/* ── '보충 필요' 백로그(5절) ── */
export function addBacklog(state: AppState, sid: string, name: string, topic: string, note: string): void {
  state.backlog = state.backlog || [];
  state.backlog.push({
    id: rid(),
    ds: iso(new Date()),
    sid: sid || '',
    name: name || '',
    topic: topic || '',
    note: note || '',
    done: false,
    doneDs: '',
  });
}
export function toggleBacklog(state: AppState, id: string): void {
  const b = (state.backlog || []).find((x) => x.id === id);
  if (!b) return;
  b.done = !b.done;
  b.doneDs = b.done ? iso(new Date()) : '';
}
export function delBacklog(state: AppState, id: string): void {
  state.backlog = (state.backlog || []).filter((x) => x.id !== id);
}
export function openBacklog(state: AppState): Backlog[] {
  return (state.backlog || []).filter((b) => !b.done);
}
export function backlogClosedBetween(state: AppState, fromDs?: string, toDs?: string): number {
  return (state.backlog || []).filter(
    (b) => b.done && b.doneDs && (!fromDs || b.doneDs >= fromDs) && (!toDs || b.doneDs <= toDs),
  ).length;
}

/* ── 주간 리뷰(10절) — 키: 그 주 월요일 ISO ── */
export function weeklyKey(d?: Date): string {
  return iso(mondayOf(d || new Date()));
}
export function getWeekly(state: AppState, wk: string): Weekly {
  state.weekly = state.weekly || {};
  return state.weekly[wk] || { checks: {}, note: '' };
}
export function setWeeklyCheck(state: AppState, wk: string, k: string, on: boolean): void {
  state.weekly = state.weekly || {};
  const w = (state.weekly[wk] = state.weekly[wk] || { checks: {}, note: '' });
  w.checks = w.checks || {};
  w.checks[k] = !!on;
}
export function setWeeklyNote(state: AppState, wk: string, note: string): void {
  state.weekly = state.weekly || {};
  const w = (state.weekly[wk] = state.weekly[wk] || { checks: {}, note: '' });
  w.note = note || '';
}

/* ── 일일 의식(아침 계획·저녁 셧다운) ── */
export function getRitual(state: AppState, ds: string): Ritual {
  state.rituals = state.rituals || {};
  return state.rituals[ds] || { plan: false, shutdown: false, note: '' };
}
export function setRitual(state: AppState, ds: string, key: keyof Ritual, val: boolean | string): void {
  state.rituals = state.rituals || {};
  const r: Ritual = state.rituals[ds] || { plan: false, shutdown: false, note: '' };
  (r as Record<string, boolean | string>)[key] = val;
  state.rituals[ds] = r;
}

/* ── Anki 카드 초안(7절) — 요약·반복 오답을 Anki import용 TSV(.txt) 라인으로. ── */
function _cf(s: unknown): string {
  return (s ?? '').toString().replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
}
export function buildAnkiCards(state: AppState, fromDs?: string, toDs?: string): string[] {
  const lines: string[] = [];
  const sm = state.summaries || {};
  Object.keys(sm)
    .sort()
    .forEach((ds) => {
      if (fromDs && ds < fromDs) return;
      if (toDs && ds > toDs) return;
      (sm[ds] || []).forEach((x) => {
        const front = _cf((x.name ? '[' + x.name + '] ' : '') + (x.s1 || '핵심 현상·문제는?'));
        const back = _cf(['How(도구): ' + (x.s2 || ''), 'Result(결과·의미): ' + (x.s3 || '')].join('\n'));
        const tag = '요약' + (x.name ? '::' + x.name.replace(/\s+/g, '_') : '');
        lines.push([front, back, tag].join('\t'));
      });
    });
  (state.cbms || []).forEach((e) => {
    if (fromDs && e.ds < fromDs) return;
    if (toDs && e.ds > toDs) return;
    const inf = CBMS_INFO[e.code] || { label: '', tip: '' };
    const front = _cf((e.name ? '[' + e.name + '] ' : '') + (e.chapter || '') + ' — 어디서 왜 막혔나?');
    const back = _cf((e.note || '(메모 없음)') + '\n처방(' + e.code + ' ' + inf.label + '): ' + inf.tip);
    lines.push([front, back, '오답::' + e.code].join('\t'));
  });
  return lines;
}

/** 3문장 요약을 날짜·과목별 마크다운 한 장으로(볼트 '연결'용). */
export function buildSummaryNotes(state: AppState, fromDs?: string, toDs?: string): string {
  const sm = state.summaries || {};
  const dss = Object.keys(sm)
    .sort()
    .filter((ds) => (!fromDs || ds >= fromDs) && (!toDs || ds <= toDs) && (sm[ds] || []).length);
  if (!dss.length) return '';
  const md = [
    '# 러닝허브 요약 노트',
    '',
    `> 생성 ${todayISO(state)} · ${dss.length}일치 3문장 요약 · #러닝허브/요약`,
    '',
  ];
  dss.forEach((ds) => {
    md.push('## ' + ds, '');
    (sm[ds] || []).forEach((x) => {
      md.push('### ' + ((x.name ? x.name + ' — ' : '') + (x.s1 || '(핵심 현상·문제)')));
      if (x.s2) md.push('- **도구·어떻게**: ' + x.s2);
      if (x.s3) md.push('- **결과·의미**: ' + x.s3);
      md.push('');
    });
  });
  return md.join('\n');
}

/* ── 데이터 규모/아카이빙 ── */
export function dataSizeKB(state: AppState): number {
  try {
    return Math.round(JSON.stringify(state).length / 1024);
  } catch {
    return 0;
  }
}
export function recordCount(state: AppState): number {
  let n = 0;
  const c = state.completions || {};
  const s = state.summaries || {};
  for (const k in c) n += Object.keys(c[k]!).length;
  for (const k in s) n += s[k]!.length;
  return n + (state.cbms || []).length + (state.backlog || []).length + (state.blankResults || []).length;
}
export interface ArchiveResult {
  archive: {
    schemaVersion: number;
    archivedAt: string;
    cutoff: string;
    completions: AppState['completions'];
    summaries: AppState['summaries'];
    cbms: AppState['cbms'];
    backlog: AppState['backlog'];
    blankResults: AppState['blankResults'];
  };
  count: number;
}
/** cutoff(기본 6개월) 이전 기록을 archive로 분리하고 state에서 비운다(다운로드는 호출부). */
export function archiveOldData(state: AppState, monthsKeep = 6): ArchiveResult {
  const cutoff = iso(addDays(new Date(), -Math.round(monthsKeep * 30)));
  const arch: ArchiveResult['archive'] = {
    schemaVersion: SCHEMA_VERSION,
    archivedAt: new Date().toISOString(),
    cutoff,
    completions: {},
    summaries: {},
    cbms: [],
    backlog: [],
    blankResults: [],
  };
  let n = 0;
  const c = state.completions || {};
  Object.keys(c).forEach((ds) => {
    if (ds < cutoff) {
      arch.completions[ds] = c[ds]!;
      delete c[ds];
      n += Object.keys(arch.completions[ds]!).length;
    }
  });
  const sm = state.summaries || {};
  Object.keys(sm).forEach((ds) => {
    if (ds < cutoff) {
      arch.summaries[ds] = sm[ds]!;
      delete sm[ds];
      n += arch.summaries[ds]!.length;
    }
  });
  arch.cbms = (state.cbms || []).filter((e) => e.ds && e.ds < cutoff);
  state.cbms = (state.cbms || []).filter((e) => !(e.ds && e.ds < cutoff));
  n += arch.cbms.length;
  arch.backlog = (state.backlog || []).filter((b) => b.done && b.doneDs && b.doneDs < cutoff);
  state.backlog = (state.backlog || []).filter((b) => !(b.done && b.doneDs && b.doneDs < cutoff));
  n += arch.backlog.length;
  arch.blankResults = (state.blankResults || []).filter((x) => x.ds && x.ds < cutoff);
  state.blankResults = (state.blankResults || []).filter((x) => !(x.ds && x.ds < cutoff));
  n += arch.blankResults.length;
  return { archive: arch, count: n };
}

/* ── 유지율(retention) 추세(E6·F-05) — AnkiConnect due를 주별 스냅샷 ── */
interface DeckLike {
  new?: number;
  learn?: number;
  review?: number;
  total?: number;
}
export function recordRetentionSnapshot(state: AppState, decks: DeckLike[]): void {
  if (!Array.isArray(decks)) return;
  const due = decks.reduce((t, d) => t + +(d.new || 0) + +(d.learn || 0) + +(d.review || 0), 0);
  const cards = decks.reduce((t, d) => t + +(d.total || 0), 0);
  const wk = iso(mondayOf(new Date()));
  state.retentionLog = (state.retentionLog || []).filter((x) => x.wk !== wk);
  state.retentionLog.push({ wk, at: new Date().toISOString(), due, cards });
  state.retentionLog.sort((a, b) => (a.wk < b.wk ? -1 : a.wk > b.wk ? 1 : 0));
  if (state.retentionLog.length > 26) state.retentionLog = state.retentionLog.slice(-26);
}
export function retentionTrend(state: AppState) {
  const pts = (state.retentionLog || []).slice();
  if (!pts.length) return { points: [], latest: null, prev: null, delta: 0, has: false };
  const latest = pts[pts.length - 1]!;
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  return { points: pts, latest, prev, delta: prev ? prev.due - latest.due : 0, has: true };
}

/** 인출 증거(14절) — CBMS 주간 추세. */
export function cbmsTrend(state: AppState): { thisW: number; lastW: number } {
  const mon = mondayOf(new Date());
  const thisW = cbmsBetween(state, iso(mon), iso(addDays(mon, 6))).length;
  const lastMon = addDays(mon, -7);
  const lastW = cbmsBetween(state, iso(lastMon), iso(addDays(lastMon, 6))).length;
  return { thisW, lastW };
}
