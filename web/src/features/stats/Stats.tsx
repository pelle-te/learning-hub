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
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui';
import DetailDrawer from '@/components/DetailDrawer';
import { ProgressRing } from '@/components/ProgressRing';
import { CountReadout } from '@/components/CountReadout';
import { totalDoneHours, studyStreak } from '@/lib/persistence';
import { cbmsCounts, cbmsTop, cbmsTrend, cbmsTrendGlyph, recallEvidence, CBMS_INFO } from '@/lib/methodology';
import { personalBests } from '@/lib/records';
import { parseISO, fmtShort, todayISO, dayDiff, ddayInfo, hLabel } from '@/lib/utils';
import { buildStreakGrid } from '@/lib/statsView';
import { sortSubjectsByUrgency } from '@/lib/scheduleView';
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
    '[writing-mode:vertical-rl] text-xs leading-[1.6] font-extrabold text-mut max-wide:[writing-mode:horizontal-tb]',
  // 2 — 지표 컬럼
  metrics:
    'flex min-w-0 flex-col justify-center gap-3.5 border-r border-line2 p-5.5 max-wide:border-r-0 max-wide:border-b max-wide:border-line2',
  hero: `relative flex flex-col items-center gap-3 rounded-lg border border-line bg-[image:var(--bg-hero-stats)] px-4.5 pt-5.5 pb-5 shadow-hero animate-[enter-rise_var(--dur-slow)_var(--ease)_both] ds-hairline motion-reduce:animate-none max-wide:flex-row max-wide:justify-center max-wide:gap-5 max-narrow:flex-col`,
  heroMeta: 'flex flex-col items-center gap-0.5 text-center',
  heroLab: 'text-sm leading-[1.6] font-bold text-txt',
  heroSub: 'text-xs leading-[1.6] text-mut tabular-nums',
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
  sigTitle: 'text-xs leading-[1.6] font-extrabold tracking-caps text-mut uppercase',
  sigMeta: 'text-xs leading-[1.6] text-mut tabular-nums',
  sigMap: `relative flex flex-1 flex-col justify-center rounded-lg border border-line bg-[image:var(--bg-sig-stats)] px-4.5 pt-4.5 pb-3.5 shadow-card animate-[enter-rise_var(--dur-slow)_var(--ease)_var(--stagger)_both] ds-hairline motion-reduce:animate-none`,
  verdicts: 'flex flex-col gap-3 border-t border-line2 pt-3.5 max-wide:mt-3.5',
  verdict: 'flex items-start gap-3',
  vIcon: 'min-w-16 flex-none pt-px text-md font-extrabold',
  vIconGood: 'text-acc [text-shadow:var(--verdict-glow)]',
  vIconBad: 'text-bad',
  vText: 'text-md leading-[1.5] text-mut',
  weakBar: 'mt-1.5 h-2 flex-1 overflow-hidden rounded-full bg-track-cat',
  weakFill: 'block h-full rounded-full',
  // 인라인 링크 <button> — 원본은 font:inherit 로 부모 .vText 의 line-height(1.5)를 상속했다. preflight 가
  // 없어 버튼이 UA line-height:normal 로 떨어지므로, 부모의 상속 LH 를 명시로 못박는다(모바일 줄바꿈 시 누적 시프트 방지).
  navLink:
    'ml-1.25 inline border-0! bg-transparent! p-0! font-bold! text-acc! leading-[1.5] transition-[text-shadow] hover:underline hover:[text-shadow:var(--navlink-glow)] focus-visible:underline focus-visible:[text-shadow:var(--navlink-glow)]',
  // 4 — 과목별 진행
  subjects:
    'flex min-h-0 min-w-0 flex-col border-l border-line2 p-5.5 max-wide:min-h-75 max-wide:border-t max-wide:border-l-0 max-wide:border-line2',
  subjectsH2: 'mb-3! flex-none text-xs! leading-[1.6] font-extrabold! tracking-caps! text-mut! uppercase',
  subjList: '-mx-1 flex min-h-0 flex-1 flex-col gap-2.25 overflow-y-auto px-1 [scrollbar-width:thin]',
  subj: "relative flex flex-col gap-1.5 overflow-hidden rounded-md border border-line bg-panel pt-2.75 pr-3.25 pb-3 pl-3.75 shadow-card transition-[border-color,transform,box-shadow] duration-fast ease-[var(--ease)] before:absolute before:top-2.25 before:bottom-2.25 before:left-0 before:w-0.75 before:scale-y-0 before:rounded-cell before:bg-acc before:shadow-spine before:transition-transform before:duration-fast before:ease-[var(--ease)] before:content-[''] hover:-translate-y-px hover:border-line-acc hover:shadow-hero hover:before:scale-y-100",
  subjTop: 'flex items-center gap-2',
  subjNm: 'flex-1 truncate text-base14 font-bold',
  subjBar: 'h-1.75 overflow-hidden rounded-full bg-track-cat',
  subjFill: 'block h-full rounded-full',
  subjMeta: 'truncate text-xs leading-[1.6] text-mut tabular-nums',
  // 스트릭 히트맵(잔디)
  hmWrap: 'flex items-start gap-1.5 overflow-x-auto py-1',
  hmDowWrap: 'flex flex-none flex-col',
  hmMonthSpacer: 'mb-0.75 h-3.25',
  hmDow: 'flex flex-none flex-col gap-0.75 text-2xs text-mut',
  hmDowCell: 'h-3.25 leading-[1.3]',
  hmGridWrap: 'flex flex-col',
  hmMonths: 'mb-0.75 flex h-3.25 gap-0.75',
  hmMonth: 'w-3.25 flex-none overflow-visible text-2xs leading-[1.3] whitespace-nowrap text-mut',
  hmGrid: 'flex gap-0.75',
  hmCol: 'flex flex-col gap-0.75',
  cell: 'size-3.25 flex-none rounded-cell border border-line-soft',
  cellLg: 'size-2.75 flex-none rounded-cell border border-line-soft',
  hmFuture: 'bg-panel2 opacity-25',
  hmLegend: 'mt-2 flex items-center gap-1',
  hmTable: 'mt-2',
  hmSummary: 'w-fit cursor-pointer',
  hmTableScroll: 'mt-2 max-h-60 overflow-auto [scrollbar-width:thin]',
  hmTableEl: 'border-collapse text-xs leading-[1.6] tabular-nums',
  thCol: 'sticky top-0 border-b border-line-soft bg-panel px-2 py-0.75 text-right font-bold whitespace-nowrap text-txt',
  thRow: 'border-b border-line-soft px-2 py-0.75 text-left font-semibold whitespace-nowrap text-txt',
  td: 'border-b border-line-soft px-2 py-0.75 text-right whitespace-nowrap text-mut',
} as const;

