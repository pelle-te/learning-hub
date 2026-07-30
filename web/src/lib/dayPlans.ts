/* ============================================================
   dayPlans.ts — 일일 배치 오버라이드(계획개편 §4·§6)의 순수 CRUD·선택자.
   자동엔진(schedule)은 제안자, dayPlans[ds]가 그날 배치의 진리(mode:'manual'). 첫 편집 시
   자동초안을 스냅샷해 승격(§6-3 자동초안을 잃지 않게) → 그 위에서 시간박기/추가/핀/삭제.
   applyDayPlans(scheduler)가 manual인 날 day.items를 이 블록으로 치환하고, layoutDay가 start를 존중.
   변형 헬퍼는 스토어 mutate 안에서 호출(→ persist), 컴포넌트는 blocksForDay 등 선택자로 파생만 읽는다.
============================================================ */
import { completionKey } from './domainKeys';
import { rid, clamp, reviewBlockMin } from './utils';
import type { AppState, DayPlan, PlacedBlock, ScheduleResult } from './types';

/** 시간박기 스냅 격자(분) — 드래그·리사이즈·시각 입력 공통. */
export const SNAP = 15;
/** 15분 격자로 스냅. */
export function snap(min: number): number {
  return Math.round(min / SNAP) * SNAP;
}

/** 드롭 충돌 해소(§6-2 "겹치면 밀거나 거부") — 요청 시각에서 occupied 구간과 겹치면 그 구간 끝으로 밀고,
 *  그래도 dayMax를 넘겨 못 들어가면 null(거부). occupied=[start,end][](고정 일과·타임박스 카드, 드래그 대상 제외).
 *  순수 함수라 단위 테스트 가능 — 컴포넌트는 occupied를 빚어 넘기고 결과 시각으로 placeBlock/placeTask. */
export function resolveSlot(
  occupied: [number, number][],
  requested: number,
  dur: number,
  dayMax = 1440,
): number | null {
  let s = clamp(snap(requested), 0, Math.max(0, dayMax - dur));
  const sorted = [...occupied].filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let moved = true;
  let guard = 0;
  while (moved && guard++ < 500) {
    moved = false;
    for (const [os, oe] of sorted) {
      if (s < oe && s + dur > os) {
        // 겹침 → 그 구간 끝으로 밀기
        s = snap(oe);
        moved = true;
      }
    }
  }
  return s + dur <= dayMax ? s : null; // 끝까지 밀어도 안 들어가면 거부
}

/* ── 자동초안 스냅샷 ──────────────────────────────────────────────────────
   그날 자동 산출(res.days[ds].items)을 PlacedBlock[]로 굳힌다. start 미부여(미지정=트레이) —
   승격 직후엔 layoutDay가 auto-pack하므로 화면 무변, 사용자가 시간박기하면 그 블록만 고정된다.
   id는 (ds·sid·type·i) 결정론 — blocksForDay 프리뷰(미승격)와 승격 후 id가 일치해 드래그 연속성 보존. */
export function snapshotAutoDraft(res: ScheduleResult, ds: string): PlacedBlock[] {
  const day = (res.days || []).find((d) => d.ds === ds);
  if (!day) return [];
  return day.items.map((it, i) => ({
    id: `${ds}:${it.sid}:${it.type}:${i}`,
    type: it.type,
    sid: it.sid,
    name: it.name,
    color: it.color,
    min: it.min,
    chapters: it.chapters ? it.chapters.slice() : undefined,
  }));
}

/* ── 선택자(순수 파생 · 읽기 전용) ────────────────────────────────────── */

