/* ============================================================
   Review — 탭: 🔄 주간 리뷰 (Phase 4 · 앱상태 + 파생 · 방법론 10절)
   레거시 ui-review.js를 React로 — '공부 방식'을 주 1회 점검:
   계획 vs 실제 · CBMS 분포 · 백로그 회수 · 주간 체크리스트.
============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { toast, toastUndo } from '@/shell/toast';
import { useToggleBacklogUndo } from '@/shell/useBacklog';
import { useHeroPointer, useWeekNavKeys, useFlushOnUnmount } from '@/hooks/interactions';
import { useSchedule } from '@/store/selectors';
import { isDone } from '@/lib/persistence';
import {
  cbmsCounts,
  cbmsTop,
  CBMS_INFO,
  CBMS_CODES,
  openBacklog,
  backlogClosedBetween,
  addBacklog,
  setWeeklyCheck,
  setWeeklyNote,
} from '@/lib/methodology';
import { indexDays } from '@/lib/scheduleView';
import { weeklyInsights, weakSpots } from '@/lib/insights';
import { riskChapters } from '@/lib/spacedReview';
import { rootCauseRollup } from '@/lib/knowledge';
import { backlogFromWeakSpot, backlogFromRootCause, type BacklogSeed, PROMOTE_TOAST } from '@/lib/promote';
import { reviewCoach, previewFromJsonStream, type ReviewCoachResult } from '@/lib/api';
import { usePing, useKnowledge } from '@/store/queries';
import { mondayOf, addDays, iso, weekLabel, fmtShort, parseISO, dayDiff, DOW_MON, todayISO } from '@/lib/utils';
import { itemById } from '@/lib/utils';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import rv from './Review.module.css';
import type { AppState, CbmsCode, ScheduleResult } from '@/lib/types';

interface WeekPA {
  byDay: { ds: string; k: number; pm: number; dm: number }[];
  planMin: number;
  doneMin: number;
  rate: number;
  maxRef: number;
}
/** 한 주의 계획·완료 분 집계 — 디브리프 헤더와 계획대비실제 차트가 공유(이중 순회 제거). */
function weekPlanActual(state: AppState, res: ScheduleResult, mon: Date): WeekPA {
  const byDs = indexDays(res); // ds→Day 인덱스 정본(scheduleView) 공유
  let planMin = 0;
  let doneMin = 0;
  const byDay: WeekPA['byDay'] = [];
  for (let k = 0; k < 7; k++) {
    const dsk = iso(addDays(mon, k));
    const d = byDs[dsk];
    let pm = 0;
    let dm = 0;
    if (d)
      d.items.forEach((it) => {
        pm += it.min;
        if (isDone(state, dsk, it.sid, it.type)) dm += it.min;
      });
    planMin += pm;
    doneMin += dm;
    byDay.push({ ds: dsk, k, pm, dm });
  }
  return {
    byDay,
    planMin,
    doneMin,
    rate: planMin > 0 ? Math.round((doneMin / planMin) * 100) : 0,
    maxRef: Math.max(1, ...byDay.map((x) => x.pm)),
  };
}

const WEEKLY_CHECKS: [string, string][] = [
  ['backlog', '보충 필요 백로그 — 이번 주 몇 개 회수했나? 남은 건 언제 닫을지 정했다.'],
  ['cbms', '오답 CBMS 분포 — 가장 많은 코드의 처방에 다음 주 시간을 더 줬다.'],
  ['plan', '계획 vs 실제 — 버퍼(15~20%)가 부족했으면 다음 주 목표시간을 낮춘다.'],
  ['anki', 'Anki 적체 — due가 밀렸으면 큐레이션을 더 빡세게(≤5장/블록).'],
];

/** 계획 대비 실제 — 요일별 계획·완료 분 막대(weekPlanActual 집계 공유). 주간 디브리프의 발광 시그니처.
   액센트 베이크 패널 + 포인터 추적 스포트라이트·오로라(ds.spotHost/spotlight/aura/glow). */
