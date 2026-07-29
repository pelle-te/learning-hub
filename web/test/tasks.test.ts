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

  it('반복(repeat): 완료 시 다음 occurrence를 spawn(daily=+1·weekly=+7)', () => {
    const s = seed();
    const d = addTask(s, { title: '매일 스트레칭', ds: '2026-06-23', repeat: 'daily', start: 540 });
    toggleTaskDone(s, d.id, true);
    // 원본 완료 + 다음날(06-24) 미완 인스턴스가 생김(시각·반복 승계).
    const next = s.tasks!.filter((t) => t.title === '매일 스트레칭' && !t.done);
    expect(next).toHaveLength(1);
    expect(next[0]!.ds).toBe('2026-06-24');
    expect(next[0]!.start).toBe(540);
    expect(next[0]!.repeat).toBe('daily');

    const w = addTask(s, { title: '도서 반납', ds: '2026-06-23', repeat: 'weekly' });
    toggleTaskDone(s, w.id, true);
    expect(s.tasks!.some((t) => t.title === '도서 반납' && t.ds === '2026-06-30' && !t.done)).toBe(true);
  });

  it('반복 멱등: 같은 날 미완 인스턴스가 이미 있으면 중복 spawn 안 함', () => {
    const s = seed();
    const d = addTask(s, { title: 'X', ds: '2026-06-23', repeat: 'daily' });
    toggleTaskDone(s, d.id, true);
    toggleTaskDone(s, d.id, false);
    toggleTaskDone(s, d.id, true); // 재완료 — 06-24 인스턴스가 이미 있어 중복 생성 안 함
    expect(s.tasks!.filter((t) => t.title === 'X' && t.ds === '2026-06-24')).toHaveLength(1);
  });

  it('비반복 완료는 spawn 없음(회귀)', () => {
    const s = seed();
    const t = addTask(s, { title: '일회성', ds: '2026-06-23' });
    toggleTaskDone(s, t.id, true);
    expect(s.tasks).toHaveLength(1);
  });
});

/* `Task.deadline` 은 스키마·동기화 계약엔 있는데 **쓰기 0·읽기 0** 이라 사용자가 넣을 수도 볼 수도
   없었다(2026-07-29 실측). 배선한 뒤로는 왕복이 계약이다 — 한쪽만 살아 있으면 다른 쪽이 죽는다. */
describe('Task.deadline — 왕복', () => {
  it('updateTask 로 넣은 마감이 그대로 남는다', () => {
    const st = seed();
    const t = addTask(st, { title: '보고서', ds: '2026-07-29' });
    updateTask(st, t.id, { deadline: '2026-08-05' });
    expect(st.tasks.find((x) => x.id === t.id)?.deadline).toBe('2026-08-05');
  });

  it('빈 문자열로 지울 수 있다 — 넣기만 되고 못 지우면 그것도 반쪽이다', () => {
    const st = seed();
    const t = addTask(st, { title: '보고서', ds: '2026-07-29', deadline: '2026-08-05' });
    updateTask(st, t.id, { deadline: '' });
    expect(st.tasks.find((x) => x.id === t.id)?.deadline).toBe('');
  });
});
