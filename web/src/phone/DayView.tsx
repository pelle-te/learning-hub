/* ============================================================
   phone/DayView.tsx — 하루: 일정 + 할 일(C-6 · G1 의 "캘린더 일 + 할일 편집").

   ## ⚠ 표시만 새로 짠다 — 규칙은 `lib/` 것을 그대로 쓴다

   설계서 §9-4 의 절충안("하위 컴포넌트만 선별 재사용")은 현 코드에서 성립하지 않았다:
   `DayPlanner`·`WeekCalendar`·`MonthCalendar` 가 props 가 아니라 `useApp` 을 직접 부른다
   (C-6 착수 실측). 그래서 **화면은 새로 짜되 로직은 한 줄도 다시 쓰지 않는다** —
   `tasksForDay`·`toggleTaskDone`·`eventsForDay` 는 전부 `AppState` 를 인자로 받는
   순수 함수라 그대로 온다. 이원화되는 것은 픽셀이지 규칙이 아니다.
============================================================ */
import { useApp } from '@/store/useApp';
import { addTask, removeTask, tasksForDay, toggleTaskDone } from '@/lib/tasks';
import { eventsForDay } from '@/lib/events';
import { colorForId, parseISO, fmt, toHM } from '@/lib/utils';
import { useMemo, useState } from 'react';

export default function DayView({ ds }: { ds: string }): React.JSX.Element {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const [draft, setDraft] = useState('');

  /* ⚠ `draft`(할 일 추가 입력)가 같은 컴포넌트에 있어, memo 가 없으면 **타이핑 매 키마다**
     `eventsForDay`·`tasksForDay` 가 state 배열을 통째로 재순회한다. 데스크톱은 이 부류를
     `store/selectors` 캐시로 막는데(PL-15) 폰엔 그 층이 없다 → 여기서 memo 로 막는다.
     폰 데이터가 작아 체감은 미미하지만 패턴상 명백한 낭비다. */
  const events = useMemo(() => eventsForDay(state, ds), [state, ds]);
  const tasks = useMemo(() => tasksForDay(state, ds), [state, ds]);

  /* 편집 후 동기화 예약은 이제 **전역**이다 — `installSyncTriggers({ onEdit })` 가 `useApp`
     상태 변경을 구독해 `syncSoon` 을 건다(`store/syncController`). 그래서 여기서 화면마다
     따로 부르지 않는다(DayView·WeekView·ReadsView 어디서 편집해도 한 곳이 잡는다). */
  const edit = (recipe: Parameters<typeof mutate>[0]): void => {
    mutate(recipe);
  };

  const add = (e: React.FormEvent): void => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    edit((st) => void addTask(st, { title, ds }));
    setDraft('');
  };

  return (
    <section className="flex flex-col gap-5 p-4">
      <h2 className="text-base font-semibold text-txt">{fmt(parseISO(ds))}</h2>

      {events.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-2xs tracking-wide text-mut uppercase">일정</h3>
          {events.map((ev) => (
            <div key={ev.id} className="flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-2">
              <span className="w-24 shrink-0 text-xs text-mut tabular-nums">
                {toHM(ev.start)}–{toHM(ev.start + ev.min)}
              </span>
              <span className="truncate text-sm text-txt">{ev.title}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-2xs tracking-wide text-mut uppercase">할 일</h3>
        {tasks.length === 0 ? <p className="text-xs text-mut">이 날 할 일이 없어요.</p> : null}
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-2">
            {/* ⚠ 터치 표적은 최소 44px — 체크박스만 키우지 않고 라벨 전체를 표적으로 만든다. */}
            <label className="flex min-h-11 flex-1 items-center gap-3">
              <input
                type="checkbox"
                checked={!!t.done}
                onChange={(e) => edit((st) => toggleTaskDone(st, t.id, e.target.checked))}
                className="size-5 shrink-0"
              />
              <span
                className={`truncate text-sm ${t.done ? 'text-mut line-through' : 'text-txt'}`}
                style={t.sid ? { borderLeft: `3px solid ${colorForId(t.sid)}`, paddingLeft: 8 } : undefined}
              >
                {t.title}
              </span>
            </label>
            <button
              type="button"
              aria-label={`${t.title} 삭제`}
              onClick={() => edit((st) => removeTask(st, t.id))}
              className="min-h-11 px-2 text-xs text-mut"
            >
              삭제
            </button>
          </div>
        ))}

        <form onSubmit={add} className="mt-1 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="할 일 추가"
            aria-label="할 일 추가"
            className="min-h-11 flex-1 rounded-md border border-line bg-panel px-3 text-base text-txt"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="min-h-11 rounded-md bg-acc px-4 text-sm font-medium text-on-acc disabled:opacity-40"
          >
            추가
          </button>
        </form>
      </div>
    </section>
  );
}
