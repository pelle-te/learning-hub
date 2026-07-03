/* ============================================================
   promote.test.ts — 소비→학습 승격 매핑(순수) 회귀.
============================================================ */
import { describe, expect, it } from 'vitest';
import { backlogFromArticle, backlogFromNews } from '@/lib/promote';
import type { Article } from '@/lib/reads';
import type { NewsItem } from '@/lib/markets';

const article = (over?: Partial<Article>): Article => ({
  id: 'a1',
  lang: 'en',
  field: 'science',
  source: 'Nature',
  title: '  변위 전류의 재발견  ',
  url: 'https://x.test/1',
  published: '2026-07-01',
  words: 900,
  text: 'word '.repeat(100), // 500자 → 발췌 잘림
  ...over,
});
const news = (over?: Partial<NewsItem>): NewsItem => ({
  id: 'n1',
  source: 'Bloomberg',
  field: '거시',
  title: 'Fed 금리 동결',
  url: 'https://x.test/n',
  published: '2026-07-04',
  summary: '연준이 기준금리를 동결했다.',
  ...over,
});

describe('promote — backlogFromArticle', () => {
  it('제목 트림·출처/링크/발췌 포함, 긴 본문은 … 로 절단', () => {
    const seed = backlogFromArticle(article());
    expect(seed.name).toBe('읽을거리');
    expect(seed.topic).toBe('변위 전류의 재발견'); // 트림됨
    expect(seed.note).toContain('Nature');
    expect(seed.note).toContain('https://x.test/1');
    expect(seed.note.endsWith('…')).toBe(true); // 길어서 절단
  });

  it('본문 없으면 발췌 생략', () => {
    const seed = backlogFromArticle(article({ text: '' }));
    expect(seed.note).not.toContain('…');
    expect(seed.note).toContain('https://x.test/1');
  });
});

describe('promote — backlogFromNews', () => {
  it('증시 라벨·제목·출처·링크·발췌', () => {
    const seed = backlogFromNews(news());
    expect(seed.name).toBe('증시 동향');
    expect(seed.topic).toBe('Fed 금리 동결');
    expect(seed.note).toContain('Bloomberg');
    expect(seed.note).toContain('연준이 기준금리를 동결');
  });
});
