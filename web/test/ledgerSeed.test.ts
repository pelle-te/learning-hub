/* ============================================================
   ledgerSeed.test.ts — 임포트가 세우는 **가짜 백로그**의 교정(W4).
   요지: 후보를 계산만 하고 **자동으로 찍지 않는다**, 그리고 완료 앵커는 오늘이 아니라
   원장이 아는 마지막 관측일이다(오늘로 찍으면 유지 사다리가 34일 동안 통째로 fresh 가 된다).
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  applyCardedDone,
  cardedChapters,
  cardedPrompt,
  ledgerPending,
  pendingCount,
  pendingPrompt,
} from '@/lib/ledgerSeed';
import type { Ledger } from '@/lib/ledger';
import type { Chapter } from '@/lib/types';

const ch = (name: string): Chapter => ({ id: name, name, hours: 5, done: false });
const led = {
  n_chapters: 3,
  subjects: {
    '과학기술과 법': {
      slug: 'stlaw',
      abbr: 'STLAW',
      domain: '인문',
      src: null,
      src_present: true,
      chapters: [
        { arc: '01 법의 가치관', milestones: { carded: true }, reviewed_recent: '2026-07-09' },
        { arc: '02 헌법과 기본권 총론', milestones: { carded: true }, reviewed_recent: null },
        { arc: '03 법률행위와 사적자치', milestones: { carded: false }, reviewed_recent: '2026-07-11' },
      ],
    },
  },
} as unknown as Ledger;

describe('cardedChapters — 원장이 "카드까지 갔다"고 말하는 것만', () => {
  it('carded 마일스톤을 밟은 챕터만 후보다', () => {
    const out = cardedChapters(led, '과학기술과 법', [
      ch('01 법의 가치관'),
      ch('02 헌법과 기본권 총론'),
      ch('03 법률행위와 사적자치'),
    ]);
    expect(out.map((c) => c.name)).toEqual(['01 법의 가치관', '02 헌법과 기본권 총론']);
    expect(out[0]!.reviewedRecent).toBe('2026-07-09');
    expect(out[1]!.reviewedRecent).toBe(''); // null → '' (앵커 모름)
  });

  it('과목 표기가 흔들려도 붙고(subjectMatch), 원장이 없으면 조용히 0건', () => {
    expect(cardedChapters(led, '과학기술과법', [ch('01 법의 가치관')])).toHaveLength(1);
    expect(cardedChapters(undefined, '과학기술과 법', [ch('01 법의 가치관')])).toHaveLength(0);
    expect(cardedChapters(led, '전자기학', [ch('01 법의 가치관')])).toHaveLength(0);
  });

  it('⚠ 챕터는 정확 일치만 — 퍼지 매칭이면 "01 미분"이 "01 미분의 응용"의 앵커를 훔친다', () => {
    expect(cardedChapters(led, '과학기술과 법', [ch('01 법의')])).toHaveLength(0);
  });
});

describe('applyCardedDone — 앵커는 오늘이 아니라 원장이 아는 마지막 관측일', () => {
  it('done 을 찍고 doneDs 는 reviewed_recent, 모르면 비워 둔다', () => {
    const chapters = [ch('01 법의 가치관'), ch('02 헌법과 기본권 총론'), ch('03 법률행위와 사적자치')];
    const n = applyCardedDone(chapters, cardedChapters(led, '과학기술과 법', chapters));
    expect(n).toBe(2);
    expect(chapters[0]).toMatchObject({ done: true, doneDs: '2026-07-09' });
    expect(chapters[1]!.done).toBe(true);
    expect(chapters[1]!.doneDs).toBeUndefined(); // 앵커 모름 = 유지 큐가 due 로 다루고 첫 인출이 교정
    expect(chapters[2]!.done).toBe(false);
  });

  it('이미 done 인 챕터는 세지도 덮지도 않는다(재임포트가 앵커를 깎지 않게)', () => {
    const chapters = [{ ...ch('01 법의 가치관'), done: true, doneDs: '2026-06-01' }];
    expect(applyCardedDone(chapters, cardedChapters(led, '과학기술과 법', chapters))).toBe(0);
    expect(chapters[0]!.doneDs).toBe('2026-06-01');
  });
});

describe('문구 — "카드까지 갔다"이지 "익혔다"가 아님을 말해야 한다', () => {
  it('오해를 막는 문장이 실제로 들어 있다', () => {
    const s = cardedPrompt('과학기술과 법', 30, 49);
    expect(s).toContain('30');
    expect(s).toContain('49');
    expect(s).toContain('익혔다');
  });
});

/* ── I001 — **상시 반영**(2026-08-22 발상 축) ────────────────────────────────────────────
   위 셋은 임포트 순간에만 돌았다. 원장은 그 뒤로도 자라므로 «앱이 뒤처진 만큼»을 언제든
   물을 수 있어야 한다. 여기서 잠그는 것: ① 이미 찍힌 것은 안 센다 ② 0건인 과목은 목록에
   안 넣는다(빈 줄이 상주하면 배경이 된다) ③ 원장에만 있는 과목을 **만들지 않는다**. */
describe('ledgerPending — 앱이 원장보다 뒤처진 만큼', () => {
  const items = (over?: Partial<Chapter>[]) => [
    {
      id: 's1',
      name: '과학기술과 법',
      chapters: [
        { ...ch('01 법의 가치관'), ...(over?.[0] || {}) },
        { ...ch('02 헌법과 기본권 총론'), ...(over?.[1] || {}) },
        { ...ch('03 법률행위와 사적자치'), ...(over?.[2] || {}) },
      ],
    },
  ];

  it('carded 인데 앱에 안 찍힌 것만 — 총수를 함께 센다', () => {
    const p = ledgerPending(led, items());
    expect(p).toHaveLength(1);
    expect(p[0]!.chapters.map((c) => c.name)).toEqual(['01 법의 가치관', '02 헌법과 기본권 총론']);
    expect(pendingCount(p)).toBe(2);
  });

  it('⚠ **이미 찍힌 것은 안 센다** — 안 그러면 반영 뒤에도 같은 수가 계속 남는다', () => {
    const p = ledgerPending(led, items([{ done: true }]));
    expect(p[0]!.chapters.map((c) => c.name)).toEqual(['02 헌법과 기본권 총론']);
  });

  it('⚠ 남은 것이 0이면 그 과목은 **목록에 없다**(빈 줄이 상주하지 않게)', () => {
    expect(ledgerPending(led, items([{ done: true }, { done: true }]))).toEqual([]);
    expect(pendingCount([])).toBe(0);
  });

  it('⚠ 원장에만 있는 과목은 만들지 않는다 · 이름 없는 항목은 건너뛴다 · 원장이 없으면 0건', () => {
    expect(ledgerPending(led, [{ id: 'x', name: '', chapters: [ch('01 법의 가치관')] }])).toEqual([]);
    expect(ledgerPending(led, [{ id: 'x', name: '전자기학', chapters: [ch('01 법의 가치관')] }])).toEqual([]);
    expect(ledgerPending(undefined, items())).toEqual([]);
  });

  it('확인 문구가 **과목별 내역과 「익혔다가 아니다」**를 함께 말한다', () => {
    const t = pendingPrompt(ledgerPending(led, items()));
    expect(t).toContain('2개');
    expect(t).toContain('과학기술과 법 2개');
    expect(t).toContain("'익혔다'는 뜻이 아니에요");
  });
});
