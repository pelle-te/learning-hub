/* ============================================================
   retrieval.ts — 회상(테스팅 효과) 카드 선택 — 순수·무의존(프레임워크 무관).
   내가 과거에 쓴 3문장 요약(state.summaries)을 '스스로 다시 설명해보는' 인출 연습 재료로 재활용한다.
   서버·Ollama 불필요: 내 노트가 곧 플래시카드다. 앱의 '오늘'(todayISO)을 주입받아 결정적으로 회전한다.

   설계 원칙:
   ① 결정적: 같은 날엔 같은 카드(날짜 해시로 인덱스) → 하루 단위로만 회전, 테스트가 벽시계에 안 흔들림.
   ② 인출다움: 같은 날 쓴 요약은 회상이 아니므로 minAgeDays(기본 2일) 이상만. 없으면 1일↑로 완화.
============================================================ */
import { dayDiff } from './utils';
import type { AppState, Cbms, Summary } from './types';

export interface RetrievalCard {
  ds: string; // 요약을 쓴 날(YYYY-MM-DD)
  ageDays: number; // 오늘로부터 경과일
  summary: Summary; // {id,sid,name,s1,s2,s3}
}

/** 안정 해시(문자열→비음수 정수) — 같은 날 같은 카드, 날이 바뀌면 회전. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 후보 수집 — minAge일 이상 지난 내 요약을 (ds, summary)로 평탄화. 결정적 정렬(ds→id). */
function candidates(state: AppState, todayDs: string, minAge: number): { ds: string; summary: Summary }[] {
  const sm = state.summaries || {};
  const out: { ds: string; summary: Summary }[] = [];
  for (const ds of Object.keys(sm)) {
    const age = dayDiff(ds, todayDs);
    // 손상된 날짜 키(형식 위반→NaN)는 건너뛴다. NaN<minAge는 false라 가드 없이는
    // 모든 요약이 필터를 통과하고 ageDays=NaN 카드가 무음으로 새어나간다(견고성 방어).
    if (!Number.isFinite(age) || age < minAge) continue;
    for (const summary of sm[ds] || []) out.push({ ds, summary });
  }
  out.sort((a, b) => (a.ds < b.ds ? -1 : a.ds > b.ds ? 1 : a.summary.id < b.summary.id ? -1 : 1));
  return out;
}

/** 회상 연습 카드 1장 — minAgeDays일 이상 지난 내 요약 중 하나(날짜 해시로 하루 단위 회전).
 *  요약이 아예 없으면 null. 전부 너무 최신이면 1일↑로 완화(첫 며칠 공백 방지). */
export function pickRetrieval(state: AppState, todayDs: string, minAgeDays = 2): RetrievalCard | null {
  let cands = candidates(state, todayDs, minAgeDays);
  if (!cands.length && minAgeDays > 1) cands = candidates(state, todayDs, 1);
  if (!cands.length) return null;
  const pick = cands[hashStr(todayDs) % cands.length]!;
  return { ds: pick.ds, ageDays: dayDiff(pick.ds, todayDs), summary: pick.summary };
}

/** 인출 가능한(회상 후보) 요약 총수 — 위젯 노출 여부 판단·리드아웃용. */
export function retrievableCount(state: AppState, todayDs: string, minAgeDays = 1): number {
  return candidates(state, todayDs, minAgeDays).length;
}

export interface ConfidentWrongCard {
  cbms: Cbms; // conf 플래그가 선 오답 1건
  ageDays: number; // 그 오답을 기록한 날로부터 경과일
}

/** '착각 재확인' 카드(I-10) — conf('찍었는데/확신 없이'=착각의 신호)가 선 과거 오답 1건을 골라
   오늘 다시 인출하게 한다. pickRetrieval과 같은 결정적 하루 회전(날짜 해시). minAge일↑만(당일 제외).
   후보 없으면 null. */
export function pickConfidentWrong(state: AppState, todayDs: string, minAgeDays = 1): ConfidentWrongCard | null {
  const rows = (state.cbms || [])
    .filter((e) => {
      if (!e.conf) return false;
      const age = dayDiff(e.ds, todayDs);
      return Number.isFinite(age) && age >= minAgeDays;
    })
    .sort((a, b) => (a.ds < b.ds ? -1 : a.ds > b.ds ? 1 : a.id < b.id ? -1 : 1));
  if (!rows.length) return null;
  const pick = rows[hashStr(todayDs) % rows.length]!;
  return { cbms: pick, ageDays: dayDiff(pick.ds, todayDs) };
}

/** 착각 재확인 후보 총수 — 위젯 노출 판단용. */
export function confidentWrongCount(state: AppState, todayDs: string, minAgeDays = 1): number {
  return (state.cbms || []).filter((e) => {
    if (!e.conf) return false;
    const age = dayDiff(e.ds, todayDs);
    return Number.isFinite(age) && age >= minAgeDays;
  }).length;
}
