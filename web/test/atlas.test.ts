/* ============================================================
   atlas.test.ts — 진로 지도 순수 로직 + 시드 데이터 무결성.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  FIELDS,
  NEW_TREND_DAYS,
  SEED_EPOCH,
  atlasSummary,
  categoryOf,
  fieldByKey,
  groupByCategory,
  newTrendCount,
  newsQuery,
  type AtlasField,
} from '@/lib/atlas';
import { addDays, parseISO } from '@/lib/utils';

/** 테스트용 최소 필드 — 순수함수 검증용(실데이터와 분리). */
function mkField(partial: Partial<AtlasField>): AtlasField {
  return {
    key: 'x',
    name: 'X',
    cat: 'rfhw',
    one: '한 줄',
    doing: [],
    focus: '주력',
    skills: [],
    topics: [],
    entry: [],
    orgs: [],
    resources: [],
    future: '미래',
    outlook: { demand: '보통', difficulty: '중', horizon: '중기' },
    trends: [],
    ...partial,
  };
}

describe('newTrendCount', () => {
  const AT_EPOCH = parseISO(SEED_EPOCH); // now=에폭 → daysSinceEpoch=0 → daysAgo 원값 그대로(결정적)
  it('within일 이내 동향만 센다(경계 포함)', () => {
    const f = mkField({
      trends: [
        { id: 't1', text: '', source: '', daysAgo: 2 },
        { id: 't2', text: '', source: '', daysAgo: NEW_TREND_DAYS }, // 경계 포함
        { id: 't3', text: '', source: '', daysAgo: NEW_TREND_DAYS + 1 }, // 제외
      ],
    });
    expect(newTrendCount(f, AT_EPOCH)).toBe(2);
  });
  it('시간이 흐르면 NEW가 자연히 빠진다(실시간 노화)', () => {
    const f = mkField({ trends: [{ id: 't1', text: '', source: '', daysAgo: 2 }] });
    expect(newTrendCount(f, AT_EPOCH)).toBe(1); // 에폭 당일: age 2 ≤ 7
    const plus8 = addDays(AT_EPOCH, 8); // 8일 뒤: age 2+8=10 > 7 → 빠짐
    expect(newTrendCount(f, plus8)).toBe(0);
  });
});

describe('groupByCategory', () => {
  it('필터 없으면 필드 가진 모든 대분류를 CATEGORIES 순서로', () => {
    const groups = groupByCategory(FIELDS);
    expect(groups.length).toBe(CATEGORIES.length);
    expect(groups.map((g) => g.cat.key)).toEqual(CATEGORIES.map((c) => c.key));
  });
  it('필터가 있으면 그 대분류만', () => {
    const groups = groupByCategory(FIELDS, 'mobile');
    expect(groups.length).toBe(1);
    expect(groups[0]!.cat.key).toBe('mobile');
    expect(groups[0]!.fields.every((f) => f.cat === 'mobile')).toBe(true);
  });
  it('필드 없는 대분류는 빈 배열', () => {
    expect(groupByCategory([mkField({ cat: 'rfhw' })], 'mobile')).toEqual([]);
  });
});

describe('atlasSummary', () => {
  it('전체 수·대분류 수·관심·동향(커버리지 없음)', () => {
    const sum = atlasSummary(FIELDS, new Set(['ran', 'antenna']));
    expect(sum.total).toBe(FIELDS.length);
    expect(sum.categories).toBe(CATEGORIES.length);
    expect(sum.starred).toBe(2);
    expect(sum.newTrends).toBe(FIELDS.reduce((t, f) => t + newTrendCount(f), 0));
    expect('coverage' in sum).toBe(false); // 근거 없는 % 지표는 제거됨
  });
  it('없는 key는 관심으로 안 셈', () => {
    expect(atlasSummary(FIELDS, new Set(['nope'])).starred).toBe(0);
  });
});

describe('categoryOf', () => {
  it('필드의 대분류 메타를 돌려준다', () => {
    expect(categoryOf(fieldByKey('ran')!)?.name).toBe('이동통신 네트워크');
  });
});

describe('newsQuery', () => {
  it('분야명(·제거) + 상위 토픽 2개를 결합', () => {
    expect(newsQuery(fieldByKey('ran')!)).toBe('기지국 RAN Massive MIMO 빔포밍/프리코딩');
  });
  it('모든 필드가 비어있지 않은 검색어를 낸다', () => {
    for (const f of FIELDS) expect(newsQuery(f).length, f.key).toBeGreaterThan(0);
  });
});

describe('시드 데이터 무결성', () => {
  it('필드 key는 유일', () => {
    const keys = FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('모든 필드의 cat은 유효한 대분류', () => {
    const catKeys = new Set(CATEGORIES.map((c) => c.key));
    for (const f of FIELDS) expect(catKeys.has(f.cat)).toBe(true);
  });
  it('동향 id는 전역 유일', () => {
    const ids = FIELDS.flatMap((f) => f.trends.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('모든 필드가 필수 콘텐츠 섹션을 채운다(빈 부실 방지)', () => {
    for (const f of FIELDS) {
      expect(f.doing.length, `${f.key} doing`).toBeGreaterThan(0);
      expect(f.skills.length, `${f.key} skills`).toBeGreaterThan(0);
      expect(f.topics.length, `${f.key} topics`).toBeGreaterThan(0);
      expect(f.entry.length, `${f.key} entry`).toBeGreaterThan(0);
      expect(f.orgs.length, `${f.key} orgs`).toBeGreaterThan(0);
      expect(f.resources.length, `${f.key} resources`).toBeGreaterThan(0);
      expect(f.focus.length, `${f.key} focus`).toBeGreaterThan(0);
      expect(f.future.length, `${f.key} future`).toBeGreaterThan(0);
      expect(f.outlook.demand, `${f.key} outlook`).toBeTruthy();
    }
  });
  it('fieldByKey 왕복', () => {
    expect(fieldByKey('ran')?.name).toBe('기지국 · RAN');
    expect(fieldByKey('nope')).toBeUndefined();
  });
});
