/* ============================================================
   Review — 탭: 🔄 주간 리뷰 (Phase 4 · 앱상태 + 파생 · 방법론 10절)
   레거시 ui-review.js를 React로 — '공부 방식'을 주 1회 점검:
   계획 vs 실제 · CBMS 분포 · 백로그 회수 · 주간 체크리스트.
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
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
import { mondayOf, addDays, iso, weekLabel, fmtShort, parseISO, dayDiff, DOW_MON } from '@/lib/utils';
import { itemById } from '@/lib/utils';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import rv from './Review.module.css';
import type { CbmsCode, ScheduleResult } from '@/lib/types';

const WEEKLY_CHECKS: [string, string][] = [
  ['backlog', '보충 필요 백로그 — 이번 주 몇 개 회수했나? 남은 건 언제 닫을지 정했다.'],
  ['cbms', '오답 CBMS 분포 — 가장 많은 코드의 처방에 다음 주 시간을 더 줬다.'],
  ['plan', '계획 vs 실제 — 버퍼(15~20%)가 부족했으면 다음 주 목표시간을 낮춘다.'],
  ['anki', 'Anki 적체 — due가 밀렸으면 큐레이션을 더 빡세게(≤5장/블록).'],
];

/** 계획 대비 실제 — RES.days에서 요일별 계획·완료 분 집계. */
function PlanActualCard({ mon, res }: { mon: Date; res: ScheduleResult }) {
  const state = useApp((s) => s.state);
  const byDs: Record<string, ScheduleResult['days'][number]> = {};
  (res.days || []).forEach((d) => (byDs[d.ds] = d));
  let planMin = 0;
  let doneMin = 0;
  const byDay: { ds: string; k: number; pm: number; dm: number }[] = [];
  for (let k = 0; k < 7; k++) {
    const ds = iso(addDays(mon, k));
    const d = byDs[ds];
    let pm = 0;
    let dm = 0;
    if (d)
      d.items.forEach((it) => {
        pm += it.min;
        if (isDone(state, ds, it.sid, it.type)) dm += it.min;
      });
    planMin += pm;
    doneMin += dm;
    byDay.push({ ds, k, pm, dm });
  }
  const rate = planMin > 0 ? Math.round((doneMin / planMin) * 100) : 0;
  const maxRef = Math.max(1, ...byDay.map((x) => x.pm));

  return (
    <div className={ds.card}>
      <h2>
        계획 대비 실제 <span className={`${ds.muted} ${ds.tiny}`}>— 이번 주</span>
      </h2>
      <div className={ds.kpis} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className={ds.kpi}>
          <div className={ds.v}>
            {(doneMin / 60).toFixed(1)}h
            <span className={`${ds.muted} ${ds.tiny}`}> / {(planMin / 60).toFixed(1)}h</span>
          </div>
          <div className={ds.l}>완료 / 계획 ({rate}%)</div>
        </div>
        <div className={ds.kpi}>
          <div className={ds.v}>{rate}%</div>
          <div className={ds.l}>달성률</div>
        </div>
        <div className={ds.kpi}>
          <div className={ds.v}>{rate < 80 ? '⚠️' : '👍'}</div>
          <div className={ds.l}>{rate < 80 ? '버퍼 부족 — 목표↓ 고려' : '페이스 양호'}</div>
        </div>
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
    <div className={ds.card}>
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
  const close = (id: string) => mutate((st) => toggleBacklog(st, id));
  return (
    <div className={ds.card}>
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
    <div className={ds.card}>
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
  const [weekOffset, setWeekOffset] = useState(0);

  const mon = addDays(mondayOf(new Date()), weekOffset * 7);
  const ds0 = iso(mon);
  const ds6 = iso(addDays(mon, 6));
  const wk = ds0;
  const isThis = weekOffset === 0;

  return (
    <>
      <div className={ds.card}>
        <div className={ds.row} style={{ alignItems: 'center' }}>
          <Button sm onClick={() => setWeekOffset((o) => o - 1)}>
            ◀ 이전 주
          </Button>
          <div style={{ flex: 1, textAlign: 'center', minWidth: 120 }}>
            <b style={{ fontSize: 15 }}>{weekLabel(mon)}</b>
            <span className={`${ds.muted} ${ds.tiny}`}>
              {' '}
              {isThis ? '· 이번 주' : weekOffset > 0 ? `· +${weekOffset}주` : `· ${weekOffset}주`}
            </span>
          </div>
          <Button sm onClick={() => setWeekOffset((o) => o + 1)}>
            다음 주 ▶
          </Button>
          <Button sm variant="ghost" onClick={() => setWeekOffset(0)}>
            이번 주
          </Button>
        </div>
        <div className={ds.foot}>
          주 1회 15~20분, <b>공부 방식</b>을 점검하는 자리. 시간(투입)이 아니라 <i>CBMS 분포 축소·진행률</i> 같은 나아진
          증거가 가장 강한 동기.
        </div>
      </div>
      <PlanActualCard mon={mon} res={res} />
      <CbmsDistCard ds0={ds0} ds6={ds6} />
      <BacklogReviewCard ds0={ds0} ds6={ds6} />
      <ChecklistCard wk={wk} />
    </>
  );
}
