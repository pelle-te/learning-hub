/* ============================================================
   chapterView.test.ts — 챕터 서랍(N-2 첫 조각)이 **반드시 채워지는 것만** 담는지.
   조인 실패로 빈칸이 생길 수 있는 볼트 산출물은 1차에 없다는 것이 이 테스트의 요지다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { chapterSnapshot, riskWord } from '@/lib/chapterView';
import type { AppState, Day, ScheduleItem } from '@/lib/types';

const TODAY = '2026-07-08';
const newIt = (sid: string, chapters: string[]): ScheduleItem => ({
  type: 'new',
  sid,
  name: '물리',
  min: 120,
  chapters,
});
const day = (ds: string, items: ScheduleItem[]): Day =>
  ({ ds, date: new Date(ds + 'T00:00:00'), wd: 0, studyMin: 0, used: 0, modLeft: 0, revLeft: 0, items }) as Day;

const stateOf = (chapters: { name: string; hours: number; done?: boolean; doneDs?: string }[], extra = {}) =>
  ({
    items: [{ id: 'p', name: '물리', chapters: chapters.map((c, i) => ({ id: 'c' + i, ...c, done: !!c.done })) }],
    completions: { [TODAY]: { 'p|new': { done: true, min: 120 } } },
    cbms: [],
    ...extra,
  }) as unknown as AppState;

describe('chapterSnapshot — 앱이 스스로 쓴 값만(조인 실패가 불가능하다)', () => {
  it('진행 중 챕터 — 분량·진행·마지막 인출·오답 수', () => {
    const st = stateOf([{ name: '역학', hours: 3 }], {
      cbms: [
        { id: 'e1', sid: 'p', chapter: '역학', code: 'C' },
        { id: 'e2', sid: 'p', chapter: '열', code: 'B' },
      ],
    });
    const s = chapterSnapshot(st, [day(TODAY, [newIt('p', ['역학'])])], TODAY, 'p', '역학')!;
    expect(s.hours).toBe(3);
    expect(s.done).toBe(false);
    expect(s.lastDs).toBe(TODAY);
    expect(s.daysSince).toBe(0);
    expect(s.cbms).toBe(1); // 다른 챕터 기록은 안 센다
    expect(s.maintenance).toBe(false);
  });

  it('끝낸 챕터 — 유지 큐에서 오고, 끝낸 날을 모르면 모른다고 남는다', () => {
    const st = stateOf([{ name: '역학', hours: 3, done: true }]);
    const s = chapterSnapshot(st, [], TODAY, 'p', '역학')!;
    expect(s.done).toBe(true);
    expect(s.doneDs).toBeNull();
    expect(s.maintenance).toBe(true);
    expect(riskWord(s)).toBe('유지 복습 때'); // 앵커가 없으면 유지 큐가 due 로 잡는다(N-10)
  });

  it('끝낸 날이 있으면 그대로 싣는다(N-10 스탬프)', () => {
    const st = stateOf([{ name: '역학', hours: 3, done: true, doneDs: '2026-07-01' }]);
    expect(chapterSnapshot(st, [], TODAY, 'p', '역학')!.doneDs).toBe('2026-07-01');
  });

  it('카탈로그에 없는 과목·챕터는 null(빈 서랍을 그리지 않는다)', () => {
    const st = stateOf([{ name: '역학', hours: 3 }]);
    expect(chapterSnapshot(st, [], TODAY, 'zzz', '역학')).toBeNull();
    expect(chapterSnapshot(st, [], TODAY, 'p', '없는장')!.hours).toBeNull();
  });

  it('기록이 전혀 없는 챕터는 "기록 없음" — 없는 위험을 지어내지 않는다', () => {
    const st = stateOf([{ name: '열', hours: 2 }]);
    expect(riskWord(chapterSnapshot(st, [], TODAY, 'p', '열')!)).toBe('기록 없음');
  });
});