/** 잔디 농도 5단(0~4) — 정적 클래스 맵(§15 부칙 · 동적 조립 금지). L0=panel2·L4=acc, 사이는 acc 파생 잔디. */
const LVL: Record<number, string> = { 0: 'bg-panel2', 1: 'bg-hm-l1', 2: 'bg-hm-l2', 3: 'bg-hm-l3', 4: 'bg-acc' };

/** 과목 칩 톤 — 정적 맵(진행/반복=중립 · good=정상 · bad=시간부족/마감초과). 테두리는 acc/bad 45% line. */
const PILL = 'rounded-full border px-2 py-px text-2xs font-bold whitespace-nowrap';
const PILL_TONE = {
  '': 'border-line text-mut',
  good: 'border-line-acc-pill text-acc',
  bad: 'border-line-bad-pill text-bad',
} as const;

/** 학습 스트릭 히트맵 — 최근 18주 잔디. 메인 화면(bare)과 카드 두 형태로 쓰인다. */
function StreakHeatmap({ bare }: { bare?: boolean }) {
  const state = useApp((s) => s.state);
  // 126개 <td>는 접힌 채로도 상시 렌더됐음 — 열렸을 때만 표를 만들어(lazy) 유휴 비용 제거.
  const [tableOpen, setTableOpen] = useState(false);
  const WEEKS = 18;
  // 그리드 파생(임계값·미래 마스킹·월 라벨)은 순수 lib(buildStreakGrid) — 이 컴포넌트는 마크업만.
  const { cols, monthLabels, activeDays, totalMin } = buildStreakGrid(state, WEEKS);
  const heat = (
    <>
      {/* ⚠ `tabIndex={0}` + 이름 — axe `scrollable-region-focusable`(2026-07-25). 이 잔디는
          18주치라 좁은 폭에서 **가로로 스크롤된다.** 안에 포커스 가능한 자식이 하나도 없어서
          (전부 `<span>` 칸이다) 키보드·스위치 사용자는 잘린 부분을 볼 방법이 아예 없었다.
          마우스 휠·터치로만 닿는 콘텐츠가 있었던 셈이다. 컨테이너를 포커스 대상으로 만들면
          화살표키로 스크롤된다(브라우저 기본 동작). 픽셀은 안 바뀐다 — 포커스 링은 :focus-visible
          이라 스냅샷(비포커스 상태)에 안 나온다. */}
      <div className={S.hmWrap} tabIndex={0} role="group" aria-label={`최근 ${WEEKS}주 학습 잔디`}>
        <div className={S.hmDowWrap}>
          <span className={S.hmMonthSpacer} aria-hidden="true" />
          <div className={S.hmDow}>
            {['월', '', '수', '', '금', '', '일'].map((x, i) => (
              <span key={i} className={S.hmDowCell}>
                {x}
              </span>
            ))}
          </div>
        </div>
        <div className={S.hmGridWrap}>
          <div className={S.hmMonths} aria-hidden="true">
            {monthLabels.map((lab, ci) => (
              <span key={ci} className={S.hmMonth}>
                {lab}
              </span>
            ))}
          </div>
          <div className={S.hmGrid}>
            {cols.map((col, ci) => (
              <div key={ci} className={S.hmCol}>
                {col.map((c, i) =>
                  c.l < 0 ? (
                    <div key={i} className={`${S.cell} ${S.hmFuture}`} />
                  ) : (
                    (() => {
                      const lab = `${c.ds}: ${c.v > 0 ? `${Math.round(c.v)}분` : '학습 없음'}`;
                      return (
                        <div key={i} className={`${S.cell} ${LVL[c.l]}`} data-tip={lab} role="img" aria-label={lab} />
                      );
                    })()
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={`${S.hmLegend} ds-muted ds-tiny`}>
        <span>적음</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <div key={l} className={`${S.cellLg} ${LVL[l]}`} />
        ))}
        <span>많음</span>
        <span style={{ flex: 1 }} />
        최근 {WEEKS}주 {activeDays}일 학습 · 총 {Math.round(totalMin / 60)}h
      </div>
      {/* 잔디 셀은 탭스톱 폭주 방지로 비포커스(role=img+aria-label) — 대신 키보드/스크린리더용
          접이식 표(주 × 요일 · 분)로 동일 정보를 순회 없이 읽게. 기본 접힘·비침습. */}
      <details className={S.hmTable} onToggle={(e) => setTableOpen(e.currentTarget.open)}>
        <summary className={`${S.hmSummary} ds-muted ds-tiny`}>표로 보기 — 주 × 요일(분)</summary>
        {tableOpen && (
          <div className={S.hmTableScroll}>
            <table className={S.hmTableEl}>
              <thead>
                <tr>
                  <th scope="col" className={S.thCol}>
                    주 시작
                  </th>
                  {['월', '화', '수', '목', '금', '토', '일'].map((d) => (
                    <th key={d} scope="col" className={S.thCol}>
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cols.map((col, ci) => (
                  <tr key={ci}>
                    <th scope="row" className={S.thRow}>
                      {fmtShort(parseISO(col[0]!.ds))}
                    </th>
                    {col.map((c, i) => (
                      <td key={i} className={S.td}>
                        {c.l < 0 ? '' : c.v > 0 ? Math.round(c.v) : '·'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </>
  );
  if (bare) return heat;
  return (
    <div className="ds-rule">
      <h2>
        학습 스트릭 <span className="ds-muted ds-tiny">— 최근 {WEEKS}주 · 하루 완료량(꾸준함의 리듬)</span>
      </h2>
      {heat}
    </div>
  );
}

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
        {s.deadline ? (
          <>
            {' · 마감 '}
            {fmtShort(parseISO(s.deadline))} <b>({ddayInfo(dayDiff(today, s.deadline)).lab})</b>
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
function Readout(props: { value: number; lab: ReactNode; prefix?: string; suffix?: ReactNode }) {
  return <CountReadout {...props} className="ds-ro ds-glow" numClassName={'ds-roNum'} labClassName={'ds-roLab'} />;
}

export default function Stats() {
  const state = useApp((s) => s.state);
  const r = useSchedule();
  const navigate = useNavigate();
  const [detailOpen, setDetailOpen] = useState(false);
  // 포인터 추적 스포트라이트 — 히어로 게이지 패널·발광 스트릭 시그니처가 커서를 따라 발광(틸트 없는 큰 보드).
  const { ref: heroRef, onMouseMove: heroMove, onMouseLeave: heroLeave } = useHeroPointer(0);
  const { ref: mapRef, onMouseMove: mapMove, onMouseLeave: mapLeave } = useHeroPointer(0);

  const totalSchedH = r.itemStat.reduce((t, s) => t + (s.schedH || 0), 0);
  const totalCh = r.itemStat.reduce((t, s) => t + (s.totalCh || 0), 0);
  const doneCh = r.itemStat.reduce((t, s) => t + (s.doneCh || 0), 0);
  const revCount = r.days.reduce((t, d) => t + d.items.filter((i) => i.type === 'rev').length, 0);
  const doneH = totalDoneHours(state);
  const streak = studyStreak(state);
  const compRate = totalSchedH > 0 ? Math.min(100, Math.round((doneH / totalSchedH) * 100)) : 0;

  // 능동 인출 활동(북극성 출력 지표) = 요약 + 백지 완료 + 모의 완료. (인출카드와 공용 헬퍼 · SSOT)
  const { recallActs } = recallEvidence(state, r);

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
        {
          label: '연속',
          value: (
            <>
              {streak}
              <small className="text-base14 font-bold text-mut"> 일</small>
            </>
          ),
        },
        { label: '인출', value: recallActs },
      ],
      action: { label: '＋ 상세 리포트', onClick: () => setDetailOpen(true) },
    }),
    [compRate, streak, recallActs],
  );

  if (!r.itemStat.length)
    return (
      <section aria-label="학습 통계">
        <div className="ds-rule">
          <EmptyState
            glyph="📊"
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
            <Readout value={streak} prefix="🔥 " lab="연속 학습일" />
            <Readout value={doneCh} suffix={<small>/{totalCh}</small>} lab="완료 챕터" />
            <Readout value={recallActs} lab="능동 인출(요약+백지+모의)" />
            <Readout value={revCount} lab="복습 세션(계획)" />
            {/* 개인 기록(I-6) — 기록이 있을 때만(과장 금지). 최고 집중일은 hLabel(분→시간)로 정적 표기. */}
            {pb.totalDays > 0 && (
              <>
                <Readout value={pb.longestStreak} prefix="🏆 " lab="최장 연속(개인 기록)" />
                <div className="ds-ro ds-glow">
                  <span className="ds-roNum">{hLabel(pb.bestFocusMin)}</span>
                  <span className="ds-roLab">
                    최고 집중일{pb.bestFocusDs ? ` · ${fmtShort(parseISO(pb.bestFocusDs))}` : ''}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 3 — 시그니처(스트릭 발광맵 + 인출 판정) */}
        <div className={S.signature}>
          <div className={S.sigHead}>
            <span className={S.sigTitle}>학습 스트릭 — STREAK</span>
            <span className={S.sigMeta}>꾸준함의 리듬</span>
          </div>
          <div ref={mapRef} onMouseMove={mapMove} onMouseLeave={mapLeave} className={`${S.sigMap} ds-spotHost ds-glow`}>
            <div className="ds-spotlight" aria-hidden="true" />
            <div className="ds-aura" aria-hidden="true" />
            <StreakHeatmap bare />
          </div>
          <div className={S.verdicts}>
            <div className={S.verdict}>
              <span className={`${S.vIcon} ${trGood ? S.vIconGood : S.vIconBad}`}>{trIcon}</span>
              <span className={S.vText}>
                <b className="text-txt">오답 추세</b> — 지난주 {tr.lastW} → 이번주 {tr.thisW}.{' '}
                {trGood ? '약점이 닫히는 방향. 👍' : '가장 잦은 유형의 처방에 다음 주 시간을 더 주세요.'}
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
        </div>
      </div>

      {/* 깊은 차트는 온디맨드 드로어로 — 인출 증거·유지율·CBMS 레이더·주별 시간·챕터 타임라인 */}
      {/* 상세 리포트는 lazy — 열기 전엔 코드조차 받지 않는다(첫 화면 청크에서 제외).
          `detailOpen &&`로 감싸 마운트 자체를 미루므로 닫힌 상태에선 네트워크 요청도 없다. */}
      <DetailDrawer open={detailOpen} onClose={() => setDetailOpen(false)} title="학습 리포트 — 상세">
        {detailOpen && (
          <Suspense fallback={<div className="ds-muted ds-tiny">상세 리포트를 불러오는 중…</div>}>
            <StatsDetail r={r} />
          </Suspense>
        )}
      </DetailDrawer>
    </section>
  );
}
