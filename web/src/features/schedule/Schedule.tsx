/* ============================================================
   Schedule — 배치 세그먼트(계획개편 §5-3): [일·주·월] 타임블로킹.
   질문 "오늘/이번 주, 무엇을 언제 할까?"에 한 화면으로 답한다.
   상단 네비(뷰 스위치 일/주/월 + 주 뷰 이동) · 본문:
     · 일 = DayPlanner(트레이 + 하루 타임라인 드래그 시간박기)
     · 주 = 위크보드(WeekCalendar) + 일자 아젠다(온디맨드 세부)
     · 월 = MonthCalendar(일정 칩 + 부하 틴트 · 마감 · 클릭→일 뷰)
   주간 합계·완료율·마감은 상단 바(usePageChrome)로 끌어올린다. 하단 스트립(예상 완료·마감·.ics)은 공통.
============================================================ */
import { useMemo, useState } from 'react';
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useUI } from '@/store/useUI';
import { useNavigate, useSearchParams } from 'react-router-dom';
import EmptyState from '@/components/EmptyState';
import { useSchedule, useStudyMinByWeekday } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { io } from '@/shell';
import { isDone } from '@/lib/persistence';
import {
  iso,
  toHM,
  hLabel,
  mondayOf,
  parseISO,
  addDays,
  dayDiff,
  weekLabel,
  fmtShort,
  ddayInfo,
  todayISO,
  DOW_MON,
} from '@/lib/utils';
import { Button } from '@/components/ui';
import { useHeroPointer, useWeekNavKeys, useNowMin } from '@/hooks/interactions';
import ds from '@/styles/ds.module.css';
import c from './Schedule.module.css';
import {
  computeDay,
  indexDays,
  deadlineDdays,
  SESSION_TYPE_META as TAG,
  type Row,
  type DayData,
} from '@/lib/scheduleView';
import { timedTasksForDay } from '@/lib/tasks';
import { WeekCalendar } from './WeekCalendar';
import { DayPlanner } from './DayPlanner';
import { MonthCalendar } from './MonthCalendar';

/** 학습/복습/Anki 한 줄 — 완료 체크박스 포함. */
function StudyRow({ ds: dsKey, row }: { ds: string; row: Extract<Row, { kind: 'study' }> }) {
  const toggleDone = useApp((s) => s.toggleDone);
  const done = useApp((s) => isDone(s.state, dsKey, row.it.sid, row.it.type));
  const x = row.it;
  const tag = TAG[x.type];
  const timeHtml = row.start != null && row.end != null ? `${toHM(row.start)}–${toHM(row.end)}` : '미배치';
  const dur = row.start != null && row.end != null ? hLabel(row.end - row.start) : hLabel(x.min);
  return (
    <div className={`${ds.tl}${done ? ' ' + ds.rowdone : ''}`}>
      <input
        type="checkbox"
        className={ds.donechk}
        checked={done}
        onChange={(e) => toggleDone(dsKey, x.sid, x.type, row.plannedMin, e.target.checked)}
        title="완료 표시"
        aria-label={`${x.name} 완료`}
      />
      <span className={ds.tm}>{row.start == null ? <span className={ds.muted}>미배치</span> : timeHtml}</span>
      <span className={ds.swatch} style={{ background: x.color || '#6ea8fe' }} />
      <span className={`${ds.tag} ${ds[tag.cls]}`}>{tag.label}</span>
      <span className={ds.nm}>
        {x.name}
        {x.chapters && x.chapters.length > 0 && (
          <span className={`${ds.muted} ${ds.tiny}`}> · {x.chapters.join(', ')}</span>
        )}
      </span>
      <span className={ds.mn}>{dur}</span>
    </div>
  );
}

