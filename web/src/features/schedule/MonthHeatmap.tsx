/* ============================================================
   MonthHeatmap — 배치 세그먼트 '월' 뷰(계획개편 §6-5). 하루=한 칸 요약.
   색농도=그날 학습량(res.days used) · 마감 플래그 · 미완 할일 점. 날짜 클릭 → 일 뷰 진입.
   순수 파생 read(스케줄러 재계산 없이 useSchedule 결과 + tasks 집계)라 저비용. 6주 그리드(월 시작).
============================================================ */
import { iso, addDays, mondayOf, fmtShort, hLabel } from '@/lib/utils';
import { indexDays } from '@/lib/scheduleView';
import { openTasksForDay } from '@/lib/tasks';
import { Button } from '@/components/ui';
import { useApp } from '@/store/useApp';
import type { ScheduleResult } from '@/lib/types';
import s from './MonthHeatmap.module.css';

const DOW = ['월', '화', '수', '목', '금', '토', '일'];

export function MonthHeatmap({
  anchor,
  res,
  todayIso,
  onPick,
  onNav,
}: {
  anchor: Date;
  res: ScheduleResult;
  todayIso: string;
  onPick: (ds: string) => void;
  onNav: (deltaMonths: number, toToday?: boolean) => void;
}) {
  const state = useApp((st) => st.state);
  const byDs = indexDays(res);
  const y = anchor.getFullYear();
  const mo = anchor.getMonth();
  const first = new Date(y, mo, 1);
  const gridStart = mondayOf(first); // 월요일 시작 6주 격자
  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const ds = iso(date);
    const used = byDs[ds] ? Math.round(byDs[ds]!.used) : 0;
    const deadlines = state.items.filter((it) => it.deadline === ds && it.name).map((it) => it.name);
    const open = openTasksForDay(state, ds).length;
    return { ds, date, inMonth: date.getMonth() === mo, isToday: ds === todayIso, used, deadlines, open };
  });

  // 그 달 최대 학습량으로 정규화(상대 농도) — 데이터 없으면 240분 기준.
  const peak = Math.max(240, ...cells.filter((c) => c.inMonth).map((c) => c.used));
  const monthLabel = `${y}년 ${mo + 1}월`;
  const monthUsedH = cells.filter((c) => c.inMonth).reduce((t, c) => t + c.used, 0) / 60;

  return (
    <section className={s.wrap} aria-label={`${monthLabel} 학습량`}>
      <div className={s.head}>
        <Button sm onClick={() => onNav(-1)} aria-label="이전 달">
          ◀
        </Button>
        <div className={s.title}>
          <b>{monthLabel}</b>
          <span className={s.sub}>이 달 {monthUsedH.toFixed(1)}h</span>
        </div>
        <Button sm onClick={() => onNav(1)} aria-label="다음 달">
          ▶
        </Button>
        <Button sm variant="ghost" onClick={() => onNav(0, true)}>
          오늘
        </Button>
      </div>

      <div className={s.dowRow} aria-hidden="true">
        {DOW.map((d) => (
          <span key={d} className={s.dowCell}>
            {d}
          </span>
        ))}
      </div>

      <div className={s.grid}>
        {cells.map((c) => {
          const alpha = c.used > 0 ? 0.12 + 0.68 * Math.min(1, c.used / peak) : 0;
          return (
            <button
              key={c.ds}
              type="button"
              className={`${s.cell}${c.inMonth ? '' : ' ' + s.out}${c.isToday ? ' ' + s.today : ''}`}
              onClick={() => onPick(c.ds)}
              style={
                alpha
                  ? { ['--fill' as string]: `color-mix(in srgb, var(--acc) ${Math.round(alpha * 100)}%, transparent)` }
                  : undefined
              }
              aria-label={`${fmtShort(c.date)} · 학습 ${hLabel(c.used)}${c.deadlines.length ? ' · 마감 ' + c.deadlines.join(', ') : ''}${c.open ? ` · 미완 할일 ${c.open}` : ''} — 일 뷰 열기`}
            >
              <span className={s.fill} aria-hidden="true" />
              <span className={s.dnum}>{c.date.getDate()}</span>
              {c.used > 0 && <span className={s.load}>{(c.used / 60).toFixed(1)}h</span>}
              <span className={s.marks} aria-hidden="true">
                {c.deadlines.length > 0 && <span className={s.deadline} title={`마감: ${c.deadlines.join(', ')}`} />}
                {c.open > 0 && <span className={s.openDot}>{c.open}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
