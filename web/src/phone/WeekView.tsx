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
        const done = all.length - open.length;
        /* ⚠ 버튼의 접근 이름을 **문장으로** 짠다. 안 그러면 SR 이 "7월 24일 · 일정 2 · 할 일 3
           슬래시 5" 처럼 파편으로 읽고, 빈 날의 `—`(아래)는 의미 없는 문자로 읽힌다 — 조망이
           목적인 화면인데 음성으론 조망이 안 된다. 시각 텍스트는 그대로 두고 이름만 보강한다. */
        const label =
          `${fmt(parseISO(d))}${d === today ? ', 오늘' : ''}` +
          (events.length > 0 ? `, 일정 ${events.length}개` : '') +
          (all.length > 0 ? `, 할 일 ${done}/${all.length} 완료` : ', 할 일 없음');
        return (
          <button
            key={d}
            type="button"
            onClick={() => onPick(d)}
            aria-current={d === today ? 'date' : undefined}
            aria-label={label}
            className={`flex min-h-14 items-center justify-between gap-3 rounded-md border border-line bg-panel px-3 py-2 text-left ${
              d === today ? 'border-acc' : ''
            }`}
          >
            {/* 시각 텍스트는 aria-hidden — 접근 이름은 위 문장형 aria-label 이 소유한다(중복 방지). */}
            <span className={`text-sm ${d === today ? 'font-semibold text-acc' : 'text-txt'}`} aria-hidden="true">
              {fmt(parseISO(d))}
            </span>
            <span className="flex items-center gap-3 text-xs text-mut tabular-nums" aria-hidden="true">
              {events.length > 0 ? <span>일정 {events.length}</span> : null}
              {all.length > 0 ? (
                <span>
                  할 일 {done}/{all.length}
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
