/* ============================================================
   StatsDetail — 통계 탭의 **온디맨드 상세 리포트**(드로어 안에서만 렌더).
   인출 증거 · 과신율/유지율 스파크 · CBMS 레이더 · 주별 학습시간 · 시즌 페이스 · 챕터 타임라인.

   왜 별도 파일인가: 이 컴포넌트들은 사용자가 "상세"를 열기 전엔 한 픽셀도 그려지지 않는데
   Stats.tsx 안에 있으면 메인 청크에 통째로 실렸다. lazy 경계를 여기 두어 첫 화면 비용에서 뺀다.
   (겸사겸사 908줄짜리 Stats.tsx가 화면 구성 단위로 갈라진다.)
   레이더 기하는 lib/statsView가 소유 — 여기선 좌표를 받아 그리기만 한다.

   [a11y] 이 파일의 막대·세그먼트는 `role="img" + aria-label + data-tip + tabIndex={0}` 규약을
   따른다. tabIndex 의 목적은 **툴팁 도달성**이다 — components/Tooltip 이 문서 전역 focusin 으로
   `[data-tip]` 에 툴팁을 띄우므로, tabIndex 가 없으면 호버 전용 정보가 키보드 사용자에게만
   사라진다(스크린리더는 같은 문자열의 aria-label 로 이미 받는다 → 정보 손실 없음, 시각+키보드
   사용자에게 순이익). jsx-a11y/no-noninteractive-tabindex 는 이 '툴팁 타깃' 예외를 표현할
   수 없어 파일 단위로 끈다 — 이 파일은 차트 전용이라 여기 생길 tabIndex 는 전부 같은 패턴이다.
============================================================ */
/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
import { useApp } from '@/store/useApp';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import {
  cbmsCounts,
  cbmsTrend,
  cbmsTrendGlyph,
  confRate,
  confTrend,
  recallEvidence,
  retentionNudge,
  retentionTrend,
  CBMS_INFO,
  CBMS_CODES,
} from '@/lib/methodology';
import { seasonPace } from '@/lib/records';
import { parseISO, fmtShort, hLabel, DOW, round1 } from '@/lib/utils';
import { radarPoint, radarPolygon, radarRing, type RadarGeom } from '@/lib/statsView';
import State from '@/components/State';
import type { ScheduleResult } from '@/lib/types';

const TIMELINE_CAP = 60; // 최근 N일만 그려 다년 누적에도 비용 상한.

/* ── C-7 이식(stats 상세) — Tailwind 클래스 ────────────────────────────────────
   스파크 막대(과신율·유지율·시즌 페이스)·주별 시간 세그·인라인 링크. ds.* 공유 클래스와 차트의
   런타임 인라인 style(높이·색)·SVG 표현 속성은 그대로 두고 st.* 만 옮긴다. 규약은 §15.
   막대 base 는 배경을 갖지 않고 사용처가 bg 를 얹는다(sparkBarPast/Now 오버라이드 충돌 방지). */
const SPARK =
  'min-w-1.5 flex-1 self-end rounded-t-xs transition-[filter,box-shadow] duration-fast ease-[var(--ease)] hover:brightness-emph-strong hover:shadow-dot focus-visible:brightness-emph-strong focus-visible:shadow-dot';
const SPARK_BAR = `${SPARK} bg-acc`;
const SPARK_NULL = 'h-1 min-w-1.5 flex-1 self-end rounded-t-xs bg-spark-null opacity-60';
// 시즌 페이스(I-7) — 지난주는 은은히(spark-past), 이번 주는 발광 액센트(shadow-spark-now)로 초점.
const SPARK_NOW = `${SPARK} bg-acc shadow-spark-now`;
const SPARK_PAST = `${SPARK} bg-spark-past`;
const WK_SEG =
  'rounded-t-cell transition-[filter,box-shadow] duration-fast ease-[var(--ease)] hover:brightness-emph-strong hover:shadow-wkseg focus-visible:brightness-emph-strong focus-visible:shadow-wkseg';
// 인라인 링크 <button> — 원본은 font:inherit 로 부모 'ds-foot'(line-height 미설정 → body 1.6 상속)의 LH 를 상속했다.
// preflight 가 없어 버튼이 UA line-height:normal 로 떨어지므로 상속 LH 1.6 을 명시로 못박는다.
const NAV_LINK =
  'ml-1.25 inline border-0! bg-transparent! p-0! font-bold! text-acc! leading-text transition-[text-shadow] hover:underline hover:[text-shadow:var(--navlink-glow)] focus-visible:underline focus-visible:[text-shadow:var(--navlink-glow)]';

