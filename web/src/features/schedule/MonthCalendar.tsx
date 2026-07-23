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

/** 한 칸에 보일 칩 최대 개수. 넘으면 "+N". 칸 최소 높이 76px 기준 2개가 온전히 들어가는 한계 —
 *  이보다 늘리면 마지막 칩이 잘려 "있는데 안 읽히는" 상태가 된다. */
const MAX_CHIPS = 2;

/* ── C-7 이식(MonthCalendar) — Tailwind 클래스 SSOT ─────────────────────────────
   6주 격자 칸(고정 최소 높이 + overflow:hidden) + 칩 3종(마감/일정/할일). ⚠ 칸은 고정 행 높이라
   반픽셀 font-size(10.5/9.5px)가 칩을 잘라먹은 이력이 있어(tokenBridge 머리주석) 전부 --text-sched-*
   명명 토큰이다. ⚠ 칸(.cell)은 <button> 이라 전역 button(언레이어)이 유틸을 이긴다 → 다른 값만 `!`.
   칩 텍스트는 built-in 크기(text-sm)만 companion line-height 를 흘리므로 그 자리에만 원본 LH 를
   명시(leading-[1.5]/[1.45] · line-height 트랩). 상태(오늘/주말/칩 종류/완료)는 정적 클래스맵(§15). */
const S = {
  wrap: 'flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-5.5 pt-3.5 pb-4.5 [scrollbar-width:thin] max-mobile:px-3 max-mobile:pt-2.5 max-mobile:pb-3.5',
  dowRow: 'sticky top-0 z-[2] grid flex-none grid-cols-7 gap-1 bg-bg',
  dowCell: 'pb-0.5 text-center text-sched-dow font-extrabold tracking-mode-sub',
  grid: 'grid min-h-0 flex-1 auto-rows-[var(--monthcell-row)] grid-cols-7 gap-1',
  cell: 'relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-chip! border-0! bg-transparent! px-1! pt-1! pb-0.75! text-left focus-visible:-outline-offset-2!',
  dayRow: 'flex items-baseline justify-between gap-1 px-0.5 pb-0.75',
  dnum: 'text-sm font-extrabold tabular-nums leading-[1.5]',
  dnumToday: 'min-w-5 rounded-full bg-acc px-1.25 text-center text-bg',
  load: 'text-sched-meta tabular-nums text-mut',
  chips: 'flex min-h-0 flex-col gap-0.5 overflow-hidden',
  // 칩 공통 — nowrap 말줄임 + off-ladder 반경/틴트. 모바일은 텍스트를 버리고 색점만(칸이 두 줄 못 담음).
  chip: 'flex flex-none items-center gap-1 truncate rounded-chip-sm bg-[var(--chip-ink)] px-1 py-0.25 text-2xs leading-[1.45] max-mobile:gap-0 max-mobile:px-0.5 max-mobile:py-0.25 max-mobile:text-sched-hide',
  chipDeadline: 'bg-[var(--sched-chip-bad)]! font-bold text-bad max-mobile:text-sched-cap',
  chipEvent: 'bg-[var(--tint-event)]! font-bold text-[color:var(--event-on-ink)]',
  chipDone: 'line-through opacity-50',
  dot: 'h-1.5 w-1.5 flex-none rounded-full',
  more: 'cursor-pointer px-1 text-left text-sched-meta font-bold text-mut',
} as const;

interface Chip {
  key: string;
  name: string;
  color?: string;
  tip: string;
  done?: boolean;
  /** 색점 생략(마감 칩은 🚩 글리프가 그 역할을 한다 — 점까지 붙으면 좁은 칸에서 글자만 밀린다). */
  noDot?: boolean;
  /** 칩 종류 — 렌더는 한 벌만 두고 종류 차이는 정적 클래스맵으로만 준다(§15). */
  kind?: 'deadline' | 'event';
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
    // ⚠ 마감은 예전에 캡 밖에서 따로 렌더됐다 — MAX_CHIPS는 아래 chips에만 걸리고 "+N개 더"도
    //   그 초과분만 셌다. 그래서 마감 3개인 날은 4줄을 48px 칸에 그려 2줄이 **표시도 없이 잘렸다**
    //   (사용자는 숨은 게 있다는 사실조차 알 수 없다). 같은 목록의 맨 앞에 넣어 캡과 +N이 전부를 센다.
    //   순서: 마감(가장 시급) → 일정 → 할 일.
    for (const name of state.items.filter((it) => it.deadline === dsKey && it.name).map((it) => it.name)) {
      chips.push({ key: `d${name}`, name: `🚩 ${name}`, tip: `마감: ${name}`, kind: 'deadline', noDot: true });
    }
    const evs = eventsForDay(state, dsKey);
    for (const ev of evs) {
      chips.push({
        key: `e${ev.id}`,
        name: ev.title,
        color: ev.color,
        tip: `${ev.title} · 일정 ${toHM(ev.start)}–${toHM(ev.start + ev.min)}`,
        kind: 'event',
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
    <section className={S.wrap} aria-label={`${monthLabel} 캘린더`}>
      <div className={S.dowRow} aria-hidden="true">
        {DOW_MON.map((d, i) => (
          <span key={d} className={`${S.dowCell} ${i >= 5 ? 'text-[color:var(--mut-weekend)]' : 'text-mut'}`}>
            {d}
          </span>
        ))}
      </div>

      <div className={S.grid}>
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
              className={`${S.cell} ${cl.inMonth ? '' : 'opacity-[0.42]'} ${cl.isToday ? 'shadow-[var(--shadow-cell-today)]' : 'shadow-inset-line2'} hover:shadow-[var(--shadow-cell-hover)]`}
            >
              <span className={S.dayRow}>
                <span className={`${S.dnum} ${cl.isToday ? S.dnumToday : cl.isWeekend ? 'text-mut' : ''}`}>
                  {cl.date.getDate()}
                </span>
                {cl.used > 0 && <span className={S.load}>{(cl.used / 60).toFixed(1)}h</span>}
              </span>

              <div className={S.chips}>
                {cl.chips.slice(0, MAX_CHIPS).map((ch) => (
                  <span
                    key={ch.key}
                    className={`${S.chip} ${ch.kind === 'deadline' ? S.chipDeadline : ch.kind === 'event' ? S.chipEvent : ''} ${ch.done ? S.chipDone : ''}`}
                    title={ch.tip}
                  >
                    {/* 색점의 기본값은 종류별 클래스가 갖는다(일정=event · 그 외=acc) — 인라인은 실제 색이 있을 때만. */}
                    {!ch.noDot && (
                      <i
                        className={`${S.dot} ${ch.kind === 'event' ? 'bg-[var(--event)]' : 'bg-acc'}`}
                        style={ch.color ? { background: ch.color } : undefined}
                        aria-hidden="true"
                      />
                    )}
                    {ch.name}
                  </span>
                ))}
              </div>
              {overflow > 0 && <span className={S.more}>+{overflow}개 더</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
