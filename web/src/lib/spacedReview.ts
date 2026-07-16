/* ============================================================
   spacedReview.ts — 개념(챕터) 레벨 간격반복 위험 — 순수·무의존.
   Anki가 '카드' 레벨을 소유한다면 여기선 '개념(챕터)' 레벨: 내가 실제로 학습/복습/백지한
   (완료된) 세션에서 챕터별 '마지막으로 만진 날'을 뽑아, 망각곡선상 오래 방치된 챕터를 위험으로 표식.

   신호원: 스케줄의 완료 세션(new/rev/blank) + chapters. isDone으로 게이팅 — 계획만 있고 안 한 건 제외.
   ⚠ 한계: 챕터를 'done' 처리하면 스케줄 계획에서 빠져(=이 스캔에서도 빠짐) — 진행 중 과목의
      '배웠지만 다시 안 본' 챕터를 겨냥한다(가장 잊기 쉬운 구간). REVIEW_OFFSETS(1·3·7·16)와 정렬.
============================================================ */
import { dayDiff, REVIEW_OFFSETS } from './utils';
import { isDone } from './persistence';
import type { AppState, Day, SessionType } from './types';

export type ReviewRisk = 'fresh' | 'due' | 'overdue';

export interface ChapterReview {
  sid: string;
  subject: string;
  color?: string;
  chapter: string;
  lastDs: string; // 마지막으로 만진 날
  daysSince: number; // 오늘로부터 경과일
  risk: ReviewRisk;
}

/** 간격반복의 마지막 오프셋(16) 기준: 그 이상 방치=overdue, 마지막 직전(7)↑=due. */
const DUE_DAYS = REVIEW_OFFSETS[REVIEW_OFFSETS.length - 2] ?? 7; // 7
const OVERDUE_DAYS = REVIEW_OFFSETS[REVIEW_OFFSETS.length - 1] ?? 16; // 16

export function riskOf(daysSince: number): ReviewRisk {
  if (daysSince >= OVERDUE_DAYS) return 'overdue';
  if (daysSince >= DUE_DAYS) return 'due';
  return 'fresh';
}

const TOUCH_TYPES: ReadonlySet<SessionType> = new Set<SessionType>(['new', 'rev', 'blank']);

/** 챕터별 '마지막으로 만진 날' → 경과일·위험도. todayDs 이후(미래) 배치는 무시. 위험 큰 순 정렬. */
export function chapterReviews(state: AppState, days: Day[], todayDs: string): ChapterReview[] {
  const last = new Map<string, { ds: string; subject: string; sid: string; color?: string; chapter: string }>();
  for (const d of days) {
    if (d.ds > todayDs) continue;
    for (const it of d.items) {
      if (!TOUCH_TYPES.has(it.type) || !it.chapters || !it.chapters.length) continue;
      if (!isDone(state, d.ds, it.sid, it.type)) continue;
      for (const ch of it.chapters) {
        const key = it.sid + '|' + ch;
        const cur = last.get(key);
        if (!cur || d.ds > cur.ds)
          last.set(key, { ds: d.ds, subject: it.name, sid: it.sid, color: it.color, chapter: ch });
      }
    }
  }
  // ReviewRun 챕터 터치(계획 밖 인출) 병합 — 계획 파생 lastDs와 max(감사 #22: 밀린 챕터를
  // 복습해도 overdue가 안 풀리던 루프). 스캔에 없는 키는 과목 메타를 몰라 건너뜀 — 위험으로
  // 뜨는 챕터는 완료 이력이 있어 항상 스캔에 존재한다. 미래 ds는 스캔과 동일하게 무시.
  const touches = state.reviewTouches || {};
  for (const k in touches) {
    const ds = touches[k]!;
    const cur = last.get(k);
    if (cur && ds > cur.ds && ds <= todayDs) cur.ds = ds;
  }
  const out: ChapterReview[] = [];
  for (const e of last.values()) {
    const daysSince = dayDiff(e.ds, todayDs);
    out.push({
      sid: e.sid,
      subject: e.subject,
      color: e.color,
      chapter: e.chapter,
      lastDs: e.ds,
      daysSince,
      risk: riskOf(daysSince),
    });
  }
  return out.sort((a, b) => b.daysSince - a.daysSince || (a.subject < b.subject ? -1 : 1));
}

/** 복습 위험(due/overdue) 챕터만, 위험 큰 순 상위 cap개. */
export function riskChapters(state: AppState, days: Day[], todayDs: string, cap = 8): ChapterReview[] {
  return chapterReviews(state, days, todayDs)
    .filter((c) => c.risk !== 'fresh')
    .slice(0, cap);
}

/** 위험 요약 — {overdue, due, total 위험 수} (배지·홈 넛지용). */
export function riskSummary(state: AppState, days: Day[], todayDs: string): { overdue: number; due: number } {
  let overdue = 0;
  let due = 0;
  for (const c of chapterReviews(state, days, todayDs)) {
    if (c.risk === 'overdue') overdue++;
    else if (c.risk === 'due') due++;
  }
  return { overdue, due };
}
