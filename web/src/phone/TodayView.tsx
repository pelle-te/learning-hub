/* ============================================================
   phone/TodayView.tsx — 폰 홈 대시보드(Phase 3 · "열면 오늘이 한눈에").

   데스크톱 TodaySignature(756줄 · 발광 히어로·흐름 레일)를 옮기지 않는다 — 폰은 화면만 새로
   짜고(§9-4) **견고한 신호 몇 개**만 압축해 보여준다: 오늘의 초점(가장 큰 새 학습), 새 학습량,
   복습 대기, 가장 가까운 마감, 스트릭. 상세 편집은 '일' 탭, 복습 실행은 '복습' 탭으로 넘긴다.

   규칙은 lib 것을 그대로 쓴다(studyStreak·riskSummary·deadlineDdays·useSchedule) — 픽셀만 새로.
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { todayISO, parseISO, fmt, ddayInfo } from '@/lib/utils';
import { studyStreak, isDone } from '@/lib/persistence';
import { riskSummary } from '@/lib/spacedReview';
import { deadlineDdays } from '@/lib/scheduleView';
import { pickFocus, type FocusEntry } from '@/lib/focusState';
import { latestResume, resumeDevice, resumeLabel, type ResumeKind } from '@/lib/resume';

const CARD = 'rounded-lg border border-line bg-panel p-4';
const STAT = 'flex flex-col gap-0.5 rounded-md border border-line bg-panel2 px-3 py-2.5';
const NAV = 'min-h-12 flex-1 rounded-md text-sm font-semibold';

export default function TodayView({ onGo }: { onGo: (v: 'day' | 'review') => void }): React.JSX.Element {
  /* 이어하기 커서(N-7) — 마운트 시각 한 번으로 TTL 을 본다(6시간짜리라 초 단위 정확도 불필요).
     `kind` 는 라우트가 아니라 **의도**라 폰은 자기 뷰 이름으로 옮긴다: 복습→review, 나머지는
     오늘 하루 화면(day). 이 표 하나가 드롭된 F1(딥링크 핸드오프)을 불필요하게 만든 것이다. */
  const [nowMs] = useState(() => Date.now());
  const resume = latestResume(useApp.getState().state, resumeDevice(), nowMs);
  const onResume = (kind: ResumeKind): void => onGo(kind === 'review' ? 'review' : 'day');
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const today = todayISO(state);

  const day = res.days.find((d) => d.ds === today);
  const newBlocks = (day?.items || []).filter((it) => it.type === 'new');
  const plannedMin = newBlocks.reduce((t, it) => t + (it.min || 0), 0);
  /* 오늘의 초점 — **데스크톱 히어로와 같은 함수**(D-5). 예전엔 폰만 `pickTodayFocus`(마감·진도
     가중)를 써서 같은 질문에 답이 둘이었고, 이유(reason)를 표시하는 것도 폰뿐이었다. 그 규칙은
     `pickFocus` 안으로 흡수됐다.
     ⚠ **시각을 일부러 안 넘긴다**(start/end=null). 폰 카드는 타임블로킹 화면이 아니라 "무엇부터"만
       묻는다 — 시각을 주면 `pickFocus` 가 시간 순서를 우선해 급함(마감·진도)이 밀린다.
     ⚠ 후보는 여전히 **새 학습 블록**뿐이다(카드의 빈 문구가 그 범위를 전제한다). 무엇을 후보로
       볼지는 화면의 결정, 그중 무엇이 먼저인지는 lib 의 결정 — 그 경계를 지킨다. */
  const entries: FocusEntry[] = newBlocks.map((it) => ({
    it,
    start: null,
    end: null,
    done: isDone(state, today, it.sid, it.type),
  }));
  const focusPick = pickFocus(entries, 0, res.itemStat, today);
  const focus = focusPick.focus?.it || null;

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

      {/* N-7 이어하기 — 데스크톱에서 하던 것이 살아 있을 때만 뜬다. 폰이 이 기능의 주 수혜자다:
          "PC 에서 어디까지 했더라"가 그동안 기억 재구성이었고, 틀리면 같은 걸 두 번 했다.
          ⚠ 데스크톱 칩을 공유하지 않고 폰 문법으로 따로 그린다(C-6 · lib 만 공유). */}
      {resume && (
        <button
          type="button"
          onClick={() => onResume(resume.cur.kind)}
          className="flex min-h-11 w-full items-center gap-2 rounded-md border border-line-acc-pill bg-tint-acc px-3 text-left text-sm font-semibold text-ink"
        >
          <span aria-hidden="true">↪</span>
          {resumeLabel(resume.cur)}
        </button>
      )}

      {/* 오늘의 초점 — 가장 큰 새 학습(과목색 좌측 띠). */}
      <div
        className={CARD}
        style={focus?.color ? { borderLeft: `3px solid ${focus.color}`, paddingLeft: 13 } : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs font-bold tracking-wide text-mut uppercase">오늘의 초점</span>
          {focusPick.reason ? <span className="text-2xs font-bold text-acc">{focusPick.reason}</span> : null}
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
