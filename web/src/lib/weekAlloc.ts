/* ============================================================
   weekAlloc.ts — 주간 배분(재개편 v2 §12) 순수 CRUD.
   모델: weekAlloc[weekMon][sid] = number[7](분, index=wd 0=일..6=토). '이번 주 어느 과목을 어느 요일에 얼마씩'.
   dayPlans 패턴을 주(週) 층으로 일반화 — 무배분 주는 자동(불변), 첫 편집 시 자동 파생 스냅샷을 managed로 승격.
   스케줄러 입력은 아니고(스케줄러는 state.weekAlloc를 직접 읽음 · §12-4), 여긴 보드/스토어가 쓰는 편집 헬퍼.
   ⚠ state 변형 함수(ensure/set/copy/reset)는 store.mutate(immer draft) 안에서만 호출한다.
============================================================ */
import { addDays, iso, mondayOf, parseISO } from './utils';
import type { AppState, ScheduleResult } from './types';

/** 7요일 0벡터(분) — index=wd(0=일..6=토). */
export function zeroVec(): number[] {
  return [0, 0, 0, 0, 0, 0, 0];
}

/** 그 날짜(또는 주 아무 날)가 속한 주의 월요일(ISO) = weekAlloc 키. */
export function weekMonOf(ds: string): string {
  return iso(mondayOf(parseISO(ds)));
}

/** 스케줄 산출에서 그 주의 new 블록 분을 (sid → 7요일[분])으로 집계 = 자동 분배 스냅샷.
 *  managed 승격 전 보드가 보여줄 시작점이자, ensureWeekAlloc가 심는 값. */
export function deriveAutoAlloc(res: ScheduleResult, wk: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const d of res.days) {
    if (weekMonOf(d.ds) !== wk) continue;
    for (const it of d.items) {
      if (it.type !== 'new') continue;
      const vec = (out[it.sid] ||= zeroVec());
      vec[d.wd] = (vec[d.wd] || 0) + it.min;
    }
  }
  return out;
}

/** 그 주가 managed(사용자 배분 확정)인가. */
export function isWeekManaged(state: AppState, wk: string): boolean {
  return !!state.weekAlloc?.[wk];
}

/** 그 주 표시용 배분(읽기 전용) — managed면 명시값, 아니면 자동 파생 스냅샷. */
export function allocView(state: AppState, res: ScheduleResult, wk: string): Record<string, number[]> {
  return state.weekAlloc?.[wk] ?? deriveAutoAlloc(res, wk);
}

/** managed 승격 — 없으면 자동 파생을 스냅샷해 weekAlloc[wk]에 심고 반환(dayPlans ensureManual 동형). state 변형. */
export function ensureWeekAlloc(state: AppState, res: ScheduleResult, wk: string): Record<string, number[]> {
  state.weekAlloc = state.weekAlloc || {};
  if (!state.weekAlloc[wk]) state.weekAlloc[wk] = deriveAutoAlloc(res, wk);
  return state.weekAlloc[wk];
}

/** 셀 배분 설정(분) — 승격 후 (sid,wd) 칸을 mins로(음수는 0). state 변형. */
export function setAllocCell(
  state: AppState,
  res: ScheduleResult,
  wk: string,
  sid: string,
  wd: number,
  mins: number,
): void {
  if (wd < 0 || wd > 6) return;
  const map = ensureWeekAlloc(state, res, wk);
  const vec = (map[sid] ||= zeroVec());
  vec[wd] = Math.max(0, Math.round(mins));
}

/** 이전 주 배분(명시 or 자동)을 이 주로 스냅샷 복사 — per-week지만 되풀이 편의(§12-2). state 변형. */
export function copyPrevWeekAlloc(state: AppState, res: ScheduleResult, wk: string): void {
  const prev = iso(addDays(parseISO(wk), -7)); // wk=월요일 → -7일 = 지난 주 월요일
  const src = allocView(state, res, prev);
  const copy: Record<string, number[]> = {};
  for (const sid in src) copy[sid] = (src[sid] || zeroVec()).slice(0, 7);
  state.weekAlloc = state.weekAlloc || {};
  state.weekAlloc[wk] = copy;
}

/** 그 주를 자동으로 되돌리기 — weekAlloc[wk] 삭제(auto 복귀). state 변형. */
export function resetWeekAlloc(state: AppState, wk: string): void {
  if (state.weekAlloc) delete state.weekAlloc[wk];
}

/** 과목 행 합(분) — 그 과목 주간 배분 총합. */
export function rowSumMin(vec: number[] | undefined): number {
  return (vec || []).reduce((t, m) => t + (m || 0), 0);
}

/** 요일 열 합(분) — 그 wd의 전 과목 배분 합. */
export function colSumMin(map: Record<string, number[]>, wd: number): number {
  let t = 0;
  for (const sid in map) t += map[sid]?.[wd] || 0;
  return t;
}
