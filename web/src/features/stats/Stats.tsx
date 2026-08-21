/* ============================================================
   Stats — 탭: 📊 통계 (Phase 4 · 앱상태 + 파생)
   레거시 ui-stats.js를 React로 — KPI·인출 증거·유지율 스파크·스트릭 히트맵·CBMS 레이더·
   과목별 진행·주별 학습시간·챕터 타임라인. 차트는 기존 SVG/막대 로직을 컴포넌트화(설계도 §3).
   스타일: 공유 디자인 시스템은 styles/ds.css(`ds-*` 전역), 히트맵·데이터 보드는 Tailwind(C-7), 요소·토큰은 전역 base.
============================================================ */
import { Suspense, lazy, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useHeroPointer, useCountUp } from '@/hooks/interactions';
import State from '@/components/State';
import { Button } from '@/components/ui';
import DetailDrawer from '@/components/DetailDrawer';
import { ProgressRing } from '@/components/ProgressRing';
import { CountReadout } from '@/components/CountReadout';
import Trellis from '@/components/Trellis';
import { weekSeries } from '@/lib/series';
import { Num } from '@/components/Num';
import { totalDoneHours } from '@/lib/persistence';
import { cbmsCounts, cbmsTop, cbmsTrend, cbmsTrendGlyph, recallEvidence, CBMS_INFO } from '@/lib/methodology';
import { personalBests } from '@/lib/records';
import { parseISO, fmtShort, todayISO, dayDiff, ddayInfo, hLabel } from '@/lib/utils';
import { sortSubjectsByUrgency } from '@/lib/scheduleView';
import { riskSummary } from '@/lib/spacedReview';
import type { ScheduleResult } from '@/lib/types';

const StatsDetail = lazy(() => import('./StatsDetail'));

/* ── C-7 이식(stats) — Tailwind 클래스 ────────────────────────────────────────
   데이터 보드 4컬럼(스파인·지표·시그니처·과목) + 스트릭 히트맵 잔디 + 발광 원형 게이지.
   ds.* 공유 클래스·런타임 색 주입(과목 색 style)·전역 요소(h2)는 그대로 두고 전역을 이기는 지점만 `!`.
   히어로/시그니처 그래디언트·상단 헤어라인·페이드업 키프레임·필터/글로우는 tokens.css/tw.css 에 이름 주고
   참조한다(§14-3). 규약은 §15 + tokenBridge.css 머리주석이 SSOT. `Stats.module.css` 삭제. */

