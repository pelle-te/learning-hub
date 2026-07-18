/* ============================================================
   MonthCalendar — 캘린더 '월' 뷰(재개편 v4). 옛 MonthHeatmap을 진짜 월 캘린더로 교체.
   히트맵은 "얼마나 했나"만 답했다 — 색농도 한 겹이라 **그날 뭘 하는지**를 못 보여줬다.
   TickTick 규약대로 칸마다 **일정 칩**(과목 색점 + 이름)을 얹고, 넘치면 "+N".
   히트맵의 가치(주/달 부하 리듬)는 버리지 않고 칸 배경의 옅은 틴트로 남겼다 — 칩은 '무엇', 틴트는 '얼마나'.
   순수 파생 read(useSchedule 결과 + tasks 집계)라 저비용. 6주 격자(월요일 시작).
============================================================ */
import { iso, addDays, mondayOf, fmtShort, hLabel, toHM } from '@/lib/utils';
import { indexDays, SESSION_TYPE_META as STYPE } from '@/lib/scheduleView';
import { openTasksForDay, timedTasksForDay } from '@/lib/tasks';
import { useApp } from '@/store/useApp';
import type { ScheduleResult } from '@/lib/types';
import s from './MonthCalendar.module.css';

const DOW = ['월', '화', '수', '목', '금', '토', '일'];
/** 한 칸에 보일 칩 최대 개수. 넘으면 "+N". 칸 최소 높이 76px 기준 2개가 온전히 들어가는 한계 —
 *  이보다 늘리면 마지막 칩이 잘려 "있는데 안 읽히는" 상태가 된다. */
const MAX_CHIPS = 2;
/** 칩 표시 우선순위 — 낮을수록 먼저. 새 학습이 최우선, 매일 도는 Anki가 최하위. */
const TYPE_RANK: Record<string, number> = { new: 0, mock: 1, blank: 2, rev: 3, anki: 4 };
const rank = (t: string): number => TYPE_RANK[t] ?? 9;

interface Chip {
  key: string;
  name: string;
  color?: string;
  tip: string;
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

    // 칩 — 학습 세션(과목색·타입)을 먼저, 그다음 시각 잡힌 할 일. 같은 과목·타입은 한 칩으로 접는다
    // (하루 3모듈이 같은 과목이면 칩 3개는 정보가 아니라 소음).
    const seen = new Set<string>();
    const chips: Chip[] = [];
    // 칸이 낮아 앞의 2~3개만 보인다 → 순서가 곧 정보 우선순위. 새 학습이 Anki·복습보다 먼저 와야 한다
    // (매일 반복되는 Anki가 매 칸 첫 줄을 차지하면 달 전체가 같은 모양이 돼 아무것도 안 읽힌다).
    const ordered = [...(day?.items ?? [])].sort((a, b) => rank(a.type) - rank(b.type));
    for (const it of ordered) {
      const k = `${it.sid}|${it.type}`;
      if (seen.has(k)) continue;
      seen.add(k);
      chips.push({
        key: k,
        name: it.name,
        color: it.color,
        tip: `${it.name} · ${STYPE[it.type].label} ${hLabel(it.min)}`,
      });
    }
    for (const t of timedTasksForDay(state, dsKey)) {
      chips.push({
        key: `t${t.id}`,
        name: t.title,
        color: t.color,
        tip: `${t.title} · 할 일 ${t.start != null ? toHM(t.start) : ''}`,
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
    };
  });

  // 그 달 최대 학습량으로 정규화(상대 농도) — 데이터 없으면 240분 기준.
  const peak = Math.max(240, ...cells.filter((cl) => cl.inMonth).map((cl) => cl.used));
  const monthLabel = `${y}년 ${mo + 1}월`;

  return (
    <section className={s.wrap} aria-label={`${monthLabel} 캘린더`}>
      <div className={s.dowRow} aria-hidden="true">
        {DOW.map((d) => (
          <span key={d} className={s.dowCell}>
            {d}
          </span>
        ))}
      </div>

      <div className={s.grid}>
        {cells.map((cl) => {
          // 부하 틴트 — 히트맵의 계승. 칩을 가리지 않게 상한을 낮게(0.30) 잡는다.
          const alpha = cl.used > 0 ? 0.06 + 0.24 * Math.min(1, cl.used / peak) : 0;
          const overflow = cl.chips.length - MAX_CHIPS;
          return (
            <div
              key={cl.ds}
              className={`${s.cell}${cl.inMonth ? '' : ' ' + s.out}${cl.isToday ? ' ' + s.today : ''}${cl.isWeekend ? ' ' + s.weekend : ''}`}
              style={
                alpha
                  ? ({
                      ['--fill']: `color-mix(in srgb, var(--acc) ${Math.round(alpha * 100)}%, transparent)`,
                    } as React.CSSProperties)
                  : undefined
              }
            >
              <button
                type="button"
                className={s.dayBtn}
                onClick={() => onPick(cl.ds)}
                aria-label={`${fmtShort(cl.date)} · 학습 ${hLabel(cl.used)}${cl.deadlines.length ? ' · 마감 ' + cl.deadlines.join(', ') : ''}${cl.open ? ` · 미완 할일 ${cl.open}` : ''} — 일 뷰 열기`}
              >
                <span className={s.dnum}>{cl.date.getDate()}</span>
                {cl.used > 0 && <span className={s.load}>{(cl.used / 60).toFixed(1)}h</span>}
              </button>

              <div className={s.chips}>
                {cl.deadlines.map((name) => (
                  <span key={`d${name}`} className={`${s.chip} ${s.chipDeadline}`} title={`마감: ${name}`}>
                    🚩 {name}
                  </span>
                ))}
                {cl.chips.slice(0, MAX_CHIPS).map((ch) => (
                  <span key={ch.key} className={s.chip} title={ch.tip}>
                    <i className={s.dot} style={{ background: ch.color || 'var(--acc)' }} aria-hidden="true" />
                    {ch.name}
                  </span>
                ))}
              </div>
              {overflow > 0 && (
                <button type="button" className={s.more} onClick={() => onPick(cl.ds)}>
                  +{overflow}개 더
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
