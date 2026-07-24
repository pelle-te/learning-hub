/* ============================================================
   semantic.test.ts — 시맨틱 레이어의 순수 계산(해시·코사인·topK·코퍼스·자동 엣지).
   IO(임베딩 fetch·IDB 캐시)는 여기서 다루지 않는다 — Ollama 없인 조용히 비활성이 계약.
============================================================ */
import { describe, expect, it, vi } from 'vitest';
import { hashText, cosine, topK, buildCorpus, crossChapterEdges, vectorsFor, type SemEntry } from '@/lib/semantic';
import { defaults } from '@/lib/persistence';
import type { AppState } from '@/lib/types';
import type { ReadsLocal } from '@/lib/reads';

// vectorsFor(IO) 검증용 — 임베딩·IDB를 목킹(모델명은 mock 접두 변수로 런타임 제어).
let mockModel = 'model-A';
vi.mock('@/lib/idb', () => ({ idbLoad: vi.fn(async () => null), idbMirror: vi.fn(() => {}) }));
vi.mock('@/lib/api', () => ({
  embedTexts: vi.fn(async (texts: string[]) => ({ ok: true, model: mockModel, vectors: texts.map(() => [1, 0, 0]) })),
}));

describe('hashText — 증분 캐시 키', () => {
  it('같은 입력은 같은 해시, 다른 입력은 (사실상) 다른 해시', () => {
    expect(hashText('전자기학 3장')).toBe(hashText('전자기학 3장'));
    expect(hashText('전자기학 3장')).not.toBe(hashText('전자기학 4장'));
  });
  it('빈 문자열도 안정적으로 해시된다', () => {
    expect(hashText('')).toBe(hashText(''));
  });
});

describe('cosine — 코사인 유사도', () => {
  it('동일 벡터는 1, 직교는 0', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('길이 불일치·영벡터는 0(방어)', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([0, 0], [1, 2])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });
  it('스케일에 불변(방향만 본다)', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });
});

const entry = (id: string): SemEntry => ({ id, kind: 'chapter', label: id, text: id, to: '/graph' });

describe('topK — 상위 k 필터·정렬', () => {
  const entries = [
    { entry: entry('a'), vec: [1, 0] },
    { entry: entry('b'), vec: [0.9, 0.1] },
    { entry: entry('c'), vec: [0, 1] }, // 직교 — minSim 미달
  ];
  it('minSim 미달은 제외하고 유사도 내림차순', () => {
    const hits = topK([1, 0], entries, 5, 0.35);
    expect(hits.map((h) => h.id)).toEqual(['a', 'b']);
    expect(hits[0]!.sim).toBeGreaterThan(hits[1]!.sim);
  });
  it('k로 자른다', () => {
    expect(topK([1, 0], entries, 1, 0.1)).toHaveLength(1);
  });
});

function seedState(): AppState {
  const s = defaults();
  s.items = [
    {
      id: 'i1',
      name: '전자기학',
      chapters: [
        { id: 'c1', name: '맥스웰 방정식', hours: 2, done: false },
        { id: 'c2', name: '', hours: 1, done: false }, // 이름 없음 — 제외
      ],
    },
    { id: 'i2', name: '', chapters: [{ id: 'c3', name: '무명 과목 챕터', hours: 1, done: false }] }, // 과목명 없음 — 제외
  ] as AppState['items'];
  s.summaries = {
    '2026-07-01': [{ id: 's1', sid: 'i1', name: '전자기학', s1: '변위전류는 …', s2: '', s3: '' }],
  } as never;
  s.backlog = [
    {
      id: 'b1',
      ds: '2026-07-01',
      sid: '',
      name: '',
      topic: '인플레이션 기사',
      note: '읽고 정리',
      done: false,
      doneDs: '',
    },
    { id: 'b2', ds: '2026-07-01', sid: '', name: '', topic: '  ', note: '', done: false, doneDs: '' }, // 빈 주제 — 제외
  ];
  return s;
}