function PlanActualCard({ pa }: { pa: WeekPA }) {
  const { byDay, maxRef, rate, planMin } = pa;
  const navigate = useNavigate();
  // 포인터 추적 스포트라이트 — 시그니처 차트가 커서를 따라 발광(틸트 없는 큰 보드).
  const { ref, onMouseMove, onMouseLeave } = useHeroPointer(0);
  // 과거 무계획·미래 주는 planMin=0 → 높이0 막대7개+"달성0%"가 '고장난 듯'. 인라인 빈상태로 교체.
  const empty = planMin === 0;

  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={`${rv.sigChart} ${ds.spotHost} ${ds.glow}`}
    >
      <div className={ds.spotlight} aria-hidden="true" />
      <div className={ds.aura} aria-hidden="true" />
      <div className={rv.sigHead}>
        <span className={rv.sigTitle}>계획 대비 실제 — PLAN vs ACTUAL</span>
        {!empty && (
          <span className={rv.sigRate}>
            달성 {rate}
            <small>%</small>
          </span>
        )}
      </div>
      {empty ? (
        <div className={rv.paEmpty}>이 주엔 계획된 블록이 없어요 — 계획 탭에서 배정하면 채워집니다.</div>
      ) : (
        <div className={rv.paChart}>
          {byDay.map((x) => {
            const ph = Math.round((x.pm / maxRef) * 70);
            const dh = Math.round((x.dm / maxRef) * 70);
            const paLab = `${DOW_MON[x.k]} ${fmtShort(parseISO(x.ds))} · 계획 ${(x.pm / 60).toFixed(1)}h / 완료 ${(x.dm / 60).toFixed(1)}h`;
            // 인덱스 기반 소량 stagger — 막대가 요일 순서대로 밑에서 차오른다(표현만, 데이터 불변).
            return (
              <div key={x.k} className={rv.paCol} data-tip={paLab} role="img" aria-label={paLab}>
                <span className={rv.paBar}>
                  <i className={rv.plan} style={{ height: ph, animationDelay: `${x.k * 45}ms` }} />
                  <i className={rv.done} style={{ height: dh, animationDelay: `${x.k * 45 + 80}ms` }} />
                </span>
                <span className={`${ds.tiny} ${ds.muted}`}>{DOW_MON[x.k]}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className={ds.foot}>
        <span className={`${rv.paLg} ${rv.plan}`} /> 계획 &nbsp; <span className={`${rv.paLg} ${rv.done}`} /> 완료
        &nbsp;· 막대는 요일별 시간. 자세한 추세는{' '}
        <button type="button" className={rv.inlineLink} onClick={() => navigate('/stats', { viewTransition: true })}>
          통계
        </button>{' '}
        탭.
      </div>
    </div>
  );
}

/** CBMS 분포(6·10절). 카운트는 본체가 이미 리드아웃용으로 집계한 걸 주입받아 이중 순회를 없앤다. */
function CbmsDistCard({ cnt }: { cnt: Record<CbmsCode, number> }) {
  const maxc = Math.max(1, ...CBMS_CODES.map((c) => cnt[c]));
  const top = cbmsTop(cnt); // 최다코드 + 합 — argmax/합 관용구는 methodology 단일 출처.
  let hint: React.ReactNode = '이번 주 기록된 오답이 없어요. 막힌 곳을 CBMS로 남기면 약점 분포가 보입니다.';
  if (top) {
    // 처방 문구는 CBMS_INFO.tip이 단일 원천 — 로컬 사본은 CoachCard·Anki 카드와 어긋나게 드리프트했다.
    hint = (
      <>
        가장 많은 코드{' '}
        <b>
          {top.code}({CBMS_INFO[top.code].label})
        </b>{' '}
        — {CBMS_INFO[top.code].tip}
      </>
    );
  }
  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        오답 CBMS 분포 <span className={`${ds.muted} ${ds.tiny}`}>— 약점의 분포</span>
      </h2>
      {CBMS_CODES.map((c) => {
        const inf = CBMS_INFO[c];
        const n = cnt[c];
        return (
          <div key={c} className={ds.cbmsRow}>
            <span className={ds.cbmsChip} style={{ '--c': inf.color } as React.CSSProperties}>
              {c} {inf.label}
            </span>
            <span className={ds.cbmsTrack}>
              <i style={{ width: `${(n / maxc) * 100}%`, background: inf.color }} />
            </span>
            <span className={ds.tiny} style={{ minWidth: 18, textAlign: 'right' }}>
              {n}
            </span>
          </div>
        );
      })}
      <div className={ds.foot} style={{ marginTop: 10 }}>
        {hint}
      </div>
    </div>
  );
}

/** 백로그 회수(5·10절). */
function BacklogReviewCard({ ds0, ds6 }: { ds0: string; ds6: string }) {
  const state = useApp((s) => s.state);
  const navigate = useNavigate();
  const open = openBacklog(state);
  const closedThisWeek = backlogClosedBetween(state, ds0, ds6);
  // 회수 체크는 목록에서 즉시 사라진다 — 실수 클릭 대비 되돌리기 토스트(Journal과 단일 출처).
  const close = useToggleBacklogUndo();
  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        보충 필요 회수 <span className={`${ds.muted} ${ds.tiny}`}>— 백로그를 닫는 고리</span>
      </h2>
      <div className={ds.row} style={{ marginBottom: 8 }}>
        <span className={`${ds.pill} ${open.length ? ds.warn : ds.good}`}>열림 {open.length}</span>
        <span className={`${ds.pill} ${ds.good}`}>이번 주 회수 {closedThisWeek}</span>
      </div>
      {open.length ? (
        open.map((b) => (
          <div key={b.id} className={`${ds.rec} ${ds.blOpen}`}>
            <div className={ds.recHead}>
              <input type="checkbox" aria-label="회수 완료" checked={false} onChange={() => close(b.id)} />
              <span className={ds.swatch} style={{ background: itemById(state, b.sid)?.color || '#888' }} />
              <b>{b.topic || '(주제 없음)'}</b>
              {b.name && <span className={`${ds.muted} ${ds.tiny}`}> · {b.name}</span>}
              <span className={`${ds.muted} ${ds.tiny}`} style={{ marginLeft: 6 }}>
                열린 지 {dayDiff(b.ds, todayISO(state))}일
              </span>
            </div>
            {b.note && <div className={ds.tiny}>{b.note}</div>}
          </div>
        ))
      ) : (
        <div className={`${ds.empty} ${ds.tiny}`}>열린 백로그가 없어요 👍</div>
      )}
      <div className={ds.foot} style={{ marginTop: 8 }}>
        오래 열린 항목일수록 위로. 더 안 중요하면 과감히 버린다(재시작 루틴). 추가는{' '}
        <button type="button" className={rv.inlineLink} onClick={() => navigate('/today', { viewTransition: true })}>
          오늘 학습
        </button>{' '}
        탭에서.
      </div>
    </div>
  );
}

/** 주간 체크리스트 + 메모(10절). */
function ChecklistCard({ wk }: { wk: string }) {
  const w = useApp((s) => s.state.weekly?.[wk]) || { checks: {}, note: '' };
  const mutate = useApp((s) => s.mutate);
  const checks = w.checks || {};
  const ckDone = WEEKLY_CHECKS.filter(([k]) => !!checks[k]).length;
  // 메모는 로컬 draft로 미러링 — 키 입력마다 전역 mutate(→schedule 전체 재계산 캐스케이드)를 피하고
  // onBlur(및 언마운트 flush)에서만 커밋한다(Journal 텍스트 필드와 동일 패턴).
  // draft 초기값=이번 주 note. 주(wk)가 바뀌면 이 카드는 부모 key={wk}로 리마운트돼 자동 재동기화된다.
  const [draft, setDraft] = useState(w.note || '');
  const commit = () => mutate((st) => setWeeklyNote(st, wk, draft));
  useFlushOnUnmount(commit); // 마지막 편집 유실 방지 — 탭 이탈/주 이동으로 언마운트될 때 draft 커밋.
  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        주간 점검 체크리스트{' '}
        <span className={`${ds.pill} ${ckDone === WEEKLY_CHECKS.length ? ds.good : ''} ${ds.tiny}`}>
          {ckDone}/{WEEKLY_CHECKS.length}
        </span>
      </h2>
      {WEEKLY_CHECKS.map(([k, label]) => (
        <label key={k} className={ds.chkRow}>
          <input
            type="checkbox"
            checked={!!checks[k]}
            onChange={(e) => mutate((st) => setWeeklyCheck(st, wk, k, e.target.checked))}
          />
          <span>{label}</span>
        </label>
      ))}
      <label htmlFor="wk-note" style={{ marginTop: 10 }}>
        이번 주 메모 <span className={`${ds.muted} ${ds.tiny}`}>(무엇을 바꿀까)</span>
        {draft.trim() && <span className={`${ds.pill} ${ds.good} ${ds.tiny}`}> ✓ 자동 저장됨</span>}
      </label>
      <textarea
        id="wk-note"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        placeholder="예) M 오답이 많았다 → 다음 주 통신 도출 백지연습 +1블록. 보충필요 2개 남음, 토요일 오전에 닫기."
      />
      <div className={ds.foot}>체크/메모는 그 주에 저장돼요(주를 넘기면 각각 따로 보관).</div>
    </div>
  );
}

/** 회고 코칭(B7) + 반복 약점(C9) — 결정적 인사이트를 항상 보이고, serve.js가 켜져 있으면 AI로 구체화. */
/* E-4 레버 SSOT — 약점/위험 과목의 주간 배정시간(weeklyHours, 스케줄러 입력)을 +1h/정확한 -1h 언두로
   조정. CoachCard·WorkbenchCard가 바이트 동일 복붙하던 것(반올림 로직 드리프트=실버그 위험)을 한 곳으로.
   daily 모드는 이 레버가 없어(leverFor가 undefined) 버튼이 미표시된다. */
function useWeeklyAllot() {
  const items = useApp((s) => s.state.items);
  const mutate = useApp((s) => s.mutate);
  const leverFor = (subject: string) => items.find((it) => it.name === subject && it.mode !== 'daily');
  const bumpWeekly = (id: string, delta: number) =>
    mutate((st) => {
      const t = st.items.find((x) => x.id === id);
      if (t) t.weeklyHours = Math.max(0, Math.round((+(t.weeklyHours || 0) + delta + Number.EPSILON) * 10) / 10);
    });
  const allotMore = (subject: string, id: string) => {
    bumpWeekly(id, 1);
    toastUndo(`"${subject}" 주간 배정 +1h`, () => bumpWeekly(id, -1));
  };
  return { leverFor, allotMore };
}

function CoachCard({ ds0 }: { ds0: string }) {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const { data: ping } = usePing();
  const online = !!ping?.ok;
  const insights = weeklyInsights(state, ds0);
  const weak = weakSpots(state); // 전 기간 반복 약점(C9) — '반복적으로 막히는 지점' 자각.
  const { data: k } = useKnowledge();
  const roots = rootCauseRollup(k); // 여러 약점의 공통 뿌리(선수개념). k 없거나 오프라인이면 [].

  // I-1: 진단→행동 — 반복약점/근본원인을 원클릭으로 보충 백로그(소비 승격과 같은 그릇)로 시드.
  const seedBacklog = (seed: BacklogSeed) => {
    mutate((s) => addBacklog(s, '', seed.name, seed.topic, seed.note));
    toast(PROMOTE_TOAST);
  };

  // E-4: 리뷰→계획 되먹임 — 약점 과목의 주간 배정시간 +1h(정확한 -1h 언두). SSOT는 useWeeklyAllot.
  const { leverFor, allotMore } = useWeeklyAllot();

  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState('');
  const [ai, setAi] = useState<ReviewCoachResult | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const askAI = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiErr(null);
    setAiPreview('');
    try {
      const facts = insights.map((i) => i.text);
      const weakLines = weak.map((w) => `${w.subject} — ${w.chapter} (${w.count}회, ${w.codes.join('/')})`);
      const r = await reviewCoach(facts, weakLines, {
        onDelta: (t) => setAiPreview(previewFromJsonStream(t)),
      });
      if (r.ok && r.coach) setAi(r.coach);
      else setAiErr(r.error || 'AI 코칭 실패');
    } catch (e) {
      setAiErr((e as Error).message || 'AI 연결 실패');
    }
    setAiBusy(false);
  };

  const hasData = insights.length > 0 || weak.length > 0 || roots.length > 0;

  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        회고 코칭 <span className={`${ds.muted} ${ds.tiny}`}>— 이번 주 데이터가 말하는 다음 주 우선순위</span>
      </h2>
      {hasData ? (
        <>
          {insights.length > 0 && (
            <ul className={rv.coachList}>
              {insights.map((ins, i) => (
                <li key={i} className={rv.coachItem} data-tone={ins.tone}>
                  <span className={rv.coachDot} aria-hidden="true" />
                  <span>{ins.text}</span>
                </li>
              ))}
            </ul>
          )}
          {weak.length > 0 && (
            <div className={rv.weakBox}>
              <div className={`${ds.muted} ${ds.tiny}`}>반복 약점 — 같은 곳에서 여러 번 막힌 지점</div>
              <ul className={rv.weakList}>
                {weak.map((w) => {
                  const lever = leverFor(w.subject);
                  return (
                    <li key={w.key} className={rv.weakItem}>
                      <b>
                        {w.subject} — {w.chapter}
                      </b>
                      <span className={rv.weakMeta}>
                        {w.count}회 · {w.codes.map((c) => CBMS_INFO[c].label).join('·')}
                      </span>
                      <span className={rv.weakActions}>
                        <button
                          type="button"
                          className={rv.weakSeed}
                          onClick={() => seedBacklog(backlogFromWeakSpot(w))}
                          title={`"${w.subject} — ${w.chapter}"를 보충 백로그로 보내기`}
                          aria-label={`${w.subject} ${w.chapter} 보충 백로그로 보내기`}
                        >
                          ＋보충
                        </button>
                        {lever && (
                          <button
                            type="button"
                            className={rv.weakAllot}
                            onClick={() => allotMore(w.subject, lever.id)}
                            title={`"${w.subject}" 주간 배정시간 +1h (현재 ${lever.weeklyHours || 0}h)`}
                            aria-label={`${w.subject} 다음 주 배정시간 1시간 늘리기`}
                          >
                            +1h 배정
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {roots.length > 0 && (
            <div className={rv.weakBox}>
              <div className={`${ds.muted} ${ds.tiny}`}>
                약점의 뿌리 — 한 선수개념이 여러 약점의 공통 근본원인(먼저 메우면 상류가 함께 풀림)
              </div>
              <ul className={rv.weakList}>
                {roots.map((c) => (
                  <li key={c.cause} className={rv.weakItem}>
                    <b>🌱 {c.cause}</b>
                    <span className={rv.weakMeta}>{c.count}개 약점의 뿌리</span>
                    <span className={rv.weakActions}>
                      <button
                        type="button"
                        className={rv.weakSeed}
                        onClick={() => seedBacklog(backlogFromRootCause(c))}
                        title={`"${c.cause}"(선수개념)를 보충 백로그로 보내기`}
                        aria-label={`${c.cause} 보충 백로그로 보내기`}
                      >
                        ＋보충
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className={ds.foot}>이번 주 요약·오답·백지 기록이 쌓이면 코칭이 나와요.</div>
      )}
      <div className={rv.coachAi}>
        <Button
          sm
          onClick={askAI}
          disabled={aiBusy || !online || !hasData}
          title={online ? '' : 'serve.js가 꺼져 있어요'}
        >
          {aiBusy ? (
            <>
              <span className={ds.spin} /> 코칭 중…
            </>
          ) : (
            '🤖 AI 회고 받기'
          )}
        </Button>
        {aiErr && (
          <>
            <span className={`${ds.muted} ${ds.tiny}`} role="alert">
              {aiErr}
            </span>
            <Button sm variant="ghost" onClick={askAI} disabled={aiBusy || !online}>
              다시 시도
            </Button>
          </>
        )}
      </div>
      {/* 코칭 스트리밍 미리보기 — 완성 문장부터(SR에는 버튼의 '코칭 중…'이 상태). */}
      {aiBusy && aiPreview && (
        <p className={rv.aiStream} aria-hidden="true">
          {aiPreview}
        </p>
      )}
      {ai && (
        <div className={rv.aiBox} role="status">
          {ai.headline && <div className={rv.aiHead}>{ai.headline}</div>}
          {ai.focus && (
            <div className={rv.aiFocus}>
              <b>먼저 손볼 것</b> {ai.focus}
            </div>
          )}
          {Array.isArray(ai.actions) && ai.actions.length > 0 && (
            <ul className={rv.aiActions}>
              {ai.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
          {ai.encourage && <div className={ds.foot}>{ai.encourage}</div>}
        </div>
      )}
    </div>
  );
}

/** I-14 약점 워크벤치(RiskCard 승격) — 복습 위험(C8: 배웠지만 오래 안 본 개념)을 '식별'에서 끝내지 않고
   각 행을 식별→행동 전환대로: [＋보충 큐][+1h 배정][🔎 볼트][↻ 복습 실행]. weakSpots는 좌측 코칭 카드가,
   여기선 riskChapters·openBacklog 신호를 소비(전부 이 파일 스코프에 이미 있어 재페치 0). */
function WorkbenchCard() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const res = useSchedule();
  const navigate = useNavigate();
  const today = todayISO(state);
  const [expanded, setExpanded] = useState(false);
  // 조용한 절단 금지 — 전체를 받아 접기/펼치기로 숨은 수를 밝힌다.
  const all = riskChapters(state, res.days || [], today, 100);
  const shown = expanded ? all : all.slice(0, 6);
  const hidden = all.length - shown.length;
  const openN = openBacklog(state).length; // 워크벤치가 채우는 큐의 현재 깊이(맥락).

  // E-4 레버 재사용 — 약점/위험 과목의 주간 배정시간 +1h(정확한 -1h 언두). SSOT는 useWeeklyAllot.
  const { leverFor, allotMore } = useWeeklyAllot();
  // I-1과 동일 경로(addBacklog→toast) — 방치된 개념을 보충 큐로 넣어 백지 복습을 예약한다.
  const seedRisk = (c: { subject: string; chapter: string; daysSince: number }) => {
    const seed: BacklogSeed = {
      name: '복습 위험',
      topic: `${c.subject} — ${c.chapter}`,
      note: `${c.daysSince}일 방치된 개념 — 백지 복습으로 인출`,
    };
    mutate((s) => addBacklog(s, '', seed.name, seed.topic, seed.note));
    toast(PROMOTE_TOAST);
  };
  const openVault = (c: { subject: string; chapter: string }) =>
    window.open('obsidian://search?query=' + encodeURIComponent(c.subject + ' ' + c.chapter));

  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        약점 워크벤치 <span className={`${ds.muted} ${ds.tiny}`}>— 오래 안 본 개념을 식별에서 행동으로</span>
      </h2>
      <div className={ds.row} style={{ marginBottom: 8 }}>
        <span className={`${ds.pill} ${all.length ? ds.warn : ds.good}`}>복습 위험 {all.length}</span>
        <span className={`${ds.pill} ${openN ? ds.warn : ds.good}`}>보충 열림 {openN}</span>
      </div>
      {all.length ? (
        <>
          <ul className={rv.riskList}>
            {shown.map((c) => {
              const lever = leverFor(c.subject);
              return (
                <li key={c.sid + '|' + c.chapter} className={rv.riskRow} data-risk={c.risk}>
                  <span className={rv.riskDot} style={{ background: c.color || 'var(--acc)' }} aria-hidden="true" />
                  <span className={rv.riskNm}>
                    {c.subject} <small>{c.chapter}</small>
                  </span>
                  <span className={rv.riskAge}>{c.daysSince}일</span>
                  <span className={rv.benchActions}>
                    {lever && (
                      <button
                        type="button"
                        className={rv.weakAllot}
                        onClick={() => allotMore(c.subject, lever.id)}
                        title={`"${c.subject}" 주간 배정시간 +1h (현재 ${lever.weeklyHours || 0}h)`}
                        aria-label={`${c.subject} 다음 주 배정시간 1시간 늘리기`}
                      >
                        +1h
                      </button>
                    )}
                    <button
                      type="button"
                      className={rv.benchBtn}
                      onClick={() => seedRisk(c)}
                      title={`"${c.subject} — ${c.chapter}"를 보충 백로그로 보내기`}
                      aria-label={`${c.subject} ${c.chapter} 보충 백로그로 보내기`}
                    >
                      ＋
                    </button>
                    {/* 백지 복습 유도의 손잡이 — 볼트 딥링크(Graph E-5 미러). obsidian://search는 볼트명 없이도 동작. */}
                    <button
                      type="button"
                      className={rv.benchBtn}
                      onClick={() => openVault(c)}
                      title="Obsidian에서 이 개념 검색 (설치돼 있어야 함)"
                      aria-label={`${c.subject} ${c.chapter} 볼트에서 검색`}
                    >
                      🔎
                    </button>
                    <button
                      type="button"
                      className={rv.benchBtn}
                      onClick={() => navigate('/review-run', { viewTransition: true })}
                      title="지금 복습 실행(백지 인출)"
                      aria-label={`${c.subject} ${c.chapter} 복습 실행`}
                    >
                      ↻
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {(hidden > 0 || expanded) && (
            <button type="button" className={rv.showMore} onClick={() => setExpanded((v) => !v)}>
              {expanded ? '접기' : `+${hidden}개 더 보기`}
            </button>
          )}
        </>
      ) : (
        <div className={ds.foot}>위험한 챕터가 없어요 — 최근 학습을 잘 따라가고 있어요 👍</div>
      )}
      <div className={ds.foot}>
        오래될수록 붉게 — 배정으로 시간을 주거나 · 보충 큐로 넣거나 · 볼트에서 찾아 · 복습 실행으로 인출.
      </div>
    </div>
  );
}

export default function Review() {
  const res = useSchedule();
  const state = useApp((s) => s.state);
  const [weekOffset, setWeekOffset] = useState(0);
  // , / . — 이전/다음 주(스케줄 탭과 동일 키).
  // 회고는 과거·현재만 — 미래 주는 데이터가 없어 전부 '달성 0%' 보드다. 앞으로는 이번 주(0)까지만.
  useWeekNavKeys(
    () => setWeekOffset((o) => o - 1),
    () => setWeekOffset((o) => Math.min(0, o + 1)),
  );

  const mon = addDays(mondayOf(parseISO(todayISO(state))), weekOffset * 7); // '오늘' 단일 출처 경유.
  const ds0 = iso(mon);
  const ds6 = iso(addDays(mon, 6));
  const wk = ds0;
  const isThis = weekOffset === 0;
  const pa = weekPlanActual(state, res, mon);

  // 디브리프 리드아웃 — 달성률·가장 잦은 오답·보충 열림을 상단 바로(데모 v6 헤더).
  // cnt는 여기서 한 번 집계해 CbmsDistCard에도 주입한다(이중 cbmsCounts 순회 제거).
  const cnt = cbmsCounts(state, ds0, ds6);
  const cbmsT = cbmsTop(cnt); // 최다 오답 코드 + 합 — 리드아웃·분포 카드가 공유.
  const openN = openBacklog(state).length;

  usePageChromeEffect(
    () => ({
      readouts: [
        {
          label: '달성률',
          value: (
            <>
              {pa.rate}
              <small>%</small>
            </>
          ),
          accent: true,
        },
        { label: '잦은 오답', value: cbmsT?.code ?? '—' },
        { label: '보충 열림', value: openN },
      ],
    }),
    [pa.rate, cbmsT?.code, openN],
  );

  return (
    <section className={rv.wrap} aria-label="주간 리뷰">
      <div className={rv.nav}>
        <Button sm onClick={() => setWeekOffset((o) => o - 1)}>
          ◀ 이전 주
        </Button>
        <div className={rv.wkBox}>
          <b className={rv.wkLab}>{weekLabel(mon)}</b>
          <span className={rv.wkOff}>
            {isThis ? '이번 주' : weekOffset > 0 ? `+${weekOffset}주` : `${weekOffset}주`}
          </span>
        </div>
        <Button sm onClick={() => setWeekOffset((o) => Math.min(0, o + 1))} disabled={weekOffset >= 0}>
          다음 주 ▶
        </Button>
        <Button sm variant="ghost" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>
          이번 주
        </Button>
      </div>

      <div className={rv.grid}>
        {/* 좌 — 시그니처 차트(계획 대비 실제 · CBMS 분포) */}
        <div className={rv.mainCol}>
          <div className={rv.hint}>
            주 1회 15~20분, <b>공부 방식</b>을 점검하는 자리. 시간(투입)이 아니라 <i>CBMS 분포 축소·진행률</i> 같은
            나아진 증거가 가장 강한 동기.
          </div>
          {/* key=주 — 주를 이동하면 AI 코칭(ai/aiErr/aiBusy)이 리셋된다(이전 주 코칭이 그대로 남던 오표시 방지). */}
          <CoachCard key={ds0} ds0={ds0} />
          <PlanActualCard pa={pa} />
          <CbmsDistCard cnt={cnt} />
        </div>
        {/* 우 — 점검·회수(액션) */}
        <div className={rv.sideCol}>
          {/* key=주 — 주 이동 시 리마운트해 메모 draft를 그 주 note로 재동기화(+언마운트 flush). */}
          <ChecklistCard key={wk} wk={wk} />
          <WorkbenchCard />
          <BacklogReviewCard ds0={ds0} ds6={ds6} />
        </div>
      </div>
    </section>
  );
}
