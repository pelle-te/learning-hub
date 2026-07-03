// @vitest-environment jsdom
/* ============================================================
   markets.test.ts — '증시 동향' 데이터 레이어(순수 로직 + fetch 계약).
   아티팩트 페치 성공/실패 · 지수 집계 · 지역 그룹핑 · 등락 표기 헬퍼.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMarketsArtifact, indexStats, groupByRegion, fmtPct, dir, type IndexQuote } from '@/lib/markets';

afterEach(() => vi.unstubAllGlobals());

function res(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

function q(symbol: string, region: string, changePct: number): IndexQuote {
  return {
    symbol,
    name: symbol,
    region,
    currency: 'USD',
    price: 100,
    prevClose: 100,
    change: 0,
    changePct,
    spark: [99, 100],
  };
}

describe('fetchMarketsArtifact — 성공/실패', () => {
  it('data(indices·news)를 반환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res({ ok: true, data: { at: 'now', date: 'd', indices: [], news: [] } })),
    );
    await expect(fetchMarketsArtifact()).resolves.toMatchObject({ date: 'd', indices: [], news: [] });
  });
  it('아직 수집 안 됨(ok:false)이면 throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res({ ok: false, error: '아직 생성 안 됨' })),
    );
    await expect(fetchMarketsArtifact()).rejects.toThrow('아직 생성 안 됨');
  });
});

describe('indexStats — 상승/하락/보합 집계', () => {
  it('changePct 부호로 센다', () => {
    const arr = [q('^GSPC', '미국', 1.2), q('^KS11', '한국', -0.5), q('^VIX', '지표', 0)];
    expect(indexStats(arr)).toEqual({ total: 3, up: 1, down: 1, flat: 1 });
  });
  it('빈 배열은 0으로', () => {
    expect(indexStats([])).toEqual({ total: 0, up: 0, down: 0, flat: 0 });
  });
});

describe('groupByRegion — 지역별 묶기(순서 유지)', () => {
  it('등장 순서대로 지역을 묶는다', () => {
    const arr = [q('a', '미국', 1), q('b', '한국', 1), q('c', '미국', -1)];
    const g = groupByRegion(arr);
    expect(g.map(([r]) => r)).toEqual(['미국', '한국']);
    expect(g[0]![1].map((x) => x.symbol)).toEqual(['a', 'c']);
    expect(g[1]![1]).toHaveLength(1);
  });
});

describe('fmtPct / dir — 등락 표기(색 비의존)', () => {
  it('부호를 붙이고 절대값 2자리', () => {
    expect(fmtPct(1.234)).toBe('+1.23%');
    expect(fmtPct(-0.8)).toBe('−0.80%'); // 유니코드 마이너스
    expect(fmtPct(0)).toBe('0.00%');
  });
  it('방향을 up/down/flat으로 분류', () => {
    expect(dir(0.1)).toBe('up');
    expect(dir(-0.1)).toBe('down');
    expect(dir(0)).toBe('flat');
  });
});
