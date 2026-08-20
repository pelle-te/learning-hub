/* ============================================================
   scheduler/dayPlanOverride.ts — 자동 산출 위에 사용자의 수동 배치를 얹는 후처리.
   ⚠ 핵심 불변식: 수동 오버라이드가 없으면 완전 무동작 → 자동 산출이 100% 그대로여야 한다.
============================================================ */
import { REVIEW_OFFSETS, REVIEW_OFFSETS_WEAK, REVIEW_TAIL_OFFSET, clamp, dayDiff, reviewBlockMin } from '../utils';
import { latestBlank } from './priority';
import type { AppState, Day } from '../types';

/** 일일 배치 오버라이드 후처리(§4-2) — mode==='manual'인 날의 day.items를 dayPlans 블록으로 치환.
 *  각 블록에 명시 start를 실어 layoutDay가 그 시각에 배치한다. day.used도 블록 합으로 갱신.
 *  ⚠ 불변식: 수동 오버라이드가 없으면(dayPlans 부재/빈값) 완전 무동작 → 자동 산출 100% 불변.
 *  (§4-3 복습 재씨앗은 별도 — 수동 new 블록의 하류 복습 생성은 후속 패스에서. 자동-only 불변이 전제.) */
export function applyDayPlans(state: AppState, days: Day[]): void {
  const plans = state.dayPlans;
  if (!plans) return; // 무 dayPlans → 무동작(자동 산출 불변)
  for (const d of days) {
    const dp = plans[d.ds];
    if (!dp || dp.mode !== 'manual') continue;
    d.items = dp.blocks.map((b) => ({
      type: b.type,
      sid: b.sid,
      name: b.name,
      color: b.color,
      min: b.min,
      chapters: b.chapters ? b.chapters.slice() : undefined,
      start: b.start, // 명시 배치 시각(있으면) — layoutDay가 존중
    }));
    d.used = d.items.reduce((t, it) => t + it.min, 0);
  }
}

/** §4-3 복습 재씨앗 — applyDayPlans 직후, manual인 날의 new 블록 하류 복습을 보강한다.
 *  ⚠ 불변식: manual인 날이 하나도 없으면 완전 무동작 → 자동 산출 100% 불변(회귀 고정 전제).
 *  이중계상 방지: 대상 날에 그 과목 rev가 이미 그 챕터를 덮으면 skip한다 — 수동이 '자동초안 스냅샷'인
 *  일반 경우엔 자동 패스가 만든 하류 rev가 이미 그 챕터를 덮으므로 실질 무보강(사용자가 새 챕터의
 *  new 블록을 손수 얹었을 때만 그 하류 복습이 새로 생긴다). 대상 날이 manual이면 사용자 소유라 주입 안 함.
 *  reviewViaAnki면 복습은 Anki/FSRS 소유라 생략(자동 패스와 동일 규칙). */
/* ⚠ **복습 한 칸 주입**을 갈라 둔다(2026-08-20 리뷰 M-14 원장 축소). 종전엔 `reseedManualReviews`
   안에 루프 셋이 중첩돼 있었고(날 → 블록 → 오프셋) 가장 안쪽이 다시 조건 넷을 품었다.
   이 함수는 *한 날에 한 복습을 어떻게 얹는가* 만 안다 — 어느 날에 얹을지는 호출부가 정한다. */
function injectReview(
  td: Day,
  src: { sid: string; name: string; color?: string; chapters?: string[] },
  revMin: number,
  plans: NonNullable<AppState['dayPlans']>,
): void {
  if (plans[td.ds]?.mode === 'manual') return; // 사용자 소유 날 — 주입 안 함
  const ex = td.items.find((x) => x.type === 'rev' && x.sid === src.sid);
  const missing = (src.chapters ?? []).filter((c) => !(ex && ex.chapters && ex.chapters.includes(c)));
  if (!missing.length) return; // 이미 하류 rev 가 그 챕터를 덮음 → 이중계상 방지
  if (ex && ex.chapters) {
    missing.forEach((c) => ex.chapters!.push(c)); // 기존 rev 에 챕터만 병합(min 보수적 유지)
    return;
  }
  td.items.push({ type: 'rev', sid: src.sid, name: src.name, color: src.color, min: revMin, chapters: missing });
  td.used += revMin;
}

export function reseedManualReviews(
  state: AppState,
  days: Day[],
  start: string,
  ML: number,
  reviewViaAnki: boolean,
): void {
  const plans = state.dayPlans;
  if (!plans) return;
  if (reviewViaAnki) return;
  if (!days.some((d) => plans[d.ds]?.mode === 'manual')) return; // auto-only → 무동작
  const revMin = reviewBlockMin(ML);
  /* ⚠ 아래 두 조회는 **블록마다** 불린다(manual 인 날 × 그날 new 블록). 종전엔 각각
     `state.items` 선형 탐색과 `blankResults` 전량 스캔이라 그 곱이 그대로 비용이었다
     (2026-08-20 리뷰 M-4 · `engine.ts` 의 `blankBySid` 와 같은 처방). sid 는 과목 수만큼만
     존재하므로 한 번 접어 두면 그 축이 사라진다. */
  const itemById = new Map((state.items || []).map((x) => [x.id, x]));
  const dlIdxOf = (sid: string): number => {
    const it = itemById.get(sid);
    return it?.deadline ? dayDiff(start, it.deadline) : Infinity;
  };
  const blankCache = new Map<string, boolean | null>();
  const blankOf = (sid: string): boolean | null => {
    let v = blankCache.get(sid);
    if (v === undefined) {
      v = latestBlank(state, sid);
      blankCache.set(sid, v);
    }
    return v;
  };
  for (const d of days) {
    if (plans[d.ds]?.mode !== 'manual') continue;
    for (const it of d.items) {
      if (it.type !== 'new' || !it.chapters || !it.chapters.length) continue;
      const anchor = anchorIdx(state, d.ds, it.sid, start, days.length);
      for (const off of offsetsFor(blankOf(it.sid))) {
        const ti = anchor + off;
        if (ti >= days.length || ti > dlIdxOf(it.sid)) continue;
        injectReview(days[ti]!, it, revMin, plans);
      }
    }
  }
}

/** 하류 복습의 앵커 인덱스 — **실제 완료일(`doneDs`) 우선**, 없으면 배치일(자동 패스와 동일 규칙). */
function anchorIdx(state: AppState, ds: string, sid: string, start: string, len: number): number {
  const comp = state.completions?.[ds]?.[sid + '|new'];
  return comp?.done && comp.doneDs ? clamp(dayDiff(start, comp.doneDs), 0, len - 1) : dayDiff(start, ds);
}

/** 백지 성과에 따른 사다리 — 막힘이면 단축, 통과면 꼬리 연장, 기록 없으면 기본(②#23). */
function offsetsFor(blank: boolean | null): readonly number[] {
  if (blank === false) return REVIEW_OFFSETS_WEAK;
  if (blank === true) return [...REVIEW_OFFSETS, REVIEW_TAIL_OFFSET];
  return REVIEW_OFFSETS;
}
