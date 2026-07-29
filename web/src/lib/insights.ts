/* ============================================================
   insights.ts — 회고 코칭 & 반복 약점 — 순수·무의존(결정적, 서버 불필요).
   주간 리뷰(B7): 이번 주 데이터로 '무엇을 바꿀지' 실행 지향 한 줄들.
   반복 약점(C9): 흩어진 CBMS 오답을 (과목·챕터)로 묶어 '반복적으로 막히는 지점'을 자각시킨다.

   Ollama는 선택적 살(enrichment)일 뿐, 뼈대는 여기 결정적 계산이 소유한다(오프라인 완결·테스트가능).
============================================================ */
import { addDays, iso, parseISO } from './utils';
import { completionMin } from './persistence';
import {
  CBMS_INFO,
  backlogClosedBetween,
  blankPassRate,
  cbmsBetween,
  cbmsCounts,
  openBacklog,
  retentionNudge,
} from './methodology';
import type { AppState, CbmsCode } from './types';

export type InsightKind = 'cbms' | 'blank' | 'weakspot' | 'backlog' | 'retention' | 'praise';
export interface Insight {
  kind: InsightKind;
  tone: 'warn' | 'good' | 'info';
  text: string;
}

export interface WeakSpot {
  key: string; // sid|chapter
  subject: string;
  chapter: string;
  count: number;
  codes: CbmsCode[];
}

/** 반복 약점 — CBMS 오답을 (과목·챕터)로 묶어 2회 이상 막힌 지점(구간 옵션). count 큰 순. */
export function weakSpots(state: AppState, fromDs?: string, toDs?: string, cap = 5): WeakSpot[] {
  const map = new Map<string, WeakSpot>();
  for (const e of state.cbms || []) {
    if (fromDs && e.ds < fromDs) continue;
    if (toDs && e.ds > toDs) continue;
    const chapter = (e.chapter || '').trim();
    if (!chapter) continue;
    const key = e.sid + '|' + chapter;
    const w = map.get(key) || { key, subject: e.name || '?', chapter, count: 0, codes: [] as CbmsCode[] };
    w.count++;
    if (!w.codes.includes(e.code)) w.codes.push(e.code);
    map.set(key, w);
  }
  return [...map.values()]
    .filter((w) => w.count >= 2)
    .sort((a, b) => b.count - a.count || (a.subject < b.subject ? -1 : 1))
    .slice(0, cap);
}

/** sid별 '반복 약점' 총합 — 학습 항목 카드의 ⚠반복 배지용. weakSpots(2회+ 막힌 지점)를 sid로 롤업(SR-2). */
export function weakCountBySid(state: AppState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of weakSpots(state, undefined, undefined, Infinity)) {
    const sid = w.key.split('|')[0] ?? '';
    if (!sid) continue;
    out[sid] = (out[sid] || 0) + w.count;
  }
  return out;
}

/** 지배적 오답 유형 — 최다 코드가 2건 이상이고 전체의 40%↑면 반환(한쪽으로 쏠린 약점). 아니면 null. */
export function dominantCbms(counts: Record<CbmsCode, number>): { code: CbmsCode; n: number; total: number } | null {
  const entries = (Object.entries(counts) as [CbmsCode, number][]).filter(([, n]) => n > 0);
  const total = entries.reduce((t, [, n]) => t + n, 0);
  if (!total) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const topEntry = entries[0]!;
  const [code, n] = topEntry;
  if (n < 2 || n / total < 0.4) return null;
  return { code, n, total };
}

/** 통과율(0~1) 헬퍼 — 기록 없으면 null. */
function passRate(state: AppState, from: string, to: string): number | null {
  const r = blankPassRate(state, from, to);
  return r && r.total ? r.passed / r.total : null;
}

/** tone 가중치(warn 먼저, good, info) — 실행이 급한 것부터 위로. */
const TONE_W: Record<Insight['tone'], number> = { warn: 0, good: 1, info: 2 };