describe('buildCorpus — 상태 → 임베딩 코퍼스', () => {
  it('챕터·요약·독후감·백로그를 모으고 빈 것은 건너뛴다', () => {
    const reads: ReadsLocal = {
      work: {},
      books: [
        {
          id: 'bk1',
          title: '사피엔스',
          author: '유발 하라리',
          status: 'done',
          review: '인류사 통찰',
          rating: 5,
          startedAt: '',
          finishedAt: null,
        },
        {
          id: 'bk2',
          title: '빈 독후감',
          author: '',
          status: 'reading',
          review: '',
          rating: 0,
          startedAt: '',
          finishedAt: null,
        },
      ],
    };
    const corpus = buildCorpus(seedState(), reads);
    const ids = corpus.map((e) => e.id);
    expect(ids).toContain('ch:i1:c1');
    expect(ids).not.toContain('ch:i1:c2'); // 이름 없는 챕터
    expect(ids).not.toContain('ch:i2:c3'); // 과목명 없는 항목
    expect(ids).toContain('sum:2026-07-01:s1');
    expect(ids).toContain('book:bk1');
    expect(ids).not.toContain('book:bk2'); // 독후감 없음
    expect(ids).toContain('bl:b1');
    expect(ids).not.toContain('bl:b2'); // 빈 주제
    // 라벨·이동 라우트가 팔레트에서 쓸 수 있는 형태인지
    const ch = corpus.find((e) => e.id === 'ch:i1:c1')!;
    expect(ch.label).toBe('전자기학 — 맥스웰 방정식');
    // 챕터 히트는 지식맵이 아니라 **소속 과목 카드**로 앵커링한다(contentSearch 와 같은 목적지).
    expect(ch.to).toBe('/items?focus=i1');
  });
  it('reads가 null이어도 동작한다', () => {
    expect(() => buildCorpus(seedState(), null)).not.toThrow();
  });
});

describe('crossChapterEdges — 지식맵 자동 연결(과목 경계만)', () => {
  const chs = [
    { itemId: 'A', chapterId: 'a1', vec: [1, 0] },
    { itemId: 'A', chapterId: 'a2', vec: [1, 0.01] }, // 같은 과목 — 아무리 유사해도 제외
    { itemId: 'B', chapterId: 'b1', vec: [0.95, 0.05] },
    { itemId: 'C', chapterId: 'c1', vec: [0, 1] }, // 직교 — 임계 미달
  ];
  it('같은 과목 쌍은 제외, 임계 이상만, 유사도 내림차순', () => {
    const edges = crossChapterEdges(chs, 0.62, 24);
    expect(edges.every((e) => !(e.source.startsWith('a') && e.target.startsWith('a')))).toBe(true);
    expect(edges.some((e) => e.source === 'a1' && e.target === 'b1')).toBe(true);
    expect(edges.some((e) => e.target === 'c1' || e.source === 'c1')).toBe(false);
    for (let i = 1; i < edges.length; i++) expect(edges[i - 1]!.sim).toBeGreaterThanOrEqual(edges[i]!.sim);
  });
  it('maxEdges로 캡한다', () => {
    expect(crossChapterEdges(chs, 0.1, 1)).toHaveLength(1);
  });
  it('입력 2개 미만이면 빈 배열', () => {
    expect(crossChapterEdges([{ itemId: 'A', chapterId: 'a1', vec: [1, 0] }])).toEqual([]);
  });
});

describe('vectorsFor — 모델 변경 시 spurious null 없음(L-11)', () => {
  it('모델이 바뀌면 기캐시 텍스트도 전량 재임베딩해 null이 섞이지 않는다', async () => {
    mockModel = 'model-A';
    const r1 = await vectorsFor(['x', 'y']); // 모델 A로 x·y 캐시
    expect(r1).not.toBeNull();
    expect(r1!.every((v) => v !== null)).toBe(true);

    mockModel = 'model-B'; // 임베딩 모델 교체
    const r2 = await vectorsFor(['x', 'z']); // x는 옛 모델 캐시·z는 신규 — 모델 변경 → 전량 재계산
    expect(r2).not.toBeNull();
    expect(r2).toHaveLength(2);
    expect(r2!.every((v) => v !== null)).toBe(true); // 옛 버그: x가 캐시삭제로 null 반환
  });
});
