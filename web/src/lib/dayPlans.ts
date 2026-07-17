/* ============================================================
   dayPlans.ts — 일일 배치 오버라이드(계획개편 §4·§6)의 순수 CRUD·선택자.
   자동엔진(schedule)은 제안자, dayPlans[ds]가 그날 배치의 진리(mode:'manual'). 첫 편집 시
   자동초안을 스냅샷해 승격(§6-3 자동초안을 잃지 않게) → 그 위에서 시간박기/추가/핀/삭제.
   applyDayPlans(scheduler)가 manual인 날 day.items를 이 블록으로 치환하고, layoutDay가 start를 존중.
   변형 헬퍼는 스토어 mutate 안에서 호출(→ persist), 컴포넌트는 blocksForDay 등 선택자로 파생만 읽는다.
============================================================ */
import { rid, clamp } from './utils';
import type { AppState, DayPlan, PlacedBlock, ScheduleResult } from './types';

/** 시간박기 스냅 격자(분) — 드래그·리사이즈·시각 입력 공통. */
export const SNAP = 15;
/** 15분 격자로 스냅. */
export function snap(min: number): number {
  return Math.round(min / SNAP) * SNAP;
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
  }
  return dp;
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
