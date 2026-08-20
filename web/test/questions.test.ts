/* ============================================================
   questions.test.ts — T-7 문항 원장 · T-2 시험 회수 창.

   ⚠ 여기서 특히 잠그는 것 넷:
   - **`chapterHotspots` 는 2건부터다.** 이게 T-7 이 값을 내는지의 판정 장치이고(그 항목의
     "반나절 검증"이 문자 그대로 _"2개+ 같은 챕터면 참"_ 이었다) 1건도 세면 판정이 무의미해진다.
   - **회수 창은 미래 시험에 안 열리고, 짧다.** 길면 "직후의 기억"이라는 유일한 근거가 사라져
     T-7 과 구분되지 않는다.
   - **빈 문제는 안 들어간다.** 나머지 셋은 비어도 값이 있지만(챕터만으로 밀집 판정) 문제 자체가
     없으면 다시 풀 수 없다.
   - **시험 범위 밖 문항은 빠지되, 챕터 미기재는 안 빠진다**(어느 시험에도 관련될 수 있다).
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  RECALL_WINDOW_DAYS,
  addQuestion,
  chapterHotspots,
  questionsForExam,
  questionsForSubject,
  recallWindows,
  removeQuestion,
} from '@/lib/questions';
import { examsOf } from '@/lib/semester';
import type { Item, Question } from '@/lib/types';

const q = (over: Partial<Question>): Question =>
  ({ id: over.id || 'q', ds: '2026-08-01', sid: 's', prompt: 'p', ...over }) as Question;
const ch = (id: string) => ({ id, name: id, hours: 1, done: false });
const item = (over: Partial<Item> = {}): Item =>
  ({ id: 's', name: '회로', mode: 'weekly', chapters: [ch('c1'), ch('c2'), ch('c3')], ...over }) as Item;
const st = (questions: Question[], items: Item[] = [item()]) => ({ questions, items }) as unknown as AppState;

describe('chapterHotspots', () => {
  it('2건부터 밀집이다 — 1건은 밀집이 아니다', () => {
    const s = st([
      q({ id: '1', chapter: 'c1' }),
      q({ id: '2', chapter: 'c2' }),
      q({ id: '3', chapter: 'c2' }),
      q({ id: '4', chapter: 'c2' }),
    ]);
    expect(chapterHotspots(s)).toEqual([{ chapter: 'c2', n: 3 }]);
  });
  it('챕터가 안 적힌 문항은 안 센다', () => {
    expect(chapterHotspots(st([q({ id: '1' }), q({ id: '2' })]))).toEqual([]);
  });
  it('과목으로 좁힐 수 있다', () => {
    const s = st([
      q({ id: '1', sid: 's', chapter: 'c1' }),
      q({ id: '2', sid: 's', chapter: 'c1' }),
      q({ id: '3', sid: 'other', chapter: 'c1' }),
    ]);
    expect(chapterHotspots(s, 's')).toEqual([{ chapter: 'c1', n: 2 }]);
    expect(chapterHotspots(s, 'other')).toEqual([]);
  });
});

describe('questionsForSubject', () => {
  it('최신이 먼저다 — 시험 전에 여는 화면이라 최근 것이 위다', () => {
    const s = st([q({ id: 'a', ds: '2026-07-01' }), q({ id: 'b', ds: '2026-08-01' })]);
    expect(questionsForSubject(s, 's').map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('questionsForExam', () => {
  const it_ = item({
    exams: [
      { id: 'e1', kind: 'mid', date: '2026-10-20', thru: 'c2' },
      { id: 'e2', kind: 'final', date: '2026-12-15' },
    ],
  });
  it('그 시험 범위의 챕터만 · 챕터 미기재는 뒤에 붙는다', () => {
    const s = st([q({ id: '1', chapter: 'c1' }), q({ id: '2', chapter: 'c3' }), q({ id: '3' })], [it_]);
    const mid = questionsForExam(s, it_, it_.exams![0]!);
    expect(mid.map((x) => x.id)).toEqual(['1', '3']); // c3 은 기말 범위라 빠진다
  });
});

describe('recallWindows', () => {
  const withExam = (date: string) => item({ exams: [{ id: 'e1', kind: 'mid', date }] });

  it('시험 당일에 열린다', () => {
    const s = st([], [withExam('2026-08-02')]);
    expect(recallWindows(s, '2026-08-02', examsOf)).toHaveLength(1);
  });
  it('미래 시험에는 안 열린다', () => {
    const s = st([], [withExam('2026-08-10')]);
    expect(recallWindows(s, '2026-08-02', examsOf)).toEqual([]);
  });
  it('창을 지나면 닫힌다 — 길면 T-7 과 구분되지 않는다', () => {
    const s = st([], [withExam('2026-08-02')]);
    const after = `2026-08-0${2 + RECALL_WINDOW_DAYS + 1}`;
    expect(recallWindows(s, after, examsOf)).toEqual([]);
  });
  it('그 창에 적은 회수 문항 수를 함께 돌려준다', () => {
    const s = st(
      [q({ id: '1', ds: '2026-08-02', fromRecall: true }), q({ id: '2', ds: '2026-08-02' })],
      [withExam('2026-08-02')],
    );
    expect(recallWindows(s, '2026-08-02', examsOf)[0]!.written).toBe(1); // 회수 표식이 있는 것만
  });
});

describe('뮤테이터', () => {
  it('빈 문제는 안 들어가고 false 를 돌려준다', () => {
    const s = st([]);
    expect(addQuestion(s, q({ prompt: '  ' }))).toBe(false);
    expect(s.questions).toEqual([]);
  });
  it('마지막 문항을 지우면 필드 자체가 사라진다', () => {
    const s = st([q({ id: '1' })]);
    removeQuestion(s, '1');
    expect(s.questions).toBeUndefined();
  });
});