/** 그날이 수동(사용자 소유)인가. */
export function isManual(state: AppState, ds: string): boolean {
  return state.dayPlans?.[ds]?.mode === 'manual';
}
/** 그날 편집 대상 블록 — 수동이면 저장된 블록, 아니면 자동초안 스냅샷(읽기 프리뷰). */
export function blocksForDay(state: AppState, res: ScheduleResult, ds: string): PlacedBlock[] {
  const dp = state.dayPlans?.[ds];
  return dp && dp.mode === 'manual' ? dp.blocks : snapshotAutoDraft(res, ds);
}
/** 미지정(트레이) 블록 — 시각 없음. 드래그로 시각 부여 대상. */
export function untimedBlocks(blocks: PlacedBlock[]): PlacedBlock[] {
  return blocks.filter((b) => b.start == null);
}
/** 타임박스된 블록 — 시각 있음. 캘린더에 카드로 렌더(시각순). */
export function timedBlocks(blocks: PlacedBlock[]): PlacedBlock[] {
  return blocks.filter((b) => b.start != null).sort((a, b) => a.start! - b.start!);
}

/* ── 변형(스토어 mutate 안에서 호출 · 이후 persist) ───────────────────── */

/** 수동 승격(§6-3) — 첫 편집 시 자동초안 스냅샷으로 dayPlans[ds] 생성. 이미 수동이면 그대로 반환.
 *  res는 스냅샷 원본(호출부가 현재 useSchedule 결과 주입). 승격 자체는 화면을 바꾸지 않는다. */
export function ensureManual(state: AppState, res: ScheduleResult, ds: string): DayPlan {
  const plans = (state.dayPlans = state.dayPlans || {});
  let dp = plans[ds];
  if (!dp || dp.mode !== 'manual') {
    dp = plans[ds] = { mode: 'manual', blocks: snapshotAutoDraft(res, ds) };
    // 승격 시점에 sid|type 완료가 있으면 그 블록의 done을 시딩(승격 직후 체크가 풀려 보이지 않게).
    // 승격 시엔 sid|type당 블록이 1개(자동 스냅샷)라 매핑이 모호하지 않다.
    const day = state.completions?.[ds];
    if (day) for (const b of dp.blocks) if (day[b.sid + '|' + b.type]?.done) b.done = true;
  }
  return dp;
}

/** sid|type 집계 완료(completions) 재계산 — 그날 같은 sid|type 블록들의 done을 OR/합으로 미러링.
 *  하류(스케줄러 복습씨앗·통계·.ics)는 이 집계만 읽으므로 블록별 done을 두고도 무변경으로 굴러간다. */
function syncBlockCompletion(state: AppState, ds: string, sid: string, type: string, todayIso: string): void {
  const dp = state.dayPlans?.[ds];
  if (!dp || dp.mode !== 'manual') return;
  const done = dp.blocks.filter((b) => b.sid === sid && b.type === type && b.done);
  const comps = (state.completions = state.completions || {});
  const day = (comps[ds] = comps[ds] || {});
  const key = completionKey(sid, type);
  if (done.length) {
    const min = done.reduce((t, b) => t + b.min, 0);
    day[key] = { done: true, min: Math.round(min), doneDs: todayIso };
  } else {
    delete day[key];
    if (!Object.keys(day).length) delete comps[ds];
  }
}

/** 블록별 완료 토글(수동 날) — 그 블록의 done을 세팅하고 sid|type 집계를 재계산.
 *  같은 과목·유형 여러 블록을 독립으로 체크할 수 있다(병합 제거의 짝 · §6-3 충돌 해소). */
export function setBlockDone(state: AppState, ds: string, id: string, on: boolean, todayIso: string): void {
  const dp = state.dayPlans?.[ds];
  if (!dp || dp.mode !== 'manual') return;
  const b = findBlock(dp, id);
  if (!b) return;
  if (on) b.done = true;
  else delete b.done;
  syncBlockCompletion(state, ds, b.sid, b.type, todayIso);
}

function findBlock(dp: DayPlan, id: string): PlacedBlock | undefined {
  return dp.blocks.find((b) => b.id === id);
}

