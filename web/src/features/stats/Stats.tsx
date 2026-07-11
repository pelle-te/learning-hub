/* ============================================================
   Stats — 탭: 📊 통계 (Phase 4 · 앱상태 + 파생)
   레거시 ui-stats.js를 React로 — KPI·인출 증거·유지율 스파크·스트릭 히트맵·CBMS 레이더·
   과목별 진행·주별 학습시간·챕터 타임라인. 차트는 기존 SVG/막대 로직을 컴포넌트화(설계도 §3).
   스타일: 공유 디자인 시스템은 ds.module(ds.*), 히트맵은 Stats.module(st.*), 요소·토큰은 전역 base.
============================================================ */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useHeroPointer, useCountUp } from '@/lib/interactions';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui';
import DetailDrawer from '@/components/DetailDrawer';
import { ProgressRing } from '@/components/ProgressRing';
import { CountReadout } from '@/components/CountReadout';
import { totalDoneHours, studyStreak } from '@/lib/persistence';
import {
  cbmsCounts,
  cbmsTrend,
  cbmsTrendGlyph,
  cbmsTop,
  confRate,
  recallEvidence,
  retentionNudge,
  retentionTrend,
  CBMS_INFO,
  CBMS_CODES,
} from '@/lib/methodology';
import { parseISO, fmtShort, addDays, mondayOf, iso, todayISO, dayDiff, ddayInfo, DOW } from '@/lib/utils';
import ds from '@/styles/ds.module.css';
import st from './Stats.module.css';
import type { ScheduleResult } from '@/lib/types';

const TIMELINE_CAP = 60; // 최근 N일만 그려 다년 누적에도 비용 상한.

