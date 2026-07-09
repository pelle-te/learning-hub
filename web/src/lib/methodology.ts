/* ============================================================
   methodology.ts — 학습방법론 데이터 레이어. 레거시 js/data-methodology.js 이식.
   3문장 요약·CBMS 오답·보충 백로그·백지 결과·주간 리뷰·Anki 카드·유지율·아카이빙.
   레거시는 전역 state 변형 + persist()/toast()/download를 섞었다 → 여기선
   *순수*하게: reads는 state를 받아 값 반환, 뮤테이터는 받은 state를 변형(Immer draft
   또는 평범한 객체 모두 동작). persist/다운로드/토스트는 store·features가 조립한다.
============================================================ */
import { addDays, iso, mondayOf, parseISO, rid, todayISO } from './utils';
import { SCHEMA_VERSION, isDone } from './persistence';
import type { AppState, Backlog, BlankResult, CbmsCode, Ritual, ScheduleResult, Summary } from './types';

/* ── 인출 증거·추세 파생(통계 리드아웃·인출카드 공용 · 중복 제거 SSOT) ── */

export interface RecallEvidence {
  blankPlan: number; // 계획된 백지복습 수
  blankDone: number; // 완료된 백지복습 수
  mockDone: number; // 완료된 모의 수
  blankRate: number; // 백지복습 완료율(%)
  recallActs: number; // 능동 인출 활동 총수 = 요약 + 백지완료 + 모의완료
}

/** 능동 인출 증거 — 요약·백지·모의 완료를 집계(북극성 출력 지표). Stats 리드아웃·인출카드가 공유. */
export function recallEvidence(state: AppState, r: ScheduleResult): RecallEvidence {
  let blankPlan = 0;
  let blankDone = 0;
  let mockDone = 0;
  (r.days || []).forEach((d) =>
    d.items.forEach((it) => {
      if (it.type === 'blank') {
        blankPlan++;
        if (isDone(state, d.ds, it.sid, it.type)) blankDone++;
      }
      if (it.type === 'mock' && isDone(state, d.ds, it.sid, it.type)) mockDone++;
    }),
  );
  const blankRate = blankPlan ? Math.round((blankDone / blankPlan) * 100) : 0;
  const recallActs = summaryCount(state) + blankDone + mockDone;
  return { blankPlan, blankDone, mockDone, blankRate, recallActs };
}

export interface TrendGlyph {
  delta: number; // lastW - thisW (양수 = 감소 = 개선)
  icon: string; // '▼ 감소' | '▲ 증가' | '＝ 유지'
  good: boolean; // 개선 방향(감소) 또는 둘 다 0
}

