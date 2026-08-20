/* ============================================================
   retrievalLatency.test.ts — A-2 인출 지연.
   잠그는 것: ① 문턱 밖은 **버린다**(눌러 담지 않는다) ② 중앙값(평균 아님) ③ "통과하지만 느린".
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  MAX_MS,
  MIN_MS,
  addRetrieval,
  retrievalStats,
  setRetrievalGot,
  slowButPassing,
  usable,
} from '@/lib/retrievalLatency';

const st = (): AppState => ({ retrievals: [], _today: '2026-08-07' }) as unknown as AppState;

describe('문턱 — 잡음을 원장에 안 들인다', () => {
  it('연타(너무 짧음)와 자리 뜸(너무 김)은 안 담는다', () => {
    expect(usable(MIN_MS - 1)).toBe(false);
    expect(usable(MAX_MS + 1)).toBe(false);
    expect(usable(MIN_MS)).toBe(true);
    expect(usable(MAX_MS)).toBe(true);
    expect(usable(NaN)).toBe(false);
  });

  it('⭐ 문턱 밖은 **버린다** — 0 이나 상한으로 눌러 담지 않는다(가짜 값이 된다)', () => {
    const s = st();
    expect(addRetrieval(s, 'c', '3장', 50, true)).toBeNull();
    expect(addRetrieval(s, 'c', '3장', 999_999, true)).toBeNull();
    expect(s.retrievals).toEqual([]);
  });

  it('챕터를 모르면 안 담는다 — 이 값의 쓸모가 전부 "어느 챕터가 느린가"에 있다', () => {
    const s = st();
    expect(addRetrieval(s, 'c', '   ', 3000, true)).toBeNull();
    expect(addRetrieval(s, '', '3장', 3000, true)).toBeNull();
    expect(s.retrievals).toEqual([]);
  });
});

describe('두 걸음 — 지연과 판정은 다른 시점에 온다', () => {
  it('펼칠 때 담고, 판정은 나중에 채운다', () => {
    const s = st();
    const id = addRetrieval(s, 'c', '3장', 3000, false)!;
    expect(s.retrievals![0]).toMatchObject({ sid: 'c', chapter: '3장', ms: 3000, got: false });
    setRetrievalGot(s, id, true);
    expect(s.retrievals![0]!.got).toBe(true);
  });

  it('없는 id 는 조용히 무시한다(되돌리기·경합에서 안전)', () => {
    const s = st();
    addRetrieval(s, 'c', '3장', 3000, false);
    setRetrievalGot(s, 'nope', true);
    expect(s.retrievals![0]!.got).toBe(false);
  });
});

describe('retrievalStats — 평균이 아니라 중앙값', () => {
  const seed = (ms: number[], chapter = '3장'): AppState => {
    const s = st();
    for (const m of ms) addRetrieval(s, 'c', chapter, m, true);
    return s;
  };

  it('표본이 얇으면 안 낸다', () => {
    expect(retrievalStats(seed([1000, 2000, 3000]))).toEqual([]);
  });

  it('⭐ 이상치 하나가 그 챕터의 성격이 되지 않는다', () => {
    // 평균이면 (1+1+1+100)/4 ≈ 25.7초. 중앙값은 1초대다.
    const s = seed([1000, 1100, 1200, 100_000]);
    const [row] = retrievalStats(s);
    expect(row!.medianMs).toBe(1150);
    expect(row!.n).toBe(4);
  });

  it('느린 순으로 낸다', () => {
    const s = st();
    for (const m of [1000, 1000, 1000, 1000]) addRetrieval(s, 'c', '빠른장', m, true);
    for (const m of [9000, 9000, 9000, 9000]) addRetrieval(s, 'c', '느린장', m, true);
    expect(retrievalStats(s).map((r) => r.chapter)).toEqual(['느린장', '빠른장']);
  });
});

describe('slowButPassing — 기존 어느 지표도 못 보는 것', () => {
  it('⭐ 통과율이 높은데 느린 챕터를 집는다(사다리는 이걸 "붙음"이라 미룬다)', () => {
    const s = st();
    for (const m of [1000, 1000, 1000, 1000]) addRetrieval(s, 'c', 'A', m, true);
    for (const m of [1200, 1200, 1200, 1200]) addRetrieval(s, 'c', 'B', m, true);
    for (const m of [9000, 9000, 9000, 9000]) addRetrieval(s, 'c', '느린데통과', m, true);
    expect(slowButPassing(s).map((r) => r.chapter)).toEqual(['느린데통과']);
  });

  it('느려도 통과율이 낮으면 안 집는다 — 그건 이미 다른 지표가 본다', () => {
    const s = st();
    for (const m of [1000, 1000, 1000, 1000]) addRetrieval(s, 'c', 'A', m, true);
    for (const m of [1200, 1200, 1200, 1200]) addRetrieval(s, 'c', 'B', m, true);
    for (const m of [9000, 9000, 9000, 9000]) addRetrieval(s, 'c', '느리고막힘', m, false);
    expect(slowButPassing(s)).toEqual([]);
  });

  it('⚠ 비교 대상이 2챕터 미만이면 기준 자체가 잡음이라 빈 배열', () => {
    const s = st();
    for (const m of [9000, 9000, 9000, 9000]) addRetrieval(s, 'c', '유일', m, true);
    expect(slowButPassing(s)).toEqual([]);
  });
});
