/* ============================================================
   SemesterGoals — **N-18 이번 학기 목표**(W8 · 2026-08-07). 세 줄 · 각 줄이 수에 묶인다.

   ⚠ **목표 칸이 아니라 바인딩이 이 화면의 값이다.** 자유 텍스트 목표는 메모장이고, 이 앱엔
   이미 그런 자리가 있다(볼트). 여기서만 할 수 있는 것은 *어느 수가 판정하나*를 함께 고르게
   하는 것이고, 그래서 지표 셀렉트가 목표 입력 **옆에** 붙어 있다.
   ⚠ 판정·문구는 `lib/semesterGoals` 가 소유한다 — 화면이 계산하면 학기 말에 두 수가 갈린다.
   ⚠ 학기가 없으면 **아무것도 안 그린다**: 목표는 학기의 속성이라 담을 그릇이 없다.
============================================================ */
import { useApp } from '@/store/useApp';
import { toastUndoable } from '@/shell';
import { Button, NumberField, Pill } from '@/components/ui';
import { GOAL_METRIC, MAX_GOALS, goalStatuses, goalsOf } from '@/lib/semesterGoals';
import { activeSemester } from '@/lib/semester';
import { rid, todayISO } from '@/lib/utils';
import type { GoalMetric, SemesterGoal } from '@/lib/types';

const METRICS = Object.keys(GOAL_METRIC) as GoalMetric[];

export default function SemesterGoals() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const ds = todayISO(state);
  const sem = activeSemester(state, ds);
  if (!sem) return null;

  const goals = goalsOf(sem);
  const rows = goalStatuses(state, sem, ds);
  const editSem = (fn: (list: SemesterGoal[]) => SemesterGoal[]): void =>
    mutate((st) => {
      const s = st.degree.semesters.find((x) => x.id === sem.id);
      if (!s) return;
      const next = fn([...(s.goals || [])]);
      if (next.length) s.goals = next;
      else delete s.goals;
    });

  const add = (): void =>
    editSem((list) => [...list, { id: rid(), text: '', metric: 'hours' as GoalMetric, target: 0 }].slice(0, MAX_GOALS));
  const upd = (id: string, patch: Partial<SemesterGoal>): void =>
    editSem((list) => list.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const del = (id: string): void => {
    editSem((list) => list.filter((g) => g.id !== id));
    toastUndoable('목표 삭제됨');
  };

  return (
    <div className="ds-rule">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="ds-caps">이번 학기 목표 — {sem.name || '학기'}</span>
        {goals.length < MAX_GOALS && (
          <Button sm variant="ghost" onClick={add}>
            + 목표
          </Button>
        )}
      </div>

      {!goals.length ? (
        /* ⚠ 빈 상태가 잔소리가 되지 않게 **왜**를 한 줄로 말한다 — 이 화면의 값이 그 문장이다. */
        <p className="m-0 text-md text-mut">
          목표를 적을 때 <b>앱의 어느 수가 판정할지</b>를 함께 고르면, 학기 말에 기억이 아니라 수가 답합니다.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rows.map(({ goal, current, met, ratio }) => {
            const m = GOAL_METRIC[goal.metric];
            return (
              <li key={goal.id} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={goal.text}
                    onChange={(e) => upd(goal.id, { text: e.target.value })}
                    placeholder="예: 전자기학을 시험 전에 두 번 돌린다"
                    aria-label="목표"
                    className="min-w-40 flex-1"
                  />
                  <select
                    value={goal.metric}
                    onChange={(e) => upd(goal.id, { metric: e.target.value as GoalMetric })}
                    aria-label="판정 지표"
                    title={m.hint}
                  >
                    {METRICS.map((k) => (
                      <option key={k} value={k}>
                        {GOAL_METRIC[k].label}
                      </option>
                    ))}
                  </select>
                  <NumberField
                    min={0}
                    step={goal.metric === 'gpa' ? 0.1 : 1}
                    value={goal.target}
                    onCommit={(v) => upd(goal.id, { target: v })}
                    className="w-20! tabular-nums"
                    aria-label="목표값"
                  />
                  <span className="ds-tiny text-mut">{m.unit}</span>
                  <Button sm variant="ghost" danger onClick={() => del(goal.id)} aria-label="목표 삭제">
                    ✕
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-track-cat">
                    {ratio != null && (
                      <i
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                        className={
                          met
                            ? 'block h-full rounded-full bg-acc shadow-node'
                            : 'block h-full rounded-full bg-track-fill-cat'
                        }
                      />
                    )}
                  </div>
                  {/* ⚠ 모르면 `—` 다(규율 2) — 0 으로 그리면 "목표에서 한참 모자람"이라고 거짓말한다. */}
                  <span className="ds-tiny shrink-0 text-mut tabular-nums">
                    {current == null ? '—' : current} / {goal.target} {m.unit}
                  </span>
                  {met && (
                    <Pill tiny tone="good">
                      달성
                    </Pill>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
