/* ============================================================
   taskLoad.test.ts — **N-1 과제 부하가 시간 예산의 1급 시민이 된다**(W8 · 2026-08-07).

   이 파일이 잠그는 명제는 하나다: **과제는 시간을 먹고, 계획은 그 사실을 만들어질 때 안다.**
   7-I4(W2)는 오늘 화면의 *문장*만 고쳤고 계획을 만드는 쪽은 여전히 몰랐다 — 그래서 과제가
   3시간 있는 날의 자동초안은 만들어지는 순간부터 넘쳤다.

   ① 시각이 박힌 과제는 **구간**으로 창에서 빠진다(그 시간에 학습 블록이 안 앉는다).
   ② 시각이 없는 과제는 **총량**으로 빠진다(트레이의 과제가 통째로 안 세어지던 것).
   ③ 수업·수면과 겹치는 과제는 **두 번 안 깎인다**(교집합만 빼는 규율).
   ④ 완료한 과제·소요를 안 적은 과제는 **안 깎는다**(추측으로 창을 줄이지 않는다).
   ⑤ 부하 시뮬의 예산은 **2단**이고, 비율은 두 단의 합으로 판정한다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { dayStudyMin, freeWindowsForDay, studyMinByWeekday } from '@/lib/scheduler';
import { simulateSemester } from '@/lib/semesterEntry';
import { taskIntervals, untimedChoreMin } from '@/lib/tasks';
import { defaults } from '@/lib/persistence';
import type { Task } from '@/lib/types';
import type { AppState } from '@/lib/schema';

/** 2026-08-07 은 금요일(wd=5). */
const DS = '2026-08-07';
const WD = 5;

function base(tasks: Task[] = []): AppState {
  const s = defaults();
  s.routine = [
    { id: 'sleep', name: '수면', type: '수면', start: '00:00', end: '08:00', days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'sleep2', name: '수면', type: '수면', start: '23:00', end: '24:00', days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'cls', name: '수업', type: '수업', start: '09:00', end: '11:00', days: [5] },
  ];
  s.tasks = tasks;
  return s;
}
const task = (p: Partial<Task>): Task => ({ id: p.id || 't', title: '과제', ds: DS, ...p });

describe('N-1 — 과제가 창을 깎는다', () => {
  it('① 시각이 박힌 과제는 구간으로 빠진다', () => {
    const plain = freeWindowsForDay(base(), DS, WD);
    const withTask = freeWindowsForDay(base([task({ start: 13 * 60, min: 120 })]), DS, WD);
    expect(withTask.freeMin).toBe(plain.freeMin - 120);
    // 창이 그 구간에서 쪼개진다 — 13:00~15:00 을 덮는 창이 없어야 한다.
    expect(withTask.windows.some((w) => w.s < 15 * 60 && w.e > 13 * 60)).toBe(false);
  });

  it('② 시각이 없는 과제는 총량으로 빠진다(창 산술엔 안 잡힌다)', () => {
    const s = base([task({ min: 90 })]);
    expect(taskIntervals(s, DS)).toEqual([]); // 구간이 없다
    expect(untimedChoreMin(s, DS)).toBe(90);
    const capWd = studyMinByWeekday(s);
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(dayStudyMin(base(), DS, WD, studyMinByWeekday(base())) - 90);
  });

  it('③ 수업과 겹치게 적은 과제는 두 번 깎이지 않는다', () => {
    // 09:00~11:00 은 수업이라 애초에 공부 창이 아니다 → 추가 차감 0.
    const s = base([task({ start: 9 * 60, min: 120 })]);
    expect(dayStudyMin(s, DS, WD, studyMinByWeekday(s))).toBe(dayStudyMin(base(), DS, WD, studyMinByWeekday(base())));
  });

  it('④ 완료·소요 미기재 과제는 창을 안 깎는다', () => {
    const done = base([task({ id: 'a', start: 13 * 60, min: 120, done: true })]);
    const noMin = base([task({ id: 'b', start: 13 * 60 })]);
    const plain = dayStudyMin(base(), DS, WD, studyMinByWeekday(base()));
    expect(dayStudyMin(done, DS, WD, studyMinByWeekday(done))).toBe(plain);
    expect(dayStudyMin(noMin, DS, WD, studyMinByWeekday(noMin))).toBe(plain);
  });

  it('⑤ 오버라이드가 있는 날도 똑같이 깎인다(선언은 "공부 가능 시간"이지 과제 포함 총량이 아니다)', () => {
    const s = base([task({ min: 60 })]);
    s.dayOverrides = { [DS]: 4 };
    expect(dayStudyMin(s, DS, WD, studyMinByWeekday(s))).toBe(4 * 60 - 60);
  });
});

describe('N-1 — 부하 시뮬의 예산은 2단이다', () => {
  it('과제 시간은 진도와 따로 세고, 비율은 둘의 합으로 판정한다', () => {
    const s = base();
    s.items = [
      {
        id: 'i1',
        name: '신호',
        mode: 'weekly',
        chapters: [{ id: 'c1', name: '1장', hours: 30, done: false }],
        choreWeeklyH: 3,
      },
    ];
    s.degree.semesters = [
      {
        id: 's1',
        name: '2026-2',
        startDs: '2026-09-01',
        endDs: '2026-12-15',
        courses: [{ id: 'c', name: '신호', credits: 3, category: '전공선택', status: '수강중', itemId: 'i1' }],
      },
    ];
    const sim = simulateSemester(s, s.degree.semesters[0]!, DS);
    expect(sim.totalH).toBe(30);
    expect(sim.choreWeeklyH).toBe(3);
    // 비율의 분자 = 주당 진도 + 주당 과제. 과제를 빼면 매주 틀리는 수가 된다.
    expect(sim.ratio).toBeCloseTo(Math.round(((sim.weeklyH + 3) / sim.capacityH) * 100) / 100, 5);
  });
});
