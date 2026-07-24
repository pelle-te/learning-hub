/* ============================================================
   todayFocus.ts — 오늘 새 학습 중 '먼저 할 것'을 고른다(프로액티브 추천 · 순수).

   ## ⚠ 읽기 전용 추천이다 — 스케줄을 쓰지 않는다

   설계서 I-2/I-9 는 "임의 세션 삽입 = 고위험"이라 스케줄 자동쓰기를 **의도적으로 배제**했다.
   이 함수는 그 결정을 존중한다: 이미 배치된 오늘 블록들 중 **어느 것을 먼저 하면 좋은지**만
   점수로 랭크해 돌려준다(마감 임박 > 진도 밀림 > 큰 블록). 배치를 바꾸지 않는다.

   순수·결정적 — itemStat(마감·진도)과 오늘 날짜만 입력. 폰 홈이 "오늘의 초점"으로, 데스크톱이
   원하면 넛지로 소비할 수 있다.
============================================================ */
import { dayDiff, ddayInfo } from './utils';
import type { ItemStat, ScheduleItem } from './types';

export interface TodayFocus {
  /** 먼저 할 블록(오늘 새 학습 중). */
  block: ScheduleItem;
  /** 왜 이걸 먼저인지 한 줄(마감 D-n · 진도 밀림 · 가장 큰 학습). */
  reason: string;
}

/**
 * 오늘 새 학습 블록 중 최우선을 고른다. 합성 점수 = 마감 임박(가장 큼) + 진도 밀림 + 블록 크기.
 * 비어 있으면 null. 스케줄을 쓰지 않는 순수 추천이다.
 */
export function pickTodayFocus(newBlocks: ScheduleItem[], itemStat: ItemStat[], today: string): TodayFocus | null {
  if (!newBlocks.length) return null;
  const statBySid = new Map(itemStat.map((s) => [s.id, s]));

  const scored = newBlocks.map((b) => {
    const st = statBySid.get(b.sid);
    const dd = st?.deadline && !st.finished ? dayDiff(today, st.deadline) : null;
    const late = st?.late || 0;
    // 마감(미래·오늘)이 가까울수록 지배적. 없으면 진도 밀림 + 블록 크기로 가른다.
    const deadlineScore = dd != null && dd >= 0 ? 10000 - dd * 100 : 0;
    const score = deadlineScore + late * 10 + (b.min || 0) / 60;
    return { b, dd, late, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0]!;
  let reason = '오늘 가장 큰 학습';
  if (top.dd != null && top.dd <= 7) reason = `마감 ${ddayInfo(top.dd).lab}`;
  else if (top.late > 0) reason = '진도 밀림';
  return { block: top.b, reason };
}