/** 인출 증거(북극성 지표) — 투입 아닌 출력. */
function RetrievalCard({ r }: { r: ScheduleResult }) {
  const state = useApp((s) => s.state);
  const navigate = useNavigate();
  const tr = cbmsTrend(state);
  const { icon: trIcon, good: trGood } = cbmsTrendGlyph(tr);
  const { blankPlan, blankDone, blankRate, recallActs } = recallEvidence(state, r);
  // 과신 오답률(메타인지 캘리브레이션 · 방법론 E5) — 지식엔진 미빌드에도 실시간 집계. 오답 0이면 null.
  const cal = confRate(state);
  return (
    <div className={ds.card}>
      <h2>
        인출 증거{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>
          — "이해했다"가 아니라 "꺼낼 수 있다"의 증거(투입 아닌 출력 지표)
        </span>
      </h2>
      <div className={ds.kpis} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className={ds.kpi}>
          <div className={ds.v} style={{ color: trGood ? 'var(--ok)' : 'var(--bad)' }}>
            {trIcon}
          </div>
          <div className={ds.l}>
            오답 추세{' '}
            <span className={`${ds.muted} ${ds.tiny}`}>
              (지난주 {tr.lastW} → 이번주 {tr.thisW})
            </span>
          </div>
        </div>
        <div className={ds.kpi}>
          <div className={ds.v}>{blankPlan ? `${blankRate}%` : '—'}</div>
          <div className={ds.l}>
            백지 복습 완료{' '}
            <span className={`${ds.muted} ${ds.tiny}`}>
              {blankPlan ? `(${blankDone}/${blankPlan})` : '(계획 없음)'}
            </span>
          </div>
        </div>
        <div className={ds.kpi}>
          <div className={ds.v}>{recallActs}</div>
          <div className={ds.l}>
            능동 인출 활동 <span className={`${ds.muted} ${ds.tiny}`}>요약+백지+모의</span>
          </div>
        </div>
      </div>
      <div className={ds.foot}>
        {trGood ? (
          '오답이 줄고 있어요 — 약점이 닫히는 방향. 👍'
        ) : (
          <>
            오답이 늘었어요 — 가장 많은 코드의 처방에 다음 주 시간을 더 주세요.
            <button type="button" className={st.navLink} onClick={() => navigate('/review', { viewTransition: true })}>
              주간 리뷰로 →
            </button>
          </>
        )}{' '}
        백지 복습은 가장 깊은 인출 — 계획되면 꼭 닫기.
      </div>
      {/* 과신 오답 표면화 — '찍어서 맞음/확신 없었음'으로 처리한 오답 비율(캘리브레이션 신호).
          점검할 오답이 실제 있을 때만(conf>0) 노출, 비율 높으면 주의색으로 승격. */}
      {cal && cal.conf > 0 && (
        <div className={ds.foot} style={cal.rate >= 40 ? { color: 'var(--bad)' } : undefined}>
          확신 없이 처리한 오답 {cal.conf}건(전체 {cal.total}건 중 {cal.rate}%) — 다시 점검 대상.
        </div>
      )}
    </div>
  );
}

/** 유지율(due) 추세 스파크라인 — AnkiConnect 스냅샷이 쌓이면 표시. */
function RetentionSpark() {
  const state = useApp((s) => s.state);
  const t = retentionTrend(state);
  if (!t.has || !t.latest)
    return (
      <div className={ds.card}>
        <h2>
          유지율 추세 <span className={`${ds.muted} ${ds.tiny}`}>— 기억 유지의 출력 지표</span>
        </h2>
        <div className={`${ds.empty} ${ds.tiny}`}>
          아직 데이터가 없어요. <b>Anki 현황</b> 탭에서 <b>🔌 AnkiConnect 실시간 due</b>를 누르면 그 주의 due가
          기록돼요(주 1회면 충분). due가 꾸준히 줄면 복습 빚이 닫히는 중.
        </div>
      </div>
    );
  const pts = t.points;
  const nudge = retentionNudge(state);
  const max = Math.max(1, ...pts.map((p) => p.due));
  const flat = t.delta === 0 || !t.prev;
  const good = t.delta > 0;
  const icon = flat ? '＝ 유지' : good ? '▼ 감소' : '▲ 증가';
  const col = flat ? 'var(--muted)' : good ? 'var(--ok)' : 'var(--bad)';
  return (
    <div className={ds.card}>
      <h2>
        유지율 추세{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>
          — Anki 복습 빚(due)의 주별 추세. 투입 아닌 '기억 유지'의 출력 지표
        </span>
      </h2>
      <div className={ds.row} style={{ alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 50, flex: 1, minWidth: 120 }}>
          {pts.map((p, i) => {
            const lab = `${p.wk}: due ${p.due}장${p.cards ? ` / ${p.cards}장 중` : ''}`;
            return (
              <div
                key={i}
                className={st.sparkBar}
                data-tip={lab}
                tabIndex={0}
                role="img"
                aria-label={lab}
                style={{ height: Math.round((p.due / max) * 46) + 2 }}
              />
            );
          })}
        </div>
        <div style={{ textAlign: 'right', minWidth: 96 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: col }}>{icon}</div>
          <div className={`${ds.muted} ${ds.tiny}`}>
            이번주 {t.latest.due} due{t.prev ? ` · 지난주 ${t.prev.due}` : ''}
          </div>
        </div>
      </div>
      {/* 능동 넛지 — 방향 표시(색)를 넘어, 악화가 유의미할 때만 경고 박스로 승격. */}
      {nudge && (
        <div className={ds.warnbox} role="status">
          ⚠ {nudge}
        </div>
      )}
      <div className={ds.foot}>
        {flat
          ? '추세를 보려면 매주 한 번 due를 기록하세요(Anki 탭).'
          : good
            ? '복습 빚이 줄고 있어요 — 기억이 유지되는 방향. 👍'
            : 'due가 늘었어요 — 밀린 복습을 따라잡을 시간을 확보하세요(due→복습 시간예산 역연동 활용).'}
      </div>
    </div>
  );
}

/** 학습 스트릭 히트맵(GitHub식) — 최근 18주, 하루 완료분 5단계 농도.
   bare=true → 카드/제목 없이 잔디 + 범례만(데이터보드 시그니처 컬럼용). */
function StreakHeatmap({ bare }: { bare?: boolean }) {
  const state = useApp((s) => s.state);
  // 126개 <td>는 접힌 채로도 상시 렌더됐음 — 열렸을 때만 표를 만들어(lazy) 유휴 비용 제거.
  const [tableOpen, setTableOpen] = useState(false);
  const WEEKS = 18;
  const comp = state.completions || {};
  const today = parseISO(todayISO(state));
  const startMon = addDays(mondayOf(today), -7 * (WEEKS - 1));
  const minOf = (ds2: string) => {
    const m = comp[ds2];
    if (!m) return 0;
    return Object.values(m).reduce((acc, e) => acc + (e && e.done ? +e.min || 0 : 0), 0);
  };
  const lvl = (v: number) => (v <= 0 ? 0 : v < 30 ? 1 : v < 60 ? 2 : v < 120 ? 3 : 4);
  let activeDays = 0;
  let totalMin = 0;
  const cols: { ds: string; v: number; l: number }[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const colMon = addDays(startMon, w * 7);
    const cells: { ds: string; v: number; l: number }[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const d = addDays(colMon, dow);
      const ds2 = iso(d);
      const future = d > today;
      const v = future ? -1 : minOf(ds2);
      if (v > 0) {
        activeDays++;
        totalMin += v;
      }
      cells.push({ ds: ds2, v, l: future ? -1 : lvl(v) });
    }
    cols.push(cells);
  }
  // 월 라벨 — 각 주 열의 시작(월요일) 달이 바뀌는 지점에만 표기(언제 공백이 생겼는지 읽히게).
  let lastMonth = -1;
  const monthLabels = cols.map((col) => {
    const mo = new Date((col[0]?.ds || today.toISOString().slice(0, 10)) + 'T00:00:00').getMonth();
    if (mo !== lastMonth) {
      lastMonth = mo;
      return `${mo + 1}월`;
    }
    return '';
  });
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

/** 오답 분포 레이더(CBMS) — 5축 펜타곤 SVG. */
function CbmsRadar() {
  const state = useApp((s) => s.state);
  const codes = CBMS_CODES; // 방법론 SSOT — 하드코딩 축 배열 제거(드리프트 위험 차단).
  const cnt = cbmsCounts(state);
  const vals = codes.map((k) => cnt[k] || 0);
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total)
    return (
      <div className={ds.card}>
        <h2>
          오답 분포(CBMS) <span className={`${ds.muted} ${ds.tiny}`}>— 약점 유형의 모양</span>
        </h2>
        <div className={`${ds.empty} ${ds.tiny}`}>
          오답을 기록하면(오늘 학습 탭) 유형 분포가 레이더로 보여요. 모양이 작아질수록 약점이 닫히는 중.
        </div>
      </div>
    );
  const max = Math.max(...vals, 1);
  const cx = 110;
  const cy = 104;
  const R = 78;
  const pt = (i: number, r: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ring = (f: number) =>
    codes
      .map((_, i) =>
        pt(i, R * f)
          .map((n) => n.toFixed(1))
          .join(','),
      )
      .join(' ');
  const poly = vals
    .map((v, i) =>
      pt(i, R * (v / max))
        .map((n) => n.toFixed(1))
        .join(','),
    )
    .join(' ');
  return (
    <div className={ds.card}>
      <h2>
        오답 분포(CBMS) <span className={`${ds.muted} ${ds.tiny}`}>— 약점 유형의 모양(전체 {total}건)</span>
      </h2>
      <div className={ds.row} style={{ alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <svg viewBox="0 0 220 208" width={220} height={208} style={{ flex: 'none' }} aria-label="CBMS 오답 분포 레이더">
          <polygon points={ring(1)} fill="color-mix(in srgb,var(--panel2) 70%,transparent)" stroke="none" />
          {[0.25, 0.5, 0.75].map((f) => (
            <polygon key={f} points={ring(f)} fill="none" stroke="var(--line-soft)" strokeWidth={1} />
          ))}
          <polygon points={ring(1)} fill="none" stroke="var(--line)" strokeWidth={1.5} />
          {codes.map((_, i) => {
            const [x, y] = pt(i, R);
            return (
              <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="var(--line)" strokeWidth={1} />
            );
          })}
          <polygon
            points={poly}
            fill="color-mix(in srgb,var(--acc) 22%,transparent)"
            stroke="var(--acc)"
            strokeWidth={1.5}
          />
          {vals.map((v, i) => {
            const [x, y] = pt(i, R * (v / max));
            const lab = `${codes[i]} ${CBMS_INFO[codes[i]!]?.label || ''}: ${v}건`;
            return (
              <circle
                key={i}
                cx={x.toFixed(1)}
                cy={y.toFixed(1)}
                r={4}
                fill="var(--acc)"
                data-tip={lab}
                tabIndex={0}
                role="img"
                aria-label={lab}
                style={{ cursor: 'pointer' }}
              />
            );
          })}
          {codes.map((k, i) => {
            const [x, y] = pt(i, R + 15);
            const c = CBMS_INFO[k]?.color || 'var(--mut)';
            return (
              <text
                key={k}
                x={x.toFixed(1)}
                y={y.toFixed(1)}
                fill={c}
                fontSize={11}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {k}
              </text>
            );
          })}
        </svg>
        <div style={{ flex: 1, minWidth: 160 }}>
          {codes.map((k) => {
            const info = CBMS_INFO[k];
            const v = cnt[k] || 0;
            const pctv = total ? Math.round((v / total) * 100) : 0;
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', fontSize: 12 }}>
                <span className={ds.swatch} style={{ background: info.color || '#888' }} />
                <span style={{ width: 60 }}>
                  {k} {info.label || ''}
                </span>
                <div className={ds.bar} style={{ flex: 1, margin: 0 }}>
                  <i style={{ width: `${pctv}%`, background: info.color || '#888' }} />
                </div>
                <span className={`${ds.muted} ${ds.tiny}`} style={{ width: 28, textAlign: 'right' }}>
                  {v}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className={ds.foot}>
        가장 큰 축이 지금의 주된 약점 — 주간 리뷰의 처방을 그 유형에 투자하세요(모양이 작고 고를수록 좋음).
      </div>
    </div>
  );
}

/** 주별 학습시간 — 과목별 색 스택 막대. */
function WeeklyBars({ r }: { r: ScheduleResult }) {
  const weeks = Object.keys(r.weekHours).sort();
  if (!weeks.length)
    return (
      <EmptyState glyph="📊" title="아직 주별 데이터가 없어요" desc="블록을 완료하면 주별 학습시간이 여기 쌓여요." />
    );
  const byId: Record<string, ScheduleResult['itemStat'][number]> = {};
  r.itemStat.forEach((s) => (byId[s.id] = s));
  const maxH = Math.max(1, ...weeks.map((w) => Object.values(r.weekHours[w]!).reduce((t, v) => t + v, 0)));
  return (
    <>
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', overflowX: 'auto', padding: '6px 0', minHeight: 140 }}
      >
        {weeks.map((w) => {
          const segs = r.weekHours[w]!;
          const tot = Object.values(segs).reduce((t, v) => t + v, 0);
          return (
            <div key={w} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 46 }}>
              <div className={`${ds.tiny} ${ds.muted}`}>{Math.round(tot)}h</div>
              <div style={{ display: 'flex', flexDirection: 'column-reverse', width: 30, gap: 1 }}>
                {Object.entries(segs).map(([sid, h]) => {
                  const lab = `${byId[sid]?.name || ''}: ${Math.round(h * 10) / 10}h`;
                  return (
                    <div
                      key={sid}
                      className={st.wkSeg}
                      data-tip={lab}
                      role="img"
                      aria-label={lab}
                      tabIndex={0}
                      style={{
                        height: (h / maxH) * 110,
                        background: byId[sid]?.color || 'var(--acc)',
                      }}
                    />
                  );
                })}
              </div>
              <div className={`${ds.tiny} ${ds.muted}`} style={{ marginTop: 4 }}>
                {fmtShort(parseISO(w))}
              </div>
            </div>
          );
        })}
      </div>
      <div className={`${ds.tiny} ${ds.muted}`} style={{ marginTop: 6 }}>
        {r.itemStat.map((s) => (
          <span key={s.id}>
            <span className={ds.swatch} style={{ background: s.color }} />
            {s.name}
            {'  '}
          </span>
        ))}
      </div>
    </>
  );
}

/** 챕터 타임라인 — 날짜별 '무엇을 배웠나'(최근 CAP일). */
function ChapterTimeline({ r }: { r: ScheduleResult }) {
  if (!r.chapterLog.length)
    return <div className={ds.empty}>챕터가 있는 과목을 추가하면 여기에 '며칠에 무엇을 배우는지'가 쌓입니다.</div>;
  const byDs: Record<string, ScheduleResult['chapterLog']> = {};
  r.chapterLog.forEach((e) => {
    (byDs[e.ds] = byDs[e.ds] || []).push(e);
  });
  const all = Object.keys(byDs).sort();
  const dss = all.length > TIMELINE_CAP ? all.slice(-TIMELINE_CAP) : all;
  const hidden = all.length - dss.length;
  return (
    <div style={{ maxHeight: 360, overflow: 'auto' }}>
      {hidden > 0 && (
        <div className={`${ds.tiny} ${ds.muted}`} style={{ marginBottom: 6 }}>
          ⋯ 이전 {hidden}일은 생략(부분 렌더 — 대용량서도 가볍게). 전체 보관은 <b>일과 탭 → 오래된 기록 정리</b>로
          아카이빙 권장.
        </div>
      )}
      {dss.map((dsk) => {
        const d = parseISO(dsk);
        return (
          <div key={dsk} className={ds.tl}>
            <span className={ds.tm}>
              {fmtShort(d)} ({DOW[d.getDay()]})
            </span>
            <span className={ds.nm}>
              {byDs[dsk]!.map((e, i) => (
                <span key={i}>
                  <span className={ds.swatch} style={{ background: e.color }} />
                  {e.name} <span className={`${ds.muted} ${ds.tiny}`}>{e.chapters.join(', ')}</span>
                  {i < byDs[dsk]!.length - 1 ? ' / ' : ''}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 과목 한 줄(과목별 진행, 컴팩트) — 색 레일 + 진행 네온 바 + 상태 칩. */
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
      <DetailDrawer open={detailOpen} onClose={() => setDetailOpen(false)} title="학습 리포트 — 상세">
        <RetrievalCard r={r} />
        <RetentionSpark />
        <CbmsRadar />
        <div className={ds.card}>
          <h2>주별 학습시간</h2>
          <WeeklyBars r={r} />
        </div>
        <div className={ds.card}>
          <h2>학습한 내용 (챕터 타임라인)</h2>
          <ChapterTimeline r={r} />
        </div>
      </DetailDrawer>
    </section>
  );
}
