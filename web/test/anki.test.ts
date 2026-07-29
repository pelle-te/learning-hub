/* ============================================================
   anki.test.ts — Anki 연동의 에러 경로(Vitest). AnkiConnect(미실행·타임아웃·error)와
   폴더 선택(미지원·취소)의 우아한 실패를 검증 — 외부 의존이라 fetch·window를 stub.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ankiConnect,
  ankiFreshness,
  fetchAnkiLive,
  pickAndScanAnki,
  totalCards,
  totalDue,
  dueBySubject,
} from '@/lib/anki';

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

/* ── E18 과목별 due 분해(2026-07-29) ─────────────────────────────────────
   `totalDue()` 는 전 덱을 한 숫자로 합쳐 "어느 과목이 밀렸나"를 말하지 못했다 — 알려면 Anki 를
   직접 열어야 했다. 매칭 규칙은 `subjectMatch` 가 소유하므로(배분을 구동하는 그 규칙과 같아야
   한다) 여기서 잠그는 것은 **분해와 미연결 처리**다. */
describe('dueBySubject — 덱 due 를 과목에 붙인다', () => {
  const deck = (name: string, due: number) => ({ name, new: due, learn: 0, review: 0, total: due });
  const items = [
    { id: 'em', name: '전자기학' },
    { id: 'ci', name: '회로이론' },
  ];

  it('과목별로 합치고 due 내림차순으로 준다', () => {
    const r = dueBySubject([deck('전자기학', 120), deck('회로이론', 80)], items);
    expect(r.rows.map((x) => [x.sid, x.due])).toEqual([
      ['em', 120],
      ['ci', 80],
    ]);
  });

  it('같은 과목의 여러 덱은 합산된다(Anki 는 덱을 쪼개 쓴다)', () => {
    const r = dueBySubject([deck('전자기학::1장', 30), deck('전자기학::2장', 20)], items);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.due).toBe(50);
  });

  it('⚠ 안 붙는 덱을 **조용히 흡수하지 않는다** — 합계가 안 맞아야 조인 오류가 보인다', () => {
    const r = dueBySubject([deck('전자기학', 120), deck('일본어', 40), deck('요리', 10)], items);
    expect(r.rows).toHaveLength(1);
    expect(r.unmatchedDecks).toBe(2);
    expect(r.unmatchedDue).toBe(50);
  });

  it('due 0 인 덱은 분해에 안 들어간다 — 있는 것만 말한다', () => {
    const r = dueBySubject([deck('전자기학', 0), deck('일본어', 0)], items);
    expect(r.rows).toHaveLength(0);
    expect(r.unmatchedDecks).toBe(0);
  });

  it('분해 합 + 미연결 합 = totalDue — 어느 카드도 사라지지 않는다', () => {
    const decks = [deck('전자기학', 120), deck('회로이론', 80), deck('일본어', 40)];
    const r = dueBySubject(decks, items);
    const sum = r.rows.reduce((t, x) => t + x.due, 0) + r.unmatchedDue;
    expect(sum).toBe(totalDue(decks));
  });
});