function RetrievalCard({ r }: { r: ScheduleResult }) {
  const state = useApp((s) => s.state);
  const navigate = useNavigate();
  const tr = cbmsTrend(state);
  const { icon: trIcon, good: trGood } = cbmsTrendGlyph(tr);
  const { blankPlan, blankDone, blankRate, recallActs } = recallEvidence(state, r);
  // 과신 오답률(메타인지 캘리브레이션 · 방법론 E5) — 지식엔진 미빌드에도 실시간 집계. 오답 0이면 null.
  const cal = confRate(state);
  return (
    <div className="ds-rule">
      <h2>
        인출 증거{' '}
        <span className="ds-muted ds-tiny">— "이해했다"가 아니라 "꺼낼 수 있다"의 증거(투입 아닌 출력 지표)</span>
      </h2>
      <div className="ds-kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="ds-kpi">
          <div className="ds-v" style={{ color: trGood ? 'var(--ok)' : 'var(--bad)' }}>
            {trIcon}
          </div>
          <div className="ds-l">
            오답 추세{' '}
            <span className="ds-muted ds-tiny">
              (지난주 {tr.lastW} → 이번주 {tr.thisW})
            </span>
          </div>
        </div>
        <div className="ds-kpi">
          <div className="ds-v">{blankPlan ? `${blankRate}%` : '—'}</div>
          <div className="ds-l">
            백지 복습 완료{' '}
            <span className="ds-muted ds-tiny">{blankPlan ? `(${blankDone}/${blankPlan})` : '(계획 없음)'}</span>
          </div>
        </div>
        <div className="ds-kpi">
          <div className="ds-v">{recallActs}</div>
          <div className="ds-l">
            능동 인출 활동 <span className="ds-muted ds-tiny">요약+백지+모의</span>
          </div>
        </div>
      </div>
      <div className="ds-foot">
        {trGood ? (
          '오답이 줄고 있어요 — 약점이 닫히는 방향. 👍'
        ) : (
          <>
            오답이 늘었어요 — 가장 많은 코드의 처방에 다음 주 시간을 더 주세요.
            <button type="button" className={NAV_LINK} onClick={() => navigate('/review', { viewTransition: true })}>
              주간 리뷰로 →
            </button>
          </>
        )}{' '}
        백지 복습은 가장 깊은 인출 — 계획되면 꼭 닫기.
      </div>
      {/* 과신 오답 표면화 — '찍어서 맞음/확신 없었음'으로 처리한 오답 비율(캘리브레이션 신호).
          점검할 오답이 실제 있을 때만(conf>0) 노출, 비율 높으면 주의색으로 승격. */}
      {cal && cal.conf > 0 && (
        <div className="ds-foot" style={cal.rate >= 40 ? { color: 'var(--bad)' } : undefined}>
          확신 없이 처리한 오답 {cal.conf}건(전체 {cal.total}건 중 {cal.rate}%) — 다시 점검 대상.
        </div>
      )}
      {/* 과신율 추세(I-5) — 단일시점 confRate에 '최근 N주' 문맥 부여. 표본 없는 주는 흐린 빈 슬롯. */}
      <ConfSpark />
    </div>
  );
}

