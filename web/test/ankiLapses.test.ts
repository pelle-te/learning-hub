/* ============================================================
   ankiLapses.test.ts — T-19 Anki 카드 → 챕터 접합.

   ⚠ 여기서 특히 잠그는 것 셋:
   - **최댓값이지 합계가 아니다.** 합계면 카드를 많이 만든 챕터가 자동으로 "가장 위험"이 된다 —
     재려던 것은 *가장 안 붙는 것*이지 *카드가 많은 것*이 아니다.
   - **조인이 노트 id 로 이뤄진다.** `lapses` 는 카드 속성, `tags` 는 노트 속성이라 이 조인이
     없으면 수를 지어내야 한다(그러면 화면의 "5회 무너짐"이 거짓이 된다).
   - **태그 형식이 아니면 버린다.** 남의 태그를 우리 과목으로 읽으면 조용히 틀린 목록이 된다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { LAPSE_MIN, foldLapses, joinCardsToTags, parseTag } from '@/lib/ankiLapses';

describe('parseTag', () => {
  it('과목·챕터를 가른다', () => {
    expect(parseTag('요약::회로이론::3장')).toEqual({ subject: '회로이론', chapter: '3장' });
    expect(parseTag('요약::회로이론')).toEqual({ subject: '회로이론', chapter: null });
  });
  it('우리 태그가 아니면 null — 남의 태그를 과목으로 읽지 않는다', () => {
    expect(parseTag('marked')).toBeNull();
    expect(parseTag('leech::x')).toBeNull();
    expect(parseTag('요약')).toBeNull();
  });
});

describe('foldLapses', () => {
  it('문턱 미만은 버린다 — 1~2회는 정상 학습 곡선이지 신호가 아니다', () => {
    expect(foldLapses([{ tags: ['요약::A::1장'], lapses: LAPSE_MIN - 1 }])).toEqual([]);
  });
  it('같은 챕터는 **최댓값**으로 접는다(합계가 아니다)', () => {
    const rows = foldLapses([
      { tags: ['요약::A::1장'], lapses: 3 },
      { tags: ['요약::A::1장'], lapses: 7 },
      { tags: ['요약::A::1장'], lapses: 4 },
    ]);
    expect(rows).toEqual([{ subject: 'A', chapter: '1장', lapses: 7 }]); // 14 가 아니다
  });
  it('가장 많이 무너진 것부터 준다', () => {
    const rows = foldLapses([
      { tags: ['요약::A::1장'], lapses: 3 },
      { tags: ['요약::B::2장'], lapses: 9 },
    ]);
    expect(rows.map((r) => r.chapter)).toEqual(['2장', '1장']);
  });
  it('한 카드에 태그가 여럿이면 각각 센다', () => {
    const rows = foldLapses([{ tags: ['요약::A::1장', '요약::B::2장', 'marked'], lapses: 5 }]);
    expect(rows).toHaveLength(2);
  });
});

describe('joinCardsToTags', () => {
  it('노트 id 로 붙인다 — 이 조인이 없으면 수를 지어내야 한다', () => {
    const out = joinCardsToTags(
      [
        { note: 1, lapses: 5 },
        { note: 2, lapses: 3 },
      ],
      [
        { noteId: 1, tags: ['요약::A::1장'] },
        { noteId: 2, tags: ['요약::A::2장'] },
      ],
    );
    expect(out).toEqual([
      { tags: ['요약::A::1장'], lapses: 5 },
      { tags: ['요약::A::2장'], lapses: 3 },
    ]);
  });
  it('짝을 못 찾은 카드는 빈 태그 — 조용히 사라지지 않는다', () => {
    expect(joinCardsToTags([{ note: 9, lapses: 4 }], [])).toEqual([{ tags: [], lapses: 4 }]);
  });
  it('노트 id 없는 카드는 뺀다', () => {
    expect(joinCardsToTags([{ lapses: 4 }], [])).toEqual([]);
  });
});
