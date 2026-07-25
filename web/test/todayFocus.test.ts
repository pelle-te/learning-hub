/* ============================================================
   todayFocus.test.ts — '지금 뭘 하지'의 **단일 규칙**(D-5).

   ⚠ 옛 이름은 `pickTodayFocus`(lib/todayFocus.ts)였다. 같은 질문에 답이 둘이었고
   (데스크톱=시간대 · 폰=마감·진도 가중) **이유를 표시하는 건 폰뿐**이었다 — 작은 화면이
   큰 화면보다 나은 답을 주고 있었다. 규칙은 `focusState.pickFocus` 로 흡수됐고, 옛 폰 규칙은
   **시각이 없는 블록끼리의 정렬 기준**으로 살아남는다(아래 케이스가 그것을 잠근다).

   시각이 박힌 블록에는 시간이 이긴다 — 9시 블록을 12시에 하라고 말하면 계획을 배신한다.
============================================================ */
import { describe, it, expect } from 'vitest';
import { pickFocus, type FocusEntry } from '@/lib/focusState';
import type { ItemStat, ScheduleItem } from '@/lib/types';

const TODAY = '2026-07-24';
const block = (sid: string, min: number): ScheduleItem => ({ type: 'new', sid, name: sid, min });
/** 시각 없는 후보(폰·미배치 블록) — 급함 정렬이 실제로 갈리는 자리. */
const loose = (sid: string, min: number): FocusEntry => ({ it: block(sid, min), start: null, end: null, done: false });
/** 시각이 박힌 후보(배치된 날). */
const timed = (sid: string, start: number, min = 60): FocusEntry => ({
  it: block(sid, min),
  start,
  end: start + min,
  done: false,
});
const stat = (id: string, over: Partial<ItemStat> = {}): ItemStat => ({ id, name: id, schedH: 1, ...over });

describe('pickFocus — 시각이 없는 후보끼리는 급한 것이 이긴다(옛 pickTodayFocus 규칙)', () => {
  it('후보가 없으면 focus 도 이유도 없다', () => {
    const p = pickFocus([], 0, [], TODAY);
    expect(p.focus).toBeNull();
    expect(p.reason).toBe('');
  });

  it('마감 임박 과목이 큰 블록을 이긴다', () => {
    const p = pickFocus(
      [loose('big', 120), loose('urgent', 30)],
      0,
      [stat('urgent', { deadline: '2026-07-27' })],
      TODAY,
    );
    expect(p.focus?.it.sid).toBe('urgent');
    expect(p.reason).toContain('마감');
  });

  it('더 가까운 마감이 더 먼 마감을 이긴다', () => {
    const stats = [stat('far', { deadline: '2026-07-30' }), stat('near', { deadline: '2026-07-25' })];
    expect(pickFocus([loose('far', 60), loose('near', 60)], 0, stats, TODAY).focus?.it.sid).toBe('near');
  });

  it('마감 없으면 진도 밀림이 크기를 이긴다', () => {
    const p = pickFocus([loose('big', 120), loose('behind', 30)], 0, [stat('behind', { late: 5 })], TODAY);
    expect(p.focus?.it.sid).toBe('behind');
    expect(p.reason).toBe('진도 밀림');
  });

  it('마감·밀림 없으면 가장 큰 블록', () => {
    const p = pickFocus([loose('small', 20), loose('big', 90)], 0, [], TODAY);
    expect(p.focus?.it.sid).toBe('big');
    expect(p.reason).toBe('오늘 가장 큰 학습');
  });

  it('완료된 과목의 마감은 무시한다', () => {
    const stats = [stat('done', { deadline: '2026-07-25', finished: true })];
    expect(pickFocus([loose('done', 30), loose('big', 90)], 0, stats, TODAY).focus?.it.sid).toBe('big');
  });

  it('이미 해낸 블록은 후보가 아니다', () => {
    const done = { ...loose('urgent', 30), done: true };
    const p = pickFocus([done, loose('rest', 30)], 0, [stat('urgent', { deadline: '2026-07-25' })], TODAY);
    expect(p.focus?.it.sid).toBe('rest');
  });
});

describe('pickFocus — 시각이 박힌 날에는 시간이 이긴다(계획을 배신하지 않는다)', () => {
  it('지금 시간대의 블록이 급한 블록을 이긴다', () => {
    const now = 10 * 60 + 30;
    const stats = [stat('urgent', { deadline: '2026-07-25' })];
    const p = pickFocus([timed('now', 10 * 60), timed('urgent', 15 * 60)], now, stats, TODAY);
    expect(p.focus?.it.sid).toBe('now');
    expect(p.reason).toBe('지금 시간대');
  });

  it('진행 중이 없으면 다음 예정 — 이유는 급함이 있으면 그것을 말한다', () => {
    const stats = [stat('later', { deadline: '2026-07-25' })];
    const p = pickFocus([timed('later', 15 * 60)], 9 * 60, stats, TODAY);
    expect(p.focus?.it.sid).toBe('later');
    expect(p.reason).toContain('마감'); // 시간 위치보다 급함이 더 나은 설명일 때
  });

  it('stat 없이도 옛 호출부처럼 동작한다(가장 이른 미완료)', () => {
    const p = pickFocus([timed('b', 14 * 60), timed('a', 9 * 60)], 20 * 60);
    expect(p.focus?.it.sid).toBe('a');
    // 예정 시각이 이미 지났다 — 그 사실이 가장 정확한 이유다("가장 큰 학습"이라 하면 거짓말).
    expect(p.reason).toBe('09:00 예정 · 아직 안 함');
  });
});