/** 시간박기 — 블록에 start 부여(스냅 15분, 0..1440 클램프). 필요 시 수동 승격. */
export function placeBlock(state: AppState, res: ScheduleResult, ds: string, id: string, start: number): void {
  const dp = ensureManual(state, res, ds);
  const b = findBlock(dp, id);
  if (b) b.start = clamp(snap(start), 0, 1440 - SNAP);
}
/** 미지정 복귀 — start 제거(캘린더→트레이). */
export function unplaceBlock(state: AppState, res: ScheduleResult, ds: string, id: string): void {
  const dp = ensureManual(state, res, ds);
  const b = findBlock(dp, id);
  if (b) delete b.start;
}
/** 길이 변경(분, 15 스냅, 최소 15). */
export function resizeBlock(state: AppState, res: ScheduleResult, ds: string, id: string, min: number): void {
  const dp = ensureManual(state, res, ds);
  const b = findBlock(dp, id);
  if (b) b.min = Math.max(SNAP, snap(min));
}
/** 핀 토글(§6-2) — 핀 블록은 '다시 자동으로' 재초안에서 보존 대상 플래그. */
export function togglePin(state: AppState, res: ScheduleResult, ds: string, id: string): void {
  const dp = ensureManual(state, res, ds);
  const b = findBlock(dp, id);
  if (b) b.pinned = !b.pinned;
}
/** 블록 추가(공부/복습/Anki/백지/모의) — id 자동 부여. 필요 시 수동 승격. */
export function addBlock(
  state: AppState,
  res: ScheduleResult,
  ds: string,
  block: Omit<PlacedBlock, 'id'>,
): PlacedBlock {
  const dp = ensureManual(state, res, ds);
  const b: PlacedBlock = { ...block, id: rid() };
  dp.blocks.push(b);
  return b;
}

/** 공부 블록 추가하되 같은 sid|type 블록이 이미 있으면 min·챕터 병합(§6-3 완료 충돌 방지 —
 *  완료 키가 sid|type이라 같은 날 2블록이면 한 체크가 둘 다 토글되는 충돌이 난다). 반환=대상 블록. */
export function addOrMergeBlock(
  state: AppState,
  res: ScheduleResult,
  ds: string,
  block: Omit<PlacedBlock, 'id'>,
): { block: PlacedBlock; merged: boolean } {
  const dp = ensureManual(state, res, ds);
  const ex = dp.blocks.find((b) => b.sid === block.sid && b.type === block.type);
  if (ex) {
    ex.min += block.min;
    if (block.chapters) {
      ex.chapters = ex.chapters || [];
      for (const c of block.chapters) if (!ex.chapters.includes(c)) ex.chapters.push(c);
    }
    return { block: ex, merged: true };
  }
  return { block: addBlock(state, res, ds, block), merged: false };
}
/** 블록 삭제 — 수동인 날만. */
export function removeBlock(state: AppState, ds: string, id: string): void {
  const dp = state.dayPlans?.[ds];
  if (dp && dp.mode === 'manual') dp.blocks = dp.blocks.filter((b) => b.id !== id);
}
/** 다시 자동으로(§6-2) — dayPlans[ds] 제거해 자동 산출로 되돌린다. 핀 있으면 핀 블록만 남기고 재초안.
 *  (자유 할 일 tasks는 사용자 소유라 리셋 대상 아님 — 별도 리스트.) */
export function resetDay(state: AppState, ds: string): void {
  const plans = state.dayPlans;
  if (!plans || !plans[ds]) return;
  const pinned = plans[ds]!.blocks.filter((b) => b.pinned);
  if (pinned.length) plans[ds] = { mode: 'manual', blocks: pinned };
  else delete plans[ds];
}

