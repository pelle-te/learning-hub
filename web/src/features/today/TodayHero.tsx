/* ============================================================
   TodayHero — 오늘 탭 최상단 대시보드 히어로(신규).
   인사 + 주간 달성률 도넛 + 핵심 통계 타일(블록·연속·Anki·보충) + 마감 임박 과목 스트립.
   '오늘 한눈에'를 더 크게·한 화면에 — 의식 카드(RitualCard)는 체크박스만 남겨 중복 제거.
============================================================ */
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { Pill, type PillTone } from '@/components/ui';
import { isDone, studyStreak } from '@/lib/persistence';
import { openBacklog } from '@/lib/methodology';
import { todayISO, parseISO, mondayOf, addDays, iso, fmt, dayDiff, ddayInfo } from '@/lib/utils';
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

export function TodayHero() {
  const state = useApp((s) => s.state);
  const res = useSchedule();

  const ds = todayISO(state);
  const today = parseISO(ds);

  // 오늘 블록 진행
  const todayDay = (res.days || []).find((d) => d.ds === ds);
  const todayItems = todayDay?.items || [];
  const todayDone = todayItems.filter((it) => isDone(state, ds, it.sid, it.type)).length;

  // 주간 달성률(이번 주 월~일 범위의 계획 블록 대비 완료)
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
  const planned = wkTotal > 0; // 이번 주 계획 블록이 하나도 없으면 0%는 오해 → '계획 없음'으로 표기

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

  const tiles: [React.ReactNode, string][] = [
    [todayItems.length ? `${todayDone}/${todayItems.length}` : '—', '오늘 블록'],
    [`🔥 ${streak}`, '연속 학습일'],
    [due == null ? '—' : due, 'Anki due'],
    [openBl, '열린 보충'],
  ];

  return (
    <section className={styles.hero} aria-label="오늘 대시보드">
      <div className={styles.head}>
        <div>
          <div className={styles.greet}>{greeting(today.getHours())}</div>
          <div className={styles.date}>
            {fmt(today)} · {planned ? '이번 주 학습 달성률' : '이번 주 계획 없음'}
          </div>
        </div>
        <div
          className={styles.ring}
          style={{ ['--p' as string]: planned ? wkPct : 0 }}
          role="img"
          aria-label={planned ? `이번 주 달성률 ${wkPct}%` : '이번 주 계획 없음'}
        >
          <span className={styles.ringv}>{planned ? `${wkPct}%` : '—'}</span>
        </div>
      </div>

      <div className={styles.stats}>
        {tiles.map(([v, l], i) => (
          <div key={i} className={styles.tile}>
            <div className={styles.tilev}>{v}</div>
            <div className={styles.tilel}>{l}</div>
          </div>
        ))}
      </div>

      {soon.length > 0 && (
        <div className={styles.deadlines}>
          <span className={styles.dlH}>⏰ 마감 임박</span>
          {soon.map((s) => {
            const { lab, cls } = ddayInfo(s.dday);
            const tone: PillTone = cls === 'bad' ? 'bad' : cls === 'warn' ? 'warn' : 'good';
            return (
              <span key={s.name} className={styles.dl}>
                <span className={styles.dot} style={{ background: s.color || 'var(--acc)' }} />
                {s.name}
                <Pill tone={tone}>{lab}</Pill>
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}
