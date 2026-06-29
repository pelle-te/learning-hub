/* ============================================================
   Stats — 탭: 📊 통계 (Phase 4 · 앱상태 + 파생)
   레거시 ui-stats.js를 React로 — KPI·인출 증거·유지율 스파크·스트릭 히트맵·CBMS 레이더·
   과목별 진행·주별 학습시간·챕터 타임라인. 차트는 기존 SVG/막대 로직을 컴포넌트화(설계도 §3).
   스타일: 공유 디자인 시스템은 ds.module(ds.*), 히트맵은 Stats.module(st.*), 요소·토큰은 전역 base.
============================================================ */
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { isDone, totalDoneHours, studyStreak } from '@/lib/persistence';
import { cbmsCounts, cbmsTrend, retentionTrend, summaryCount, CBMS_INFO } from '@/lib/methodology';
import { parseISO, fmtShort, addDays, mondayOf, iso, todayISO, DOW } from '@/lib/utils';
import ds from '@/styles/ds.module.css';
import st from './Stats.module.css';
import type { CbmsCode, ScheduleResult } from '@/lib/types';

const TIMELINE_CAP = 60; // 최근 N일만 그려 다년 누적에도 비용 상한.

/** 인출 증거(북극성 지표) — 투입 아닌 출력. */
function RetrievalCard({ r }: { r: ScheduleResult }) {
  const state = useApp((s) => s.state);
  const tr = cbmsTrend(state);
  const trDelta = tr.lastW - tr.thisW;
  const trIcon = tr.lastW === 0 && tr.thisW === 0 ? '—' : trDelta > 0 ? '▼ 감소' : trDelta < 0 ? '▲ 증가' : '＝ 유지';
  const trGood = trDelta > 0 || (tr.lastW === 0 && tr.thisW === 0);
  let blankPlan = 0;
  let blankDone = 0;
  let mockDone = 0;
  (r.days || []).forEach((d) =>
    d.items.forEach((it) => {
      if (it.type === 'blank') {
        blankPlan++;
        if (isDone(state, d.ds, it.sid, it.type)) blankDone++;
      }
      if (it.type === 'mock' && isDone(state, d.ds, it.sid, it.type)) mockDone++;
    }),
  );
  const blankRate = blankPlan ? Math.round((blankDone / blankPlan) * 100) : 0;
  const recallActs = summaryCount(state) + blankDone + mockDone;
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
          <div className={ds.v} style={{ color: trGood ? 'var(--ok,#7ee0c0)' : 'var(--bad,#ff8fa3)' }}>
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
        {trGood
          ? '오답이 줄고 있어요 — 약점이 닫히는 방향. 👍'
          : '오답이 늘었어요 — 가장 많은 코드의 처방에 다음 주 시간을 더 주세요(주간 리뷰 탭).'}{' '}
        백지 복습은 가장 깊은 인출 — 계획되면 꼭 닫기.
      </div>
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
  const max = Math.max(1, ...pts.map((p) => p.due));
  const flat = t.delta === 0 || !t.prev;
  const good = t.delta > 0;
  const icon = flat ? '＝ 유지' : good ? '▼ 감소' : '▲ 증가';
  const col = flat ? 'var(--muted,#9aa3b2)' : good ? 'var(--ok,#7ee0c0)' : 'var(--bad,#ff8fa3)';
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
                data-tip={lab}
                tabIndex={0}
                role="img"
                aria-label={lab}
                style={{
                  flex: 1,
                  minWidth: 6,
                  height: Math.round((p.due / max) * 46) + 2,
                  background: 'var(--acc,#6ea8fe)',
                  borderRadius: '2px 2px 0 0',
                  alignSelf: 'flex-end',
                }}
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

/** 학습 스트릭 히트맵(GitHub식) — 최근 18주, 하루 완료분 5단계 농도. */
function StreakHeatmap() {
  const state = useApp((s) => s.state);
  const WEEKS = 18;
  const comp = state.completions || {};
  const today = parseISO(todayISO());
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
  return (
    <div className={ds.card}>
      <h2>
        학습 스트릭 <span className={`${ds.muted} ${ds.tiny}`}>— 최근 {WEEKS}주 · 하루 완료량(꾸준함의 리듬)</span>
      </h2>
      <div className={st.hmWrap}>
        <div className={st.hmDow}>
          {['월', '', '수', '', '금', '', '일'].map((x, i) => (
            <span key={i}>{x}</span>
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
      <div className={`${st.hmLegend} ${ds.muted} ${ds.tiny}`}>
        <span>적음</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <div key={l} className={`${st.hmC} ${st['hmL' + l]}`} />
        ))}
        <span>많음</span>
        <span style={{ flex: 1 }} />
        최근 {WEEKS}주 {activeDays}일 학습 · 총 {Math.round(totalMin / 60)}h
      </div>
    </div>
  );
}

/** 오답 분포 레이더(CBMS) — 5축 펜타곤 SVG. */
function CbmsRadar() {
  const state = useApp((s) => s.state);
  const codes: CbmsCode[] = ['C', 'B', 'M', 'S', 'T'];
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
  if (!weeks.length) return <div className={ds.empty}>데이터 없음</div>;
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
                      data-tip={lab}
                      role="img"
                      aria-label={lab}
                      style={{
                        height: (h / maxH) * 110,
                        background: byId[sid]?.color || '#6ea8fe',
                        borderRadius: '3px 3px 0 0',
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

export default function Stats() {
  const state = useApp((s) => s.state);
  const r = useSchedule();

  if (!r.itemStat.length)
    return (
      <div className={ds.card}>
        <div className={ds.empty}>학습 항목을 추가하면 통계가 나타납니다.</div>
      </div>
    );

  const totalSchedH = r.itemStat.reduce((t, s) => t + (s.schedH || 0), 0);
  const totalCh = r.itemStat.reduce((t, s) => t + (s.totalCh || 0), 0);
  const doneCh = r.itemStat.reduce((t, s) => t + (s.doneCh || 0), 0);
  const revCount = r.days.reduce((t, d) => t + d.items.filter((i) => i.type === 'rev').length, 0);
  const doneH = totalDoneHours(state);
  const streak = studyStreak(state);
  const compRate = totalSchedH > 0 ? Math.min(100, Math.round((doneH / totalSchedH) * 100)) : 0;

  return (
    <>
      <div className={ds.kpis}>
        <div className={ds.kpi}>
          <div className={ds.v}>
            {doneH.toFixed(1)}h<span className={`${ds.muted} ${ds.tiny}`}> / {Math.round(totalSchedH)}h</span>
          </div>
          <div className={ds.l}>실제 완료 / 계획 ({compRate}%)</div>
        </div>
        <div className={ds.kpi}>
          <div className={ds.v}>
            🔥 {streak}
            <span className={`${ds.muted} ${ds.tiny}`}>일</span>
          </div>
          <div className={ds.l}>연속 학습일</div>
        </div>
        <div className={ds.kpi}>
          <div className={ds.v}>
            {doneCh}
            <span className={`${ds.muted} ${ds.tiny}`}> / {totalCh}</span>
          </div>
          <div className={ds.l}>완료 챕터</div>
        </div>
        <div className={ds.kpi}>
          <div className={ds.v}>{revCount}</div>
          <div className={ds.l}>복습 세션(계획)</div>
        </div>
      </div>

      <RetrievalCard r={r} />
      <RetentionSpark />
      <StreakHeatmap />
      <CbmsRadar />

      <div className={ds.card}>
        <h2>과목별 진행</h2>
        <table>
          <thead>
            <tr>
              <th>과목</th>
              <th>주당</th>
              <th>챕터</th>
              <th>계획시간</th>
              <th>학습 종료(예상)</th>
              <th>마감</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {r.itemStat.map((s) => {
              if (s.daily)
                return (
                  <tr key={s.id}>
                    <td>
                      <span className={ds.swatch} style={{ background: s.color }} />
                      {s.name}
                    </td>
                    <td className={`${ds.muted} ${ds.tiny}`}>매일 {s.dailyMin}분</td>
                    <td className={ds.muted}>-</td>
                    <td>{s.schedH}h</td>
                    <td className={ds.muted}>{s.days}일</td>
                    <td>-</td>
                    <td>
                      <span className={ds.pill}>반복</span>
                    </td>
                  </tr>
                );
              const prog = s.totalCh ? Math.round((s.doneCh! / s.totalCh) * 100) : 0;
              const pill = !s.deadline ? (
                <span className={ds.pill}>진행</span>
              ) : !s.finished ? (
                <span className={`${ds.pill} ${ds.bad}`}>시간부족</span>
              ) : (s.late || 0) > 0 ? (
                <span className={`${ds.pill} ${ds.warn}`}>마감초과</span>
              ) : (
                <span className={`${ds.pill} ${ds.good}`}>정상</span>
              );
              return (
                <tr key={s.id}>
                  <td>
                    <span className={ds.swatch} style={{ background: s.color }} />
                    {s.name}
                  </td>
                  <td>{s.weeklyHours}h</td>
                  <td style={{ minWidth: 130 }}>
                    {s.doneCh}/{s.totalCh}
                    <div className={ds.bar} style={{ margin: '4px 0 0' }}>
                      <i style={{ width: `${prog}%`, background: s.color }} />
                    </div>
                  </td>
                  <td>
                    {s.schedH}h<span className={`${ds.muted} ${ds.tiny}`}> / {s.totalH}h</span>
                  </td>
                  <td>{s.finishDate ? fmtShort(parseISO(s.finishDate)) : '-'}</td>
                  <td>{s.deadline || '-'}</td>
                  <td>{pill}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={ds.card}>
        <h2>주별 학습시간</h2>
        <WeeklyBars r={r} />
      </div>

      <div className={ds.card}>
        <h2>학습한 내용 (챕터 타임라인)</h2>
        <ChapterTimeline r={r} />
      </div>
    </>
  );
}
