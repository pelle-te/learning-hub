/* ============================================================
   MonthCalendar — 캘린더 '월' 뷰(재개편 v5 · 피드백 반영).
   월은 '멀리서 보는 달력'이다 → **반복되는 것은 빼고 특이한 것만** 띄운다.
   매일 도는 학습·복습·Anki와 고정 생활 패턴(수업·수면·식사)은 어차피 매 칸에 있어 정보가 아니다
   (모든 칸이 같은 모양이 되면 아무것도 안 읽힌다). 남기는 건 **마감**과 **그날만의 할 일**.
   부하 히트맵 틴트도 걷어냈다 — 칸 바탕이 물들면 정작 강조할 칩의 대비가 깎인다.
   v5-wave5: **일정(events)** 추가 — 반복되지 않는 단발 사건이라 '그날만의 것' 원칙에 정확히 부합한다
   (오히려 월 뷰가 답해야 할 바로 그 질문: "이 달에 뭐 있지"). 할 일과 같은 칩 줄·같은 MAX_CHIPS
   상한을 쓰되 **일정을 앞에 둔다** — 시각이 못 박힌 것이 체크리스트보다 먼저 읽혀야 한다.
   순수 파생 read(useSchedule 결과 + tasks 집계)라 저비용. 6주 격자(월요일 시작).
============================================================ */
import { iso, addDays, mondayOf, fmtShort, hLabel, toHM, DOW_MON } from '@/lib/utils';
import { indexDays } from '@/lib/scheduleView';
import { openTasksForDay, tasksForDay } from '@/lib/tasks';
import { eventsForDay } from '@/lib/events';
import { useApp } from '@/store/useApp';
import type { ScheduleResult } from '@/lib/types';
import s from './MonthCalendar.module.css';

/** 한 칸에 보일 칩 최대 개수. 넘으면 "+N". 칸 최소 높이 76px 기준 2개가 온전히 들어가는 한계 —
 *  이보다 늘리면 마지막 칩이 잘려 "있는데 안 읽히는" 상태가 된다. */
const MAX_CHIPS = 2;

interface Chip {
  key: string;
  name: string;
  color?: string;
  tip: string;
  done?: boolean;
  /** 추가 클래스(일정 칩 등) — 칩 렌더는 한 벌만 두고 종류 차이는 클래스로만 준다. */
  cls?: string;
}

export function MonthCalendar({
  anchor,
  res,
  todayIso,
  onPick,
}: {
  anchor: Date;
  res: ScheduleResult;
  todayIso: string;
  onPick: (ds: string) => void;
}) {
  const state = useApp((st) => st.state);
  const byDs = indexDays(res);
  const y = anchor.getFullYear();
  const mo = anchor.getMonth();
  const gridStart = mondayOf(new Date(y, mo, 1)); // 월요일 시작 6주 격자

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const dsKey = iso(date);
    const day = byDs[dsKey];
    const used = day ? Math.round(day.used) : 0;

    // 칩 = 그날만의 일정. 학습 세션(new/rev/anki)은 매일 반복돼 월 뷰에선 소음이라 넣지 않는다
    // — 그날 뭘 공부하는지는 주/일 뷰가 답한다. 여기선 '이 날 특별한 게 있나'만.
    const chips: Chip[] = [];
    const evs = eventsForDay(state, dsKey);
    for (const ev of evs) {
      chips.push({
        key: `e${ev.id}`,
        name: ev.title,
        color: ev.color,
        tip: `${ev.title} · 일정 ${toHM(ev.start)}–${toHM(ev.start + ev.min)}`,
        cls: s.chipEvent,
      });
    }
    for (const t of tasksForDay(state, dsKey)) {
      chips.push({
        key: `t${t.id}`,
        name: t.title,
        color: t.color,
        tip: `${t.title} · 할 일${t.start != null ? ' ' + toHM(t.start) : ''}${t.done ? ' · 완료' : ''}`,
        done: !!t.done,
      });
    }

    return {
      ds: dsKey,
      date,
      inMonth: date.getMonth() === mo,
      isToday: dsKey === todayIso,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      used,
      chips,
      deadlines: state.items.filter((it) => it.deadline === dsKey && it.name).map((it) => it.name),
      open: openTasksForDay(state, dsKey).length,
      events: evs.map((e) => e.title),
    };
  });

  const monthLabel = `${y}년 ${mo + 1}월`;

  return (
    <section className={s.wrap} aria-label={`${monthLabel} 캘린더`}>
      <div className={s.dowRow} aria-hidden="true">
        {DOW_MON.map((d) => (
          <span key={d} className={s.dowCell}>
            {d}
          </span>
        ))}
      </div>

      <div className={s.grid}>
        {cells.map((cl) => {
          const overflow = cl.chips.length - MAX_CHIPS;
          return (
            <button
              key={cl.ds}
              type="button"
              onClick={() => onPick(cl.ds)}
              // 오늘을 색(.today)만으로 전하면 스크린리더·색각 사용자에겐 아무것도 아니다 — 의미를 DOM에 싣는다.
              aria-current={cl.isToday ? 'date' : undefined}
              aria-label={`${fmtShort(cl.date)} · 학습 ${hLabel(cl.used)}${cl.deadlines.length ? ' · 마감 ' + cl.deadlines.join(', ') : ''}${cl.events.length ? ' · 일정 ' + cl.events.join(', ') : ''}${cl.open ? ` · 미완 할일 ${cl.open}` : ''} — 이 날 계획 열기`}
              className={`${s.cell}${cl.inMonth ? '' : ' ' + s.out}${cl.isToday ? ' ' + s.today : ''}${cl.isWeekend ? ' ' + s.weekend : ''}`}
            >
              <span className={s.dayRow}>
                <span className={s.dnum}>{cl.date.getDate()}</span>
                {cl.used > 0 && <span className={s.load}>{(cl.used / 60).toFixed(1)}h</span>}
              </span>

              <div className={s.chips}>
                {cl.deadlines.map((name) => (
                  <span key={`d${name}`} className={`${s.chip} ${s.chipDeadline}`} title={`마감: ${name}`}>
                    🚩 {name}
                  </span>
                ))}
                {cl.chips.slice(0, MAX_CHIPS).map((ch) => (
                  <span
                    key={ch.key}
                    className={`${s.chip}${ch.cls ? ' ' + ch.cls : ''}${ch.done ? ' ' + s.chipDone : ''}`}
                    title={ch.tip}
                  >
                    {/* 색점의 기본값은 CSS가 갖는다(칩 종류마다 다름) — 인라인은 실제 색이 있을 때만. */}
                    <i className={s.dot} style={ch.color ? { background: ch.color } : undefined} aria-hidden="true" />
                    {ch.name}
                  </span>
                ))}
              </div>
              {overflow > 0 && <span className={s.more}>+{overflow}개 더</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
