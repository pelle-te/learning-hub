/* ============================================================
   Schedule — 탭: 🗓 주간 스케줄 (데모 v6 사상 단일화면 재설계)
   질문 "이번 주, 무엇을 언제 공부하나?"에 한 화면으로 답한다.
   상단 네비(주 이동·개요/카드) · 본문 [스파인 | 위크보드(fill) | 일자 아젠다] · 하단 스트립(마감·.ics).
   주간 합계·완료율·마감은 상단 바(usePageChrome)로 끌어올리고, 그날 상세는 우측 아젠다로 온디맨드.
============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useUI } from '@/store/useUI';
import { useNavigate } from 'react-router-dom';
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
import { useHeroPointer, useWeekNavKeys } from '@/lib/interactions';
import ds from '@/styles/ds.module.css';
import c from './Schedule.module.css';
import { computeDay, indexDays, SESSION_TYPE_META as TAG, type Row, type DayData } from '@/lib/scheduleView';
import { WeekCalendar } from './WeekCalendar';

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

/** 하루 머리글(요일·날짜·가용시간 인라인 입력) + 막대. */
function DayHeadBar({ d, k }: { d: DayData; k: number }) {
  const mutate = useApp((s) => s.mutate);
  const setOverride = (v: string) =>
    mutate((st) => {
      st.dayOverrides = st.dayOverrides || {};
      if (v === '' || v == null) delete st.dayOverrides[d.ds];
      else st.dayOverrides[d.ds] = Math.min(24, Math.max(0, +v || 0)); // 하루는 24h — 99 같은 값 차단.
    });
  const barColor = d.over ? 'var(--bad)' : d.ratio > 90 ? 'var(--warn)' : 'var(--acc)';
  return (
    <>
      <div className={ds.dh}>
        <span className={ds.dt}>
          {DOW_MON[k]}{' '}
          <span className={ds.muted} style={{ fontWeight: 400 }}>
            {fmtShort(d.date)}
          </span>
          {d.isToday && <span className={ds.todaychip}> 오늘</span>}
        </span>
        <span className={ds.cap}>
          가용{' '}
          <input
            type="number"
            step="0.5"
            min="0"
            value={d.ovVal}
            max="24"
            placeholder={String(d.defMin / 60)}
            aria-label={`${fmtShort(d.date)} 가용시간(시간)`}
            onChange={(e) => setOverride(e.target.value)}
            style={{ width: 54, display: 'inline-block', padding: '3px 6px', textAlign: 'center' }}
          />
          h<span className={`${ds.muted} ${ds.tiny}`}> · 배정 {(d.used / 60).toFixed(1)}h</span>
        </span>
      </div>
      {d.studyMin ? (
        <div className={ds.bar}>
          <i style={{ width: `${d.ratio}%`, background: barColor }} />
        </div>
      ) : null}
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

function DayCard({ d, k }: { d: DayData; k: number }) {
  return (
    <div className={`${ds.day}${d.isToday ? ' ' + ds.today : ''}`}>
      <DayHeadBar d={d} k={k} />
      <div className={ds.body}>
        <DayBody d={d} />
        <DayFoot d={d} />
      </div>
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
  const [selDow, setSelDow] = useState<number | null>(null);
  // 보드 위 스포트라이트(틸트 없음 — 큰 패널). 구조분해로 ref-접근 린트 회피.
  const { ref: boardRef, onMouseMove: boardMove, onMouseLeave: boardLeave } = useHeroPointer(0);

  const baseMon = mondayOf(parseISO(state.startDate));
  const curMon = addDays(baseMon, weekOffset * 7);

  const capWd = useStudyMinByWeekday();
  // '지금' 라인·⏱ 지금 행이 로드 시각에 멈추지 않도록 분 단위로 갱신(Today 탭과 동일 감각).
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    };
    const id = setInterval(tick, 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick(); // 백그라운드 복귀 시 즉시 캐치업.
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  const todayIso = todayISO(state); // 앱의 '오늘' 단일 출처(_today 시드 존중) — 날짜비교 결정성.

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

  // 마감 카운트다운(스트립 + 가장 가까운 마감 리드아웃).
  // 완료된 과목은 제외(Today 탭과 동일 의미) — 다 끝낸 과목이 살아있는 D-n으로 남지 않도록 itemStat.finished 반영.
  const ddays = (res.itemStat || [])
    .filter((st) => st.deadline && !st.finished)
    .map((st) => ({
      name: st.name,
      color: st.color,
      deadline: st.deadline as string,
      dday: dayDiff(todayIso, st.deadline as string),
    }))
    .filter((st) => st.dday >= 0)
    .sort((a, b) => a.dday - b.dday);
  const nearestDday = ddays.length ? ddays[0]!.dday : null;
  const soon = ddays.slice(0, 4);

  // 진행률·합계·마감 + 주 액션을 상단 바로(데모 v6 헤더).
  usePageChromeEffect(
    () => ({
      readouts: [
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
      ],
      action:
        weekOffset !== todayOff
          ? { label: '이번 주로 →', onClick: weekToday }
          : { label: '캘린더(.ics) 내보내기', onClick: () => io.exportICS() },
    }),
    [weekUsedH, compRate, weekPlanMin, nearestDday, weekOffset, todayOff],
  );

  const navBar = (
    <div className={c.nav}>
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
      {/* tablist 계약(화살표 이동·tabpanel) 미이행 → group+aria-pressed가 정직(WCAG 4.1.2). */}
      <div className={ds.seg} role="group" aria-label="주간 보기 방식" style={{ marginLeft: 6 }}>
        <button
          aria-pressed={schedView === 'overview'}
          className={schedView === 'overview' ? ds.on : ''}
          onClick={() => setView('overview')}
        >
          개요
        </button>
        <button
          aria-pressed={schedView === 'cards'}
          className={schedView === 'cards' ? ds.on : ''}
          onClick={() => setView('cards')}
        >
          카드
        </button>
      </div>
    </div>
  );

  return (
    <section className={c.wrap} aria-label="주간 스케줄">
      {navBar}

      <div className={c.body}>
        {schedView === 'cards' ? (
          <div className={c.cardsView}>
            <div className={ds.weekgrid}>
              {parts.map((d, k) => (
                <DayCard key={d.ds} d={d} k={k} />
              ))}
            </div>
          </div>
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
              {res.warnings.length > 0 && (
                <div
                  className={`${c.warn}${res.warnings.some((w) => w.includes('못') || w.includes('초과')) ? ' ' + c.bad : ''}`}
                >
                  {res.warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}
            </div>

            {/* 일자 아젠다 — 선택 요일의 온디맨드 세부. 미배치(start==null) 학습 행도 여기서 체크(캘린더 세그엔 안 뜸). */}
            {hasStudyItems && (
              <div className={c.agenda} aria-label={`${DOW_MON[sel]} 아젠다`}>
                <div className={c.agendaT}>
                  {DOW_MON[sel]} {fmtShort(selDay.date)}
                  {selDay.isToday && ' · 오늘'}
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
