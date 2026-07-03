/* ============================================================
   insights.ts — 회고 코칭 & 반복 약점 — 순수·무의존(결정적, 서버 불필요).
   주간 리뷰(B7): 이번 주 데이터로 '무엇을 바꿀지' 실행 지향 한 줄들.
   반복 약점(C9): 흩어진 CBMS 오답을 (과목·챕터)로 묶어 '반복적으로 막히는 지점'을 자각시킨다.

   Ollama는 선택적 살(enrichment)일 뿐, 뼈대는 여기 결정적 계산이 소유한다(오프라인 완결·테스트가능).
============================================================ */
import { addDays, iso, parseISO } from './utils';
import { CBMS_INFO, blankPassRate, cbmsCounts, openBacklog, retentionNudge } from './methodology';
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
