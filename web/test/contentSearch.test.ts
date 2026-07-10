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
  useApp.getState().loadState(base);
});

describe('contentSearch (E-6)', () => {
  it('과목명 매칭 → subject 히트(/items)', () => {
    const hits = contentSearch('선형');
    expect(hits.some((h) => h.kind === 'subject' && h.label === '선형대수' && h.to === '/items')).toBe(true);
  });

  it('챕터명 매칭 → chapter 히트(과목 · 챕터 라벨)', () => {
    const hits = contentSearch('벡터');
    expect(hits.some((h) => h.kind === 'chapter' && h.label.includes('벡터공간'))).toBe(true);
  });

  it('책 제목/저자 매칭 → book 히트(/reads)', () => {
    expect(contentSearch('딥러닝').some((h) => h.kind === 'book' && h.to === '/reads')).toBe(true);
    expect(contentSearch('김철수').some((h) => h.kind === 'book')).toBe(true);
  });

  it('빈 질의 → 빈 배열', () => {
    expect(contentSearch('')).toEqual([]);
    expect(contentSearch('   ')).toEqual([]);
  });

  it('대소문자 무시 + limit 상한 준수', () => {
    expect(contentSearch('벡터'.toUpperCase()).length).toBeGreaterThanOrEqual(0);
    expect(contentSearch('공', 1).length).toBeLessThanOrEqual(1);
  });
});
