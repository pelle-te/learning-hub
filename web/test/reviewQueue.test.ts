/* ============================================================
   reviewQueue.test.ts — buildReviewQueue 배선 회귀(ID-2 과목 인터리빙이 큐에 실제로 흐르는지).
   회상·착각 카드는 비우고 밀린 챕터만 남겨 순서를 검증한다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { buildReviewQueue } from '@/lib/reviewQueue';
import type { AppState, Day, ScheduleItem } from '@/lib/types';

const TODAY = '2026-07-04';

const revIt = (sid: string, chapters: string[]): ScheduleItem => ({
  type: 'new',
  sid,
  name: sid.toUpperCase(),
  min: 120,
  chapters,
  color: '#0f0',
});
const day = (ds: string, items: ScheduleItem[]): Day =>
  ({ ds, date: new Date(ds + 'T00:00:00'), wd: 0, studyMin: 0, used: 0, modLeft: 0, revLeft: 0, items }) as Day;

/** 완료 세션 + (회상·착각 없음) 상태. */
function stateWith(done: [string, string, string][]): AppState {
  const completions: Record<string, Record<string, { done: boolean; min: number }>> = {};
  for (const [ds, sid, type] of done)
    (completions[ds] = completions[ds] || {})[sid + '|' + type] = { done: true, min: 60 };
  return { items: [], completions, summaries: {}, cbms: [] } as unknown as AppState;
}

describe('buildReviewQueue — 밀린 챕터가 과목 인터리빙으로 나온다(ID-2)', () => {
  // m 3장·p 1장 모두 20일 전 완료(overdue). 위험순만이라면 m,m,m,p. 인터리빙이면 m,p,m,m.
  const days = [
    day('2026-06-14', [revIt('m', ['m1', 'm2', 'm3']), revIt('p', ['p1'])]), // 20일 전
  ];
  const state = stateWith([
    ['2026-06-14', 'm', 'new'],
    ['2026-06-14', 'p', 'new'],
  ]);

  it('같은 과목이 큐 앞을 통째로 점유하지 않는다(라운드로빈)', () => {
    const q = buildReviewQueue(state, days, TODAY);
    const chapters = q.filter((x) => x.kind === 'chapter').map((x) => (x.kind === 'chapter' ? x.ch.chapter : ''));
    // 회전 순 m→p: [m1,p1],[m2],[m3] → m1,p1,m2,m3. p가 두 번째로 끼어든다(블록 학습 방지).
    expect(chapters).toEqual(['m1', 'p1', 'm2', 'm3']);
  });
});
