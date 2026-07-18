/* ============================================================
   Journal — 탭: 📒 학습 기록 (Phase 4 · 앱상태/Zustand)
   레거시 ui-journal.js를 React로 — 공부 뒤 남기는 산출물: 3문장 요약·CBMS 오답·보충 백로그.
   '오늘 학습' 블록의 프리필 버튼이 prefill 스토어로 과목을 미리 채운다.
   스타일: 공유 디자인 시스템은 ds.module(ds.*), 요소·토큰은 전역 base(Phase 9 전환).
============================================================ */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { usePrefill } from '@/store/prefill';
import { ui, io } from '@/shell';
import { summariesFor, cbmsBetween, openBacklog, activityFeed, setRitual } from '@/lib/methodology';
import { weeklyRecap } from '@/lib/insights';
import { shutdownChain } from '@/lib/records';
import { parseCaptureBatch } from '@/lib/quickCapture';
import { addDays, fmt, hLabel, iso, mondayOf, parseISO, todayISO } from '@/lib/utils';
import { Button } from '@/components/ui';
import JournalStream from './JournalStream';
import ds from '@/styles/ds.module.css';
import j from './Journal.module.css';
import SummaryCard from './SummaryCard';
import CbmsCard from './CbmsCard';
import BacklogCard from './BacklogCard';