const S = {
  // 셸 + 4컬럼 그리드
  wrap: 'flex h-full min-w-0 flex-col',
  grid: 'grid min-h-0 flex-1 grid-cols-stats max-wide:grid-cols-1 max-wide:overflow-y-auto',
  // 1 — 회전 스파인
  spine:
    'flex min-w-0 flex-col items-center justify-between overflow-hidden border-r border-line2 px-0 py-6.5 max-wide:flex-row max-wide:justify-start max-wide:gap-3.5 max-wide:border-r-0 max-wide:border-b max-wide:border-line2 max-wide:px-4.5 max-wide:py-3.5',
  kicker:
    '[writing-mode:vertical-rl] text-2xs font-extrabold tracking-kicker text-acc uppercase max-wide:[writing-mode:horizontal-tb]',
  spineBig:
    '[writing-mode:vertical-rl] text-spine leading-none font-black tracking-spine max-wide:[writing-mode:horizontal-tb] max-wide:text-spine-sm',
  spineSub:
    '[writing-mode:vertical-rl] text-xs leading-text font-extrabold text-mut max-wide:[writing-mode:horizontal-tb]',
  // 2 — 지표 컬럼
  metrics:
    'flex min-w-0 flex-col justify-center gap-3.5 border-r border-line2 p-5.5 max-wide:border-r-0 max-wide:border-b max-wide:border-line2',
  hero: `relative flex flex-col items-center gap-3 rounded-lg border border-line bg-[image:var(--bg-hero-stats)] px-4.5 pt-5.5 pb-5 shadow-hero animate-[enter-rise_var(--dur-slow)_var(--ease)_both] ds-hairline motion-reduce:animate-none max-wide:flex-row max-wide:justify-center max-wide:gap-5 max-narrow:flex-col`,
  heroMeta: 'flex flex-col items-center gap-0.5 text-center',
  heroLab: 'text-sm leading-text font-bold text-txt',
  heroSub: 'text-xs leading-text text-mut tabular-nums',
  ros: 'grid grid-cols-2 gap-2.5 max-wide:grid-cols-4 max-narrow:grid-cols-2',
  // 완료율 게이지
  gauge: 'relative size-32.5 flex-none',
  gaugeSvg: 'size-full -rotate-90',
  gaugeTrack: 'fill-none stroke-line2 [stroke-width:9]',
  gaugeArc:
    'fill-none stroke-acc [stroke-width:9] [stroke-linecap:round] [filter:var(--filter-gauge-glow)] transition-[stroke-dashoffset] duration-draw ease-[var(--ease)] motion-reduce:transition-none',
  gaugeNum:
    'absolute inset-0 flex items-center justify-center text-gauge font-black tracking-tight text-acc tabular-nums [text-shadow:var(--gauge-num-glow)]',
  gaugeUnit: 'ml-px text-gauge-sm font-extrabold text-mut',
  // 3 — 시그니처
  signature: 'flex min-h-0 min-w-0 flex-col gap-3.5 p-5.5',
  sigHead: 'flex items-baseline justify-between',
  sigTitle: 'ds-caps',
  sigMeta: 'text-xs leading-text text-mut tabular-nums',
  /* Q-14 — **hero 가 아니라 여기가 이 화면의 시그니처다**(위 `// 3 — 시그니처` 주석이 원천).
     hero 는 지표 컬럼의 게이지 리드아웃이라 `ds-frame` 을 달면 한 화면에 둘이 되고, 그건
     ds.css 가 못박은 계약(`한 화면에 하나`)을 어긴다 — 그래서 hero 는 그대로 둔다. */
  sigMap: `ds-frame mb-0! relative flex flex-1 flex-col justify-center bg-[image:var(--bg-sig-stats)] px-4.5! pt-4.5! pb-3.5! animate-[enter-rise_var(--dur-slow)_var(--ease)_var(--stagger)_both] ds-hairline motion-reduce:animate-none`,
  verdicts: 'flex flex-col gap-3 border-t border-line2 pt-3.5 max-wide:mt-3.5',
  verdict: 'flex items-start gap-3',
  vIcon: 'min-w-16 flex-none pt-px text-md font-extrabold',
  vIconGood: 'text-acc [text-shadow:var(--verdict-glow)]',
  vIconBad: 'text-bad',
  vText: 'text-md leading-body text-mut',
  weakBar: 'mt-1.5 h-2 flex-1 overflow-hidden rounded-full bg-track-cat',
  weakFill: 'block h-full rounded-full',
  // 인라인 링크 <button> — 원본은 font:inherit 로 부모 .vText 의 line-height(1.5)를 상속했다. preflight 가
  // 없어 버튼이 UA line-height:normal 로 떨어지므로, 부모의 상속 LH 를 명시로 못박는다(모바일 줄바꿈 시 누적 시프트 방지).
  navLink:
    'ml-1.25 inline border-0! bg-transparent! p-0! font-bold! text-acc! leading-body transition-[text-shadow] hover:underline hover:[text-shadow:var(--navlink-glow)] focus-visible:underline focus-visible:[text-shadow:var(--navlink-glow)]',
  // 4 — 과목별 진행
  subjects:
    'flex min-h-0 min-w-0 flex-col border-l border-line2 p-5.5 max-wide:min-h-75 max-wide:border-t max-wide:border-l-0 max-wide:border-line2',
  subjectsH2: 'mb-3! flex-none ds-caps',
  subjList: '-mx-1 flex min-h-0 flex-1 flex-col gap-2.25 overflow-y-auto px-1 [scrollbar-width:thin]',
  subj: "relative flex flex-col gap-1.5 overflow-hidden rounded-md border border-line bg-panel pt-2.75 pr-3.25 pb-3 pl-3.75 transition-[border-color,transform,box-shadow] duration-fast ease-[var(--ease)] before:absolute before:top-2.25 before:bottom-2.25 before:left-0 before:w-0.75 before:scale-y-0 before:rounded-cell before:bg-acc before:shadow-spine before:transition-transform before:duration-fast before:ease-[var(--ease)] before:content-[''] hover:-translate-y-px hover:border-line-acc hover:shadow-hero hover:before:scale-y-100",
  subjTop: 'flex items-center gap-2',
  subjNm: 'flex-1 truncate text-base14 font-bold',
  subjBar: 'h-1.75 overflow-hidden rounded-full bg-track-cat',
  subjFill: 'block h-full rounded-full',
  subjMeta: 'truncate text-xs leading-text text-mut tabular-nums',
  // ⚠ 여기 스트릭 히트맵(잔디) 표기 18칸이 있었다 — I046 이 그 화면을 지웠다.
} as const;

