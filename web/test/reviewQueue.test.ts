/* ============================================================
   reviewQueue.test.ts — buildReviewQueue 배선 회귀(ID-2 과목 인터리빙이 큐에 실제로 흐르는지).
   회상·착각 카드는 비우고 밀린 챕터만 남겨 순서를 검증한다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { REQUEUE_GAP, buildReviewQueue, requeue, runItemKey, type RunItem } from '@/lib/reviewQueue';
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

/* ── D-1 재큐(세션 내 확장 인출) ─────────────────────────────────────────
   러너 UI 없이 규칙 전량을 덮는다 — 데스크톱·폰 두 러너가 이 한 함수를 공유하므로
   여기가 녹색이면 두 화면의 큐 동작이 같다는 뜻이다(스냅샷과 무관한 안전망). */
const ch = (chapter: string): RunItem => ({
  kind: 'chapter',
  ch: { sid: 's', subject: 'S', chapter, lastDs: '2026-06-01', daysSince: 20, risk: 'overdue' },
});
const keys = (q: RunItem[]): string[] => q.map((i) => (i.kind === 'chapter' ? i.ch.chapter : i.kind));

describe('requeue — 못 한 카드를 세션 안에서 한 번 더', () => {
  const q4 = [ch('a'), ch('b'), ch('c'), ch('d')];

  it(`현재 카드를 ${REQUEUE_GAP}장 뒤에 다시 넣는다`, () => {
    const next = requeue(q4, 0);
    expect(keys(next)).toEqual(['a', 'b', 'c', 'd', 'a']); // idx 0 → 삽입 위치 4
    expect(next[4]!.again).toBe(true);
    expect(next[0]!.again).toBeUndefined();
  });

  it('끝을 넘어가면 마지막에 붙인다(세션 밖으로 밀어내면 삭제가 된다)', () => {
    expect(keys(requeue(q4, 3))).toEqual(['a', 'b', 'c', 'd', 'd']);
  });

  it('재삽입본은 다시 재삽입하지 않는다(상한 1)', () => {
    const once = requeue(q4, 0);
    expect(requeue(once, 4)).toBe(once); // 참조 동일 = 손대지 않음
  });

  it('짧은 큐(<4)에서는 재삽입하지 않는다 — 사실상 직후 반복이 된다', () => {
    const q3 = [ch('a'), ch('b'), ch('c')];
    expect(requeue(q3, 0)).toBe(q3);
    expect(requeue([ch('a')], 0)).toHaveLength(1);
  });

  it('원본 배열을 변형하지 않는다(순수)', () => {
    const before = keys(q4);
    requeue(q4, 1);
    expect(keys(q4)).toEqual(before);
  });

  it('범위 밖 인덱스는 무시한다', () => {
    expect(requeue(q4, 9)).toBe(q4);
    expect(requeue([], 0)).toHaveLength(0);
  });

  it('재삽입본은 원본과 같은 카드로 센다(분모가 흔들리지 않는다)', () => {
    const next = requeue(q4, 0);
    expect(runItemKey(next[4]!)).toBe(runItemKey(next[0]!));
    expect(new Set(next.map(runItemKey)).size).toBe(4); // 큐는 5장이지만 카드는 4장
  });
});
