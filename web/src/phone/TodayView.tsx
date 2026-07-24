/* ============================================================
   phone/TodayView.tsx — 폰 홈 대시보드(Phase 3 · "열면 오늘이 한눈에").

   데스크톱 TodaySignature(756줄 · 발광 히어로·흐름 레일)를 옮기지 않는다 — 폰은 화면만 새로
   짜고(§9-4) **견고한 신호 몇 개**만 압축해 보여준다: 오늘의 초점(가장 큰 새 학습), 새 학습량,
   복습 대기, 가장 가까운 마감, 스트릭. 상세 편집은 '일' 탭, 복습 실행은 '복습' 탭으로 넘긴다.

   규칙은 lib 것을 그대로 쓴다(studyStreak·riskSummary·deadlineDdays·useSchedule) — 픽셀만 새로.
============================================================ */
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { todayISO, parseISO, fmt, ddayInfo } from '@/lib/utils';
import { studyStreak } from '@/lib/persistence';
import { riskSummary } from '@/lib/spacedReview';
import { deadlineDdays } from '@/lib/scheduleView';
import { pickTodayFocus } from '@/lib/todayFocus';

const CARD = 'rounded-lg border border-line bg-panel p-4';
const STAT = 'flex flex-col gap-0.5 rounded-md border border-line bg-panel2 px-3 py-2.5';
const NAV = 'min-h-12 flex-1 rounded-md text-sm font-semibold';

export default function TodayView({ onGo }: { onGo: (v: 'day' | 'review') => void }): React.JSX.Element {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const today = todayISO(state);

  const day = res.days.find((d) => d.ds === today);
  const newBlocks = (day?.items || []).filter((it) => it.type === 'new');
  const plannedMin = newBlocks.reduce((t, it) => t + (it.min || 0), 0);
  // 오늘의 초점 = 마감·진도 밀림 가중 우선순위(읽기전용 추천 · 스케줄 안 씀 · pickTodayFocus).
  const focusPick = pickTodayFocus(newBlocks, res.itemStat, today);
  const focus = focusPick?.block || null;

  const streak = studyStreak(state);
  const risk = riskSummary(state, res.days, today);
  const reviewN = risk.overdue + risk.due;
  const nearest = deadlineDdays(res.itemStat, today)[0] || null;

  return (
    <section className="flex flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-txt">{fmt(parseISO(today))}</h2>
        {streak > 0 ? (
          <span className="text-sm font-semibold text-acc">🔥 {streak}일 연속</span>
        ) : (
          <span className="text-xs text-mut">오늘 시작해요</span>
        )}
      </header>

      {/* 오늘의 초점 — 가장 큰 새 학습(과목색 좌측 띠). */}
      <div
        className={CARD}
        style={focus?.color ? { borderLeft: `3px solid ${focus.color}`, paddingLeft: 13 } : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs font-bold tracking-wide text-mut uppercase">오늘의 초점</span>
          {focusPick ? <span className="text-2xs font-bold text-acc">{focusPick.reason}</span> : null}
        </div>
        {focus ? (
          <>
            <div className="mt-1 text-base font-bold text-txt">{focus.name}</div>
            {focus.chapters && focus.chapters.length > 0 ? (
              <div className="mt-0.5 truncate text-sm text-mut">{focus.chapters.join(' · ')}</div>
            ) : null}
          </>
        ) : (
          <div className="mt-1 text-sm text-mut">오늘은 새로 배울 게 없어요 — 복습에 집중하세요.</div>
        )}
      </div>

      {/* 한눈 지표 3종. */}
      <div className="grid grid-cols-3 gap-2">
        <div className={STAT}>
          <span className="text-2xs text-mut">새 학습</span>
          <span className="text-base font-bold text-txt tabular-nums">
            {newBlocks.length}
            <span className="text-xs font-medium text-mut">블록</span>
          </span>
          <span className="text-2xs text-mut tabular-nums">{(plannedMin / 60).toFixed(1)}h</span>
        </div>
        <button type="button" onClick={() => onGo('review')} className={`${STAT} text-left`}>
          <span className="text-2xs text-mut">복습 대기</span>
          <span className={`text-base font-bold tabular-nums ${reviewN > 0 ? 'text-acc' : 'text-txt'}`}>{reviewN}</span>
          <span className="text-2xs text-mut tabular-nums">{risk.overdue > 0 ? `밀림 ${risk.overdue}` : '깨끗함'}</span>
        </button>
        <div className={STAT}>
          <span className="text-2xs text-mut">마감</span>
          {nearest ? (
            <>
              <span className="truncate text-base font-bold text-txt">{ddayInfo(nearest.dday).lab}</span>
              <span className="truncate text-2xs text-mut">{nearest.name}</span>
            </>
          ) : (
            <span className="text-base font-bold text-mut">—</span>
          )}
        </div>
      </div>

      {/* 다음 행동. */}
      <div className="mt-1 flex gap-2">
        <button type="button" onClick={() => onGo('day')} className={`${NAV} border border-line text-txt`}>
          오늘 일정
        </button>
        <button
          type="button"
          onClick={() => onGo('review')}
          className={`${NAV} ${reviewN > 0 ? 'bg-acc text-on-acc' : 'border border-line text-mut'}`}
        >
          {reviewN > 0 ? `복습 ${reviewN}건` : '복습'}
        </button>
      </div>
    </section>
  );
}
