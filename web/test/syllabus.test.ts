/* ============================================================
   syllabus.test.ts — T-17 주차 싱크.

   ⚠ 여기서 특히 잠그는 것 둘(둘 다 "조용히 틀린 답"이 되는 자리):
   - **빈 주차는 직전 기록으로 내려간다.** 0 으로 답하면 앱이 "교수가 한 주 쉬었다"고 단정한다.
   - **내 진도 끝은 '끝난 개수-1' 이 아니다.** 이 앱은 건너뛰기(`deferred`)를 1급으로 지원하므로
     개수는 위치를 말하지 못한다.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  clearSyllabusMark,
  myThruIdx,
  setSyllabusMark,
  suggestExamThru,
  syllabusOf,
  syncGap,
  taughtThruIdx,
} from '@/lib/syllabus';
import type { Item } from '@/lib/types';

const ch = (id: string, done = false, deferred = false) => ({ id, name: id, hours: 1, done, deferred });
const item = (over: Partial<Item> = {}): Item =>
  ({ id: 's', name: '회로', mode: 'weekly', chapters: [ch('c1'), ch('c2'), ch('c3'), ch('c4')], ...over }) as Item;

describe('syllabusOf', () => {
  it('주차 오름차순이고 같은 주차는 뒤엣것이 이긴다(마지막 편집이 정본)', () => {
    const it_ = item({
      syllabus: [
        { week: 3, thru: 'c3' },
        { week: 1, thru: 'c1' },
        { week: 3, thru: 'c4' },
      ],
    });
    expect(syllabusOf(it_)).toEqual([
      { week: 1, thru: 'c1' },
      { week: 3, thru: 'c4' },
    ]);
  });
});

describe('taughtThruIdx', () => {
  it('기록이 없는 주차는 직전 기록으로 내려간다 — 0 이 아니다', () => {
    const it_ = item({ syllabus: [{ week: 1, thru: 'c2' }] });
    expect(taughtThruIdx(it_, 1)).toBe(1);
    expect(taughtThruIdx(it_, 2)).toBe(1); // ⚠ 여기가 요지 — "기록 없음"은 "진도 없음"이 아니다
    expect(taughtThruIdx(it_, 9)).toBe(1);
  });
  it('첫 기록보다 앞선 주차는 -1(모른다)', () => {
    expect(taughtThruIdx(item({ syllabus: [{ week: 5, thru: 'c1' }] }), 2)).toBe(-1);
  });
  it('지워진 챕터를 가리키는 점은 없는 것으로 친다 — 판정이 통째로 멈추지 않는다', () => {
    const it_ = item({
      syllabus: [
        { week: 1, thru: 'c2' },
        { week: 2, thru: '지워짐' },
      ],
    });
    expect(taughtThruIdx(it_, 2)).toBe(1);
  });
});

describe('myThruIdx', () => {
  it('건너뛰고 뒤를 먼저 했으면 개수가 아니라 위치로 답한다', () => {
    const it_ = item({ chapters: [ch('c1'), ch('c2'), ch('c3', true), ch('c4')] });
    expect(myThruIdx(it_)).toBe(2); // 끝난 개수는 1 이지만 진도의 끝은 3번째다
  });
  it('하나도 안 끝났으면 -1', () => expect(myThruIdx(item())).toBe(-1));
});

describe('syncGap', () => {
  it('수업이 앞서면 양수 · 내가 앞서면 음수', () => {
    const behind = item({ syllabus: [{ week: 2, thru: 'c3' }], chapters: [ch('c1', true), ch('c2'), ch('c3')] });
    expect(syncGap(behind, 2).gap).toBe(2);
    const ahead = item({
      syllabus: [{ week: 2, thru: 'c1' }],
      chapters: [ch('c1', true), ch('c2', true), ch('c3')],
    });
    expect(syncGap(ahead, 2).gap).toBe(-1);
  });
  it('교수 진도 기록이 없으면 어긋남 0 이고 known=false — 모르는 것을 어긋남이라 안 부른다', () => {
    const g = syncGap(item({ chapters: [ch('c1', true)] }), 3);
    expect(g).toMatchObject({ gap: 0, known: false });
  });
});

describe('suggestExamThru', () => {
  it('그 주차까지 나간 마지막 챕터 id 를 제안한다', () => {
    const it_ = item({
      syllabus: [
        { week: 1, thru: 'c1' },
        { week: 6, thru: 'c3' },
      ],
    });
    expect(suggestExamThru(it_, 7)).toBe('c3');
  });
  it('모르면 null — 지어내지 않는다', () => expect(suggestExamThru(item(), 7)).toBeNull());
});

describe('뮤테이터', () => {
  it('같은 주차는 덮어쓰고 정렬을 유지한다', () => {
    const it_ = item();
    setSyllabusMark(it_, 3, 'c3');
    setSyllabusMark(it_, 1, 'c1');
    setSyllabusMark(it_, 3, 'c4');
    expect(it_.syllabus).toEqual([
      { week: 1, thru: 'c1' },
      { week: 3, thru: 'c4' },
    ]);
  });
  it('마지막 점을 지우면 필드 자체가 사라진다(저장에 빈 배열을 안 남긴다)', () => {
    const it_ = item({ syllabus: [{ week: 1, thru: 'c1' }] });
    clearSyllabusMark(it_, 1);
    expect(it_.syllabus).toBeUndefined();
  });
});