/** 과신율 추세 스파크라인(I-5) — 주별 과신 오답 비율. rate=null(표본 없음)은 0%로 오도하지 않고 흐린 빈 슬롯. */
function ConfSpark() {
  const state = useApp((s) => s.state);
  const weeks = confTrend(state, 6);
  const withData = weeks.filter((w) => w.rate !== null);
  if (!withData.length) return null; // 오답 표본이 한 주도 없으면 노출 안 함(빈 막대 벽 방지).
  const latest = withData[withData.length - 1]!;
  return (
    <div className="ds-foot">
      <div className="ds-row" style={{ alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 46, flex: 1, minWidth: 120 }}>
          {weeks.map((w, i) => {
            if (w.rate === null) {
              const lab = `${w.weekMon}: 표본 없음`;
              return <div key={i} className={SPARK_NULL} data-tip={lab} role="img" aria-label={lab} />;
            }
            const lab = `${w.weekMon}: 과신 ${w.rate}% (${w.conf}/${w.total}건)`;
            return (
              <div
                key={i}
                className={SPARK_BAR}
                data-tip={lab}
                tabIndex={0}
                role="img"
                aria-label={lab}
                style={{ height: Math.round((w.rate / 100) * 42) + 4 }}
              />
            );
          })}
        </div>
        <div className="ds-muted ds-tiny" style={{ minWidth: 96, textAlign: 'right' }}>
          최근 {withData.length}주 과신율
          <br />
          최근 {latest.rate}%
        </div>
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
      <div className="ds-rule">
        <h2>
          유지율 추세 <span className="ds-muted ds-tiny">— 기억 유지의 출력 지표</span>
        </h2>
        <div className="ds-empty ds-tiny">
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
    <div className="ds-rule">
      <h2>
        유지율 추세{' '}
        <span className="ds-muted ds-tiny">— Anki 복습 빚(due)의 주별 추세. 투입 아닌 '기억 유지'의 출력 지표</span>
      </h2>
      <div className="ds-row" style={{ alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 50, flex: 1, minWidth: 120 }}>
          {pts.map((p, i) => {
            const lab = `${p.wk}: due ${p.due}장${p.cards ? ` / ${p.cards}장 중` : ''}`;
            return (
              <div
                key={i}
                className={SPARK_BAR}
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
          <div className="ds-muted ds-tiny">
            이번주 {t.latest.due} due{t.prev ? ` · 지난주 ${t.prev.due}` : ''}
          </div>
        </div>
      </div>
      {/* 능동 넛지 — 방향 표시(색)를 넘어, 악화가 유의미할 때만 경고 박스로 승격. */}
      {nudge && (
        <div className="ds-warnbox" role="status">
          ⚠ {nudge}
        </div>
      )}
      <div className="ds-foot">
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
function CbmsRadar() {
  const state = useApp((s) => s.state);
  const codes = CBMS_CODES; // 방법론 SSOT — 하드코딩 축 배열 제거(드리프트 위험 차단).
  const cnt = cbmsCounts(state);
  const vals = codes.map((k) => cnt[k] || 0);
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total)
    return (
      <div className="ds-rule">
        <h2>
          오답 분포(CBMS) <span className="ds-muted ds-tiny">— 약점 유형의 모양</span>
        </h2>
        <div className="ds-empty ds-tiny">
          오답을 기록하면(오늘 학습 탭) 유형 분포가 레이더로 보여요. 모양이 작아질수록 약점이 닫히는 중.
        </div>
      </div>
    );
  // 기하는 lib/statsView가 소유(순수 · 단위 테스트 대상) — 여기선 좌표를 받아 그리기만 한다.
  const geom: RadarGeom = { cx: 110, cy: 104, r: 78, n: codes.length };
  const cx = geom.cx;
  const cy = geom.cy;
  const R = geom.r;
  const max = Math.max(...vals, 1); // 꼭짓점 마커도 같은 정규화를 쓴다(radarPolygon과 동일 규칙)
  const pt = (i: number, r: number) => radarPoint(i, r, geom);
  const ring = (f: number) => radarRing(f, geom);
  const poly = radarPolygon(vals, geom);
  return (
    <div className="ds-rule">
      <h2>
        오답 분포(CBMS) <span className="ds-muted ds-tiny">— 약점 유형의 모양(전체 {total}건)</span>
      </h2>
      <div className="ds-row" style={{ alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
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
                {/* H25 — `CBMS_INFO.color` 는 non-optional 이라 이 폴백은 **죽은 생 hex** 였다(도달 0). */}
                <span className="ds-swatch" style={{ background: info.color }} />
                <span style={{ width: 60 }}>
                  {k} {info.label || ''}
                </span>
                <div className="ds-bar" style={{ flex: 1, margin: 0 }}>
                  <i style={{ width: `${pctv}%`, background: info.color }} />
                </div>
                <span className="ds-muted ds-tiny" style={{ width: 28, textAlign: 'right' }}>
                  {v}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="ds-foot">
        가장 큰 축이 지금의 주된 약점 — 주간 리뷰의 처방을 그 유형에 투자하세요(모양이 작고 고를수록 좋음).
      </div>
    </div>
  );
}

/** 주별 학습시간 — 과목별 색 스택 막대. */
function WeeklyBars({ r }: { r: ScheduleResult }) {
  const navigate = useNavigate();
  const weeks = Object.keys(r.weekHours).sort();
  if (!weeks.length)
    return (
      <State
        glyph="📊"
        title="아직 주별 데이터가 없어요"
        desc="블록을 완료하면 주별 학습시간이 여기 쌓여요."
        next={
          <Button sm onClick={() => navigate('/today')}>
            오늘 학습으로 →
          </Button>
        }
      />
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
              <div className="ds-tiny ds-muted">{Math.round(tot)}h</div>
              <div style={{ display: 'flex', flexDirection: 'column-reverse', width: 30, gap: 1 }}>
                {Object.entries(segs).map(([sid, h]) => {
                  const lab = `${byId[sid]?.name || ''}: ${round1(h)}h`;
                  return (
                    <div
                      key={sid}
                      className={WK_SEG}
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
              <div className="ds-tiny ds-muted" style={{ marginTop: 4 }}>
                {fmtShort(parseISO(w))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="ds-tiny ds-muted" style={{ marginTop: 6 }}>
        {r.itemStat.map((s) => (
          <span key={s.id}>
            <span className="ds-swatch" style={{ background: s.color }} />
            {s.name}
            {'  '}
          </span>
        ))}
      </div>
    </>
  );
}

/** 시즌 페이스(I-7) — '완료율' 아닌 '리듬': 이번 주 학습량 vs 직전 4주 평균. weeks로 미니 스파크. */
function SeasonPaceCard() {
  const state = useApp((s) => s.state);
  const p = seasonPace(state, 4);
  const hasHist = p.avgWeekMin > 0;
  const max = Math.max(1, ...p.weeks.map((w) => w.min));
  const flat = hasHist && p.deltaPct === 0;
  const good = p.ahead;
  const arrow = flat ? '＝' : good ? '▲' : '▼';
  const col = flat ? 'var(--muted)' : good ? 'var(--ok)' : 'var(--bad)';
  return (
    <div className="ds-rule">
      <h2>
        시즌 페이스 <span className="ds-muted ds-tiny">— 이번 주 학습량 vs 직전 4주 평균(완료율 아닌 '리듬')</span>
      </h2>
      <div className="ds-row" style={{ alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 50, flex: 1, minWidth: 120 }}>
          {p.weeks.map((w, i) => {
            const now = i === p.weeks.length - 1;
            const lab = `${w.weekMon}${now ? '(이번주)' : ''}: ${hLabel(w.min)}`;
            return (
              <div
                key={i}
                className={now ? SPARK_NOW : SPARK_PAST}
                data-tip={lab}
                tabIndex={0}
                role="img"
                aria-label={lab}
                style={{ height: Math.round((w.min / max) * 46) + 2 }}
              />
            );
          })}
        </div>
        <div style={{ textAlign: 'right', minWidth: 110 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: col }}>
            {hasHist ? `${arrow} ${Math.abs(p.deltaPct)}%` : hLabel(p.thisWeekMin)}
          </div>
          <div className="ds-muted ds-tiny">
            이번주 {hLabel(p.thisWeekMin)}
            {hasHist ? ` · 평균 ${hLabel(p.avgWeekMin)}` : ''}
          </div>
        </div>
      </div>
      <div className="ds-foot">
        {!hasHist
          ? '직전 주 이력이 쌓이면 평소 대비 페이스를 보여줘요 — 이번 주는 기준선을 만드는 중.'
          : flat
            ? '평소와 같은 페이스예요 — 리듬을 유지하는 중. 👍'
            : good
              ? `평소보다 ${p.deltaPct}% 앞서 있어요 — 리듬이 살아있는 방향. 👍`
              : `평소보다 ${Math.abs(p.deltaPct)}% 뒤처져 있어요 — 짧게라도 매일 이어가면 리듬이 회복돼요.`}
      </div>
    </div>
  );
}

/** 챕터 타임라인 — 날짜별 '무엇을 배웠나'(최근 CAP일). */
function ChapterTimeline({ r }: { r: ScheduleResult }) {
  if (!r.chapterLog.length)
    return <div className="ds-empty">챕터가 있는 과목을 추가하면 여기에 '며칠에 무엇을 배우는지'가 쌓입니다.</div>;
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
        <div className="ds-tiny ds-muted" style={{ marginBottom: 6 }}>
          ⋯ 이전 {hidden}일은 생략(부분 렌더 — 대용량서도 가볍게). 전체 보관은 <b>일과 탭 → 오래된 기록 정리</b>로
          아카이빙 권장.
        </div>
      )}
      {dss.map((dsk) => {
        const d = parseISO(dsk);
        return (
          <div key={dsk} className="ds-tl">
            <span className="ds-tm">
              {fmtShort(d)} ({DOW[d.getDay()]})
            </span>
            <span className="ds-nm">
              {byDs[dsk]!.map((e, i) => (
                <span key={i}>
                  <span className="ds-swatch" style={{ background: e.color }} />
                  {e.name} <span className="ds-muted ds-tiny">{e.chapters.join(', ')}</span>
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

/** 드로어 본문 — 상세 카드 묶음. Stats가 lazy로 불러 <Suspense> 안에서 렌더한다. */
export default function StatsDetail({ r }: { r: ScheduleResult }) {
  return (
    <>
      <RetrievalCard r={r} />
      <RetentionSpark />
      <CbmsRadar />
      <div className="ds-rule">
        <h2>주별 학습시간</h2>
        <WeeklyBars r={r} />
      </div>
      <SeasonPaceCard />
      <div className="ds-rule">
        <h2>학습한 내용 (챕터 타임라인)</h2>
        <ChapterTimeline r={r} />
      </div>
    </>
  );
}
