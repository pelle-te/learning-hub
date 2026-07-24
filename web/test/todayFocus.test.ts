import { describe, it, expect } from 'vitest';
import { pickTodayFocus } from '@/lib/todayFocus';
import type { ItemStat, ScheduleItem } from '@/lib/types';

const block = (sid: string, min: number): ScheduleItem => ({ type: 'new', sid, name: sid, min });
const stat = (id: string, over: Partial<ItemStat> = {}): ItemStat => ({ id, name: id, schedH: 1, ...over });

describe('pickTodayFocus', () => {
  it('블록이 없으면 null', () => {
    expect(pickTodayFocus([], [], '2026-07-24')).toBeNull();
  });

  it('마감 임박 과목이 큰 블록을 이긴다', () => {
    const blocks = [block('big', 120), block('urgent', 30)];
    const stats = [stat('urgent', { deadline: '2026-07-27' })]; // D-3
    const f = pickTodayFocus(blocks, stats, '2026-07-24');
    expect(f?.block.sid).toBe('urgent');
    expect(f?.reason).toContain('마감');
  });

  it('더 가까운 마감이 더 먼 마감을 이긴다', () => {
    const blocks = [block('far', 60), block('near', 60)];
    const stats = [stat('far', { deadline: '2026-07-30' }), stat('near', { deadline: '2026-07-25' })];
    expect(pickTodayFocus(blocks, stats, '2026-07-24')?.block.sid).toBe('near');
  });

  it('마감 없으면 진도 밀림이 크기를 이긴다', () => {
    const blocks = [block('big', 120), block('behind', 30)];
    const stats = [stat('behind', { late: 5 })];
    const f = pickTodayFocus(blocks, stats, '2026-07-24');
    expect(f?.block.sid).toBe('behind');
    expect(f?.reason).toBe('진도 밀림');
  });

  it('마감·밀림 없으면 가장 큰 블록', () => {
    const blocks = [block('small', 20), block('big', 90)];
    const f = pickTodayFocus(blocks, [], '2026-07-24');
    expect(f?.block.sid).toBe('big');
    expect(f?.reason).toBe('오늘 가장 큰 학습');
  });

  it('완료된 과목의 마감은 무시한다', () => {
    const blocks = [block('done', 30), block('big', 90)];
    const stats = [stat('done', { deadline: '2026-07-25', finished: true })];
    // done 의 마감은 finished 라 점수 0 → 큰 블록이 이긴다.
    expect(pickTodayFocus(blocks, stats, '2026-07-24')?.block.sid).toBe('big');
  });
});
