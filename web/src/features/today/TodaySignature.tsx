/* ============================================================
   TodaySignature — 오늘 탭 = 데모 v6 단일 화면 대시보드(에디토리얼 다크).
   프레임을 가득 채우는 4컬럼 그리드 [회전 스파인 | 스탯 | 발광 트랙 | 오늘의 블록] + 하단 스트립.
   진행률·연속·마감 리드아웃과 "지금 시작" 주 액션은 상단 바(usePageChrome)로 끌어올림.
   세부(블록 액션·일일 의식·흐름 가이드)는 onOpenMore 패널로 — 기본은 한 화면, 무스크롤.
============================================================ */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ui } from '@/shell';
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useFocus } from '@/store/useFocus';
import { isDone, studyStreak } from '@/lib/persistence';
import { pickFocus, focusMinutes } from '@/lib/focusState';
import { openBacklog } from '@/lib/methodology';
import { layoutDay, freeWindowsForWeekday, freeMinAfter } from '@/lib/scheduler';
import { pickRetrieval, retrievableCount } from '@/lib/retrieval';
import { riskSummary } from '@/lib/spacedReview';
import { ProgressRing } from '@/components/ProgressRing';
import { todayISO, parseISO, mondayOf, addDays, iso, dayDiff, ddayInfo, toHM, hLabel, DOW_MON } from '@/lib/utils';
import { useCountUp, useHeroPointer } from '@/lib/interactions';
import s from './TodaySignature.module.css';

interface AnkiLive {
  decks?: { new?: number; learn?: number; review?: number }[];
}
function ankiDue(v: AnkiLive | undefined | null): number | null {
  if (!v?.decks) return null;
  return v.decks.reduce((t, d) => t + +(d.new || 0) + +(d.learn || 0) + +(d.review || 0), 0);
}

const TYPE_LABEL: Record<string, string> = {
  new: '집중 학습',
  rev: '간격 복습',
  blank: '백지 복습',
  anki: 'Anki',
  mock: '모의시험',
};

