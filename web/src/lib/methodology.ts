/* ============================================================
   methodology.ts — 학습방법론 데이터 레이어. 레거시 js/data-methodology.js 이식.
   3문장 요약·CBMS 오답·보충 백로그·백지 결과·주간 리뷰·Anki 카드·유지율·아카이빙.
   레거시는 전역 state 변형 + persist()/toast()/download를 섞었다 → 여기선
   *순수*하게: reads는 state를 받아 값 반환, 뮤테이터는 받은 state를 변형(Immer draft
   또는 평범한 객체 모두 동작). persist/다운로드/토스트는 store·features가 조립한다.
============================================================ */
import { keySid } from './domainKeys';
import { addDays, iso, mondayOf, parseISO, rid, todayISO } from './utils';
import { SCHEMA_VERSION, isDone } from './persistence';
import type { AppState, Backlog, BlankResult, Cbms, CbmsCode, Ritual, ScheduleResult, Summary } from './types';

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
  // 순수 읽기 — 예전엔 `state.summaries = state.summaries || {}`로 지연초기화하며 state를 제자리 변형했다.
  // 이 함수는 렌더(동결 state)에서 불려 immer autoFreeze를 못 켜게 한 SD-5 주범 → 변형 없이 읽기만 한다.
  return (state.summaries && state.summaries[ds]) || [];
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
  // 색은 의미론 토큰으로 — 예전엔 다크 전용 생 hex라 흰 패널 위에서 1.58~2.42:1로 읽히지 않았다
  // (칩이 코드 구분의 유일한 시각 단서인데). 토큰은 테마별로 갈리므로 두 테마 모두 통과한다.
  C: { label: '개념', tip: '교재 해당 단원 다시 정독(2절 ①로 복귀)', color: 'var(--bad)' },
  B: { label: '경계', tip: '그 문제 유형의 체크리스트 만들기', color: 'var(--warn)' },
  M: { label: '수학', tip: '도출 단계 백지 연습(손으로 끝까지)', color: 'var(--info)' },
  S: { label: '실수', tip: '검산 습관 + 단위 체크 자동화', color: 'var(--ok)' },
  T: { label: '시간', tip: '자주 막히는 계산 손에 익히기 + 시간 분배 훈련', color: 'var(--violet)' },
};
/** CBMS 코드 순서·집합의 단일 원천(SSOT) — CBMS_INFO에서 파생. Stats·Review·Journal이 각자
   `['C','B','M','S','T']`/`Object.keys(CBMS_INFO)`를 재선언하던 드리프트 위험을 봉쇄. */
export const CBMS_CODES = Object.keys(CBMS_INFO) as CbmsCode[];

/* ── P-3 복습 사다리를 **앞당기는** 유형(2026-08-01) ──────────────────────────
   여기까지 CBMS 코드는 **아무것도 안 바꿨다**: 5분류 + 코드별 처방까지 갖춰 놓고
   `grep cbms lib/scheduler/ lib/spacedReview.ts` 가 **0건**이었다. 즉 사용자가 매번 고르던
   5지선다가 화면 문구 말고는 어디에도 안 닿았다 — 방향 §1-b 의 세 번째 규율("넣었을 때 무엇이
   즉시 달라지는가")이 **이미 만들어 둔 슬롯에서** 위반되고 있던 자리다.

   가르는 축은 **지식 결손인가**다:
   · `C`(개념)·`B`(경계)·`M`(수학) — 몰라서 틀렸다. 다시 만나는 시점을 앞당길 근거가 된다.
   · `S`(실수)·`T`(시간)          — **알지만** 틀렸다. 부주의 오류는 개념 결손을 뜻하지 않으며
     피로·촉박에서 급증한다(IRIS/Vanderbilt · 확인 2026-08-01). 이걸 개념 오답과 같은 사다리에
     태우면 검산 한 번 놓친 챕터가 정말 모르는 챕터와 같은 급함을 갖는다 — 그게 **오탐**이다.

   ⚠ 임의 계수가 안 생긴다: *얼마나* 앞당길지는 여전히 `REVIEW_OFFSETS` 자신에서 나오고
     (`spacedReview.FAIL_DUE_DAYS`), 여기서 정하는 것은 *앞당길 것인가* 뿐이다.
   ⚠ **자동 분류는 하지 않는다** — `insights.ts` 가 _"LLM 자동 CBMS 분류가 조용한 오분류로
     드롭됐다"_ 고 못박았다. 이 표는 **사람이 고른 코드**의 뜻을 적을 뿐이다. */
