/* ============================================================
   anki.test.ts — Anki 연동의 에러 경로(Vitest). AnkiConnect(미실행·타임아웃·error)와
   폴더 선택(미지원·취소)의 우아한 실패를 검증 — 외부 의존이라 fetch·window를 stub.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ankiConnect, ankiFreshness, fetchAnkiLive, pickAndScanAnki, totalCards, totalDue } from '@/lib/anki';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('totalDue — 순수 합산', () => {
  it('덱들의 new+learn+review를 더한다', () => {
    expect(totalDue([{ name: 'a', new: 2, learn: 3, review: 5, total: 10 }])).toBe(10);
    expect(totalDue([])).toBe(0);
  });
  it('숫자가 아닌 값은 0으로 본다(방어적)', () => {
    expect(totalDue([{ name: 'a', new: undefined as unknown as number, learn: 1, review: 2, total: 3 }])).toBe(3);
  });
});

describe('totalCards — 파일덱 카드 합', () => {
  it('덱들의 cards를 더한다', () => {
    expect(
      totalCards([
        { file: 'a', subj: '수학', cards: 12 },
        { file: 'b', subj: '물리', cards: 8 },
      ]),
    ).toBe(20);
    expect(totalCards([])).toBe(0);
  });
  it('숫자가 아닌 값은 0으로 본다(방어적)', () => {
    expect(totalCards([{ file: 'a', subj: '수학', cards: undefined as unknown as number }])).toBe(0);
  });
});

describe('ankiConnect — 결과/에러/타임아웃', () => {
  it('정상 응답은 result를 반환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ result: ['Default'] }) })),
    );
    await expect(ankiConnect('deckNames')).resolves.toEqual(['Default']);
  });
  it('AnkiConnect가 error를 주면 throw한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ error: 'collection is not available' }) })),
    );
    await expect(ankiConnect('deckNames')).rejects.toThrow('collection is not available');
  });
  it('3초 내 무응답이면 abort로 throw한다(무한대기 방지)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_res, rej) => {
            opts.signal.addEventListener('abort', () =>
              rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      ),
    );
    const p = ankiConnect('deckNames');
    const expectation = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000); // 3초 경과 → setTimeout이 abort
    await expectation;
  });
});

describe('fetchAnkiLive — deckNames→getDeckStats 매핑', () => {
  it('덱 통계를 AnkiDeck 형태로 매핑한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ result: ['수학'] }) }) // deckNames
      .mockResolvedValueOnce({
        json: async () => ({
          result: { 수학: { name: '수학', new_count: 1, learn_count: 2, review_count: 3, total_in_deck: 9 } },
        }),
      }); // getDeckStats
    vi.stubGlobal('fetch', fetchMock);
    const live = await fetchAnkiLive();
    expect(live.decks).toEqual([{ name: '수학', new: 1, learn: 2, review: 3, total: 9 }]);
  });
});

describe('pickAndScanAnki — 폴더 선택 실패 경로', () => {
  it('showDirectoryPicker 미지원 브라우저면 안내와 함께 throw', async () => {
    vi.stubGlobal('window', {}); // picker 없음
    await expect(pickAndScanAnki()).rejects.toThrow('지원하지 않아요');
  });
  it('사용자가 폴더 선택을 취소하면 null을 반환한다', async () => {
    vi.stubGlobal('window', {
      showDirectoryPicker: vi.fn(async () => {
        throw Object.assign(new Error('cancel'), { name: 'AbortError' });
      }),
    });
    await expect(pickAndScanAnki()).resolves.toBeNull();
  });
});

/* ── 신선도 ────────────────────────────────────────────────────────────────
   `_ankiLive` 는 `runtime` 테이블에 살아남는 캐시다. 갱신 경로(`AnkiPanel` 이펙트)는 그
   컴포넌트가 마운트돼 있을 때만 도는데, 표시(오늘 탭 KPI·예보 리드아웃)는 언제나 그린다 —
   갱신은 멈췄는데 표시는 안 멈추는 조합이라 **어제 숫자가 오늘 숫자 행세**를 했다. */
describe('anki — 이 due 가 오늘 것인가', () => {
  const live = (ds?: string) => ({ at: '아무개', ds, decks: [] });

  it('같은 날이면 신선', () => {
    expect(ankiFreshness(live('2026-07-29'), '2026-07-29')).toEqual({ stale: false, label: '오늘 확인함' });
  });

  it('날이 다르면 낡음 — 언제 것인지 함께 말한다', () => {
    expect(ankiFreshness(live('2026-07-28'), '2026-07-29')).toEqual({
      stale: true,
      label: '2026-07-28에 확인한 값이에요',
    });
  });

  it('옛 저장본(ds 없음)은 신선하다고 우기지 않는다 — 모르면 모른다고 말한다', () => {
    expect(ankiFreshness(live(), '2026-07-29')).toEqual({ stale: true, label: '마지막 확인 시각을 몰라요' });
  });

  it('값 자체가 없으면 null — 그건 "낡음"이 아니라 "미연결"이고 화면 문구가 다르다', () => {
    expect(ankiFreshness(null, '2026-07-29')).toBeNull();
  });
});
