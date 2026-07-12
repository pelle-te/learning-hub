/* ============================================================
   statsView.ts — 통계 탭의 순수 뷰모델(프레임워크 무관). 컴포넌트에서 파생 로직만 분리해
   임계값·미래 마스킹 같은 규칙을 단위 테스트로 잠근다(Stats.tsx는 마크업만 남긴다).
============================================================ */
import type { AppState } from './types';
import { addDays, iso, mondayOf, parseISO, todayISO } from './utils';

/** 스트릭 히트맵 한 칸 — v: 그날 학습분(미래는 -1), l: 강도 레벨(0~4, 미래는 -1). */
export interface StreakCell {
  ds: string;
  v: number;
  l: number;
}

export interface StreakGrid {
  cols: StreakCell[][]; // 주(열) × 요일(행) 셀
  monthLabels: string[]; // 각 주 열 시작(월요일)의 달이 바뀌는 지점에만 'N월', 아니면 ''
  activeDays: number; // 학습분 > 0 인 날 수
  totalMin: number; // 총 학습분
}

/** 학습분 → 강도 레벨. 임계값(30·60·120분)은 여기 단일 정의 — 테스트 대상. */
export function streakLevel(v: number): number {
  return v <= 0 ? 0 : v < 30 ? 1 : v < 60 ? 2 : v < 120 ? 3 : 4;
}

/** 최근 weeks주 스트릭 그리드를 완료기록에서 빌드. 미래 날짜는 v=l=-1로 마스킹. */
export function buildStreakGrid(state: AppState, weeks: number): StreakGrid {
  const comp = state.completions || {};
  const today = parseISO(todayISO(state));
  const startMon = addDays(mondayOf(today), -7 * (weeks - 1));
  const minOf = (ds: string): number => {
    const m = comp[ds];
    if (!m) return 0;
    return Object.values(m).reduce((acc, e) => acc + (e && e.done ? +e.min || 0 : 0), 0);
  };

  let activeDays = 0;
  let totalMin = 0;
  const cols: StreakCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const colMon = addDays(startMon, w * 7);
    const cells: StreakCell[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const d = addDays(colMon, dow);
      const ds = iso(d);
      const future = d > today;
      const v = future ? -1 : minOf(ds);
      if (v > 0) {
        activeDays++;
        totalMin += v;
      }
      cells.push({ ds, v, l: future ? -1 : streakLevel(v) });
    }
    cols.push(cells);
  }

  // 월 라벨 — 각 주 열의 시작(월요일) 달이 바뀌는 지점에만 표기(언제 공백이 생겼는지 읽히게).
  let lastMonth = -1;
  const monthLabels = cols.map((col) => {
    const first = col[0]?.ds || iso(today);
    const mo = parseISO(first).getMonth();
    if (mo !== lastMonth) {
      lastMonth = mo;
      return `${mo + 1}월`;
    }
    return '';
  });

  return { cols, monthLabels, activeDays, totalMin };
}
