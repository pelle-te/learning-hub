/* ============================================================
   Review — 탭: 🔄 주간 리뷰 (Phase 4 · 앱상태 + 파생 · 방법론 10절)
   레거시 ui-review.js를 React로 — '공부 방식'을 주 1회 점검:
   계획 vs 실제 · CBMS 분포 · 백로그 회수 · 주간 체크리스트.
============================================================ */
import { useEffect, useState } from 'react';
import { useApp } from '@/store/useApp';
import { usePageChrome } from '@/store/usePageChrome';
import { toastUndo } from '@/shell/toast';
import { useHeroPointer } from '@/lib/interactions';
import { useSchedule } from '@/store/selectors';
import { isDone } from '@/lib/persistence';
import {
  cbmsCounts,
  CBMS_INFO,
  openBacklog,
  backlogClosedBetween,
  setWeeklyCheck,
  setWeeklyNote,
  toggleBacklog,
} from '@/lib/methodology';
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
  const byDs: Record<string, ScheduleResult['days'][number]> = {};
  (res.days || []).forEach((d) => (byDs[d.ds] = d));
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
  const { byDay, maxRef, rate } = pa;
  // 포인터 추적 스포트라이트 — 시그니처 차트가 커서를 따라 발광(틸트 없는 큰 보드).
  const { ref, onMouseMove, onMouseLeave } = useHeroPointer(0);

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
        <span className={rv.sigRate}>
          달성 {rate}
          <small>%</small>
        </span>
      </div>
      <div className={rv.paChart}>
        {byDay.map((x) => {
          const ph = Math.round((x.pm / maxRef) * 70);
          const dh = Math.round((x.dm / maxRef) * 70);
          const paLab = `${DOW_MON[x.k]} ${fmtShort(parseISO(x.ds))} · 계획 ${(x.pm / 60).toFixed(1)}h / 완료 ${(x.dm / 60).toFixed(1)}h`;
          return (
            <div key={x.k} className={rv.paCol} data-tip={paLab} role="img" aria-label={paLab}>
              <span className={rv.paBar}>
                <i className={rv.plan} style={{ height: ph }} />
                <i className={rv.done} style={{ height: dh }} />
              </span>
              <span className={`${ds.tiny} ${ds.muted}`}>{DOW_MON[x.k]}</span>
            </div>
          );
        })}
      </div>
      <div className={ds.foot}>
        <span className={`${rv.paLg} ${rv.plan}`} /> 계획 &nbsp; <span className={`${rv.paLg} ${rv.done}`} /> 완료
        &nbsp;· 막대는 요일별 시간. 자세한 추세는 <b>통계</b> 탭.
      </div>
    </div>
  );
}

/** CBMS 분포(6·10절). */
function CbmsDistCard({ ds0, ds6 }: { ds0: string; ds6: string }) {
  const state = useApp((s) => s.state);
  const cnt = cbmsCounts(state, ds0, ds6);
  const codes = Object.keys(CBMS_INFO) as CbmsCode[];
  const total = codes.reduce((a, c) => a + cnt[c], 0);
  const maxc = Math.max(1, ...codes.map((c) => cnt[c]));
  let hint: React.ReactNode = '이번 주 기록된 오답이 없어요. 막힌 곳을 CBMS로 남기면 약점 분포가 보입니다.';
  if (total) {
    const top = codes.reduce((a, b) => (cnt[b] > cnt[a] ? b : a), 'C' as CbmsCode);
    const map: Record<string, string> = {
      C: '이해 단계가 부족 — 교재 정독·개념 정리에 시간 더.',
      B: '조건 설정이 약점 — 문제 유형별 체크리스트를 만들자.',
      M: '손 연습량 부족 — 도출 단계 백지 연습을 늘려라.',
      S: '마무리 루틴 부족 — 검산·단위 체크를 습관화.',
      T: '속도/효율 문제 — 자주 막히는 계산을 손에 익히고 시간 분배 훈련.',
    };
    hint = (
      <>
        가장 많은 코드{' '}
        <b>
          {top}({CBMS_INFO[top].label})
        </b>{' '}
        — {map[top]}
      </>
    );
  }
  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        오답 CBMS 분포 <span className={`${ds.muted} ${ds.tiny}`}>— 약점의 분포</span>
      </h2>
      {codes.map((c) => {
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
  const mutate = useApp((s) => s.mutate);
  const open = openBacklog(state);
  const closedThisWeek = backlogClosedBetween(state, ds0, ds6);
  // 회수 체크는 목록에서 즉시 사라진다 — 실수 클릭 대비 되돌리기 토스트(기록 탭과 동일 문화).
  const close = (id: string) => {
    mutate((st) => toggleBacklog(st, id));
    toastUndo('보충 회수 완료 ✓', () => mutate((st) => toggleBacklog(st, id)));
  };
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
                열린 지 {dayDiff(b.ds, iso(new Date()))}일
              </span>
            </div>
            {b.note && <div className={ds.tiny}>{b.note}</div>}
          </div>
        ))
      ) : (
        <div className={`${ds.empty} ${ds.tiny}`}>열린 백로그가 없어요 👍</div>
      )}
      <div className={ds.foot} style={{ marginTop: 8 }}>
        오래 열린 항목일수록 위로. 더 안 중요하면 과감히 버린다(재시작 루틴). 추가는 <b>오늘 학습</b> 탭에서.
      </div>
    </div>
  );
}