/** 하루 본문(타임라인 행들). */
function DayBody({ d }: { d: DayData }) {
  if (!d.rows.length)
    return (
      <div className={`${ds.tl} ${ds.free}`}>
        <span className={`${ds.nm} ${ds.muted}`}>일과 블록 없음</span>
      </div>
    );
  return (
    <>
      {d.rows.map((row, i) => {
        if (row.kind === 'now')
          return (
            <div key={i} className={`${ds.tl} ${ds.nowline}`}>
              <span className={ds.tm}>{toHM(row.start)}</span>
              <span className={ds.nm}>⏱ 지금</span>
              <span className={ds.mn} />
            </div>
          );
        if (row.kind === 'free') {
          if (row.end - row.start < 5) return null;
          return (
            <div key={i} className={`${ds.tl} ${ds.free}`}>
              <span className={ds.tm}>
                {toHM(row.start)}–{toHM(row.end)}
              </span>
              <span className={`${ds.nm} ${ds.muted}`}>🟢 빈 시간</span>
              <span className={ds.mn}>{hLabel(row.end - row.start)}</span>
            </div>
          );
        }
        if (row.kind === 'block')
          return (
            <div key={i} className={`${ds.tl} ${ds.block}`}>
              <span className={ds.tm}>
                {toHM(row.start)}–{toHM(row.end)}
              </span>
              <span className={ds.swatch} style={{ background: row.color }} />
              <span className={`${ds.nm} ${ds.muted}`}>{row.name}</span>
              <span className={ds.mn}>{row.btype}</span>
            </div>
          );
        return <StudyRow key={i} ds={d.ds} row={row} />;
      })}
    </>
  );
}

/** 하루 꼬리(요약 칩). */
function DayFoot({ d }: { d: DayData }) {
  const { counts: cc } = d;
  const extra = (cc.blanks ? ` · 백지 ${cc.blanks}` : '') + (cc.mocks ? ` · 모의 ${cc.mocks}` : '');
  return (
    <div className={ds.tl} style={{ border: 'none' }}>
      <span className={`${ds.nm} ${ds.tiny} ${ds.muted}`}>
        학습 {cc.studies}모듈 · 복습 {cc.revs} · Anki {cc.ankis}
        {extra}
      </span>
      {d.planMin > 0 && (
        <span className={`${ds.pill} ${ds.tiny}${d.doneMinTot >= d.planMin ? ' ' + ds.good : ''}`}>
          완료 {(d.doneMinTot / 60).toFixed(1)}/{(d.planMin / 60).toFixed(1)}h
        </span>
      )}
      {d.freeMin > 0 && <span className={`${ds.pill} ${ds.tiny}`}>빈 {(d.freeMin / 60).toFixed(1)}h</span>}
    </div>
  );
}

/** .ics 신선도 — 마지막 내보내기 서명을 현재 계획과 비교(어긋나면 재내보내기 안내). 스트립용 컴팩트. */
function IcsFreshnessNote() {
  const x = useRuntime((s) => s.cache._icsExport) as { at?: string; sig?: string } | undefined;
  const today = useApp((s) => todayISO(s.state)); // 렌더 순수성: Date.now() 대신 앱 정본 '오늘'(테스트 _today 존중)
  if (!x || !x.at) return <span className={c.icsNote}>📅 캘린더(.ics) 미내보내기</span>;
  const when = new Date(x.at);
  const days = isNaN(when.getTime()) ? null : dayDiff(iso(when), today);
  const ago = days == null ? '' : days <= 0 ? '오늘' : days === 1 ? '어제' : `${days}일 전`;
  const stale = x.sig !== io.planSignature();
  if (stale)
    return (
      <span className={`${c.icsNote} ${c.stale}`}>
        📅 .ics 계획과 어긋남({ago})
        <Button sm onClick={() => io.exportICS()}>
          🔄 재내보내기
        </Button>
      </span>
    );
  return <span className={c.icsNote}>📅 .ics 최신 · 마지막 {ago}</span>;
}

