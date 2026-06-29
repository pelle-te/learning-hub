/* ============================================================
   TodayHero — 오늘 탭 최상단 단일 초점 히어로(재설계).
   "지금 뭐 할까?"에 단 하나로 답한다 — 현재(또는 다음) 블록을 화면에서 제일 큰 픽셀로.
   보조 지표(연속·Anki·보충·주간%)는 조용한 하단 줄로 강등, 마감 임박은 그 아래 칩 스트립.
============================================================ */
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { Pill, Button, type PillTone } from '@/components/ui';
import { isDone, studyStreak } from '@/lib/persistence';
import { openBacklog } from '@/lib/methodology';
import { layoutDay } from '@/lib/scheduler';
import { todayISO, parseISO, mondayOf, addDays, iso, fmt, dayDiff, ddayInfo, toHM } from '@/lib/utils';
import type { AppState } from '@/lib/types';
import styles from './TodayHero.module.css';

interface AnkiLive {
  decks?: { new?: number; learn?: number; review?: number }[];
}

function ankiDue(state: AppState): number | null {
  const v = state._ankiLive as AnkiLive | undefined;
  if (!v?.decks) return null;
  return v.decks.reduce((t, d) => t + +(d.new || 0) + +(d.learn || 0) + +(d.review || 0), 0);
}

function greeting(hour: number): string {
  if (hour < 5) return '늦은 밤이에요';
  if (hour < 12) return '좋은 아침이에요';
  if (hour < 18) return '좋은 오후예요';
  return '좋은 저녁이에요';
}

/** 블록 유형 → 사람이 읽는 한 단어 라벨(히어로 메타 줄에 표시). */
const TYPE_LABEL: Record<string, string> = {
  new: '집중 학습',
  rev: '간격 복습',
  blank: '백지 복습',
  anki: 'Anki 큐레이션',
  mock: '모의시험',
};