/** 주간 회고 코칭(결정적) — weekMonDs(그 주 월요일 ISO) 기준 실행 지향 인사이트 배열. */
export function weeklyInsights(state: AppState, weekMonDs: string): Insight[] {
  const mon = parseISO(weekMonDs);
  const ds0 = weekMonDs;
  const ds6 = iso(addDays(mon, 6));
  const prev0 = iso(addDays(mon, -7));
  const prev6 = iso(addDays(mon, -1));
  const out: Insight[] = [];

  // ① 지배적 오답 유형 — 처방(CBMS_INFO.tip)까지.
  const dom = dominantCbms(cbmsCounts(state, ds0, ds6));
  if (dom) {
    const inf = CBMS_INFO[dom.code];
    out.push({
      kind: 'cbms',
      tone: 'warn',
      text: `이번 주 오답이 '${inf.label}(${dom.code})'에 ${dom.n}/${dom.total}건 쏠렸어요 — ${inf.tip}`,
    });
  }

  // ② 반복 약점(이번 주) — 같은 챕터에서 2회+.
  const ws = weakSpots(state, ds0, ds6, 1)[0];
  if (ws) {
    out.push({
      kind: 'weakspot',
      tone: 'warn',
      text: `'${ws.subject} — ${ws.chapter}'에서 이번 주 ${ws.count}번 막혔어요. 다음 주 우선순위로 올리세요.`,
    });
  }

  // ③ 백지 통과율 — 이번 주 vs 지난주(개선이면 칭찬, 낮으면 경고).
  const cur = passRate(state, ds0, ds6);
  if (cur != null) {
    const prev = passRate(state, prev0, prev6);
    const pct = Math.round(cur * 100);
    if (prev != null && cur > prev + 0.001) {
      out.push({ kind: 'blank', tone: 'good', text: `백지 통과율 ${Math.round(prev * 100)}% → ${pct}%로 올랐어요 👍` });
    } else if (cur < 0.6) {
      out.push({
        kind: 'blank',
        tone: 'warn',
        text: `백지 통과율 ${pct}% — 이해가 얕은 신호. 막힌 단원은 교재로 되돌아가 다시 인출해 보세요.`,
      });
    }
  }

  // ④ 유지율 넛지(Anki due 증가) — methodology가 이미 능동 문구를 만든다.
  const rn = retentionNudge(state);
  if (rn) out.push({ kind: 'retention', tone: 'warn', text: rn });

  // ⑤ 열린 보충이 쌓임.
  const openN = openBacklog(state).length;
  if (openN >= 3) {
    out.push({ kind: 'backlog', tone: 'info', text: `열린 보충이 ${openN}건 — 이번 주 리뷰에서 몇 개는 회수하세요.` });
  }

  return out.sort((a, b) => TONE_W[a.tone] - TONE_W[b.tone]);
}

export interface WeeklyRecap {
  weekMon: string;
  doneSessions: number; // 그 주 완료 학습 세션 수
  focusMin: number; // 그 주 완료 학습 분 합
  summaries: number; // 그 주 작성한 3문장 요약 수
  backlogClosed: number; // 그 주 회수한 보충 수
  wins: string[]; // '해낸 것' 격려 문구(빈 배열 = 조용한 주)
}

/** 주간 리캡(I-12) — review(처방)와 톤 분리한 '이번 주 해낸 것' 성취 회수. weekMonDs(그 주 월요일) 기준.
   completions/summaries/backlog를 그 주 범위로 집계하고, 임계 넘은 성취만 격려 문구로. */
export function weeklyRecap(state: AppState, weekMonDs: string): WeeklyRecap {
  const mon = parseISO(weekMonDs);
  const ds0 = weekMonDs;
  const ds6 = iso(addDays(mon, 6));

  const comp = state.completions || {};
  let doneSessions = 0;
  let focusMin = 0;
  for (const ds of Object.keys(comp)) {
    if (ds < ds0 || ds > ds6) continue;
    for (const k of Object.keys(comp[ds] || {})) {
      const e = comp[ds]![k];
      if (e?.done) {
        doneSessions++;
        focusMin += completionMin(e);
      }
    }
  }

  const sm = state.summaries || {};
  let summaries = 0;
  for (const ds of Object.keys(sm)) if (ds >= ds0 && ds <= ds6) summaries += (sm[ds] || []).length;

  const backlogClosed = backlogClosedBetween(state, ds0, ds6);
  const errors = cbmsBetween(state, ds0, ds6).length; // 성취 문구에 '오답도 마주함' 톤으로만

  const wins: string[] = [];
  if (doneSessions > 0) wins.push(`학습 세션 ${doneSessions}개 · ${Math.round(focusMin / 60)}시간 집중`);
  if (summaries > 0) wins.push(`내 말로 정리한 요약 ${summaries}개`);
  if (backlogClosed > 0) wins.push(`밀린 보충 ${backlogClosed}개 회수`);
  if (errors > 0) wins.push(`오답 ${errors}개를 회피 않고 기록 — 약점을 마주함`);

  return { weekMon: weekMonDs, doneSessions, focusMin, summaries, backlogClosed, wins };
}

export interface DayShape {
  ds: string;
  subjects: number; // 그날 완료 세션이 있는 과목 수(distinct)
  sessions: number; // 그날 완료 학습 세션 수
  focusMin: number; // 그날 완료 학습 분 합
  learned: string; // 그날 마지막 요약의 마지막 문장(s3→s2→s1) — 없으면 ''
}

/** 오늘의 모양(ID-5) — 하루짜리 weeklyRecap 축소판. 셧다운 순간에 '오늘이 어땠나' 회고 한 줄로.
 *  weeklyRecap 이 전향 모멘텀이라면 여기는 그날의 마감 톤(I-13 셧다운 체인과 상보). learned 는
 *  요약의 '마지막 문장' — 3문장 요약에서 결론/핵심에 해당하는 자리라 '배운 것'으로 가장 적합하다. */