/** 과목 칩 톤 — 정적 맵(진행/반복=중립 · good=정상 · bad=시간부족/마감초과). 테두리는 acc/bad 45% line. */
const PILL = 'rounded-full border px-2 py-px text-2xs font-bold whitespace-nowrap';
const PILL_TONE = {
  '': 'border-line text-mut',
  good: 'border-line-acc-pill text-acc',
  bad: 'border-line-bad-pill text-bad',
} as const;

/* ⚠⚠ **여기 18주 스트릭 히트맵(`StreakHeatmap`)이 있었다 — 은퇴했다**(I046 · 2026-08-22 발상 축).

   근거: 이 잔디의 입력은 `completions` 인데 실 DB 실측이 **0행**이다 — 즉 이 화면은 실물에서
   **항상 빈 잔디**를 18주치 그린다. 0 을 크게 그리는 것은 조망이 아니라 죄책감 장치이고, 이
   앱의 정의(「한눈에」)가 요구하는 것과 반대 방향이다.

   ⚠ 함께 지운 것: 「연속 학습일」·「최장 연속(개인 기록)」 리드아웃과 상단 크롬의 `연속` 칸.
   ⚠ 크롬의 그 자리는 **「밀린 복습」**이 받는다 — 빈 자리를 남기면 다음 사람이 다시 채운다.
   복구: `git show <이 커밋의 부모>:web/src/features/stats/Stats.tsx`. */

/** 과목 1행 — 진행 막대 + 마감 상태 필. */
function SubjectRow({ s, today }: { s: ScheduleResult['itemStat'][number]; today: string }) {
  if (s.daily)
    return (
      <div className={S.subj}>
        <div className={S.subjTop}>
          <span className="ds-swatch" style={{ background: s.color }} />
          <span className={S.subjNm}>{s.name}</span>
          <span className={`${PILL} ${PILL_TONE['']}`}>반복</span>
        </div>
        <div className={S.subjMeta}>
          매일 {s.dailyMin}분 · {s.schedH}h / {s.days}일
        </div>
      </div>
    );
  const prog = s.totalCh ? Math.round((s.doneCh! / s.totalCh) * 100) : 0;
  const pill: { tone: keyof typeof PILL_TONE; lab: string } = !s.deadline
    ? { tone: '', lab: '진행' }
    : !s.finished
      ? { tone: 'bad', lab: '시간부족' }
      : (s.late || 0) > 0
        ? { tone: 'bad', lab: '마감초과' }
        : { tone: 'good', lab: '정상' };
  return (
    <div className={S.subj}>
      <div className={S.subjTop}>
        <span className="ds-swatch" style={{ background: s.color }} />
        <span className={S.subjNm}>{s.name}</span>
        <span className={`${PILL} ${PILL_TONE[pill.tone]}`}>{pill.lab}</span>
      </div>
      <div className={S.subjBar}>
        <i className={S.subjFill} style={{ width: `${prog}%`, background: s.color }} />
      </div>
      <div className={S.subjMeta}>
        {s.doneCh}/{s.totalCh} 챕터 · {s.schedH}h/{s.totalH}h
        {/* ⚠ 표시는 **다가오는 시험**이다(H-2) — `deadline`(마지막 시험)을 그리면 중간고사가
            사흘 뒤인데 D-60 이 뜬다. 배지(위 `pill`)는 과목의 *끝* 을 말하므로 계속 `deadline`. */}
        {s.nextExam ? (
          <>
            {' · 마감 '}
            {fmtShort(parseISO(s.nextExam))} <b>({ddayInfo(dayDiff(today, s.nextExam)).lab})</b>
          </>
        ) : (
          ''
        )}
      </div>
    </div>
  );
}

