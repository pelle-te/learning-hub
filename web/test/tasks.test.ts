import { describe, expect, it } from 'vitest';
import { defaults } from '@/lib/persistence';
import {
  addTask,
  updateTask,
  removeTask,
  toggleTaskDone,
  placeTask,
  unplaceTask,
  tasksForDay,
  untimedTasksForDay,
  timedTasksForDay,
  openTasksForDay,
  inboxTasks,
} from '@/lib/tasks';
import type { AppState } from '@/lib/types';

// _today 시드로 doneDs 결정론화(앱의 '오늘' 단일 출처).
const seed = (): AppState => ({ ...defaults(), _today: '2026-06-23' }) as AppState;

describe('tasks — 자유 할 일 CRUD·선택자(§4-4)', () => {
  it('addTask: id·at 부여 + tasks 지연 초기화(무마이그레이션)', () => {
    const s = seed();
    expect(s.tasks).toBeUndefined(); // 옵셔널 — 첫 쓰기 전엔 없음
    const t = addTask(s, { title: '과제 제출', ds: '2026-06-23', min: 30 });
    expect(t.id).toBeTruthy();
    expect(typeof t.at).toBe('number');
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks![0]!.title).toBe('과제 제출');
  });

  it('updateTask/removeTask', () => {
    const s = seed();
    const t = addTask(s, { title: 'A' });
    updateTask(s, t.id, { title: 'A2', sid: 's1' });
    expect(s.tasks![0]!.title).toBe('A2');
    expect(s.tasks![0]!.sid).toBe('s1');
    removeTask(s, t.id);
    expect(s.tasks).toHaveLength(0);
  });

  it('toggleTaskDone: done + doneDs(오늘) / 되돌리기', () => {
    const s = seed();
    const t = addTask(s, { title: 'B', ds: '2026-06-23' });
    toggleTaskDone(s, t.id, true);
    expect(s.tasks![0]!.done).toBe(true);
    expect(s.tasks![0]!.doneDs).toBe('2026-06-23');
    toggleTaskDone(s, t.id, false);
    expect(s.tasks![0]!.done).toBe(false);
    expect(s.tasks![0]!.doneDs).toBeUndefined();
  });

  it('placeTask/unplaceTask: 트레이 ↔ 타임박스', () => {
    const s = seed();
    const t = addTask(s, { title: 'C', ds: '2026-06-23' });
    expect(untimedTasksForDay(s, '2026-06-23')).toHaveLength(1);
    placeTask(s, t.id, '2026-06-23', 600);
    expect(s.tasks![0]!.start).toBe(600);
    expect(timedTasksForDay(s, '2026-06-23')).toHaveLength(1);
    expect(untimedTasksForDay(s, '2026-06-23')).toHaveLength(0); // 시각 부여 → 트레이서 이탈
    unplaceTask(s, t.id);
    expect(s.tasks![0]!.start).toBeUndefined();
    expect(untimedTasksForDay(s, '2026-06-23')).toHaveLength(1); // 미지정 복귀
  });

  it('선택자: tasksForDay·openTasksForDay·inboxTasks', () => {
    const s = seed();
    addTask(s, { title: 'day', ds: '2026-06-23' });
    addTask(s, { title: 'done', ds: '2026-06-23', done: true });
    addTask(s, { title: 'someday' }); // ds 없음 = 인박스
    expect(tasksForDay(s, '2026-06-23')).toHaveLength(2);
    expect(openTasksForDay(s, '2026-06-23')).toHaveLength(1); // 미완만
    expect(inboxTasks(s)).toHaveLength(1);
  });
});
