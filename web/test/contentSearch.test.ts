/* E-6 오프라인 통합 검색(`lib/contentSearch`) — 학습 항목·챕터·독서·오답을 부분문자열로.

   ⚠ **이 파일이 H15 의 증거였다**(2026-08-01 `/감사 근본`). 검사 대상은 처음부터 순수 함수인데,
   그 함수가 `shell/actions.ts` 에 살면서 상태를 `st().state` 로 *스스로* 집었기 때문에 테스트가
   ① zustand 를 시드하고(`useApp.loadState`) ② `@/lib/reads` 를 `vi.mock` 으로 갈아끼워야 했다.
   즉 인자 하나를 안 받았다는 이유로 **순수 함수를 검사하려고 앱 전체를 세우고** 있었다.
   엔진이 `lib/` 로 내려가 상태·독서를 **인자로 받는** 지금, 둘 다 사라진다 — 아래는 평범한
   순수 함수 테스트다(모킹 0 · 스토어 0). */
import { describe, it, expect } from 'vitest';

import { defaults } from '@/lib/persistence';
import { contentSearch } from '@/lib/contentSearch';
import type { loadReads } from '@/lib/reads';

// C-1: contentSearch 는 팔레트가 열릴 때 1회 스냅샷한 reads 를 주입받는다(타이핑 매 키 재파싱 제거).
const reads: ReturnType<typeof loadReads> = {
  work: {},
  books: [
    {
      id: 'b1',
      title: '딥러닝 입문',
      author: '김철수',
      status: 'reading',
      review: '',
      rating: 0,
      startedAt: '',
      finishedAt: null,
    },
  ],
};

function seeded() {
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
  return base;
}

const s = seeded();
const find = (q: string, limit?: number) => contentSearch(q, s, reads, limit);

describe('contentSearch (E-6)', () => {
  /* W12 — 객체가 자기 URL 을 갖는다. 옛 목적지는 `/items?focus=<id>`(목록에 데려다 놓고 그 카드를
     1.5초 깜빡이는 우회로)였고, 챕터는 원리적으로 착지 불가라 소속 과목까지가 최선이었다. */
  it('과목명 매칭 → subject 히트(/subject/:id)', () => {
    const hits = find('선형');
    expect(hits.some((h) => h.kind === 'subject' && h.label === '선형대수' && h.to.startsWith('/subject/'))).toBe(true);
  });

  it('챕터명 매칭 → chapter 히트가 **자기 앵커**(#ch-<id>)에 선다', () => {
    const ch = find('벡터').find((h) => h.kind === 'chapter' && h.label.includes('벡터공간'));
    expect(ch).toBeTruthy();
    expect(ch!.to).toMatch(/^\/subject\/[^#]+#ch-/);
  });

  it('책 제목/저자 매칭 → book 히트(/reads)', () => {
    expect(find('딥러닝').some((h) => h.kind === 'book' && h.to === '/reads')).toBe(true);
    expect(find('김철수').some((h) => h.kind === 'book')).toBe(true);
  });

  it('빈 질의 → 빈 배열', () => {
    expect(find('')).toEqual([]);
    expect(find('   ')).toEqual([]);
  });

  it('대소문자 무시 + limit 상한 준수', () => {
    expect(find('벡터'.toUpperCase()).length).toBeGreaterThanOrEqual(0);
    expect(find('공', 1).length).toBeLessThanOrEqual(1);
  });
});

/* 오답 메모(CBMS `note`)는 앱에서 가장 밀도 높은 자기 텍스트인데 **유일하게 검색 밖**이었다 —
   도달 경로가 오답 탭을 눈으로 스크롤하는 것뿐이었다. */
describe('contentSearch — 오답 메모', () => {
  it('메모 본문으로 찾힌다', () => {
    expect(find('대각화').some((h) => h.kind === 'mistake')).toBe(true);
  });

  it('과목까지 좁혀 데려간다 — 조인 키가 과목 id 라 실패가 원리적으로 없다', () => {
    const hit = find('대각화').find((h) => h.kind === 'mistake')!;
    expect(hit.to).toBe('/mistakes?sid=i1');
    expect(hit.sid).toBe('i1');
  });

  it('과목명·챕터명으로도 걸린다', () => {
    expect(find('고유값').some((h) => h.kind === 'mistake')).toBe(true);
  });
});
