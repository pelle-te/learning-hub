/* ============================================================
   phone/WeekView.tsx — 한 주 조망(C-6 · G1 의 "캘린더 주").

   폰에서 주 뷰의 목적은 **시간표를 그리는 것이 아니라 "어느 날이 무거운가"를 보는 것**이다.
   데스크톱 `WeekCalendar`(367줄)는 시각 격자에 블록을 좌표로 놓는데, 그건 폭 900px 이상을
   전제한 표현이라 폰에서 그대로 축소하면 아무것도 안 읽힌다. 그래서 **행 7개 요약**으로
   바꾼다 — 같은 데이터, 폰에 맞는 표현.

   ⚠ 이게 표시 이원화의 실제 내용이다. 규칙(`tasksForDay`·`eventsForDay`)은 공유하고
   좌표 계산만 안 가져온다.
============================================================ */
import { useApp } from '@/store/useApp';
import { openTasksForDay, tasksForDay } from '@/lib/tasks';
import { eventsForDay } from '@/lib/events';
import { addDays, fmt, iso, mondayOf, parseISO, todayISO } from '@/lib/utils';

export default function WeekView({ ds, onPick }: { ds: string; onPick: (ds: string) => void }): React.JSX.Element {
  const state = useApp((s) => s.state);
  const mon = mondayOf(parseISO(ds));
  const today = todayISO(state);

  return (
    <section className="flex flex-col gap-2 p-4">
      {Array.from({ length: 7 }, (_, i) => iso(addDays(mon, i))).map((d) => {
        const events = eventsForDay(state, d);
        const all = tasksForDay(state, d);
        const open = openTasksForDay(state, d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onPick(d)}
            aria-current={d === today ? 'date' : undefined}
            className={`flex min-h-14 items-center justify-between gap-3 rounded-md border border-line bg-panel px-3 py-2 text-left ${
              d === today ? 'border-acc' : ''
            }`}
          >
            <span className={`text-sm ${d === today ? 'font-semibold text-acc' : 'text-txt'}`}>{fmt(parseISO(d))}</span>
            <span className="flex items-center gap-3 text-xs text-mut tabular-nums">
              {events.length > 0 ? <span>일정 {events.length}</span> : null}
              {all.length > 0 ? (
                <span>
                  할 일 {all.length - open.length}/{all.length}
                </span>
              ) : (
                <span className="opacity-50">—</span>
              )}
            </span>
          </button>
        );
      })}
    </section>
  );
}
