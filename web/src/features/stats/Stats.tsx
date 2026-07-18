/* ============================================================
   Stats — 탭: 📊 통계 (Phase 4 · 앱상태 + 파생)
   레거시 ui-stats.js를 React로 — KPI·인출 증거·유지율 스파크·스트릭 히트맵·CBMS 레이더·
   과목별 진행·주별 학습시간·챕터 타임라인. 차트는 기존 SVG/막대 로직을 컴포넌트화(설계도 §3).
   스타일: 공유 디자인 시스템은 ds.module(ds.*), 히트맵은 Stats.module(st.*), 요소·토큰은 전역 base.
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
import ds from '@/styles/ds.module.css';
import st from './Stats.module.css';
import type { ScheduleResult } from '@/lib/types';

const StatsDetail = lazy(() => import('./StatsDetail'));

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
      <div className={st.hmWrap}>
        <div className={st.hmDowWrap}>
          <span className={st.hmMonthSpacer} aria-hidden="true" />
          <div className={st.hmDow}>
            {['월', '', '수', '', '금', '', '일'].map((x, i) => (
              <span key={i}>{x}</span>
            ))}
          </div>
        </div>
        <div className={st.hmGridWrap}>
          <div className={st.hmMonths} aria-hidden="true">
            {monthLabels.map((lab, ci) => (
              <span key={ci} className={st.hmMonth}>
                {lab}
              </span>
            ))}
          </div>
          <div className={st.hmGrid}>
            {cols.map((col, ci) => (
              <div key={ci} className={st.hmCol}>
                {col.map((c, i) =>
                  c.l < 0 ? (
                    <div key={i} className={`${st.hmC} ${st.hmFuture}`} />
                  ) : (
                    (() => {
                      const lab = `${c.ds}: ${c.v > 0 ? `${Math.round(c.v)}분` : '학습 없음'}`;
                      return (
                        <div
                          key={i}
                          className={`${st.hmC} ${st['hmL' + c.l]}`}
                          data-tip={lab}
                          role="img"
                          aria-label={lab}
                        />
                      );
                    })()
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={`${st.hmLegend} ${ds.muted} ${ds.tiny}`}>
        <span>적음</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <div key={l} className={`${st.hmC} ${st['hmL' + l]}`} />
        ))}
        <span>많음</span>
        <span style={{ flex: 1 }} />
        최근 {WEEKS}주 {activeDays}일 학습 · 총 {Math.round(totalMin / 60)}h
      </div>
      {/* 잔디 셀은 탭스톱 폭주 방지로 비포커스(role=img+aria-label) — 대신 키보드/스크린리더용
          접이식 표(주 × 요일 · 분)로 동일 정보를 순회 없이 읽게. 기본 접힘·비침습. */}
      <details className={st.hmTable} onToggle={(e) => setTableOpen(e.currentTarget.open)}>
        <summary className={`${ds.muted} ${ds.tiny}`}>표로 보기 — 주 × 요일(분)</summary>
        {tableOpen && (
          <div className={st.hmTableScroll}>
            <table>
              <thead>
                <tr>
                  <th scope="col">주 시작</th>
                  {['월', '화', '수', '목', '금', '토', '일'].map((d) => (
                    <th key={d} scope="col">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cols.map((col, ci) => (
                  <tr key={ci}>
                    <th scope="row">{fmtShort(parseISO(col[0]!.ds))}</th>
                    {col.map((c, i) => (
                      <td key={i}>{c.l < 0 ? '' : c.v > 0 ? Math.round(c.v) : '·'}</td>
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
    <div className={ds.card}>
      <h2>
        학습 스트릭 <span className={`${ds.muted} ${ds.tiny}`}>— 최근 {WEEKS}주 · 하루 완료량(꾸준함의 리듬)</span>
      </h2>
      {heat}
    </div>
  );
}

/** 과목 1행 — 진행 막대 + 마감 상태 필. */
function SubjectRow({ s, today }: { s: ScheduleResult['itemStat'][number]; today: string }) {
  if (s.daily)
    return (
      <div className={st.subj}>
        <div className={st.subjTop}>
          <span className={ds.swatch} style={{ background: s.color }} />
          <span className={st.subjNm}>{s.name}</span>
          <span className={st.subjPill}>반복</span>
        </div>
        <div className={st.subjMeta}>
          매일 {s.dailyMin}분 · {s.schedH}h / {s.days}일
        </div>
      </div>
    );
  const prog = s.totalCh ? Math.round((s.doneCh! / s.totalCh) * 100) : 0;
  const pill = !s.deadline
    ? { cls: '', lab: '진행' }
    : !s.finished
      ? { cls: st.bad, lab: '시간부족' }
      : (s.late || 0) > 0
        ? { cls: st.bad, lab: '마감초과' }
        : { cls: st.good, lab: '정상' };
  return (
    <div className={st.subj}>
      <div className={st.subjTop}>
        <span className={ds.swatch} style={{ background: s.color }} />
        <span className={st.subjNm}>{s.name}</span>
        <span className={`${st.subjPill} ${pill.cls}`}>{pill.lab}</span>
      </div>
      <div className={st.subjBar}>
        <i style={{ width: `${prog}%`, background: s.color }} />
      </div>
      <div className={st.subjMeta}>
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
    <div className={st.gauge} role="img" aria-label={`완료율 ${pct}%`}>
      <ProgressRing
        size={130}
        r={52}
        pct={shown}
        className={st.gaugeSvg}
        trackClassName={st.gaugeTrack}
        arcClassName={st.gaugeArc}
      />
      <span className={st.gaugeNum}>
        {Math.round(shown)}
        <small>%</small>
      </span>
    </div>
  );
}

/** 보조 리드아웃 — 공용 CountReadout에 이 탭의 클래스만 입힘(카운트업 정본 공유). */
function Readout(props: { value: number; lab: ReactNode; prefix?: string; suffix?: ReactNode }) {
  return <CountReadout {...props} className={`${st.ro} ${ds.glow}`} numClassName={st.roNum} labClassName={st.roLab} />;
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

  usePageChromeEffect(
    () => ({
      readouts: [
        {
          label: '완료율',
          value: (
            <>
              {compRate}
              <small>%</small>
            </>
          ),
          accent: true,
        },
        {
          label: '연속',
          value: (
            <>
              {streak}
              <small> 일</small>
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
        <div className={ds.card}>
          <EmptyState
            glyph="📊"
            title="아직 통계가 없어요"
            desc={
              <>
                학습 항목을 추가하면 <b>완료율·인출 증거·유지율·스트릭</b>이 여기에 쌓입니다. 매일 블록을 체크할수록
                지표가 또렷해져요.
              </>
            }
            actions={
              <Button variant="primary" onClick={() => navigate('/items')}>
                + 학습 항목 추가
              </Button>
            }
          />
        </div>
      </section>
    );

  return (
    <section className={st.wrap} aria-label="학습 통계">
      <div className={st.grid}>
        {/* 1 — 회전 스파인 */}
        <div className={st.spine}>
          <div className={st.kicker}>학습 통계</div>
          <div className={st.spineBig}>DATA</div>
          <div className={st.spineSub}>{r.itemStat.length}과목</div>
        </div>

        {/* 2 — 지표 컬럼(완료율 발광 게이지 히어로 + 카운트업 리드아웃) */}
        <div className={st.metrics}>
          <div
            ref={heroRef}
            onMouseMove={heroMove}
            onMouseLeave={heroLeave}
            className={`${st.hero} ${ds.spotHost} ${ds.glow}`}
          >
            <div className={ds.spotlight} aria-hidden="true" />
            <div className={ds.aura} aria-hidden="true" />
            <Gauge pct={compRate} />
            <div className={st.heroMeta}>
              <span className={st.heroLab}>완료율 · 실제/계획</span>
              <span className={st.heroSub}>
                {doneH.toFixed(1)}h / {Math.round(totalSchedH)}h
              </span>
            </div>
          </div>
          <div className={st.ros}>
            <Readout value={streak} prefix="🔥 " lab="연속 학습일" />
            <Readout value={doneCh} suffix={<small>/{totalCh}</small>} lab="완료 챕터" />
            <Readout value={recallActs} lab="능동 인출(요약+백지+모의)" />
            <Readout value={revCount} lab="복습 세션(계획)" />
            {/* 개인 기록(I-6) — 기록이 있을 때만(과장 금지). 최고 집중일은 hLabel(분→시간)로 정적 표기. */}
            {pb.totalDays > 0 && (
              <>
                <Readout value={pb.longestStreak} prefix="🏆 " lab="최장 연속(개인 기록)" />
                <div className={`${st.ro} ${ds.glow}`}>
                  <span className={st.roNum}>{hLabel(pb.bestFocusMin)}</span>
                  <span className={st.roLab}>
                    최고 집중일{pb.bestFocusDs ? ` · ${fmtShort(parseISO(pb.bestFocusDs))}` : ''}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 3 — 시그니처(스트릭 발광맵 + 인출 판정) */}
        <div className={st.signature}>
          <div className={st.sigHead}>
            <span className={st.sigTitle}>학습 스트릭 — STREAK</span>
            <span className={st.sigMeta}>꾸준함의 리듬</span>
          </div>
          <div
            ref={mapRef}
            onMouseMove={mapMove}
            onMouseLeave={mapLeave}
            className={`${st.sigMap} ${ds.spotHost} ${ds.glow}`}
          >
            <div className={ds.spotlight} aria-hidden="true" />
            <div className={ds.aura} aria-hidden="true" />
            <StreakHeatmap bare />
          </div>
          <div className={st.verdicts}>
            <div className={st.verdict}>
              <span className={`${st.vIcon} ${trGood ? st.good : st.bad}`}>{trIcon}</span>
              <span className={st.vText}>
                <b>오답 추세</b> — 지난주 {tr.lastW} → 이번주 {tr.thisW}.{' '}
                {trGood ? '약점이 닫히는 방향. 👍' : '가장 잦은 유형의 처방에 다음 주 시간을 더 주세요.'}
              </span>
            </div>
            <div className={st.verdict}>
              <span className={st.vIcon} style={{ color: top ? CBMS_INFO[top.code]?.color : undefined }}>
                {top ? `${top.code} ${top.n}` : '—'}
              </span>
              <span className={st.vText} style={{ flex: 1 }}>
                <b>주된 약점</b> {top ? `${CBMS_INFO[top.code]?.label || ''}(전체 ${top.total}건)` : '오답 기록 없음'}
                {top && (
                  <>
                    <div className={st.weakBar}>
                      <i
                        style={{
                          width: `${Math.round((top.n / top.total) * 100)}%`,
                          background: CBMS_INFO[top.code]?.color || 'var(--acc)',
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className={st.navLink}
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
        <div className={st.subjects}>
          <h2>과목별 진행</h2>
          <div className={st.subjList}>
            {r.itemStat.map((s) => (
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
          <Suspense fallback={<div className={`${ds.muted} ${ds.tiny}`}>상세 리포트를 불러오는 중…</div>}>
            <StatsDetail r={r} />
          </Suspense>
        )}
      </DetailDrawer>
    </section>
  );
}
