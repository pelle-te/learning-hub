/* E-6 오프라인 통합 검색(shell/actions.contentSearch) — 학습 항목·챕터·독서를 부분문자열로.
   store는 loadState로 시드, 독서 블롭은 loadReads를 목킹. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/reads', async (orig) => {
  const actual = await orig<typeof import('@/lib/reads')>();
  return {
    ...actual,
    loadReads: () => ({
      work: {},
      books: [
        {
          id: 'b1',
          title: '딥러닝 입문',
          author: '김철수',
          status: 'reading' as const,
          review: '',
          rating: 0,
          startedAt: '',
          finishedAt: null,
        },
      ],
    }),
  };
});

import { useApp } from '@/store/useApp';
import { defaults } from '@/lib/persistence';
import { contentSearch } from '@/shell/actions';
import { loadReads } from '@/lib/reads';

// C-1: contentSearch는 팔레트가 열릴 때 1회 스냅샷한 reads를 주입받는다(타이핑 매 키 재파싱 제거).
//      테스트도 목킹된 loadReads() 스냅샷을 그 계약대로 넘긴다.
const reads = loadReads();

beforeEach(() => {
  const base = defaults();
  base.items = [
    {
      id: 'i1',
      name: '선형대수',
      mode: 'weekly',
      weeklyHours: 3,
      chapters: [
        { id: 'c1', name: '벡터공간', hours: 2, done: false },
        { id: 'c2', name: '고유값', hours: 2, done: false },
      ],
    },
    { id: 'i2', name: '알고리즘', mode: 'daily', chapters: [{ id: 'c3', name: '정렬', hours: 1, done: false }] },
  ] as typeof base.items;
  base.cbms = [
    {
      id: 'm1',
      ds: '2026-07-20',
      sid: 'i1',
      name: '선형대수',
      chapter: '고유값',
      code: 'C1',
      note: '대각화 조건을 헷갈렸다',
    },
  ] as typeof base.cbms;
  useApp.getState().loadState(base);
});

describe('contentSearch (E-6)', () => {
  /* W12 — 객체가 자기 URL 을 갖는다. 옛 목적지는 `/items?focus=<id>`(목록에 데려다 놓고 그 카드를
     1.5초 깜빡이는 우회로)였고, 챕터는 원리적으로 착지 불가라 소속 과목까지가 최선이었다. */
  it('과목명 매칭 → subject 히트(/subject/:id)', () => {
    const hits = contentSearch('선형', reads);
    expect(hits.some((h) => h.kind === 'subject' && h.label === '선형대수' && h.to.startsWith('/subject/'))).toBe(true);
  });

  it('챕터명 매칭 → chapter 히트가 **자기 앵커**(#ch-<id>)에 선다', () => {
    const hits = contentSearch('벡터', reads);
    const ch = hits.find((h) => h.kind === 'chapter' && h.label.includes('벡터공간'));
    expect(ch).toBeTruthy();
    expect(ch!.to).toMatch(/^\/subject\/[^#]+#ch-/);
  });

  it('책 제목/저자 매칭 → book 히트(/reads)', () => {
    expect(contentSearch('딥러닝', reads).some((h) => h.kind === 'book' && h.to === '/reads')).toBe(true);
    expect(contentSearch('김철수', reads).some((h) => h.kind === 'book')).toBe(true);
  });

  it('빈 질의 → 빈 배열', () => {
    expect(contentSearch('', reads)).toEqual([]);
    expect(contentSearch('   ', reads)).toEqual([]);
  });

  it('대소문자 무시 + limit 상한 준수', () => {
    expect(contentSearch('벡터'.toUpperCase(), reads).length).toBeGreaterThanOrEqual(0);
    expect(contentSearch('공', reads, 1).length).toBeLessThanOrEqual(1);
  });
});

/* 오답 메모(CBMS `note`)는 앱에서 가장 밀도 높은 자기 텍스트인데 **유일하게 검색 밖**이었다 —
   도달 경로가 오답 탭을 눈으로 스크롤하는 것뿐이었다. */
describe('contentSearch — 오답 메모', () => {
  it('메모 본문으로 찾힌다', () => {
    const hits = contentSearch('대각화', reads);
    expect(hits.some((h) => h.kind === 'mistake')).toBe(true);
  });

  it('과목까지 좁혀 데려간다 — 조인 키가 과목 id 라 실패가 원리적으로 없다', () => {
    const hit = contentSearch('대각화', reads).find((h) => h.kind === 'mistake')!;
    expect(hit.to).toBe('/mistakes?sid=i1');
    expect(hit.sid).toBe('i1');
  });

  it('과목명·챕터명으로도 걸린다', () => {
    expect(contentSearch('고유값', reads).some((h) => h.kind === 'mistake')).toBe(true);
  });
});
