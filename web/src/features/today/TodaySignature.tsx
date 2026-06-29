/* ============================================================
   TodaySignature — 오늘 탭 단일 시그니처(에디토리얼 다크 · 데모 v6).
   회전 스파인(지금 과목) | 스탯 리드아웃 | 발광 NeonTrack(+다음 콜아웃+주간 미니트랙) + 하단 스트립.
   데이터는 기존 파생(useSchedule·layoutDay·studyStreak)을 그대로 — UI만 시그니처로 재구성.
============================================================ */
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { NeonTrack, Readout, type NeonSeg } from '@/components/hud';
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

export function TodaySignature() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const navigate = useNavigate();
  const go = (to: string) => navigate(to, { viewTransition: true });

  const ds = todayISO(state);
  const today = parseISO(ds);

  // 오늘 블록 + 시각 배정(빈 시간 기준).
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

  // 다음 블록(포커스 이후 가장 이른 미완료).
  const after = focus?.end ?? nowMin;
  const upNext =
    pending.filter((e) => e !== focus && startKey(e) >= after).sort((a, b) => startKey(a) - startKey(b))[0] ||
    pending.filter((e) => e !== focus).sort((a, b) => startKey(a) - startKey(b))[0] ||
    null;

  // 주간(이번 주) 시간 + 일별 — 미니트랙.
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

  // 마감 임박(D-14 이내, 미완료) — 가까운 순 최대 3개.
  const soon = (res.itemStat || [])
    .filter((st) => st.deadline && !st.finished)
    .map((st) => ({ name: st.name, color: st.color, dday: dayDiff(ds, st.deadline as string) }))
    .filter((st) => st.dday >= 0 && st.dday <= 14)
    .sort((a, b) => a.dday - b.dday)
    .slice(0, 3);

  // NeonTrack 세그먼트 — layoutDay 타임라인(루틴 블록 + 학습 세션).
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
  // 표시 범위 — 세그 최소/최대를 3시간 격자로 스냅(기본 06–24).
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

  const startNow = () =>
    document.getElementById('today-blocks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section className={s.sigWrap} aria-label="오늘 대시보드">
      <div className={s.sig}>
        {/* 스파인 — 회전 라벨 + 지금 과목 + 현재 시각 */}
        <div className={s.spine}>
          <div className={s.kickerTag}>{kicker}</div>
          <div className={s.subjName} style={focus && !allDone ? { color: focus.it.color || 'var(--ink)' } : undefined}>
            {subjName}
          </div>
          <div className={s.clock}>{toHM(nowMin)}</div>
        </div>

        {/* 스탯 리드아웃 + 주 액션 */}
        <div className={s.stats}>
          <Readout label="진행률" accent size="lg" value={todayTotal ? `${pct}%` : '—'} />
          <Readout
            label="오늘 블록"
            value={
              <>
                {todayDone}
                <small> / {todayTotal}</small>
              </>
            }
          />
          <Readout
            label="연속"
            value={
              <>
                {streak}
                <small> 일</small>
              </>
            }
          />
          <Readout
            label="이번 주"
            value={
              <>
                {weekTotalH.toFixed(1)}
                <small> h</small>
              </>
            }
          />
          <div className={s.cta}>
            {todayTotal === 0 ? (
              <button type="button" className={s.ctaBtn} onClick={() => go('/items')}>
                학습 항목 설정하기 →
              </button>
            ) : allDone ? (
              <button type="button" className={`${s.ctaBtn} ${s.ctaGhost}`} onClick={() => go('/journal')}>
                학습 기록 보기
              </button>
            ) : (
              <button type="button" className={s.ctaBtn} onClick={startNow}>
                시작하기 →
              </button>
            )}
          </div>
        </div>

        {/* 발광 트랙 + 다음 콜아웃 + 주간 미니트랙 */}
        <div className={s.track}>
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
      </div>

      {/* 하단 라인 스트립 — 마감·Anki·보충 */}
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
