// @vitest-environment jsdom
/* ============================================================
   reads.test.ts — '읽을거리' 데이터 레이어(순수 로직 + fetch 계약).
   로컬 저장 round-trip · 손상 입력 방어 · 아티팩트 페치 성공/실패 · 파생 집계.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadReads,
  saveReads,
  recoverReadsFromIDB,
  fetchReadsArtifact,
  newBook,
  articleStats,
  type Article,
  type ArticleWork,
} from '@/lib/reads';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function res(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

describe('로컬 저장 — round-trip + 손상 방어', () => {
  it('빈 상태를 로드하면 work/books 빈 값', () => {
    expect(loadReads()).toEqual({ work: {}, books: [] });
  });
  it('저장한 뒤 로드하면 그대로 복원된다', () => {
    const b = newBook('사피엔스', '유발 하라리');
    const ok = saveReads({ work: { a1: { summary: '요약', done: true, updatedAt: 't' } }, books: [b] });
    expect(ok).toBe(true);
    const r = loadReads();
    expect(r.books[0]!.title).toBe('사피엔스');
    expect(r.work.a1!.done).toBe(true);
  });
  it('손상된 JSON은 빈 값으로 방어한다', () => {
    localStorage.setItem('lh:reads', '{not json');
    expect(loadReads()).toEqual({ work: {}, books: [] });
  });
  it('부분/이상 타입은 정규화된다(work 비객체·books 비배열)', () => {
    localStorage.setItem('lh:reads', JSON.stringify({ work: 42, books: 'x' }));
    expect(loadReads()).toEqual({ work: {}, books: [] });
  });
});

describe('newBook — 기본값', () => {
  it('제목·저자 트림, 읽는 중, 빈 독후감, 별점 0', () => {
    const b = newBook('  총, 균, 쇠  ', '  다이아몬드 ');
    expect(b.title).toBe('총, 균, 쇠');
    expect(b.author).toBe('다이아몬드');
    expect(b.status).toBe('reading');
    expect(b.review).toBe('');
    expect(b.rating).toBe(0);
    expect(b.finishedAt).toBeNull();
    expect(b.id).toBeTruthy();
  });
});

describe('articleStats — 언어·완료 집계', () => {
  const arts: Article[] = [
    { id: 'e1', lang: 'en', field: '과학', source: 's', title: 't', url: 'u', published: '', words: 500, text: '' },
    { id: 'k1', lang: 'ko', field: '사회', source: 's', title: 't', url: 'u', published: '', words: 800, text: '' },
    { id: 'k2', lang: 'ko', field: '경제', source: 's', title: 't', url: 'u', published: '', words: 300, text: '' },
  ];
  it('총/영어/한국어/완료를 센다', () => {
    const work: Record<string, ArticleWork> = { k1: { summary: 'x', done: true, updatedAt: 't' } };
    expect(articleStats(arts, work)).toEqual({ total: 3, en: 1, ko: 2, done: 1 });
  });
});

describe('fetchReadsArtifact — 성공/실패', () => {
  it('data.articles를 반환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res({ ok: true, data: { at: 'now', date: 'd', articles: [] } })),
    );
    await expect(fetchReadsArtifact()).resolves.toMatchObject({ date: 'd', articles: [] });
  });
  it('아직 생성 안 됨(ok:false)이면 throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res({ ok: false, error: '아직 생성 안 됨' })),
    );
    await expect(fetchReadsArtifact()).rejects.toThrow('아직 생성 안 됨');
  });
});

describe('recoverReadsFromIDB', () => {
  it('localStorage에 이미 값이 있으면 복구를 건너뛴다(null)', async () => {
    saveReads({ work: {}, books: [newBook('x')] });
    await expect(recoverReadsFromIDB()).resolves.toBeNull();
  });
  it('IDB 미지원(jsdom)이면 조용히 null', async () => {
    await expect(recoverReadsFromIDB()).resolves.toBeNull();
  });
});