/** 완료율 — 발광 원형 게이지(마운트 시 0→target 카운트업). 데이터 보드의 시선 집중점. */
function Gauge({ pct }: { pct: number }) {
  const shown = useCountUp(pct);
  return (
    <div className={S.gauge} role="img" aria-label={`완료율 ${pct}%`}>
      <ProgressRing
        size={130}
        r={52}
        pct={shown}
        className={S.gaugeSvg}
        trackClassName={S.gaugeTrack}
        arcClassName={S.gaugeArc}
      />
      <span className={S.gaugeNum}>
        {Math.round(shown)}
        <small className={S.gaugeUnit}>%</small>
      </span>
    </div>
  );
}

/** 보조 리드아웃 — 공용 CountReadout에 이 탭의 클래스만 입힘(카운트업 정본 공유). */
function Readout(props: { value: number; lab: ReactNode; prefix?: ReactNode; suffix?: ReactNode }) {
  return <CountReadout {...props} className="ds-ro ds-glow" numClassName={'ds-roNum'} labClassName={'ds-roLab'} />;
}

export default function Stats() {
  const state = useApp((s) => s.state);
  const r = useSchedule();
  const navigate = useNavigate();
  const [detailOpen, setDetailOpen] = useState(false);
  /* 포인터 추적 스포트라이트 — 히어로 게이지 패널이 커서를 따라 발광(틸트 없는 큰 보드).
     ⚠ 짝이던 `mapRef`(스트릭 발광맵)가 I046 과 함께 사라졌다. */
  const { ref: heroRef, onMouseMove: heroMove, onMouseLeave: heroLeave } = useHeroPointer(0);

  const totalSchedH = r.itemStat.reduce((t, s) => t + (s.schedH || 0), 0);
  const totalCh = r.itemStat.reduce((t, s) => t + (s.totalCh || 0), 0);
  const doneCh = r.itemStat.reduce((t, s) => t + (s.doneCh || 0), 0);
  const revCount = r.days.reduce((t, d) => t + d.items.filter((i) => i.type === 'rev').length, 0);
  const doneH = totalDoneHours(state);
  const risk = riskSummary(state, r.days || [], todayISO(state));
  const compRate = totalSchedH > 0 ? Math.min(100, Math.round((doneH / totalSchedH) * 100)) : 0;

  // 능동 인출 활동(북극성 출력 지표) = 요약 + 백지 완료 + 모의 완료. (인출카드와 공용 헬퍼 · SSOT)
  const { recallActs } = recallEvidence(state, r);

  /* T-14·T-23 — 과목별 주간 시계열. **판정(점이 충분한가)은 `lib/series`** 가 하고 여기선
     행만 만든다. `weekHours` 는 스케줄러가 이미 내는 값이라 새 계산이 0 이다. */
  const trellisRows = r.itemStat.map((s) => ({
    key: s.id,
    label: s.name,
    series: weekSeries(r.weekHours, s.id),
    value: `${(s.schedH || 0).toFixed(1)}h`,
  }));

  // 오답 추세(약점이 닫히는 방향?).
  const tr = cbmsTrend(state);
  const { icon: trIcon, good: trGood } = cbmsTrendGlyph(tr);

  // 주된 약점(CBMS 최댓값) — 방법론 SSOT의 argmax 헬퍼로 위임(오답 0이면 null).
  const cnt = cbmsCounts(state);
  const top = cbmsTop(cnt); // {code,n,total}|null

  // 개인 기록(I-6) — 성취 회수: 최장 연속·최고 집중일. 기록 없으면(totalDays 0) 숨겨 0의 벽 방지.
  const pb = personalBests(state);

  /* N-15 — 완료율이 이 탭의 첫째 수치다(44px). 예전엔 완료율·연속·인출 셋이 **같은 30px** 로
     나란히 서서 "무엇을 먼저 보라"는 말을 아무도 하지 않았다. 통계 탭이 답해야 하는 질문 하나를
     고르면 그건 완료율이고, 나머지 둘은 그 옆의 맥락이다. ⚠ 본문의 회전 스파인과 충돌하지
     않는다 — 스파인은 40px 이지만 세로로 눕고 옅어(장식) 읽는 순서가 겹치지 않는다. */
  usePageChromeEffect(
    () => ({
      primary: { value: String(compRate), unit: '%', label: '완료율' },
      readouts: [
        /* I046 — 이 자리는 「연속」이었다. 그 수의 입력(`completions`)이 실물에서 0행이라
           **항상 0** 이었고, 0 을 자랑하는 자리는 조망이 아니다. 밀린 복습은 같은 크기의
           칸에 들어가면서 **행동을 부른다**. */
        { label: '밀린 복습', value: risk.overdue },
        { label: '인출', value: recallActs },
      ],
      action: { label: '＋ 상세 리포트', onClick: () => setDetailOpen(true) },
    }),
    [compRate, risk.overdue, recallActs],
  );

  if (!r.itemStat.length)
    return (
      <section aria-label="학습 통계">
        <div className="ds-rule">
          <State
            glyph="chart"
            title="아직 통계가 없어요"
            desc={
              <>
                학습 항목을 추가하면 <b>완료율·인출 증거·유지율·스트릭</b>이 여기에 쌓입니다. 매일 블록을 체크할수록
                지표가 또렷해져요.
              </>
            }
            next={
              <Button variant="primary" onClick={() => navigate('/items')}>
                + 학습 항목 추가
              </Button>
            }
            /* Q-31 — 문구는 *무엇이 쌓이는지* 이름만 대고, 형상은 못 보여 준다. 여기 두 줄이
               "완료율 74%"가 어떤 모양으로 서는지를 말한다. ⚠ 수는 **명백히 남의 것**이어야
               한다(캡션이 그렇게 말하고, `inert` 가 만지지 못하게 한다 — `State` 머리주석). */
            preview={
              <div className="flex items-center gap-4">
                <Num className="text-gauge font-black text-acc tabular-nums" value={74} unit="%" />
                <div className="flex flex-col gap-0.5 text-left">
                  <span className="text-sm font-bold text-txt">완료율 · 실제/계획</span>
                  <span className="text-xs text-mut tabular-nums">이번 주 8.5h / 11.5h · 스트릭 6일</span>
                </div>
              </div>
            }
          />
        </div>
      </section>
    );

  return (
    <section className={S.wrap} aria-label="학습 통계">
      <div className={S.grid}>
        {/* 1 — 회전 스파인 */}
        <div className={S.spine}>
          <div className={S.kicker}>학습 통계</div>
          <div className={S.spineBig}>DATA</div>
          <div className={S.spineSub}>{r.itemStat.length}과목</div>
        </div>

        {/* 2 — 지표 컬럼(완료율 발광 게이지 히어로 + 카운트업 리드아웃) */}
        <div className={S.metrics}>
          <div
            ref={heroRef}
            onMouseMove={heroMove}
            onMouseLeave={heroLeave}
            className={`${S.hero} ds-spotHost ds-glow`}
          >
            <div className="ds-spotlight" aria-hidden="true" />
            <div className="ds-aura" aria-hidden="true" />
            <Gauge pct={compRate} />
            <div className={S.heroMeta}>
              <span className={S.heroLab}>완료율 · 실제/계획</span>
              <span className={S.heroSub}>
                {doneH.toFixed(1)}h / {Math.round(totalSchedH)}h
              </span>
            </div>
          </div>
          <div className={S.ros}>
            <Readout value={doneCh} suffix={<small>/{totalCh}</small>} lab="완료 챕터" />
            <Readout value={recallActs} lab="능동 인출(요약+백지+모의)" />
            <Readout value={revCount} lab="복습 세션(계획)" />
            {/* 개인 기록(I-6) — 기록이 있을 때만(과장 금지).
                ⚠ **「최장 연속」트로피가 여기 있었다 — I046 이 지웠다**(위 히트맵 주석이 근거의
                SSOT). 남은 「최고 집중일」은 연속성 게임이 아니라 **한 날의 실측**이라 남긴다. */}
            {pb.totalDays > 0 && (
              <div className="ds-ro ds-glow">
                <span className="ds-roNum">{hLabel(pb.bestFocusMin)}</span>
                <span className="ds-roLab">
                  최고 집중일{pb.bestFocusDs ? ` · ${fmtShort(parseISO(pb.bestFocusDs))}` : ''}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 3 — 시그니처(인출 판정). ⚠ 여기 위에 스트릭 발광맵이 있었다 — I046 이 지웠다. */}
        <div className={S.signature}>
          <div className={S.sigHead}>
            <span className={S.sigTitle}>인출 판정 — VERDICT</span>
            <span className={S.sigMeta}>약점이 닫히는 방향인가</span>
          </div>
          <div className={S.verdicts}>
            <div className={S.verdict}>
              <span className={`${S.vIcon} ${trGood ? S.vIconGood : S.vIconBad}`}>{trIcon}</span>
              <span className={S.vText}>
                <b className="text-txt">오답 추세</b> — 지난주 {tr.lastW} → 이번주 {tr.thisW}.{' '}
                {trGood ? '약점이 닫히는 방향.' : '가장 잦은 유형의 처방에 다음 주 시간을 더 주세요.'}
              </span>
            </div>
            <div className={S.verdict}>
              <span className={S.vIcon} style={{ color: top ? CBMS_INFO[top.code]?.color : undefined }}>
                {top ? `${top.code} ${top.n}` : '—'}
              </span>
              <span className={S.vText} style={{ flex: 1 }}>
                <b className="text-txt">주된 약점</b>{' '}
                {top ? `${CBMS_INFO[top.code]?.label || ''}(전체 ${top.total}건)` : '오답 기록 없음'}
                {top && (
                  <>
                    <div className={S.weakBar}>
                      <i
                        className={S.weakFill}
                        style={{
                          width: `${Math.round((top.n / top.total) * 100)}%`,
                          background: CBMS_INFO[top.code]?.color || 'var(--acc)',
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className={S.navLink}
                      onClick={() => navigate('/review', { viewTransition: true })}
                    >
                      가장 잦은 유형의 처방에 다음 주 시간을 더 주세요 — 주간 리뷰로 →
                    </button>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* 4 — 과목별 진행(우측, 스크롤) */}
        <div className={S.subjects}>
          <h2 className={S.subjectsH2}>과목별 진행</h2>
          {/* UX-2 — 입력 순서 그대로였다. 과목이 여럿이면 '시간부족'·'마감초과' 배지가 목록
              아래쪽에 묻혀, 배지는 급하다고 말하는데 화면은 그 사실을 숨겼다. 위험군만 위로
              올리는 **안정** 정렬이라 나머지 상대 순서(=위치 기억)는 보존된다. */}
          <div className={S.subjList}>
            {sortSubjectsByUrgency(r.itemStat, todayISO(state)).map((s) => (
              <SubjectRow key={s.id} s={s} today={todayISO(state)} />
            ))}
          </div>
          {/* T-14·T-23 — **작은 배수**(과목별 주간 추세). ⚠⚠ **자리를 한 번 틀렸다**: 처음엔
              드로어 바로 위(섹션 최상위)에 뒀는데 그 자리는 **3열 그리드의 자식**이라 카드 위로
              겹쳐 그려졌다 — 정적 검사는 전량 녹색이었고 §15-4 가 말한 그 부류다(실렌더로 잡았다).
              여기(과목 컬럼 안)가 맞는 자리다: 바로 위 목록이 전부 *지금 값 하나*를 말하고,
              추세를 보려면 상세 드로어를 열어야 했다 — 데이터워드는 그 답을 같은 컬럼에 둔다.
              ⚠ 공유 척도가 아니면 작은 배수가 아니고, 점이 모자란 과목은 **비운다**(0 으로 안
                그린다). 둘 다 판정은 `lib/series` 가 소유한다. */}
          {trellisRows.length > 0 && (
            <div className="mt-3.5 flex-none border-t border-line2 pt-3">
              <Trellis rows={trellisRows} caption="주간 추세 — TREND" />
            </div>
          )}
        </div>
      </div>

      {/* 깊은 차트는 온디맨드 드로어로 — 인출 증거·유지율·CBMS 레이더·주별 시간·챕터 타임라인 */}
      {/* 상세 리포트는 lazy — 열기 전엔 코드조차 받지 않는다(첫 화면 청크에서 제외).
          `detailOpen &&`로 감싸 마운트 자체를 미루므로 닫힌 상태에선 네트워크 요청도 없다. */}
      <DetailDrawer open={detailOpen} onClose={() => setDetailOpen(false)} title="학습 리포트 — 상세">
        {detailOpen && (
          <Suspense fallback={<div className="ds-tiny text-mut">상세 리포트를 불러오는 중…</div>}>
            <StatsDetail r={r} />
          </Suspense>
        )}
      </DetailDrawer>
    </section>
  );
}