/** 주간 체크리스트 + 메모(10절). */
function ChecklistCard({ wk }: { wk: string }) {
  const w = useApp((s) => s.state.weekly?.[wk]) || { checks: {}, note: '' };
  const mutate = useApp((s) => s.mutate);
  const checks = w.checks || {};
  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>주간 점검 체크리스트</h2>
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
      <label style={{ marginTop: 10 }}>
        이번 주 메모 <span className={`${ds.muted} ${ds.tiny}`}>(무엇을 바꿀까)</span>
      </label>
      <textarea
        rows={3}
        value={w.note || ''}
        onChange={(e) => mutate((st) => setWeeklyNote(st, wk, e.target.value))}
        placeholder="예) M 오답이 많았다 → 다음 주 통신 도출 백지연습 +1블록. 보충필요 2개 남음, 토요일 오전에 닫기."
      />
      <div className={ds.foot}>체크/메모는 그 주에 저장돼요(주를 넘기면 각각 따로 보관).</div>
    </div>
  );
}

export default function Review() {
  const res = useSchedule();
  const state = useApp((s) => s.state);
  const [weekOffset, setWeekOffset] = useState(0);
  const setChrome = usePageChrome((s) => s.setChrome);
  const clearChrome = usePageChrome((s) => s.clear);

  const mon = addDays(mondayOf(parseISO(todayISO(state))), weekOffset * 7); // '오늘' 단일 출처 경유.
  const ds0 = iso(mon);
  const ds6 = iso(addDays(mon, 6));
  const wk = ds0;
  const isThis = weekOffset === 0;
  const pa = weekPlanActual(state, res, mon);

  // 디브리프 리드아웃 — 달성률·가장 잦은 오답·보충 열림을 상단 바로(데모 v6 헤더).
  const cnt = cbmsCounts(state, ds0, ds6);
  const codes = Object.keys(CBMS_INFO) as CbmsCode[];
  const cbmsTotal = codes.reduce((a, ci) => a + cnt[ci], 0);
  const top = cbmsTotal ? codes.reduce((a, b) => (cnt[b] > cnt[a] ? b : a), 'C' as CbmsCode) : null;
  const openN = openBacklog(state).length;

  useEffect(() => {
    setChrome([
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
      { label: '잦은 오답', value: top ?? '—' },
      { label: '보충 열림', value: openN },
    ]);
    return () => clearChrome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pa.rate, top, openN]);

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
        <Button sm onClick={() => setWeekOffset((o) => o + 1)}>
          다음 주 ▶
        </Button>
        <Button sm variant="ghost" onClick={() => setWeekOffset(0)}>
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
          <PlanActualCard pa={pa} />
          <CbmsDistCard ds0={ds0} ds6={ds6} />
        </div>
        {/* 우 — 점검·회수(액션) */}
        <div className={rv.sideCol}>
          <ChecklistCard wk={wk} />
          <BacklogReviewCard ds0={ds0} ds6={ds6} />
        </div>
      </div>
    </section>
  );
}