export function TodaySignature({ onOpenMore }: { onOpenMore: () => void }) {
  const state = useApp((s) => s.state);
  const ankiLive = useRuntime((s) => s.cache._ankiLive) as AnkiLive | undefined | null;
  const res = useSchedule();
  const toggleDone = useApp((s) => s.toggleDone);
  const navigate = useNavigate();
  const go = (to: string) => navigate(to, { viewTransition: true });
  const [recallShown, setRecallShown] = useState(false); // A2 — 회상 정답 공개 여부

  // 히어로 포인터 추적 — 스포트라이트(--mx/--my) + 3D 틸트(--tiltX/Y). 정본 훅(interactions) 공유.
  const { ref: heroRef, onMouseMove: onHeroMove, onMouseLeave: onHeroLeave } = useHeroPointer(7);

  // 집중 타이머(포모도로) — 전역 세션(useFocus): 탭 이동·새로고침에도 이어짐. 종료 감지는 FocusChip.
  const timer = useFocus((st) => st.session);
  const startSession = useFocus((st) => st.start);
  const stopSession = useFocus((st) => st.stop);

  // 적응형 틱 — 초 단위 표시는 포모도로(mmss)뿐이므로 세션 중에만 1초, 평시엔 30초(FocusChip과 동일 패턴).
  // 무조건 1초는 방치된 대시보드를 초당 리렌더하는 60배 과잉이었다. 백그라운드 정지·복귀 캐치업 유지.
  const [, setTick] = useState(0);
  const tickPeriod = timer ? 1000 : 30_000;
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const startTick = () => {
      if (id == null) id = setInterval(() => setTick((t) => (t + 1) % 86400), tickPeriod);
    };
    const stopTick = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVis = () => {
      if (document.hidden) stopTick();
      else {
        setTick((t) => (t + 1) % 86400); // 복귀 즉시 캐치업
        startTick();
      }
    };
    // 주기 전환(세션 시작/종료) 자체가 리렌더를 동반하므로 즉시 캐치업은 불필요 — 틱만 재설정.
    startTick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopTick();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [tickPeriod]);

  const ds = todayISO(state);
  const today = parseISO(ds);

  const todayDay = (res.days || []).find((d) => d.ds === ds);
  const items = todayDay?.items || [];
  const L = items.length ? layoutDay(state, todayDay!) : null;
  const timeBy: Record<string, { start: number | null; end: number | null }> = {};
  L?.sessions.forEach((se) => {
    const k = se.sid + '|' + se.type;
    if (timeBy[k] == null) timeBy[k] = { start: se.start, end: se.end };
  });

  const enriched = items.map((it) => {
    const tm = timeBy[it.sid + '|' + it.type] || { start: null, end: null };
    return { it, start: tm.start, end: tm.end, done: isDone(state, ds, it.sid, it.type) };
  });
  const todayDone = enriched.filter((e) => e.done).length;
  const todayTotal = items.length;
  const pct = todayTotal ? Math.round((todayDone / todayTotal) * 100) : 0;

  const nowDate = new Date();
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  const nowMs = nowDate.getTime();
  const startKey = (e: (typeof enriched)[number]) => e.start ?? 9999;
  const pending = enriched.filter((e) => !e.done);
  // '지금 할 일' 선택은 lib/focusState.pickFocus와 공유 — 팔레트·상단 바 시작과 같은 규칙.
  const { current, focus } = pickFocus(enriched, nowMin);
  const allDone = todayTotal > 0 && pending.length === 0;

  const after = focus?.end ?? nowMin;
  const upNext =
    pending.filter((e) => e !== focus && startKey(e) >= after).sort((a, b) => startKey(a) - startKey(b))[0] ||
    pending.filter((e) => e !== focus).sort((a, b) => startKey(a) - startKey(b))[0] ||
    null;

  const mon = mondayOf(today);
  const weekData = DOW_MON.map((lab, i) => {
    const date = addDays(mon, i);
    const k = iso(date);
    const day = (res.days || []).find((d) => d.ds === k);
    const min = (day?.items || []).reduce((t, it) => t + (it.min || 0), 0);
    return { lab, h: min / 60, today: k === ds };
  });
  const weekTotalH = weekData.reduce((t, d) => t + d.h, 0);
  const weekShown = useCountUp(weekTotalH);

  const streak = studyStreak(state);
  const due = ankiDue(ankiLive);
  const openBl = openBacklog(state).length;
  // 셋업은 됐지만(과목 있음) 오늘 배치가 0인 경우를 콜드스타트와 구분 — 빈 메시지가 이미 설정한 사용자에게
  // 또 "설정하라"고 말하지 않도록. 마감 지남·가용시간 없음 등이면 스케줄로 안내.
  const hasItems = state.items.some((it) => it.name);

  // A1 — 어제 셧다운에서 남긴 '내일 한 줄'을 오늘 아침 다시 보여줌(셧다운→모닝 루프 닫기).
  const prevNote = (state.rituals?.[iso(addDays(today, -1))]?.note || '').trim();
  // A3 — 오늘 '일과 블록·이미 배치된 학습 뺀' 남은 가용시간(now 이후) — 워터마크를 정보성으로.
  // 배치된 날이면 layoutDay의 잔여 free(학습 세션·일과 차감 + 당일 오버라이드 캡 반영)를 쓰고,
  // 빈 날(L 없음)이면 순수 루틴 창으로 폴백. now 이후로 클램프해 빡빡한 날 과대표시를 막는다.
  const freeIntervals: [number, number][] = L
    ? L.free
    : freeWindowsForWeekday(state, today.getDay()).windows.map((w) => [w.s, w.e] as [number, number]);
  const freeLeftH = Math.round((freeMinAfter(freeIntervals, nowMin) / 60) * 10) / 10;
  // A2 — 회상 카드(내 과거 요약을 인출 연습으로). 후보 없으면 null.
  const recall = pickRetrieval(state, ds);
  const recallN = recall ? retrievableCount(state, ds) : 0; // '회상 N개 대기' — 실제 대기 수량
  // 회상 카드가 바뀌면(새 날짜·다른 요약) 정답 공개를 초기화 — 다음 카드가 답이 열린 채 뜨는 인출연습 무력화 방지.
  // effect 대신 렌더 중 조건부 setState(React 권장 · 이 코드베이스의 draftFor 관용과 동일).
  const recallKey = recall ? `${ds}|${recall.summary.name || ''}` : '';
  const [recallKeyShown, setRecallKeyShown] = useState(recallKey);
  if (recallKey !== recallKeyShown) {
    setRecallKeyShown(recallKey);
    setRecallShown(false);
  }
  // A4 — 완료 후 다음 동력: 내일 첫 학습 + 복습 위험(개념 간격반복).
  const tmrNew = (res.days || []).find((d) => d.ds === iso(addDays(today, 1)))?.items.find((it) => it.type === 'new');
  const risk = riskSummary(state, res.days || [], ds);
  const riskN = risk.overdue + risk.due;

  // 마감 임박(스트립) + 가장 가까운 마감(상단 리드아웃).
  const ddays = (res.itemStat || [])
    .filter((st) => st.deadline && !st.finished)
    .map((st) => ({ name: st.name, color: st.color, dday: dayDiff(ds, st.deadline as string) }))
    .filter((st) => st.dday >= 0)
    .sort((a, b) => a.dday - b.dday);
  const soon = ddays.filter((st) => st.dday <= 14).slice(0, 3);
  const nearestDday = ddays.length ? ddays[0]!.dday : null;

  // 오늘의 흐름 노드 — 학습(체크 가능)+일과 블록을 시간순 단일 리스트로(무지개 가로 트랙 폐기).
  const tl = L?.tl || [];
  type FlowNode = {
    key: string;
    kind: 'study' | 'block';
    start: number;
    end: number | null;
    name: string;
    sub: string;
    color?: string;
    done: boolean;
    e: (typeof enriched)[number] | null;
  };
  const flowNodes: FlowNode[] = [
    ...enriched
      .filter((e) => e.start != null)
      .map((e): FlowNode => ({
        key: 'study|' + e.it.sid + '|' + e.it.type,
        kind: 'study',
        start: e.start as number,
        end: e.end,
        name: e.it.name,
        sub: e.it.chapters?.length ? e.it.chapters.join(', ') : TYPE_LABEL[e.it.type] || '학습',
        color: e.it.color,
        done: e.done,
        e,
      })),
    ...tl
      .filter((t) => t.kind === 'block' && t.start != null)
      .map((t, i): FlowNode => ({
        key: 'block|' + i + '|' + String(t.start),
        kind: 'block',
        start: t.start as number,
        end: (t.end ?? null) as number | null,
        name: t.name || '블록',
        sub: t.btype && t.btype !== t.name ? t.btype : '일과',
        color: t.color,
        done: false,
        e: null,
      })),
  ].sort((a, b) => a.start - b.start);

  const kicker = todayTotal === 0 ? '오늘 할 일' : allDone ? '오늘 학습' : current ? '지금 할 일' : '다음 할 일';
  const subjName = allDone ? '완료' : focus ? focus.it.name : todayTotal === 0 ? '비어 있음' : '—';
  const focusMin = focusMinutes(focus);
  const focusWhen = focus && focus.start != null && focus.end != null ? `${toHM(focus.start)}–${toHM(focus.end)}` : '—';
  const focusChapter = focus
    ? focus.it.chapters?.length
      ? focus.it.chapters.join(', ')
      : TYPE_LABEL[focus.it.type] || '학습'
    : '—';

  const dispKicker = kicker;
  const dispSubj = subjName;
  const dispWhen = focusWhen;
  const dispChapter = focusChapter;
  const dispColor = !allDone && focus ? focus.it.color : undefined;

  // 집중 타이머(포모도로) — 남은 초·진행%·MM:SS(1초 틱으로 갱신). 종료 알림·완료 연결은 FocusChip이.
  const timerLeft = timer ? Math.max(0, Math.round((timer.endsAt - nowMs) / 1000)) : 0;
  const timerPct = timer && timer.total ? Math.min(100, ((timer.total - timerLeft) / timer.total) * 100) : 0;
  const mmss = `${String(Math.floor(timerLeft / 60)).padStart(2, '0')}:${String(timerLeft % 60).padStart(2, '0')}`;
  // 포모도로 프리셋 — 기본은 블록 파생(focusMinutes), 25/50은 명시 선택.
  const startTimer = (min?: number) => {
    if (!focus) return;
    startSession({
      ds,
      sid: focus.it.sid,
      type: focus.it.type,
      name: focus.it.name,
      min: min ?? focusMinutes(focus),
      blockMin: focus.it.min,
    });
  };
  // 조기중단 confirm — 진행 중 세션이 실수 클릭으로 날아가는 것 방지(휴식은 즉시 중단).
  const stopTimer = async () => {
    if (timer?.kind === 'break') return stopSession();
    if (
      await ui.confirm('집중 세션을 중단할까요? 진행 시간은 기록되지 않아요.', {
        title: '집중 중단',
        okLabel: '중단',
        danger: true,
      })
    )
      stopSession();
  };

  // 전부 완료 순간 셀레브레이션(한 번만).
  const wasDone = useRef(false);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (allDone && !wasDone.current) {
      wasDone.current = true;
      setCelebrate(true);
      ui.toast('오늘 블록 완료! 🎉', 'info');
      const id = setTimeout(() => setCelebrate(false), 1400);
      return () => clearTimeout(id);
    }
    if (!allDone) wasDone.current = false;
  }, [allDone]);

  // 진행률·연속·마감 + 주 액션을 상단 바로 끌어올림(데모 v6 헤더).
  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '진행률', value: todayTotal ? `${pct}%` : '—', accent: true },
        {
          label: '연속',
          value: (
            <>
              {streak}
              <small> 일</small>
            </>
          ),
        },
        {
          label: '마감',
          // E-2: D-day만이 아니라 '어느 과목을 우선할지' 이름까지 리드아웃(가장 가까운 마감).
          value: nearestDday == null ? '—' : `D-${nearestDday}${ddays[0]?.name ? ` · ${ddays[0]!.name}` : ''}`,
        },
      ],
      action:
        todayTotal === 0
          ? { label: '학습 항목 설정 →', onClick: () => go('/items') }
          : allDone
            ? { label: '기록 보기', onClick: () => go('/journal') }
            : {
                label: '지금 시작 →',
                // getState로 항상 신선한 세션을 읽음(chrome 이펙트 deps에 안 묶임).
                // 이미 집중 중이면 재시작 대신 세부 패널을 연다.
                onClick: () => {
                  const f = useFocus.getState();
                  if (f.session) onOpenMore();
                  else f.startOnCurrent();
                },
              },
    }),
    [pct, streak, nearestDday, todayTotal, allDone],
  );

  const toggle = (e: (typeof enriched)[number]) => toggleDone(ds, e.it.sid, e.it.type, e.it.min, !e.done);

  return (
    <section className={s.today} aria-label="오늘 대시보드">
      {/* ── 상단 밴드: 포커스 히어로 | 오늘의 블록 ── */}
      <div className={s.top}>
        {/* HERO — 거대 과목명 = 행동의 무대. 과목색 오로라 + 통합 집중 시작. */}
        <div
          ref={heroRef}
          onMouseMove={onHeroMove}
          onMouseLeave={onHeroLeave}
          className={`${s.hero}${allDone ? ' ' + s.heroDone : ''}`}
          style={dispColor ? ({ '--tint': dispColor } as CSSProperties) : undefined}
        >
          <div className={s.aura} aria-hidden="true" />
          <div className={s.spotlight} aria-hidden="true" />
          {timer && <div className={s.heroFill} style={{ width: `${timerPct}%` }} aria-hidden="true" />}
          {/* 오버사이즈 게이지 — 우상단 허공을 '오늘 남은 가용시간'으로 채움(정보성 워터마크). */}
          <span className={s.ghostGauge} aria-hidden="true">
            <b>{freeLeftH}</b>
            <em>h 남음</em>
          </span>

          <div className={s.heroHead}>
            <span className={s.eyebrow}>
              {current && <i className={s.live} />}
              {dispKicker}
            </span>
            <span className={s.heroWhen}>{dispWhen}</span>
          </div>

          <h2 className={s.subj}>{dispSubj}</h2>
          <div className={s.heroSub}>
            {todayTotal === 0 ? (
              hasItems ? (
                <span className={s.momentum}>
                  <span>오늘은 배치된 블록이 없어요</span>
                  <button type="button" className={s.mChip} onClick={() => go('/schedule')}>
                    주간 스케줄 확인
                  </button>
                </span>
              ) : (
                '학습 항목을 추가하면 오늘의 흐름이 그려져요.'
              )
            ) : allDone ? (
              // A4 — 완료 후 죽은 화면 대신 '다음 동력'(내일·복습 위험·보충 회수·회상).
              <span className={s.momentum}>
                {tmrNew ? (
                  <span className={s.chapter}>내일 · {tmrNew.name}</span>
                ) : (
                  <span>내일 일정은 아직 비어 있어요</span>
                )}
                {riskN > 0 && (
                  <button type="button" className={s.mChip} onClick={() => go('/review')}>
                    복습 위험 {riskN}
                  </button>
                )}
                {openBl > 0 && (
                  <button type="button" className={s.mChip} onClick={() => go('/journal')}>
                    보충 {openBl} 회수
                  </button>
                )}
                {recall && <span className={s.upnext}>회상 {recallN}개 대기 ↓</span>}
              </span>
            ) : (
              <>
                <span className={s.chapter}>{dispChapter}</span>
                {upNext && (
                  <span className={s.upnext}>
                    다음 · {upNext.it.name}
                    {upNext.start != null ? ` ${toHM(upNext.start)}` : ''}
                  </span>
                )}
              </>
            )}
          </div>
          {/* A1 — 어제 남긴 '내일 한 줄'(아직 오늘 진행 중일 때만; 완료 화면은 동력에 집중). */}
          {prevNote && !allDone && (
            <div className={s.yesterday}>
              <span aria-hidden="true">🌙</span> 어제 남긴 한 줄 — <b>{prevNote}</b>
            </div>
          )}

          {/* 주 액션 — 집중 타이머(포모도로). 히어로 안에 통합 = 가장 큰 요소가 곧 행동. */}
          <div className={s.actions}>
            {timer ? (
              <button
                type="button"
                className={`${s.cta} ${s.ctaRun}`}
                onClick={() => void stopTimer()}
                aria-label={timer.kind === 'break' ? '휴식 타이머 정지' : '집중 타이머 정지'}
              >
                <span className={s.ctaNum}>{mmss}</span>
                <span className={s.ctaCap}>{timer.kind === 'break' ? '☕ 휴식 · ■ 정지' : '■ 정지'}</span>
              </button>
            ) : allDone ? (
              <button type="button" className={`${s.cta} ${s.ctaGhost}`} onClick={() => go('/journal')}>
                <span className={s.ctaGo}>✓ 오늘 완료</span>
                <span className={s.ctaCap}>기록 보기 →</span>
              </button>
            ) : focus ? (
              <>
                <button type="button" className={s.cta} onClick={() => startTimer()} aria-label="집중 타이머 시작">
                  <span className={s.ctaGo}>▶ 집중 시작</span>
                  <span className={s.ctaCap}>{focusMin}분</span>
                </button>
                {/* 포모도로 프리셋 — 블록 길이 대신 25/50분 명시 시작. */}
                <span className={s.presets}>
                  {[25, 50]
                    .filter((m) => m !== focusMin)
                    .map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={s.preset}
                        onClick={() => startTimer(m)}
                        aria-label={`${m}분 집중 시작`}
                      >
                        {m}′
                      </button>
                    ))}
                </span>
              </>
            ) : (
              <button type="button" className={s.cta} onClick={() => go('/items')}>
                <span className={s.ctaGo}>＋ 학습 항목 추가</span>
                <span className={s.ctaCap}>시작하기 →</span>
              </button>
            )}
            <span className={s.clock}>{toHM(nowMin)}</span>
          </div>
        </div>

        {/* 오늘의 흐름 — now-중심 세로 레일(학습 체크 + 일과, 색 통일). 무지개 트랙 폐기. */}
        <aside className={s.flow}>
          <h2 className={s.flowHead} aria-label={`오늘의 흐름 ${todayDone}/${todayTotal} 완료`}>
            <span className={`${s.ring}${celebrate ? ' ' + s.ringCele : ''}`} aria-hidden="true">
              <ProgressRing
                size={80}
                r={34}
                pct={pct}
                className={s.ringSvg}
                trackClassName={s.ringTrack}
                arcClassName={s.ringArc}
              />
              <span className={s.ringNum}>
                {todayDone}
                <small>/{todayTotal}</small>
              </span>
            </span>
            <span className={s.flowT}>오늘의 흐름</span>
            <span className={s.now}>● {toHM(nowMin)} LIVE</span>
          </h2>
          <div className={s.rail}>
            {flowNodes.length ? (
              <>
                {flowNodes.map((nd) => {
                  const live = nd.start <= nowMin && (nd.end == null || nowMin < nd.end);
                  const past = nd.done || (nd.end != null && nowMin >= nd.end);
                  const dur = nd.end != null ? ` · ${hLabel(nd.end - nd.start)}` : '';
                  // 현재 블록 실시간 진행률(경과/길이) — 1초 틱으로 갱신.
                  const prog =
                    live && nd.end != null && nd.end > nd.start
                      ? Math.min(100, Math.max(0, Math.round(((nowMin - nd.start) / (nd.end - nd.start)) * 100)))
                      : 0;
                  const cls = `${s.node} ${nd.kind === 'study' ? s.nStudy : s.nBlock}${live ? ' ' + s.nLive : ''}${past ? ' ' + s.nPast : ''}${nd.done ? ' ' + s.nDone : ''}`;
                  const inner = (
                    <>
                      {live && <span className={s.nProg} style={{ width: `${prog}%` }} aria-hidden="true" />}
                      <span className={s.nTime}>{toHM(nd.start)}</span>
                      <span
                        className={s.nDot}
                        style={nd.kind === 'study' && nd.color ? { background: nd.color } : undefined}
                      />
                      <span className={s.nBody}>
                        <span className={s.nName}>{nd.name}</span>
                        <span className={s.nSub}>
                          {nd.sub}
                          {dur}
                        </span>
                      </span>
                      {live && (
                        <span className={s.nNow}>
                          지금 <small>{prog}%</small>
                        </span>
                      )}
                    </>
                  );
                  return nd.e ? (
                    <button
                      key={nd.key}
                      type="button"
                      className={cls}
                      onClick={() => toggle(nd.e!)}
                      aria-label={`${nd.name} 완료 토글`}
                      aria-pressed={nd.done}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div key={nd.key} className={cls}>
                      {inner}
                    </div>
                  );
                })}
                {/* 종결 캡 고스트 — 마지막 노드 뒤 "이후 일정 없음": 스파인이 끝났다고 읽히게(비인터랙티브). */}
                <div className={`${s.node} ${s.nGhost}`}>
                  <span className={s.nTime}>—</span>
                  <span className={s.nDot} />
                  <span className={s.nBody}>
                    <span className={s.nSub}>이후 일정 없음</span>
                  </span>
                </div>
              </>
            ) : (
              <div className={s.railEmpty}>
                {hasItems ? (
                  <>
                    오늘은 배치된 블록이 없어요 — 마감이 지났거나 오늘 가용시간이 없을 수 있어요.{' '}
                    <button type="button" className={s.mChip} onClick={() => go('/schedule')}>
                      주간 스케줄 확인
                    </button>
                  </>
                ) : (
                  <>
                    아직 배치된 블록이 없어요. <b>학습 항목</b>·<b>가용시간</b>을 설정하면 흐름이 채워집니다.
                  </>
                )}
              </div>
            )}
          </div>
          {/* A2 — 회상 위젯: 과거에 쓴 내 요약을 '스스로 다시 설명' 인출 연습으로(테스팅 효과). */}
          {recall && (
            <div className={s.recall}>
              <div className={s.recallTop}>
                <span className={s.recallTag}>🧠 회상</span>
                <span className={s.recallMeta}>
                  {recall.ageDays}일 전 · {recall.summary.name || '요약'}
                </span>
              </div>
              <div className={s.recallQ}>{recall.summary.s1 || '이 개념을 스스로 다시 설명할 수 있나요?'}</div>
              {recallShown ? (
                <div className={s.recallA}>
                  {recall.summary.s2 && (
                    <div>
                      <b>도구·어떻게</b> {recall.summary.s2}
                    </div>
                  )}
                  {recall.summary.s3 && (
                    <div>
                      <b>결과·의미</b> {recall.summary.s3}
                    </div>
                  )}
                  <button type="button" className={s.recallReset} onClick={() => setRecallShown(false)}>
                    가리기
                  </button>
                </div>
              ) : (
                <button type="button" className={s.recallBtn} onClick={() => setRecallShown(true)}>
                  떠올렸다 · 정답 보기
                </button>
              )}
            </div>
          )}
          <button type="button" className={s.more} onClick={onOpenMore}>
            ＋ 블록 상세 · 일일 의식 · 흐름 가이드
          </button>
        </aside>
      </div>

      {/* 하단 스트립 — 이번 주·마감·Anki·보충(이퀄라이저 폐기 → 정돈된 단일 풋바). */}
      <div className={s.strip}>
        <div className={s.grp}>
          <span className={s.grpL}>이번 주</span>
          <button
            type="button"
            className={s.tag}
            onClick={() => go('/schedule')}
            aria-label={`이번 주 ${weekTotalH.toFixed(1)}시간 — 주간 보기로 이동`}
          >
            <b>{weekShown.toFixed(1)}</b> h
          </button>
        </div>
        <div className={s.vline} />
        <div className={s.grp}>
          <span className={s.grpL}>마감 임박</span>
          {soon.length ? (
            soon.map((st) => {
              const { lab } = ddayInfo(st.dday);
              return (
                <button key={st.name} type="button" className={s.tag} onClick={() => go('/items')}>
                  <span className={s.dot} style={{ background: st.color || 'var(--acc)' }} />
                  {st.name} <b>{lab}</b>
                </button>
              );
            })
          ) : (
            <span className={`${s.tag} ${s.tagMut}`}>없음</span>
          )}
        </div>
        <div className={s.vline} />
        <div className={s.grp}>
          <span className={s.grpL}>Anki 대기</span>
          <button
            type="button"
            className={s.tag}
            onClick={() => go('/integrations')}
            title={due == null ? 'Anki 미연결 — 연동 탭에서 실시간 연결' : `복습 대기 ${due}장`}
            aria-label={due == null ? 'Anki 미연결 — 연동 탭으로' : `Anki 복습 대기 ${due}장 — 연동 탭으로`}
          >
            <b>{due == null ? '연결' : due}</b> {due == null ? '필요' : '장'}
          </button>
        </div>
        <div className={s.vline} />
        <div className={s.grp}>
          <span className={s.grpL}>열린 보충</span>
          <button type="button" className={s.tag} onClick={() => go('/journal')}>
            <b>{openBl}</b> 건
          </button>
        </div>
      </div>
    </section>
  );
}
