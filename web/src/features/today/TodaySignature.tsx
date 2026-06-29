/* ============================================================
   TodaySignature — 오늘 탭 = 데모 v6 단일 화면 대시보드(에디토리얼 다크).
   프레임을 가득 채우는 4컬럼 그리드 [회전 스파인 | 스탯 | 발광 트랙 | 오늘의 블록] + 하단 스트립.
   진행률·연속·마감 리드아웃과 "지금 시작" 주 액션은 상단 바(usePageChrome)로 끌어올림.
   세부(블록 액션·일일 의식·흐름 가이드)는 onOpenMore 패널로 — 기본은 한 화면, 무스크롤.
============================================================ */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePageChrome } from '@/store/usePageChrome';
import { NeonTrack, type NeonSeg } from '@/components/hud';
import { isDone, studyStreak } from '@/lib/persistence';
import { openBacklog } from '@/lib/methodology';
import { layoutDay } from '@/lib/scheduler';
import { todayISO, parseISO, mondayOf, addDays, iso, dayDiff, ddayInfo, toHM } from '@/lib/utils';
import type { AppState } from '@/lib/types';
import s from './TodaySignature.module.css';

interface AnkiLive {
  decks?: { new?: number; learn?: number; review?: number }[];
}
function ankiDue(state: AppState): number | null {
  const v = state._ankiLive as AnkiLive | undefined;
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
const WD = ['월', '화', '수', '목', '금', '토', '일'];

export function TodaySignature({ onOpenMore }: { onOpenMore: () => void }) {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const toggleDone = useApp((s) => s.toggleDone);
  const setChrome = usePageChrome((s) => s.setChrome);
  const clearChrome = usePageChrome((s) => s.clear);
  const navigate = useNavigate();
  const go = (to: string) => navigate(to, { viewTransition: true });

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

  const nowMin = (() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();
  const startKey = (e: (typeof enriched)[number]) => e.start ?? 9999;
  const pending = enriched.filter((e) => !e.done);
  const current = pending.find((e) => e.start != null && e.end != null && nowMin >= e.start && nowMin < e.end);
  const next = pending.filter((e) => startKey(e) >= nowMin).sort((a, b) => startKey(a) - startKey(b))[0];
  const earliest = pending.slice().sort((a, b) => startKey(a) - startKey(b))[0];
  const focus = current || next || earliest || null;
  const allDone = todayTotal > 0 && pending.length === 0;

  const after = focus?.end ?? nowMin;
  const upNext =
    pending.filter((e) => e !== focus && startKey(e) >= after).sort((a, b) => startKey(a) - startKey(b))[0] ||
    pending.filter((e) => e !== focus).sort((a, b) => startKey(a) - startKey(b))[0] ||
    null;

  const mon = mondayOf(today);
  const weekData = WD.map((lab, i) => {
    const date = addDays(mon, i);
    const k = iso(date);
    const day = (res.days || []).find((d) => d.ds === k);
    const min = (day?.items || []).reduce((t, it) => t + (it.min || 0), 0);
    return { lab, h: min / 60, today: k === ds };
  });
  const maxH = Math.max(0.1, ...weekData.map((d) => d.h));
  const weekTotalH = weekData.reduce((t, d) => t + d.h, 0);

  const streak = studyStreak(state);
  const due = ankiDue(state);
  const openBl = openBacklog(state).length;

  // 마감 임박(스트립) + 가장 가까운 마감(상단 리드아웃).
  const ddays = (res.itemStat || [])
    .filter((st) => st.deadline && !st.finished)
    .map((st) => ({ name: st.name, color: st.color, dday: dayDiff(ds, st.deadline as string) }))
    .filter((st) => st.dday >= 0)
    .sort((a, b) => a.dday - b.dday);
  const soon = ddays.filter((st) => st.dday <= 14).slice(0, 3);
  const nearestDday = ddays.length ? ddays[0]!.dday : null;

  // NeonTrack 세그먼트.
  const tl = L?.tl || [];
  const segs: NeonSeg[] = tl
    .filter((e) => e.start != null && e.end != null)
    .map((e): NeonSeg => {
      if (e.kind === 'block') {
        return {
          start: e.start,
          end: e.end,
          tone: 'muted',
          label: e.name,
          place: 'up',
          title: `${e.name} ${toHM(e.start)}–${toHM(e.end)}`,
        };
      }
      const tone = e.type === 'new' ? 'primary' : e.type === 'rev' || e.type === 'anki' ? 'soft' : 'muted';
      return {
        start: e.start,
        end: e.end,
        tone,
        label: e.name,
        sub: e.chapters?.length ? e.chapters.join(', ') : e.type ? TYPE_LABEL[e.type] : undefined,
        place: e.type === 'new' ? 'dn' : undefined,
        accent: e.type === 'new',
        title: `${e.name} ${toHM(e.start)}–${toHM(e.end)}`,
      };
    });
  const mins = segs.flatMap((g) => [g.start, g.end]);
  let lo = 6 * 60;
  let hi = 24 * 60;
  if (mins.length) {
    lo = Math.min(lo, Math.min(...mins));
    hi = Math.max(hi, Math.max(...mins));
  }
  lo = Math.max(0, Math.floor(lo / 180) * 180);
  hi = Math.min(1440, Math.ceil(hi / 180) * 180);

  const kicker = todayTotal === 0 ? '오늘 할 일' : allDone ? '오늘 학습' : current ? '지금 할 일' : '다음 할 일';
  const subjName = allDone ? '완료' : focus ? focus.it.name : '—';
  const focusWhen = focus && focus.start != null && focus.end != null ? `${toHM(focus.start)}–${toHM(focus.end)}` : '—';
  const focusChapter = focus
    ? focus.it.chapters?.length
      ? focus.it.chapters.join(', ')
      : TYPE_LABEL[focus.it.type] || '학습'
    : '—';

  // 진행률·연속·마감 + 주 액션을 상단 바로 끌어올림(데모 v6 헤더).
  useEffect(() => {
    setChrome(
      [
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
      todayTotal === 0
        ? { label: '학습 항목 설정 →', onClick: () => go('/items') }
        : allDone
          ? { label: '기록 보기', onClick: () => go('/journal') }
          : { label: '지금 시작 →', onClick: onOpenMore },
    );
    return () => clearChrome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct, streak, nearestDday, todayTotal, allDone]);

  const toggle = (e: (typeof enriched)[number]) => toggleDone(ds, e.it.sid, e.it.type, e.it.min, !e.done);

  return (
    <section className={s.today} aria-label="오늘 대시보드">
      <div className={s.grid}>
        {/* 1 — 회전 스파인 */}
        <div className={s.spine}>
          <div className={s.kicker}>{kicker}</div>
          <div className={s.subj} style={focus && !allDone ? { color: focus.it.color || 'var(--ink)' } : undefined}>
            {subjName}
          </div>
          <div className={s.clock}>{toHM(nowMin)}</div>
        </div>

        {/* 2 — 스탯 */}
        <div className={s.stats}>
          <div className={s.st}>
            <div className={s.stL}>When</div>
            <div className={s.stV}>{focusWhen}</div>
          </div>
          <div className={s.st}>
            <div className={s.stL}>챕터</div>
            <div className={s.stV}>{focusChapter}</div>
          </div>
          <div className={`${s.st} ${s.big}`}>
            <div className={s.stL}>오늘 블록</div>
            <div className={s.stV}>
              {todayDone}
              <small> / {todayTotal}</small>
            </div>
          </div>
          <div className={s.st}>
            <div className={s.stL}>이번 주</div>
            <div className={s.stV}>
              {weekTotalH.toFixed(1)}
              <small> h</small>
            </div>
          </div>
        </div>

        {/* 3 — 발광 트랙 + 다음 콜아웃 + 주간 미니트랙 */}
        <div className={s.track}>
          <div>
            <div className={s.trackHead}>
              <span className={s.t}>오늘의 흐름 — TRACK</span>
              <span className={s.now}>● {toHM(nowMin)} LIVE</span>
            </div>
            {!allDone && upNext ? (
              <div className={s.next}>
                <span className={s.arr}>다음 →</span>
                <b>
                  {upNext.it.name}
                  {upNext.it.chapters?.length ? ` ${upNext.it.chapters.join(', ')}` : ''}
                </b>{' '}
                · {TYPE_LABEL[upNext.it.type] || '학습'}
                {upNext.start != null ? ` · ${toHM(upNext.start)} 시작` : ''}
              </div>
            ) : (
              <div className={s.next}>
                {allDone ? (
                  <>
                    <span className={s.arr}>✓</span>오늘 블록을 모두 끝냈어요 — 내일도 이대로.
                  </>
                ) : todayTotal === 0 ? (
                  '학습 항목·일과를 설정하면 오늘의 흐름이 여기에 그려져요.'
                ) : (
                  '오늘의 마지막 블록이에요.'
                )}
              </div>
            )}
          </div>

          {segs.length ? (
            <NeonTrack
              segs={segs}
              rangeStart={lo}
              rangeEnd={hi}
              nowMin={nowMin}
              ariaLabel={`오늘의 학습 타임라인 — ${todayDone}/${todayTotal} 완료`}
            />
          ) : (
            <div className={s.trackEmpty}>
              아직 배치된 블록이 없어요. <b>학습 항목</b>·<b>가용시간</b>을 설정하면 트랙이 채워집니다.
            </div>
          )}

          <div className={s.week}>
            <span className={s.wlab}>
              이번 주
              <br />
              {weekTotalH.toFixed(1)}h
            </span>
            {weekData.map((d, i) => (
              <div key={i} className={`${s.wd}${d.today ? ' ' + s.todayCol : ''}`}>
                <div className={s.wbar}>
                  <i style={{ height: `${Math.round((d.h / maxH) * 100)}%` }} />
                </div>
                <div className={s.wdd}>{d.lab}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 4 — 오늘의 블록(클릭 = 완료 토글) */}
        <div className={s.sched}>
          <h2 className={s.schedT}>
            오늘의 블록 · {todayDone}/{todayTotal}
          </h2>
          <div className={s.schedRows}>
            {enriched.length ? (
              enriched.map((e, i) => {
                const cur = e === current;
                return (
                  <button
                    key={e.it.sid + '|' + e.it.type + '|' + i}
                    type="button"
                    className={`${s.row}${e.done ? ' ' + s.rowDone : ''}${cur ? ' ' + s.rowCur : ''}`}
                    onClick={() => toggle(e)}
                    aria-label={`${e.it.name} 완료 토글`}
                    aria-pressed={e.done}
                  >
                    <span className={s.bull} style={!e.done && !cur ? { background: e.it.color } : undefined} />
                    <span className={s.nm}>
                      {e.it.name}
                      {e.it.chapters?.length ? <small> {e.it.chapters.join(', ')}</small> : null}
                    </span>
                    <span className={s.tm}>{e.start != null ? toHM(e.start) : ''}</span>
                  </button>
                );
              })
            ) : (
              <div className={s.schedEmpty}>아직 오늘 배치된 블록이 없어요.</div>
            )}
          </div>
          <button type="button" className={s.more} onClick={onOpenMore}>
            ＋ 블록 상세 · 일일 의식 · 흐름 가이드
          </button>
        </div>
      </div>

      {/* 하단 스트립 — 마감·Anki·보충 */}
      <div className={s.strip}>
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