export const CBMS_ADVANCES_REVIEW: ReadonlySet<CbmsCode> = new Set<CbmsCode>(['C', 'B', 'M']);

/** 코드별 카운트에서 최다 코드 + 전체합 — 임계 없는 argmax(문턱이 있는 dominantCbms와 별개).
   Stats(sort)·Review(reduce)가 각자 인라인하던 두 관용구를 하나로. 오답 0이면 null. */
export function cbmsTop(counts: Record<CbmsCode, number>): { code: CbmsCode; n: number; total: number } | null {
  let total = 0;
  let top: CbmsCode = CBMS_CODES[0]!;
  for (const c of CBMS_CODES) {
    const n = counts[c] || 0;
    total += n;
    if (n > (counts[top] || 0)) top = c;
  }
  return total ? { code: top, n: counts[top] || 0, total } : null;
}
/** conf: '찍어서 맞음/확신 없었음' 플래그(6절·E5).
 *  @returns 만들어진 기록의 id — 커밋 **뒤에** 메모만 덧붙이는 호출부(P-2 러너 인라인)가 쓴다.
 *    ⚠ 반환값을 안 쓰는 호출부가 대부분이다(그래서 추가여도 안전하다). */
export function addCbms(
  state: AppState,
  ds: string,
  sid: string,
  name: string,
  chapter: string,
  code: CbmsCode,
  note: string,
  conf?: boolean,
): string {
  state.cbms = state.cbms || [];
  const id = rid();
  state.cbms.push({
    id,
    ds: ds || todayISO(state), // '오늘' 단일 출처(_today 시드 존중) — 벽시계 직접 참조 금지
    sid: sid || '',
    name: name || '',
    chapter: chapter || '',
    code: code || 'C',
    note: note || '',
    conf: !!conf,
    at: Date.now(),
  });
  return id;
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
/** 과신 오답률(E5) — [fromDs,toDs] 구간에서 conf('찍어서 맞음/확신 없었음') 플래그 비율.
   지식엔진 캘리브레이션 산출물과 달리 앱 상태(cbms[].conf)만으로 실시간. 오답 없으면 null. */
export function confRate(
  state: AppState,
  fromDs?: string,
  toDs?: string,
): { conf: number; total: number; rate: number } | null {
  const rows = cbmsBetween(state, fromDs, toDs);
  if (!rows.length) return null;
  const conf = rows.filter((e) => e.conf).length;
  return { conf, total: rows.length, rate: Math.round((conf / rows.length) * 100) };
}
/* ── 삭제 되돌리기 복원 — feature가 state 내부구조(배열 형태·원위치 idx)를 알지 않게 삭제와 대칭.
   스냅샷 rec만 넘기면 lib이 복원 위치를 소유(단방향 레이어 경계). ── */
export function restoreSummary(state: AppState, ds: string, idx: number, rec: Summary): void {
  state.summaries = state.summaries || {};
  const arr = (state.summaries[ds] = state.summaries[ds] || []);
  arr.splice(Math.min(idx < 0 ? arr.length : idx, arr.length), 0, { ...rec });
}
export function restoreCbms(state: AppState, rec: Cbms): void {
  state.cbms = state.cbms || [];
  state.cbms.push({ ...rec });
}
export function restoreBacklog(state: AppState, rec: Backlog): void {
  state.backlog = state.backlog || [];
  state.backlog.push({ ...rec });
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
    ds: ds || todayISO(state), // '오늘' 단일 출처(_today 시드 존중) — 벽시계 직접 참조 금지
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

/* ── '보충 필요' 백로그(5절) ──
   ⚠ **id 를 돌려준다**(E2) — 캡처가 곧 커밋이 되면서 "방금 담은 그것"만 되돌릴 수 있어야 했다.
   목록 끝을 지우는 식으로 되돌리면 그 사이에 다른 쓰기가 끼었을 때 엉뚱한 항목이 사라진다. */
export function addBacklog(state: AppState, sid: string, name: string, topic: string, note: string): string {
  state.backlog = state.backlog || [];
  const id = rid();
  state.backlog.push({
    id,
    ds: todayISO(state), // '오늘' 단일 출처(_today 시드 존중) — 벽시계 직접 참조 금지
    sid: sid || '',
    name: name || '',
    topic: topic || '',
    note: note || '',
    done: false,
    doneDs: '',
    at: Date.now(),
  });
  return id;
}
/** 보충 백로그 한 건 제거(되돌리기 전용) — 없으면 무동작. */
export function removeBacklog(state: AppState, id: string): void {
  state.backlog = (state.backlog || []).filter((x) => x.id !== id);
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
  b.doneDs = b.done ? todayISO(state) : ''; // '오늘' 단일 출처(_today 시드 존중) — 벽시계 직접 참조 금지
}
export function delBacklog(state: AppState, id: string): void {
  state.backlog = (state.backlog || []).filter((x) => x.id !== id);
}
/* ⚠ 입력을 `Pick<AppState,'backlog'>` 로 좁혔다(H17) — 이 함수가 읽는 것이 그 한 슬라이스뿐이고,
   타입이 그 사실을 말하면 호출부가 **전체 상태를 구독하지 않고** 그 조각만 구독할 수 있다.
   전체 상태를 요구하면 셀렉터가 루트를 물게 되고, 그게 무관 쓰기마다 리렌더를 만든다. */
export function openBacklog(state: Pick<AppState, 'backlog'>): Backlog[] {
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
/** 기록 수 범주별 분해(완료·요약·오답·백로그·백지) — recordCount의 중간값을 버리지 않고 반환.
   Settings가 "무엇이 저장을 지배하나"를 진단(막연한 총합 → 구성비). */
export function recordBreakdown(state: AppState): {
  done: number;
  summaries: number;
  cbms: number;
  backlog: number;
  blank: number;
} {
  let done = 0;
  const c = state.completions || {};
  for (const k in c) done += Object.keys(c[k]!).length;
  let summaries = 0;
  const s = state.summaries || {};
  for (const k in s) summaries += s[k]!.length;
  return {
    done,
    summaries,
    cbms: (state.cbms || []).length,
    backlog: (state.backlog || []).length,
    blank: (state.blankResults || []).length,
  };
}
export function recordCount(state: AppState): number {
  const b = recordBreakdown(state);
  return b.done + b.summaries + b.cbms + b.backlog + b.blank;
}
/** 아카이브 가능량(mutation 없는 사전 카운트) — archiveOldData와 동일 cutoff·필터를 count-only로.
   블라인드 위험버튼(정리)을 "6개월 이전 N건 보관 가능"으로 승격(N=0이면 정리할 것 없음). */
export function archivableCount(state: AppState, monthsKeep = 6): number {
  const cutoff = iso(addDays(parseISO(todayISO(state)), -Math.round(monthsKeep * 30)));
  let n = 0;
  const c = state.completions || {};
  for (const ds in c) if (ds < cutoff) n += Object.keys(c[ds]!).length;
  const sm = state.summaries || {};
  for (const ds in sm) if (ds < cutoff) n += sm[ds]!.length;
  n += (state.cbms || []).filter((e) => e.ds && e.ds < cutoff).length;
  n += (state.backlog || []).filter((b) => b.done && b.doneDs && b.doneDs < cutoff).length;
  n += (state.blankResults || []).filter((x) => x.ds && x.ds < cutoff).length;
  return n;
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
/**
 * `cutoffOverride` 는 **같은 경계를 두 번 계산하지 않기 위한** 인자다(H2 · 2026-07-30).
 *
 * `shell/actions.ts` 의 `archiveOld` 는 이제 ① 사본에서 보관 payload 를 만들고 ② 저장이
 * **성공한 뒤에** 실제 상태를 비운다(H19 와 같은 규율 — 복구 경로가 복구 대상을 파괴하면 안 된다).
 * 그 둘 사이에는 사용자가 저장 대화를 붙들고 있는 **임의의 시간**이 있고, 그동안 자정을 넘기면
 * 두 번째 호출의 cutoff 가 하루 밀려 **보관한 것과 지운 것이 어긋난다**(archive 엔 없는 날이
 * 지워지거나 그 반대). 첫 호출이 정한 경계를 그대로 물려줘 그 창을 없앤다.
 */
export function archiveOldData(state: AppState, monthsKeep = 6, cutoffOverride?: string): ArchiveResult {
  // '오늘' 단일 출처(_today 시드 존중). 넘겨받았으면 그 값이 진리다(위 주석).
  const cutoff = cutoffOverride ?? iso(addDays(parseISO(todayISO(state)), -Math.round(monthsKeep * 30)));
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
  const wk = iso(mondayOf(parseISO(todayISO(state)))); // 그 주 월요일 — '오늘' 단일 출처(_today 시드 존중)
  /* ⚠⚠ **값이 안 바뀌었으면 아무것도 안 한다(H17 · 2026-07-31 `/감사 근본`).**

     `at` 이 매 호출마다 새 ISO 시각이라 `due`·`cards` 가 **완전히 같아도 행이 실제로 변했다.**
     `retentionLog` 는 `records` 테이블이고 `sync: true` 라, 통합 탭의 자동 새로고침(5분)이
     `applyLive` → 여기 → `syncedSliceChanged` → `syncSoon()` 로 이어져 **5분마다 Workers 요청
     한 쌍 + D1 행 쓰기 1건**을 냈다(하루 288회). W24 가 은퇴시킨 5분 폴링이 다른 문으로
     돌아온 셈이다 — 그리고 `syncController` 는 바로 그 예산을 명시 제약으로 든다.

     `artifactMirror.ts:99`(_"무변경 — 스탬프를 찍지 않는다"_)가 이미 쓰는 관용구다.
     ⚠ `at` 은 **비교에서 뺀다** — 그게 항상 달라지는 축이라 넣으면 가드가 정의상 무력해진다. */
  const prev = (state.retentionLog || []).find((x) => x.wk === wk);
  if (prev && prev.due === due && prev.cards === cards) return;
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
      const sid = keySid(key);
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

/** 과신(conf) 오답률 주별 시계열(I-5) — 최근 weeks주(오래된→최신). confRate는 단일 구간 스냅샷,
   이건 주 단위로 쪼갠 스파크라인용 시리즈. 표본게이트: 그 주 오답 0이면 rate=null(0%로 오도 금지).
   cbmsTrend와 같은 mondayOf(_today) 정렬. */
export function confTrend(
  state: AppState,
  weeks = 6,
): { weekMon: string; conf: number; total: number; rate: number | null }[] {
  const mon0 = mondayOf(parseISO(todayISO(state)));
  const out: { weekMon: string; conf: number; total: number; rate: number | null }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const mon = addDays(mon0, -7 * i);
    const rows = cbmsBetween(state, iso(mon), iso(addDays(mon, 6)));
    const total = rows.length;
    const conf = rows.filter((e) => e.conf).length;
    out.push({ weekMon: iso(mon), conf, total, rate: total ? Math.round((conf / total) * 100) : null });
  }
  return out;
}
