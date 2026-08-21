/* ============================================================
   ankiReviewed.test.ts — **밖에서 이미 일어난 학습을 받는 입구**(I002 · 2026-08-22 발상 축).

   이 앱은 Anki 를 «몇 장 남았나»(due)로만 읽었다. 그런데 실 DB 실측에서 학습 표가 전부 0행
   이었다 — 사람은 공부를 했는데 **도달 경로가 없었다.** Anki 는 «오늘 몇 장 했나»를 이미 알고,
   `ankiReviewedBetween`(T-11)이 그 총량을 부르고 있었다. **없던 것은 귀속**이다.

   ⚠ 여기서 잠그는 것:
   ① 덱 → 과목 귀속이 `dueBySubject` 와 **같은 규칙**을 쓴다(갈리면 같은 덱의 due 와 완료가
      서로 다른 과목에 붙고, 그건 조용하다)
   ② **못 물어보면 `null` 이고 0 이 아니다** — Anki 가 꺼진 것과 «오늘 한 장도 안 했다»는
      완전히 다른 사실이다(`ankiLapses` 의 `unavailable` 규율)
   ③ 귀속 안 된 카드를 **숨기지 않는다** — 합계가 안 맞아야 매칭이 틀렸다는 것을 안다
   ④ 오늘 한 게 없으면 빈 결과이되 `null` 이 아니다(«물어봤고 0이었다»)
============================================================ */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({
  log: [] as { action: string; params: Record<string, unknown> }[],
  reply: {} as Record<string, unknown>,
}));
vi.mock('@/lib/tauri', () => ({
  isTauri: (): boolean => true,
  shellAnkiConnect: (action: string, params: Record<string, unknown>) => {
    calls.log.push({ action, params });
    /* ⚠ 셸 경로의 계약은 `{error?, result?}` 다 — `ankiConnect` 가 `j.result` 를 꺼낸다.
       목이 날것을 돌려주면 «응답이 배열이 아니다» 로 읽혀 이 파일 전체가 거짓 통과한다. */
    const r = calls.reply[action];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve({ result: r });
  },
}));

import { ankiReviewedTodayBySubject, ankiDidToday } from '@/lib/anki';

const ITEMS = [
  { id: 's1', name: '회로이론' },
  { id: 's2', name: '전자기학' },
];

beforeEach(() => {
  calls.log.length = 0;
  calls.reply = {};
});

describe('ankiReviewedTodayBySubject — 오늘 실제로 한 것', () => {
  it('⭐ 덱 이름으로 과목에 귀속한다', async () => {
    calls.reply = {
      findCards: [1, 2, 3],
      cardsInfo: [{ deckName: '회로이론::3장' }, { deckName: '회로이론' }, { deckName: '전자기학' }],
    };
    const r = await ankiReviewedTodayBySubject(ITEMS);
    expect(r?.rows).toEqual([
      { sid: 's1', name: '회로이론', n: 2 },
      { sid: 's2', name: '전자기학', n: 1 },
    ]);
    expect(r?.total).toBe(3);
  });

  it('⚠ 오늘 답한 것만 묻는다 — Anki 의 하루 경계를 다시 정의하지 않는다', async () => {
    calls.reply = { findCards: [], cardsInfo: [] };
    await ankiReviewedTodayBySubject(ITEMS);
    expect(calls.log[0]).toEqual({ action: 'findCards', params: { query: 'rated:1' } });
  });

  it('⚠ 귀속 안 된 카드를 숨기지 않는다 — 합계가 안 맞아야 매칭이 틀린 걸 안다', async () => {
    calls.reply = { findCards: [1, 2], cardsInfo: [{ deckName: '회로이론' }, { deckName: '일본어' }] };
    const r = await ankiReviewedTodayBySubject(ITEMS);
    expect(r?.unmatched).toBe(1);
    expect(r?.total).toBe(2);
  });

  it('⚠⚠ 못 물어보면 null 이다 — 「Anki 꺼짐」과 「한 장도 안 했다」는 다른 사실이다', async () => {
    calls.reply = { findCards: new Error('연결 실패') };
    expect(await ankiReviewedTodayBySubject(ITEMS)).toBeNull();
  });

  it('물어봤고 0이면 빈 결과다(null 이 아니다)', async () => {
    calls.reply = { findCards: [] };
    expect(await ankiReviewedTodayBySubject(ITEMS)).toEqual({ rows: [], unmatched: 0, total: 0 });
  });

  it('응답이 배열이 아니면 null — 계약이 깨진 것을 0 으로 접지 않는다', async () => {
    calls.reply = { findCards: { nope: 1 } };
    expect(await ankiReviewedTodayBySubject(ITEMS)).toBeNull();
  });
});

describe('ankiDidToday — 화면이 「반영」 줄을 그릴지 가르는 술어', () => {
  it('관측이 없으면 0이다(줄을 안 그린다)', () => {
    expect(ankiDidToday(null, 's1')).toBe(0);
  });
  it('그 과목의 수만 돌려준다', () => {
    const r = { rows: [{ sid: 's1', name: '회로이론', n: 7 }], unmatched: 0, total: 7 };
    expect(ankiDidToday(r, 's1')).toBe(7);
    expect(ankiDidToday(r, 's2')).toBe(0);
  });
});
