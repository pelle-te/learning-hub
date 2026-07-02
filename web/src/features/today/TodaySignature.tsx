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
import { layoutDay } from '@/lib/scheduler';
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

  // 히어로 포인터 추적 — 스포트라이트(--mx/--my) + 3D 틸트(--tiltX/Y). 정본 훅(interactions) 공유.
  const { ref: heroRef, onMouseMove: onHeroMove, onMouseLeave: onHeroLeave } = useHeroPointer(7);

  // 1초 틱 — 시계·현재 블록·집중 타이머를 라이브로 갱신(백그라운드에선 정지, 복귀 시 캐치업).
  const [, setTick] = useState(0);
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const startTick = () => {
      if (id == null) id = setInterval(() => setTick((t) => (t + 1) % 86400), 1000);
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
    startTick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopTick();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // 집중 타이머(포모도로) — 전역 세션(useFocus): 탭 이동·새로고침에도 이어짐. 종료 감지는 FocusChip.
  const timer = useFocus((st) => st.session);
  const startSession = useFocus((st) => st.start);
  const stopSession = useFocus((st) => st.stop);

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
  const startTimer = () => {
    if (!focus) return;
    startSession({
      ds,
      sid: focus.it.sid,
      type: focus.it.type,
      name: focus.it.name,
      min: focusMinutes(focus),
      blockMin: focus.it.min,
    });
  };
  const stopTimer = () => stopSession();

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
        { label: '마감', value: nearestDday == null ? '—' : `D-${nearestDday}` },
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
          {/* 오버사이즈 고스트 시계 — 우상단 허공을 채우는 워터마크(콘텐츠 뒤, 포인터 통과). */}
          <span className={s.ghostClock} aria-hidden="true">
            {toHM(nowMin)}
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
              '학습 항목을 추가하면 오늘의 흐름이 그려져요.'
            ) : (
              <>
                <span className={s.chapter}>{dispChapter}</span>
                {upNext && !allDone && (
                  <span className={s.upnext}>
                    다음 · {upNext.it.name}
                    {upNext.start != null ? ` ${toHM(upNext.start)}` : ''}
                  </span>
                )}
              </>
            )}
          </div>

          {/* 주 액션 — 집중 타이머(포모도로). 히어로 안에 통합 = 가장 큰 요소가 곧 행동. */}
          <div className={s.actions}>
            {timer ? (
              <button
                type="button"
                className={`${s.cta} ${s.ctaRun}`}
                onClick={stopTimer}
                aria-label="집중 타이머 정지"
              >
                <span className={s.ctaNum}>{mmss}</span>
                <span className={s.ctaCap}>■ 정지</span>
              </button>
            ) : allDone ? (
              <button type="button" className={`${s.cta} ${s.ctaGhost}`} onClick={() => go('/journal')}>
                <span className={s.ctaGo}>✓ 오늘 완료</span>
                <span className={s.ctaCap}>기록 보기 →</span>
              </button>
            ) : focus ? (
              <button type="button" className={s.cta} onClick={startTimer} aria-label="집중 타이머 시작">
                <span className={s.ctaGo}>▶ 집중 시작</span>
                <span className={s.ctaCap}>{focusMin}분</span>
              </button>
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
                아직 배치된 블록이 없어요. <b>학습 항목</b>·<b>가용시간</b>을 설정하면 흐름이 채워집니다.
              </div>
            )}
          </div>
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
          <button type="button" className={s.tag} onClick={() => go('/integrations')}>
            <b>{due == null ? '—' : due}</b> 장
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