export function TodayHero() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const navigate = useNavigate();
  const go = (to: string) => navigate(to, { viewTransition: true });

  const ds = todayISO(state);
  const today = parseISO(ds);

  // 오늘 블록 + 시각 배정(빈 시간 기준). 시각은 layoutDay가 sid|type별로 부여.
  const todayDay = (res.days || []).find((d) => d.ds === ds);
  const items = todayDay?.items || [];
  const L = items.length ? layoutDay(state, todayDay!) : null;
  const timeBy: Record<string, { start: number | null; end: number | null }> = {};
  L?.sessions.forEach((s) => {
    const k = s.sid + '|' + s.type;
    if (timeBy[k] == null) timeBy[k] = { start: s.start, end: s.end };
  });

  // 각 블록에 시각·완료여부를 붙인다.
  const enriched = items.map((it, i) => {
    const tm = timeBy[it.sid + '|' + it.type] || { start: null, end: null };
    return { it, i, start: tm.start, end: tm.end, done: isDone(state, ds, it.sid, it.type) };
  });
  const todayDone = enriched.filter((e) => e.done).length;
  const todayTotal = items.length;
  const pct = todayTotal ? Math.round((todayDone / todayTotal) * 100) : 0;

  // "지금 할 일" 선정: 현재 시각이 든 미완료 블록 → 없으면 가장 가까운 다음 → 없으면 가장 이른 미완료.
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

  // 주간 달성률(이번 주 월~일 계획 블록 대비 완료) — 허영 지표라 하단 보조 줄로 강등.
  const mon = iso(mondayOf(today));
  const sun = iso(addDays(mondayOf(today), 6));
  let wkTotal = 0;
  let wkDone = 0;
  for (const d of res.days || []) {
    if (d.ds < mon || d.ds > sun) continue;
    for (const it of d.items) {
      wkTotal++;
      if (isDone(state, d.ds, it.sid, it.type)) wkDone++;
    }
  }
  const wkPct = wkTotal ? Math.round((wkDone / wkTotal) * 100) : 0;

  const streak = studyStreak(state);
  const due = ankiDue(state);
  const openBl = openBacklog(state).length;

  // 마감 임박(D-14 이내, 미완료) — 가까운 순 최대 5개
  const soon = (res.itemStat || [])
    .filter((s) => s.deadline && !s.finished)
    .map((s) => ({ name: s.name, color: s.color, dday: dayDiff(ds, s.deadline as string) }))
    .filter((s) => s.dday >= 0 && s.dday <= 14)
    .sort((a, b) => a.dday - b.dday)
    .slice(0, 5);

  // 오늘 블록 카드로 부드럽게 스크롤(같은 페이지 하단). 단일 초점 → 실제 작업으로 잇는 동선.
  const startNow = () =>
    document.getElementById('today-blocks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // 보조 지표(조용한 하단 줄) — 클릭하면 해당 탭으로.
  const stats: { v: React.ReactNode; l: string; to?: string }[] = [
    { v: `🔥 ${streak}`, l: '일 연속', to: '/stats' },
    { v: due == null ? '—' : due, l: 'Anki due', to: '/integrations' },
    { v: openBl, l: '열린 보충', to: '/journal' },
    { v: wkTotal ? `${wkPct}%` : '—', l: '이번 주', to: '/stats' },
  ];

  const kicker = todayTotal === 0 ? '오늘 할 일' : allDone ? '오늘 학습' : current ? '지금 할 일' : '다음 할 일';
  const chapters = focus?.it.chapters?.length ? focus.it.chapters.join(', ') : '';
  const timeStr = focus && focus.start != null && focus.end != null ? `${toHM(focus.start)}–${toHM(focus.end)}` : '';
  const metaParts = focus
    ? [chapters, timeStr, TYPE_LABEL[focus.it.type] || ''].filter(Boolean).join('  ·  ')
    : todayTotal === 0
      ? '학습 항목·일과를 설정하면 다음 할 일이 여기에 떠요'
      : '';

  return (
    <section className={styles.hero} aria-label="오늘 대시보드">
      <div className={styles.topline}>
        <span className={styles.greet}>
          {greeting(today.getHours())} <span className={styles.date}>· {fmt(today)}</span>
        </span>
      </div>

      <div className={styles.kicker}>{kicker}</div>

      {allDone ? (
        <div className={styles.focusName}>오늘 학습 완료 🎉</div>
      ) : focus ? (
        <div className={styles.focusName}>
          <span className={styles.dot} style={{ background: focus.it.color || 'var(--acc)' }} />
          {focus.it.name}
        </div>
      ) : (
        <div className={styles.focusName}>오늘은 배치된 블록이 없어요</div>
      )}

      {(metaParts || allDone) && (
        <div className={styles.meta}>
          {allDone
            ? `${todayTotal}개 블록 모두 끝냈어요${streak > 1 ? ` · 🔥 ${streak}일 연속` : ' · 내일도 이대로'}`
            : metaParts}
        </div>
      )}

      {todayTotal > 0 && (
        <div className={styles.progwrap}>
          <div className={styles.prog} role="img" aria-label={`오늘 블록 ${todayDone}/${todayTotal} 완료`}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className={styles.progv}>
            {todayDone}/{todayTotal} 블록
          </span>
        </div>
      )}

      <div className={styles.cta}>
        {todayTotal === 0 ? (
          <Button variant="primary" onClick={() => go('/items')}>
            학습 항목 설정하기 →
          </Button>
        ) : allDone ? (
          <Button onClick={() => go('/journal')}>학습 기록 보기</Button>
        ) : (
          <Button variant="primary" onClick={startNow}>
            시작하기 →
          </Button>
        )}
      </div>

      <div className={styles.foot}>
        {stats.map(({ v, l, to }, i) =>
          to ? (
            <button
              key={i}
              type="button"
              className={`${styles.stat} ${styles.statLink}`}
              onClick={() => go(to)}
              aria-label={`${l} ${typeof v === 'string' ? v : ''} — 자세히 보기`}
            >
              <span className={styles.statV}>{v}</span>
              <span className={styles.statL}>{l}</span>
            </button>
          ) : (
            <span key={i} className={styles.stat}>
              <span className={styles.statV}>{v}</span>
              <span className={styles.statL}>{l}</span>
            </span>
          ),
        )}
      </div>

      {soon.length > 0 && (
        <div className={styles.deadlines}>
          <span className={styles.dlH}>⏰ 마감 임박</span>
          {soon.map((s) => {
            const { lab, cls } = ddayInfo(s.dday);
            const tone: PillTone = cls === 'bad' ? 'bad' : cls === 'warn' ? 'warn' : 'good';
            return (
              <button
                key={s.name}
                type="button"
                className={`${styles.dl} ${styles.dlLink}`}
                onClick={() => go('/items')}
                aria-label={`${s.name} ${lab} — 학습 항목에서 보기`}
              >
                <span className={styles.dot2} style={{ background: s.color || 'var(--acc)' }} />
                {s.name}
                <Pill tone={tone}>{lab}</Pill>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