/** CBMS 오답 주간 추세를 아이콘/판정으로 — 인출카드·리드아웃의 중복 파생을 하나로. */
export function cbmsTrendGlyph(tr: { thisW: number; lastW: number }): TrendGlyph {
  const delta = tr.lastW - tr.thisW;
  const bothZero = tr.lastW === 0 && tr.thisW === 0;
  const good = delta > 0 || bothZero;
  const icon = bothZero ? '＝ 유지' : delta > 0 ? '▼ 감소' : delta < 0 ? '▲ 증가' : '＝ 유지';
  return { delta, icon, good };
}

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
  arr.push({ id: rid(), sid: sid || '', name: name || '', s1: s1 || '', s2: s2 || '', s3: s3 || '', at: Date.now() });
}
/** 요약 인라인 편집 — 세 문장·과목만 갈아끼운다(id·작성시각 보존). 오타 수정을 위해 삭제-재작성이 필요 없게. */
export function editSummary(
  state: AppState,
  ds: string,
  id: string,
  patch: { sid?: string; name?: string; s1?: string; s2?: string; s3?: string },
): void {
  const arr = state.summaries && state.summaries[ds];
  const rec = arr && arr.find((x) => x.id === id);
  if (!rec) return;
  if (patch.sid !== undefined) rec.sid = patch.sid;
  if (patch.name !== undefined) rec.name = patch.name;
  if (patch.s1 !== undefined) rec.s1 = patch.s1;
  if (patch.s2 !== undefined) rec.s2 = patch.s2;
  if (patch.s3 !== undefined) rec.s3 = patch.s3;
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
    at: Date.now(),
  });
}
/** CBMS 오답 인라인 편집 — 챕터·유형·메모·확신플래그를 갈아끼운다(id·날짜·작성시각 보존). */
export function editCbms(
  state: AppState,
  id: string,
  patch: { chapter?: string; code?: CbmsCode; note?: string; conf?: boolean },
): void {
  const rec = (state.cbms || []).find((x) => x.id === id);
  if (!rec) return;
  if (patch.chapter !== undefined) rec.chapter = patch.chapter;
  if (patch.code !== undefined) rec.code = patch.code;
  if (patch.note !== undefined) rec.note = patch.note;
  if (patch.conf !== undefined) rec.conf = patch.conf;
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
    ds: todayISO(state), // '오늘' 단일 출처(_today 시드 존중) — 벽시계 직접 참조 금지
    sid: sid || '',
    name: name || '',
    topic: topic || '',
    note: note || '',
    done: false,
    doneDs: '',
    at: Date.now(),
  });
}
/** 보충 백로그 인라인 편집 — 주제·메모를 갈아끼운다(id·날짜·완료상태 보존). */
export function editBacklog(state: AppState, id: string, patch: { topic?: string; note?: string }): void {
  const rec = (state.backlog || []).find((x) => x.id === id);
  if (!rec) return;
  if (patch.topic !== undefined) rec.topic = patch.topic;
  if (patch.note !== undefined) rec.note = patch.note;
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

/** 유지율 넛지(F-05 능동화) — due가 지난주보다 늘고 절대량도 유의미하면 경고 문구, 아니면 null.
 *  임계(20장)는 '하루면 지울 수 있는 양'은 조용히 넘어가려는 보수적 기준. */
export function retentionNudge(state: AppState): string | null {
  const t = retentionTrend(state);
  if (!t.has || !t.prev || !t.latest) return null;
  const delta = t.latest.due - t.prev.due;
  if (delta <= 0 || t.latest.due < 20) return null;
  return `복습이 밀리는 중 — Anki 대기 ${t.latest.due}장(지난주보다 +${delta}). 오늘 Anki 블록을 먼저 처리해 보세요.`;
}

/* ── 활동 피드(기록 탭) — 최근 N일의 학습 발자취를 시간역순 단일 리스트로 ── */
export interface ActivityEntry {
  ds: string;
  kind: 'done' | 'summary' | 'cbms' | 'backlog' | 'blank';
  label: string;
  detail: string;
}
/** 완료·요약·오답·보충회수·백지결과를 [fromDs, toDs] 구간에서 모아 날짜 내림차순으로. */
export function activityFeed(state: AppState, fromDs: string, toDs: string, cap = 60): ActivityEntry[] {
  const inRange = (ds?: string) => !!ds && ds >= fromDs && ds <= toDs;
  const nameOf = (sid: string) => (state.items || []).find((it) => it.id === sid)?.name || '';
  const out: ActivityEntry[] = [];
  const c = state.completions || {};
  for (const ds in c) {
    if (!inRange(ds)) continue;
    for (const key in c[ds]) {
      const e = c[ds]![key]!;
      if (!e || e.done !== true) continue;
      const [sid] = key.split('|');
      out.push({ ds, kind: 'done', label: '블록 완료', detail: nameOf(sid || '') || key });
    }
  }
  for (const ds in state.summaries || {}) {
    if (!inRange(ds)) continue;
    (state.summaries![ds] || []).forEach((x) =>
      out.push({ ds, kind: 'summary', label: '3문장 요약', detail: (x.name ? x.name + ' — ' : '') + (x.s1 || '') }),
    );
  }
  (state.cbms || []).forEach((e) => {
    if (!inRange(e.ds)) return;
    out.push({
      ds: e.ds,
      kind: 'cbms',
      label: `오답(${e.code})`,
      detail: (e.name ? e.name + ' — ' : '') + (e.chapter || e.note || ''),
    });
  });
  (state.backlog || []).forEach((b) => {
    if (!b.done || !inRange(b.doneDs)) return;
    out.push({ ds: b.doneDs, kind: 'backlog', label: '보충 완료', detail: (b.name ? b.name + ' — ' : '') + b.topic });
  });
  (state.blankResults || []).forEach((x) => {
    if (!inRange(x.ds)) return;
    out.push({ ds: x.ds, kind: 'blank', label: x.passed ? '백지 복습 통과' : '백지 복습 막힘', detail: x.name || '' });
  });
  return out.sort((a, b) => (a.ds < b.ds ? 1 : a.ds > b.ds ? -1 : 0)).slice(0, cap);
}

/** 인출 증거(14절) — CBMS 주간 추세. */
export function cbmsTrend(state: AppState): { thisW: number; lastW: number } {
  const mon = mondayOf(parseISO(todayISO(state))); // 앱의 '오늘' 단일 출처(_today 시드 존중)

  const thisW = cbmsBetween(state, iso(mon), iso(addDays(mon, 6))).length;
  const lastMon = addDays(mon, -7);
  const lastW = cbmsBetween(state, iso(lastMon), iso(addDays(lastMon, 6))).length;
  return { thisW, lastW };
}
