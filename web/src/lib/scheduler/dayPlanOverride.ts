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
  const dlIdxOf = (sid: string): number => {
    const it = state.items.find((x) => x.id === sid);
    return it?.deadline ? dayDiff(start, it.deadline) : Infinity;
  };
  for (const d of days) {
    if (plans[d.ds]?.mode !== 'manual') continue;
    const di = dayDiff(start, d.ds);
    for (const it of d.items) {
      if (it.type !== 'new' || !it.chapters || !it.chapters.length) continue;
      // 앵커 = 실제 완료일(doneDs) 우선(자동 패스와 동일 규칙), 없으면 배치일.
      const comp = state.completions?.[d.ds]?.[it.sid + '|new'];
      const anchor = comp?.done && comp.doneDs ? clamp(dayDiff(start, comp.doneDs), 0, days.length - 1) : di;
      const blank = latestBlank(state, it.sid);
      const offsets =
        blank === false
          ? REVIEW_OFFSETS_WEAK
          : blank === true
            ? [...REVIEW_OFFSETS, REVIEW_TAIL_OFFSET]
            : REVIEW_OFFSETS;
      const dl = dlIdxOf(it.sid);
      for (const off of offsets) {
        const ti = anchor + off;
        if (ti >= days.length || ti > dl) continue;
        const td = days[ti]!;
        if (plans[td.ds]?.mode === 'manual') continue; // 사용자 소유 날 — 주입 안 함
        const ex = td.items.find((x) => x.type === 'rev' && x.sid === it.sid);
        const missing = it.chapters.filter((c) => !(ex && ex.chapters && ex.chapters.includes(c)));
        if (!missing.length) continue; // 이미 하류 rev가 그 챕터를 덮음 → 이중계상 방지
        if (ex && ex.chapters) {
          missing.forEach((c) => ex.chapters!.push(c)); // 기존 rev에 챕터만 병합(min 보수적 유지)
        } else {
          td.items.push({ type: 'rev', sid: it.sid, name: it.name, color: it.color, min: revMin, chapters: missing });
          td.used += revMin;
        }
      }
    }
  }
}