/* ── 고아 sid 청소(과목 삭제 경로) ────────────────────────────────────────
   과목을 지워도 dayPlans[ds].blocks[].sid는 승격된 모든 날에 그대로 남는다(참조 무결성 없는 구조).
   그 잔재는 blocksForDay를 타고 배치·캘린더에 '연결된 과목이 없는 유령 블록'으로 뜨고,
   applyDayPlans가 그걸 day.items로 되돌려 used·주별시간·통계까지 오염시킨다.
   weekAlloc의 removeSidFromAlloc와 대칭 — 삭제 경로에서 둘을 함께 부른다. */

/** 한 과목의 블록을 전 dayPlans에서 제거하고 그 sid의 completions 고아 키까지 정리 — 과목 삭제 경로 전용.
 *
 *  **빈 날은 키째 삭제(auto 복귀).** 이 청소로 블록이 하나도 안 남은 날에 `{mode:'manual',blocks:[]}`를
 *  남기면 applyDayPlans가 그날 `d.items=[]`·`d.used=0`으로 치환해 **자동 스케줄이 죽는다**
 *  — "manual 날이 없으면 자동 산출 100% 불변"(결정로그 §계획개편)의 정반대. weekAlloc이 빈 주 객체를
 *  키째 지우는 것(removeSidFromAlloc)과 같은 판단이다. 단 **원래부터 비어 있던 날은 손대지 않는다**:
 *  그건 사용자가 손수 비운 '쉬는 날' 의사표시라 이 과목 삭제와 무관하다(실제로 지운 날만 정리).
 *
 *  **completions는 전 날짜에서 그 sid의 키를 지운다.** setBlockDone→syncBlockCompletion이 블록 done을
 *  `completions[ds]['sid|type']`로 미러링하므로, 블록만 지우면 그 집계 키가 고아로 남아
 *  완료 분(adherenceFactor·통계·연속일수)을 계속 부풀린다. 과목이 사라진 이상 그 sid의 완료는 manual/auto
 *  어느 날에서도 의미가 없으므로 날짜 전체를 훑어 지우고, 빈 날 객체는 syncBlockCompletion과 같은 규칙으로
 *  키째 정리한다. 남는 다른 sid의 집계는 sid|type로 분리돼 있어 재계산이 필요 없다.
 *
 *  @returns 정리한 개수(지운 블록 수 + 지운 완료 키 수). state 변형. */
export function removeSidFromDayPlans(state: AppState, sid: string): number {
  let n = 0;
  const plans = state.dayPlans;
  if (plans) {
    for (const ds in plans) {
      const dp = plans[ds];
      if (!dp || dp.mode !== 'manual' || !dp.blocks.length) continue;
      const before = dp.blocks.length;
      dp.blocks = dp.blocks.filter((b) => b.sid !== sid);
      const removed = before - dp.blocks.length;
      if (!removed) continue;
      n += removed;
      if (!dp.blocks.length) delete plans[ds]; // 빈 manual 날 = 자동 스케줄 사망 → 키째 정리
    }
  }
  const comps = state.completions;
  if (comps) {
    const prefix = completionKey(sid, '');
    for (const ds in comps) {
      const day = comps[ds];
      if (!day) continue;
      for (const key in day)
        if (key.startsWith(prefix)) {
          delete day[key];
          n++;
        }
      if (!Object.keys(day).length) delete comps[ds];
    }
  }
  return n;
}

/** 블록 유형별 기본 길이(분) — 모듈 길이에서 파생. '+ 블록 추가'가 쓰는 프리셋.
 *  왜 lib인가: 이건 화면 장식이 아니라 도메인 규칙(복습=모듈의 1/4, 백지=2/5 …)이라
 *  블록 CRUD 옆이 제자리다. 예전엔 DayPlanner 컴포넌트 본문에 인라인이라 테스트도 재사용도 불가했다. */
export function blockMinPresets(moduleLen: number): Record<string, number> {
  const ML = moduleLen || 120;
  return {
    new: ML,
    rev: reviewBlockMin(ML),
    anki: 20,
    blank: Math.max(30, Math.round(ML * 0.4)),
    mock: ML,
  };
}
