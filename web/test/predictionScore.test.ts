/* ============================================================
   predictionScore.test.ts — N-5 예측 → 채점.
   잠그는 것: ① 미인출은 어느 칸에도 안 센다 ② 표본 게이트 ③ 놓침/오경보를 **가른다**.
============================================================ */
import { describe, expect, it } from 'vitest';
import { MIN_SCORED, scoreLabel, scorePrediction, sealPrediction } from '@/lib/predictionScore';
import type { ChapterReview } from '@/lib/spacedReview';
import type { AppState } from '@/lib/types';

const SEAL_DS = '2026-07-01';
const TODAY = '2026-07-20';

const rev = (chapter: string, risk: ChapterReview['risk']): ChapterReview => ({
  sid: 'c',
  subject: '회로이론',
  chapter,
  lastDs: '2026-06-20',
  daysSince: 11,
  risk,
});

/** `[챕터, 통과, 날짜]` → blankResults 만 가진 상태. */
const blanks = (rows: [string, boolean, string][]): AppState =>
  ({
    blankResults: rows.map(([chapter, passed, ds], i) => ({ id: 'b' + i, ds, sid: 'c', chapter, passed })),
  }) as unknown as AppState;

describe('sealPrediction', () => {
  it('위험(due·overdue)만 atRisk 로 얼리고, 스캔 대상 전부를 분모로 남긴다', () => {
    const s = sealPrediction([rev('1장', 'overdue'), rev('2장', 'due'), rev('3장', 'fresh')], SEAL_DS);
    expect(s.atRisk).toEqual(['c|1장', 'c|2장']);
    expect(s.scanned).toHaveLength(3);
    expect(s.ds).toBe(SEAL_DS);
  });
});

describe('scorePrediction — 네 칸', () => {
  const sealed = sealPrediction(
    [rev('1장', 'overdue'), rev('2장', 'due'), rev('3장', 'fresh'), rev('4장', 'fresh')],
    SEAL_DS,
  );

  it('적중·오경보·놓침·정기각을 각각 센다', () => {
    const st = blanks([
      ['1장', false, '2026-07-05'], // 위험이라 했고 막혔다 → 적중
      ['2장', true, '2026-07-06'], // 위험이라 했는데 통과 → 오경보
      ['3장', false, '2026-07-07'], // 괜찮다 했는데 막혔다 → 놓침
      ['4장', true, '2026-07-08'], // 괜찮다 했고 통과 → 정기각
    ]);
    expect(scorePrediction(sealed, st, TODAY)).toEqual({
      hits: 1,
      falseAlarms: 1,
      misses: 1,
      correctRejections: 1,
      scored: 4,
      accuracy: 0.5,
    });
  });

  it('⭐ 미인출은 어느 칸에도 안 센다 — 통과로 치면 시간이 갈수록 적중률이 저절로 오른다', () => {
    // 넷 중 하나만 인출됨 → scored=1 < MIN_SCORED → null (분모가 4로 부풀지 않는다)
    expect(scorePrediction(sealed, blanks([['1장', false, '2026-07-05']]), TODAY)).toBeNull();
  });

  it('봉인 **뒤** 첫 인출만 본다 — 두 번째부터는 그 사이의 학습이 결과를 바꾼다', () => {
    const st = blanks([
      ['1장', false, '2026-07-05'], // 첫 인출: 막힘 → 적중
      ['1장', true, '2026-07-12'], // 두 번째는 안 본다
      ['2장', true, '2026-07-06'],
      ['3장', false, '2026-07-07'],
      ['4장', true, '2026-07-08'],
    ]);
    expect(scorePrediction(sealed, st, TODAY)!.hits).toBe(1);
  });

  it('봉인 이전 기록과 미래 기록은 안 본다', () => {
    const st = blanks([
      ['1장', true, '2026-06-25'], // 봉인 이전
      ['2장', true, '2099-01-01'], // 미래
      ['3장', false, '2026-07-07'],
      ['4장', true, '2026-07-08'],
    ]);
    expect(scorePrediction(sealed, st, TODAY)).toBeNull(); // scored=2 < MIN_SCORED
  });

  it('표본 게이트 — MIN_SCORED 미만이면 null(0% 가 아니다)', () => {
    expect(MIN_SCORED).toBeGreaterThan(1);
    const rows = ['1장', '2장', '3장'].map((c, i) => [c, false, `2026-07-0${i + 5}`] as [string, boolean, string]);
    expect(scorePrediction(sealed, blanks(rows), TODAY)).toBeNull();
  });
});

describe('scoreLabel — 적중률 하나로 뭉치지 않는다', () => {
  const base = { hits: 2, correctRejections: 2, scored: 8, accuracy: 0.5 };
  it('놓치는 쪽으로 틀리면 그렇게 말한다(사다리가 느슨하다)', () => {
    expect(scoreLabel({ ...base, misses: 3, falseAlarms: 1 })).toContain('놓치는 쪽');
  });
  it('겁이 많은 쪽으로 틀리면 그렇게 말한다(처방이 다르다)', () => {
    expect(scoreLabel({ ...base, misses: 1, falseAlarms: 3 })).toContain('겁이 많은');
  });
  it('같으면 방향을 주장하지 않는다', () => {
    const s = scoreLabel({ ...base, misses: 2, falseAlarms: 2 });
    expect(s).not.toContain('놓치는');
    expect(s).not.toContain('겁이');
  });
});