export default function Schedule() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  // '오늘'이 속한 주의 오프셋(시작 주 기준) — 초기 주·'이번 주' 배지·'이번 주로' 액션의 공통 기준.
  const todayOff = Math.round(
    dayDiff(iso(mondayOf(parseISO(state.startDate))), iso(mondayOf(parseISO(todayISO(state))))) / 7,
  );
  // 시작 주가 아니라 '현재 주'로 연다(리뷰·오늘 탭과 일관) — 오늘은 앱의 단일 출처(_today) 존중.
  const [weekOffset, setWeekOffset] = useState(todayOff);
  // , / . — 이전/다음 주(버튼과 동일 동작, 리뷰 탭과 같은 키).
  useWeekNavKeys(
    () => setWeekOffset((o) => o - 1),
    () => setWeekOffset((o) => o + 1),
  );
  // 뷰 선택은 UI 설정 단일 store(useUI)가 소유 — 영속·IDB미러 일관(localStorage 직접 접근 제거).
  const schedView = useUI((s) => s.ui.schedView);
  const setView = useUI((s) => s.setSchedView);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selDow, setSelDow] = useState<number | null>(null);
  // 보드 위 스포트라이트(틸트 없음 — 큰 패널). 구조분해로 ref-접근 린트 회피.
  const { ref: boardRef, onMouseMove: boardMove, onMouseLeave: boardLeave } = useHeroPointer(0);

  const baseMon = mondayOf(parseISO(state.startDate));
  const curMon = addDays(baseMon, weekOffset * 7);

  const capWd = useStudyMinByWeekday();
  // '지금' 라인·⏱ 지금 행이 로드 시각에 멈추지 않도록 분 단위로 갱신(Today 탭과 동일 감각) — 공유 훅.
  const nowMin = useNowMin();
  const todayIso = todayISO(state); // 앱의 '오늘' 단일 출처(_today 시드 존중) — 날짜비교 결정성.

  // 일/월 뷰의 앵커 날짜(ISO) — 일 뷰=그날, 월 뷰=그 달. 주 뷰는 weekOffset이 독립 소유.
  // 딥링크 `?ds=<ISO>`는 **초기값으로만** 흡수한다(배분 탭 셀 클릭 → 그날 일 뷰 드릴다운).
  // effect에서 setState로 되받으면 캐스케이드 렌더라 린트가 막는다 — 뷰(day) 전환은 보내는 쪽이 미리 하고,
  // 여긴 마운트 시 한 번 읽기만 하면 충분하다(탭 경계를 넘으면 이 컴포넌트는 새로 마운트되므로).
  const [anchorDs, setAnchorDs] = useState(() => {
    const q = searchParams.get('ds');
    return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayISO(state);
  });

  const dayNav = (delta: number, toToday?: boolean) =>
    setAnchorDs(toToday ? todayIso : iso(addDays(parseISO(anchorDs), delta)));
  const monthNav = (delta: number, toToday?: boolean) => {
    if (toToday) return setAnchorDs(todayIso);
    const d = parseISO(anchorDs);
    setAnchorDs(iso(new Date(d.getFullYear(), d.getMonth() + delta, 1)));
  };
  // 월 칸 클릭 → 그날 일 뷰로 진입(§6-5).
  const monthPick = (dsPick: string) => {
    setAnchorDs(dsPick);
    setView('day');
  };

  // curMon은 state.startDate+weekOffset로 완전히 결정 → 매 렌더 새 Date여도 memo는 weekOffset(안정 스칼라)에 키잉.
  const parts = useMemo(
    () => {
      const byDs = indexDays(res); // ds→Day 인덱스를 7일 루프 밖에서 1회 생성(매 호출 재구축 제거).
      return Array.from({ length: 7 }, (_, k) => computeDay(state, byDs, capWd, nowMin, todayIso, curMon, k));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- curMon은 [state,weekOffset] 파생이라 중복 의존 제거
    [state, res, capWd, nowMin, todayIso, weekOffset],
  );

  const weekToday = () => {
    setWeekOffset(todayOff);
    setSelDow(null);
  };

  let sel = selDow;
  if (sel == null || sel < 0 || sel > 6) {
    const ti = parts.findIndex((p) => p.isToday);
    sel = ti >= 0 ? ti : 0;
  }
  const selDay = parts[sel]!; // 개요 아젠다(온디맨드 세부)가 그릴 선택 요일 — 기본은 오늘.
  // 줄마다 마감 플래그 — 그날이 마감인 과목명(네온 위크-그리드에 표시).
  const deadlines = parts.map((p) => state.items.filter((it) => it.deadline === p.ds).map((it) => it.name));
  const hasStudyItems = state.items.some((it) => it.name);

  // 주간 합계·완료율(리드아웃) — 이번 화면 주(週) 기준.
  const weekUsedH = parts.reduce((t, p) => t + p.used, 0) / 60;
  const weekPlanMin = parts.reduce((t, p) => t + p.planMin, 0);
  const weekDoneMin = parts.reduce((t, p) => t + p.doneMinTot, 0);
  const compRate = weekPlanMin > 0 ? Math.round((weekDoneMin / weekPlanMin) * 100) : 0;

  // 마감 카운트다운(스트립 + 가장 가까운 마감 리드아웃) — Today 탭과 공유 헬퍼(가까운순·미완료·미래만).
  const ddays = deadlineDdays(res.itemStat, todayIso);
  const nearestDday = ddays.length ? ddays[0]!.dday : null;
  const soon = ddays.slice(0, 4);

  // 과목별 예상 완료일(스케줄러 산출 finishDate) — 하단 리드아웃. finishDate/완료 표식 있는 과목만.
  const finishes = (res.itemStat || [])
    .filter((st) => st.name && (st.finishDate || st.finished))
    .map((st) => ({
      id: st.id,
      name: st.name,
      color: st.color,
      finished: !!st.finished,
      late: st.late || 0,
      md: st.finishDate ? fmtShort(parseISO(st.finishDate)) : null,
      dday: st.deadline ? dayDiff(todayIso, st.deadline) : null,
    }));

  // 배치 전용 리드아웃(뷰별 스왑) — 일=그날, 주=이번 주(週), 월=그 달. 탭재설계 '상단 리드아웃' 사상.
  const anchorDate = parseISO(anchorDs);
  const anchorDay = computeDay(state, indexDays(res), capWd, nowMin, todayIso, anchorDate, 0); // anchorDs 하루치
  const dayCompRate = anchorDay.planMin > 0 ? Math.round((anchorDay.doneMinTot / anchorDay.planMin) * 100) : 0;
  const anchorY = anchorDate.getFullYear();
  const anchorM = anchorDate.getMonth();
  const monthDays = res.days.filter((d) => {
    const dt = parseISO(d.ds);
    return dt.getFullYear() === anchorY && dt.getMonth() === anchorM;
  });
  const monthUsedH = monthDays.reduce((t, d) => t + d.used, 0) / 60;
  const monthOpenTasks = (state.tasks || []).filter((t) => {
    if (!t.ds || t.done) return false;
    const dt = parseISO(t.ds);
    return dt.getFullYear() === anchorY && dt.getMonth() === anchorM;
  }).length;

  const readouts =
    schedView === 'day'
      ? [
          {
            label: `${fmtShort(anchorDate)} 계획`,
            value: (
              <>
                {(anchorDay.planMin / 60).toFixed(1)}
                <small> h</small>
              </>
            ),
            accent: true,
          },
          { label: '완료', value: anchorDay.planMin ? `${dayCompRate}%` : '—' },
          { label: '가용', value: `${(anchorDay.studyMin / 60).toFixed(1)}h` },
        ]
      : schedView === 'month'
        ? [
            {
              label: `${anchorM + 1}월`,
              value: (
                <>
                  {monthUsedH.toFixed(1)}
                  <small> h</small>
                </>
              ),
              accent: true,
            },
            { label: '미완 할일', value: monthOpenTasks ? String(monthOpenTasks) : '—' },
            { label: '마감', value: nearestDday == null ? '—' : `D-${nearestDday}` },
          ]
        : [
            {
              label: '이번 주',
              value: (
                <>
                  {weekUsedH.toFixed(1)}
                  <small> h</small>
                </>
              ),
              accent: true,
            },
            { label: '완료', value: weekPlanMin ? `${compRate}%` : '—' },
            { label: '마감', value: nearestDday == null ? '—' : `D-${nearestDday}` },
          ];

  // 주 뷰에서 다른 주를 보는 중이면 "이번 주로", 그 외엔 .ics 내보내기.
  usePageChromeEffect(
    () => ({
      readouts,
      action:
        schedView === 'week' && weekOffset !== todayOff
          ? { label: '이번 주로 →', onClick: weekToday }
          : { label: '캘린더(.ics) 내보내기', onClick: () => io.exportICS() },
    }),
    [schedView, readouts, weekOffset, todayOff],
  );

  // 뷰 스위치 [일·주·월] — 배분은 독립 세그먼트로 승격돼 여기서 빠졌다(재개편 v4).
  // tablist 계약(화살표 이동·tabpanel) 미이행 → group+aria-pressed가 정직(WCAG 4.1.2).
  const VIEW_LABEL = { day: '일', week: '주', month: '월' } as const;
  const viewSeg = (
    <div className={ds.seg} role="group" aria-label="캘린더 보기 방식" style={{ marginLeft: 'auto' }}>
      {(['day', 'week', 'month'] as const).map((v) => (
        <button
          key={v}
          aria-pressed={schedView === v}
          className={schedView === v ? ds.on : ''}
          onClick={() => setView(v)}
        >
          {VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  );
  const navBar = (
    <div className={c.nav}>
      {/* 월 뷰 — 달 이동을 여기(공통 nav)가 소유한다. 뷰 본문이 자체 헤더를 또 그리면 헤더가 두 줄이 되고,
          정작 이 줄은 뷰 스위치만 남아 빈 띠가 된다. 주 뷰의 주 이동과 같은 자리·같은 문법. */}
      {schedView === 'month' && (
        <div className={c.wknav}>
          <Button sm onClick={() => monthNav(-1)} aria-label="이전 달">
            ◀ 이전 달
          </Button>
          <div className={c.wk}>
            <b className={c.wkLab}>
              {anchorDate.getFullYear()}년 {anchorDate.getMonth() + 1}월
            </b>
            <span className={c.wkOff}>{monthUsedH.toFixed(1)}h</span>
          </div>
          <Button sm onClick={() => monthNav(1)} aria-label="다음 달">
            다음 달 ▶
          </Button>
          <Button sm variant="ghost" onClick={() => monthNav(0, true)}>
            오늘
          </Button>
        </div>
      )}
      {schedView === 'week' && (
        <div className={c.wknav}>
          <Button sm onClick={() => setWeekOffset((o) => o - 1)}>
            ◀ 이전 주
          </Button>
          <div className={c.wk}>
            <b className={c.wkLab}>{weekLabel(curMon)}</b>
            <span className={c.wkOff}>
              {weekOffset === todayOff
                ? '이번 주'
                : weekOffset > todayOff
                  ? `+${weekOffset - todayOff}주`
                  : `${weekOffset - todayOff}주`}
            </span>
          </div>
          <Button sm onClick={() => setWeekOffset((o) => o + 1)}>
            다음 주 ▶
          </Button>
          <Button sm variant="ghost" onClick={weekToday}>
            오늘
          </Button>
        </div>
      )}
      {viewSeg}
    </div>
  );

  return (
    <section className={c.wrap} aria-label="주간 스케줄">
      {navBar}

      {/* 편성 경고 — 뷰(개요/카드) 무관 공통 스트립(카드뷰에서 소실되지 않도록 분기 밖으로 승격). */}
      {res.warnings.length > 0 && (
        <div
          className={`${c.warn}${res.warnings.some((w) => w.includes('못') || w.includes('초과')) ? ' ' + c.bad : ''}`}
        >
          {res.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <div className={c.body}>
        {schedView === 'day' ? (
          <DayPlanner ds={anchorDs} res={res} nowMin={nowMin} todayIso={todayIso} onNav={dayNav} />
        ) : schedView === 'month' ? (
          <MonthCalendar anchor={parseISO(anchorDs)} res={res} todayIso={todayIso} onPick={monthPick} />
        ) : (
          <div className={c.board2}>
            {/* 위크보드 — 정보의 주인공(발광 카드 + 포인터 스포트라이트). */}
            <div
              ref={boardRef}
              onMouseMove={boardMove}
              onMouseLeave={boardLeave}
              className={`${c.boardCard} ${ds.spotHost} ${ds.glow}`}
            >
              <div className={ds.spotlight} aria-hidden="true" />
              {hasStudyItems ? (
                <div className={c.boardWrap}>
                  {weekPlanMin === 0 && (
                    // 과목은 있는데 이 주에 학습 블록이 하나도 안 잡힌 경우(모두 완료·마감 지남·가용 없음) —
                    // 일과만 뜬 캘린더가 왜 비었는지 조용히 두지 않고 짚어준다.
                    <div className={c.weekEmptyNote}>
                      이 주에는 배치된 <b>학습 블록</b>이 없어요 — 마감이 지났거나 가용시간이 부족할 수 있어요.
                      일과(수면·수업)만 표시됩니다.
                    </div>
                  )}
                  <div className={c.calHost}>
                    <WeekCalendar
                      parts={parts}
                      sel={sel}
                      onSelect={setSelDow}
                      nowMin={nowMin}
                      dows={DOW_MON}
                      deadlines={deadlines}
                      tasksByDay={parts.map((p) => timedTasksForDay(state, p.ds))}
                    />
                  </div>
                </div>
              ) : (
                <div className={c.emptyBoard}>
                  <EmptyState
                    glyph="🗓"
                    title="주간 보드가 비어 있어요"
                    desc={
                      <>
                        학습 항목을 추가하면 이 캘린더에 <b>공부·복습 블록</b>이 자동 배치됩니다. 지금은 기본
                        일과(수면·식사)만 보여요.
                      </>
                    }
                    actions={
                      <Button sm variant="primary" onClick={() => navigate('/items')}>
                        학습 항목 추가하기 →
                      </Button>
                    }
                  />
                </div>
              )}
            </div>

            {/* 일자 아젠다 — 선택 요일의 온디맨드 세부. 미배치(start==null) 학습 행도 여기서 체크(캘린더 세그엔 안 뜸). */}
            {hasStudyItems && (
              <div className={c.agenda} aria-label={`${DOW_MON[sel]} 아젠다`}>
                <div className={c.agendaT}>
                  <span>
                    {DOW_MON[sel]} {fmtShort(selDay.date)}
                    {selDay.isToday && ' · 오늘'}
                  </span>
                  {/* 이 날을 직접 편성(§5-3 요일→일 뷰 진입) */}
                  <Button
                    sm
                    variant="ghost"
                    onClick={() => {
                      setAnchorDs(selDay.ds);
                      setView('day');
                    }}
                  >
                    이 날 계획 짜기 →
                  </Button>
                </div>
                <div className={c.agendaBody}>
                  <DayBody d={selDay} />
                  <DayFoot d={selDay} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 예상 완료 스트립 — 과목별 스케줄러 산출 완료일(온디맨드 리드아웃, 완료/지연 표식). */}
      {finishes.length > 0 && (
        <div className={c.finStrip}>
          <span className={c.grpL}>예상 완료</span>
          {finishes.map((f) => (
            <span key={f.id} className={`${c.fin}${f.late > 0 ? ' ' + c.finLate : ''}`}>
              <span className={c.dot} style={{ background: f.color || 'var(--acc)' }} />
              {f.name}{' '}
              {f.finished ? (
                <b className={c.finDone}>✓ 완료</b>
              ) : (
                <b>
                  {f.md ?? '—'}
                  {f.dday != null && f.dday >= 0 && <span className={c.finDday}> · D-{f.dday}</span>}
                </b>
              )}
            </span>
          ))}
        </div>
      )}

      {/* 하단 스트립 — 마감 카운트다운 + .ics 신선도 */}
      <div className={c.strip}>
        <div className={c.grp}>
          <span className={c.grpL}>마감</span>
          {soon.length ? (
            soon.map((d) => {
              const { lab } = ddayInfo(d.dday);
              return (
                <button
                  key={d.name + d.deadline}
                  type="button"
                  className={`${c.dd}${d.dday <= 7 ? ' ' + c.soon : ''}`}
                  onClick={() => navigate('/items')}
                >
                  <span className={c.dot} style={{ background: d.color || 'var(--acc)' }} />
                  {d.name} <b>{lab}</b>
                </button>
              );
            })
          ) : (
            <span className={c.ddMut}>없음</span>
          )}
        </div>
        <div className={c.vline} />
        <IcsFreshnessNote />
      </div>
    </section>
  );
}