export function dayShape(state: AppState, ds: string): DayShape {
  const comp = state.completions?.[ds] || {};
  const sids = new Set<string>();
  let sessions = 0;
  let focusMin = 0;
  for (const k of Object.keys(comp)) {
    const e = comp[k];
    if (e?.done) {
      sessions++;
      focusMin += completionMin(e);
      const sid = k.split('|')[0];
      if (sid) sids.add(sid);
    }
  }
  const sums = state.summaries?.[ds] || [];
  const last = sums[sums.length - 1];
  const learned = last ? (last.s3 || last.s2 || last.s1 || '').trim() : '';
  return { ds, subjects: sids.size, sessions, focusMin, learned };
}

/* ── ID-11 인출 전 예측(JOL · Judgment of Learning) ───────────────────────────
   러너가 답을 펼치기 **전에** "이거 떠오를 것 같아?"를 묻고, 실제 인출 결과와 대조한다.
   I-5(confTrend)는 오답을 적은 **뒤**의 확신을 보므로 시점이 다르다 — 이쪽은 *사전* 회상 예측이라
   메타인지 교정(어디서 내 감이 틀리는가)에 직접 붙는다(Nelson&Dunlosky).

   ⚠ **영속하지 않는다.** 세션 안에서만 산다 — D1·서버 strict zod·폰 계약까지 번지는 새 필드를
     '알아두면 좋은 지표' 하나로 여는 것은 비용이 값보다 크다(로드맵이 못박은 보류 사유).
   ⚠ **비율을 만들지 않는다.** 표본이 세션당 최대 3건이라 "정확도 67%"는 정밀해 보이는 소음이다.
     같은 이유로 통계 탭이 표본 게이트를 두는데, 여기선 애초에 개수로만 말한다. */
export interface JolEntry {
  /** 펼치기 전 예측 — true='떠오를 것 같다'. */
  predicted: boolean;
  /** 실제 결과 — true='인출했다'(건너뛰기=false). */
  recalled: boolean;
  /* ── E6(2026-07-29) — 어떤 카드였나 ────────────────────────────────────
     종전엔 카운트만 남아 완주 화면이 _"될 줄 알았는데 안 된 게 2개"_ 라 말하고 **끝났다**.
     이 주석 바로 아래(`JolSummary.over`)가 그 방향을 _"가장 위험한 방향"_ 이라 적어 두고도
     다음 행동이 없었던 자리다 — 과신 카드를 오답으로 남기려면 완주 → 저널 탭 → 오답 카드 →
     과목·챕터 손입력(3화면·6클릭+)이라 실제로는 아무도 안 했고, 그래서 CBMS 가 0행이다.
     ⚠ **세션 로컬 타입이다** — 영속하지 않으므로 스키마·D1·폰 계약과 무관하다(그 판단은
     `ReviewRun` 의 JOL 주석이 이미 내렸고 여기서 뒤집지 않는다). 늘어난 것은 화면이
     그 자리에서 오답 폼을 열어 줄 수 있을 만큼의 식별자뿐이다. */
  /** 카드 라벨(사람이 읽는 것) — 없으면 화면이 항목을 그리지 않는다. */
  label?: string;
  /** 오답 프리필용 — 과목 id. 챕터 카드·착각 카드만 갖는다. */
  sid?: string;
  /** 오답 프리필용 — 챕터명. */
  chapter?: string;
}
export interface JolSummary {
  n: number;
  /** 예측이 맞은 횟수. */
  hit: number;
  /** 과신 — 될 줄 알았는데 안 됨(가장 위험한 방향: 안다고 믿어 복습을 건너뛴다). */
  over: number;
  /** 과소평가 — 애매하다 했는데 됨. */
  under: number;
}

/** JOL 기록 집계 — 비어 있으면 null(호출부가 '잴 것 없음'을 침묵으로 처리하게). */
/**
 * 과신 카드만 — **될 줄 알았는데 안 된 것**(E6). 완주 화면이 오답으로 남길 후보다.
 *
 * ⚠ 라벨이 없는 항목은 뺀다: 무엇을 남기라는 건지 화면이 말할 수 없으면 그 버튼은 소음이다.
 * ⚠ 코드(C/B/M/S/T)는 **여기서도 화면에서도 지어내지 않는다** — 앱이 아는 것은 "본인이 될 거라
 *   했고 안 됐다"는 관측 사실뿐이고, 분류는 사람이 한다(LLM 자동 CBMS 분류가 조용한 오분류로
 *   드롭된 그 경계를 구조적으로 지킨다).
 */
export function overconfidentCards(rows: JolEntry[]): JolEntry[] {
  return rows.filter((r) => r.predicted && !r.recalled && !!r.label);
}

export function jolSummary(rows: JolEntry[]): JolSummary | null {
  if (!rows.length) return null;
  let hit = 0;
  let over = 0;
  let under = 0;
  for (const r of rows) {
    if (r.predicted === r.recalled) hit++;
    else if (r.predicted) over++;
    else under++;
  }
  return { n: rows.length, hit, over, under };
}