/** 최근 활동(7일) — 완료·요약·오답·보충·백지를 시간역순 단일 피드로(온디맨드 <details>). */
function ActivityFeed({ ds2 }: { ds2: string }) {
  const state = useApp((s) => s.state);
  const feed = activityFeed(state, iso(addDays(parseISO(ds2), -6)), ds2);
  // 접힌 <details> 안 목록을 항상 렌더하지 않고 열렸을 때만(onToggle로 open 추적) 렌더 — lazy.
  const [open, setOpen] = useState(false);
  return (
    <details className={j.feed} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className={j.feedSum}>최근 활동 · 7일{feed.length ? ` (${feed.length})` : ''}</summary>
      {!open ? null : feed.length ? (
        <ol className={j.feedList}>
          {feed.map((e, i) => (
            <li key={i} className={j.feedRow}>
              <span className={j.feedDs}>{e.ds.slice(5).replace('-', '/')}</span>
              <span className={j.feedKind} data-kind={e.kind}>
                {e.label}
              </span>
              <span className={j.feedDetail}>{e.detail}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className={j.feedEmpty}>최근 7일 기록이 없어요 — 오늘 첫 발자취를 남겨보세요.</div>
      )}
    </details>
  );
}

/** I-11 배치 캡처 — 여러 줄을 한 번에 파싱해 요약 폼 다건 프리필(우 컬럼 상단, 접이식). */
function BatchCapture() {
  const state = useApp((s) => s.state);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  // 파싱 미리보기 — 줄 수만큼 CaptureResult(빈 줄·실패 제외). subjects=이름 있는 항목명.
  const subjects = state.items.map((i) => i.name).filter(Boolean) as string[];
  const parsed = text.trim() ? parseCaptureBatch(text, new Date(), subjects) : [];
  const apply = () => {
    if (!parsed.length) return; // 빈 파싱이면 no-op
    const reqs = parsed.map((r) => {
      // 정확 name 일치만 id로 매핑(스케줄러 오염 방지) — 없으면 ''.
      const item = r.subject ? state.items.find((i) => i.name === r.subject) : undefined;
      return { form: 'sum' as const, sid: item?.id || '', ds: r.dateISO || '' };
    });
    usePrefill.getState().requestBatch(reqs);
    setText('');
    setOpen(false);
    ui.toast(`${reqs.length}건 프리필 — 요약 폼이 순차로 채워져요`, 'ok');
  };

  return (
    <details className={j.capture} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className={j.captureSum}>여러 줄 한 번에 — 배치 캡처</summary>
      <div className={j.captureBody}>
        <textarea
          className={j.captureTa}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'한 줄에 하나씩 — 예)\n미적분 7장 부분적분 요약\n어제 선형대수 고윳값 정리'}
        />
        <div className={j.captureFoot}>
          <span className={`${ds.muted} ${ds.tiny}`}>
            {parsed.length ? `${parsed.length}건 인식 — 요약 폼으로 순차 프리필` : '한 줄씩 적으면 요약 폼을 채워요'}
          </span>
          <Button sm variant="primary" onClick={apply} disabled={!parsed.length}>
            {parsed.length ? `${parsed.length}건 프리필` : '프리필'}
          </Button>
        </div>
      </div>
    </details>
  );
}

/** I-12 주간 리캡 — '이번 주 해낸 것'(격려 톤). review(처방)와 분리. 좌 컬럼. */
function WeeklyRecapCard() {
  const state = useApp((s) => s.state);
  const weekMon = iso(mondayOf(parseISO(todayISO(state))));
  const recap = weeklyRecap(state, weekMon);
  return (
    <div className={j.recap}>
      <div className={j.recapHead}>
        <span className={j.recapTitle}>이번 주 해낸 것</span>
        {recap.focusMin > 0 && <span className={j.recapStat}>{hLabel(recap.focusMin)} 집중</span>}
      </div>
      {recap.wins.length ? (
        <ul className={j.recapWins}>
          {recap.wins.map((w, i) => (
            <li key={i} className={j.recapWin}>
              {w}
            </li>
          ))}
        </ul>
      ) : (
        <div className={j.recapEmpty}>이번 주 기록이 쌓이면 여기 성취가 모여요.</div>
      )}
    </div>
  );
}

/** I-13 셧다운 체인 — 최근 14일 연속성 도트 + 'N일 연속' 배지 + 오늘 토글. "Don't break the chain". */
function ShutdownChain() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const chain = shutdownChain(state, 14);
  const today = todayISO(state);
  const todayDone = chain.days[chain.days.length - 1]?.done ?? false;
  const doneN = chain.days.filter((d) => d.done).length;
  const toggle = () => mutate((st) => setRitual(st, today, 'shutdown', !todayDone));
  return (
    <div className={j.chain}>
      <div className={j.chainHead}>
        <span className={j.chainTitle}>셧다운 체인</span>
        {chain.streak > 0 && <span className={j.chainStreak}>🔥 {chain.streak}일 연속</span>}
      </div>
      <div className={j.chainDots} role="img" aria-label={`최근 14일 중 ${doneN}일 셧다운 완료`}>
        {chain.days.map((d) => (
          <span
            key={d.ds}
            className={`${j.dot}${d.done ? ' ' + j.dotDone : ''}`}
            title={`${d.ds}${d.done ? ' · 셧다운 완료' : ''}`}
          />
        ))}
      </div>
      <button type="button" className={j.chainToggle} onClick={toggle} aria-pressed={todayDone}>
        {todayDone ? '오늘 셧다운 완료 ✓ — 취소' : '오늘 하루를 닫기 — 셧다운 완료'}
      </button>
    </div>
  );
}

export default function Journal() {
  const state = useApp((s) => s.state);
  const navigate = useNavigate();
  const today = todayISO({ _today: state._today }); // '오늘' 단일 출처 존중
  // 기록 대상 날짜 — 기본 오늘, 과거로 이동해 어제 놓친 블록을 백필할 수 있다(미래로는 못 감).
  const [ds2, setDs2] = useState(today);
  const isToday = ds2 === today;
  // C-10: 빠른 캡처가 파싱한 날짜로 기록 탭을 이동(백필). nonce 변화 시점에만 반응(usePrefillForm과 같은 규율).
  // 로컬 setState는 컴파일러 set-state-in-effect에 걸려(usePrefillForm의 prop setter는 불투명해 통과) setTimeout 비동기 커밋으로 회피.
  const prefillNonce = usePrefill((s) => s.nonce);
  const prefillDs = usePrefill((s) => s.ds);
  useEffect(() => {
    if (!(prefillDs && prefillDs <= today)) return;
    const t = setTimeout(() => setDs2(prefillDs), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);
  const stepDay = (d: number) => {
    const next = iso(addDays(parseISO(ds2), d));
    if (next > today) return; // 미래 금지
    setDs2(next);
  };
  const sumN = summariesFor(state, today).length;
  const cbmsN = cbmsBetween(state, today, today).length;
  const openN = openBacklog(state).length;

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '요약', value: sumN, accent: true },
        { label: '오답', value: cbmsN },
        { label: '열린 보충', value: openN },
      ],
      // 무데이터면 빈 파일 데드엔드 → 상단바 액션 자체를 미노출(카드 내부 버튼은 canExport로 별도 가드).
      action: sumN || cbmsN ? { label: '🃏 Anki 카드(.txt)', onClick: () => io.exportAnkiCards('today') } : undefined,
    }),
    [sumN, cbmsN, openN],
  );

  return (
    <section className={j.wrap} aria-label="학습 기록">
      <div className={j.cols}>
        {/* 좌 — 로그(시그니처, fill) + 최근 활동(온디맨드). 선택 날짜를 따라간다. */}
        <div className={j.logCol}>
          <JournalStream ds={ds2} isToday={isToday} fill />
          <WeeklyRecapCard />
          <ActivityFeed ds2={ds2} />
          <ShutdownChain />
          <div className={j.logHint}>
            공부 뒤 남기는 산출물({fmt(new Date(ds2 + 'T00:00:00'))}) — 블록을 끝낼 때마다 하나씩. 누적 추세·약점 분포는{' '}
            <button type="button" className={j.inlineLink} onClick={() => navigate('/stats', { viewTransition: true })}>
              통계
            </button>
            ·
            <button
              type="button"
              className={j.inlineLink}
              onClick={() => navigate('/review', { viewTransition: true })}
            >
              주간 리뷰
            </button>
            에서.
          </div>
        </div>
        {/* 우 — 기록 입력(온화면 패널, 스크롤) */}
        <div className={j.inputCol}>
          <div className={j.inputHead}>기록 입력 — 요약 · 오답 · 보충</div>
          {/* 날짜 스테퍼 — 과거 보충 진입점. 오늘이면 담백하게, 과거면 강조 배너. */}
          <div className={`${j.dateNav}${isToday ? '' : ' ' + j.dateNavPast}`}>
            <Button sm variant="ghost" onClick={() => stepDay(-1)} aria-label="이전 날">
              ◀
            </Button>
            <span className={j.dateLabel}>
              {fmt(new Date(ds2 + 'T00:00:00'))}
              {isToday ? <span className={`${ds.muted} ${ds.tiny}`}> · 오늘</span> : <b> · 과거 보충</b>}
            </span>
            <Button sm variant="ghost" onClick={() => stepDay(1)} disabled={isToday} aria-label="다음 날">
              ▶
            </Button>
            {!isToday && (
              <Button sm variant="ghost" onClick={() => setDs2(today)} style={{ marginLeft: 'auto' }}>
                오늘로
              </Button>
            )}
          </div>
          <BatchCapture />
          <SummaryCard ds={ds2} />
          <CbmsCard ds={ds2} />
          <BacklogCard />
        </div>
      </div>
    </section>
  );
}
