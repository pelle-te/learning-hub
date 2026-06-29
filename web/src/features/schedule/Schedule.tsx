/* ============================================================
   Schedule — 탭: 🗓 주간 스케줄 (Phase 4 · 앱상태 + 파생 scheduler)
   레거시 ui-schedule.js를 React로 — 한 주씩 넘겨보기(개요/카드 뷰), 날짜별 타임라인,
   가용시간 인라인 조정, 완료 체크, 마감 카운트다운, .ics 신선도 배지.
   스타일: 공유 디자인 시스템(주간/타임라인 포함)은 ds.module(ds.*), 요소·토큰은 전역 base(Phase 9 전환).
============================================================ */
import { useMemo, useState } from 'react';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import { useSchedule, useStudyMinByWeekday } from '@/store/selectors';
import { io } from '@/shell';
import { dayStudyMin, layoutDay } from '@/lib/scheduler';
import { isDone } from '@/lib/persistence';
import {
  iso,
  toHM,
  hLabel,
  mondayOf,
  parseISO,
  addDays,
  dayDiff,
  weekLabel,
  fmtShort,
  ddayInfo,
  todayISO,
  DOW_MON,
} from '@/lib/utils';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import type { AppState, ScheduleItem, ScheduleResult, SessionType } from '@/lib/types';

type Row =
  | { kind: 'now'; start: number }
  | { kind: 'free'; start: number; end: number }
  | { kind: 'block'; start: number; end: number; name: string; btype: string; color?: string }
  | { kind: 'study'; start: number | null; end: number | null; it: ScheduleItem; plannedMin: number };

interface DayData {
  date: Date;
  ds: string;
  wd: number;
  isToday: boolean;
  studyMin: number;
  used: number;
  ratio: number;
  over: boolean;
  doneMinTot: number;
  planMin: number;
  freeMin: number;
  defMin: number;
  ovVal: number | string;
  rows: Row[];
  counts: { studies: number; revs: number; ankis: number; blanks: number; mocks: number };
}

/** 하루치 계산(머리글/막대/타임라인 행/꼬리) — 카드뷰·개요뷰 공용. */
function computeDay(
  state: AppState,
  res: ScheduleResult,
  capWd: number[],
  nowMin: number,
  todayIso: string,
  curMon: Date,
  k: number,
): DayData {
  const byDs: Record<string, ScheduleResult['days'][number]> = {};
  (res.days || []).forEach((d) => (byDs[d.ds] = d));
  const date = addDays(curMon, k);
  const ds2 = iso(date);
  const wd = date.getDay();
  const isToday = ds2 === todayIso;
  const defMin = capWd[wd] ?? 0;
  const studyMin = dayStudyMin(state, ds2, wd, capWd);
  const ovRaw = state.dayOverrides && state.dayOverrides[ds2] != null ? state.dayOverrides[ds2] : '';
  const planDay = byDs[ds2];
  const items = planDay ? planDay.items : [];
  const L = layoutDay(state, { ds: ds2, date, wd, studyMin, used: planDay?.used || 0, modLeft: 0, revLeft: 0, items });
  const used = planDay ? Math.round(planDay.used) : 0;
  const over = used > studyMin + 1;
  const ratio = studyMin ? Math.min(100, Math.round((used / studyMin) * 100)) : 0;

  const plannedByKey: Record<string, number> = {};
  items.forEach((it) => {
    const key = it.sid + '|' + it.type;
    plannedByKey[key] = (plannedByKey[key] || 0) + it.min;
  });
  const planMin = items.reduce((t, it) => t + it.min, 0);
  let doneMinTot = 0;
  Object.keys(plannedByKey).forEach((key) => {
    const [sid, type] = key.split('|');
    if (isDone(state, ds2, sid!, type as SessionType)) doneMinTot += plannedByKey[key]!;
  });

  // 일과 블록 + 학습 세션 + 빈 시간(+오늘이면 현재시각)을 시각순으로.
  const rows: Row[] = [];
  L.tl.forEach((x) => {
    if (x.kind === 'block')
      rows.push({
        kind: 'block',
        start: x.start,
        end: x.end,
        name: x.name || '',
        btype: x.btype || '',
        color: x.color,
      });
    else
      rows.push({
        kind: 'study',
        start: x.start,
        end: x.end,
        it: {
          type: x.type as SessionType,
          sid: x.sid as string,
          name: x.name || '',
          color: x.color,
          min: x.min || 0,
          chapters: x.chapters,
        },
        plannedMin: plannedByKey[(x.sid as string) + '|' + x.type] || x.min || 0,
      });
  });
  L.free.forEach(([s, e]) => rows.push({ kind: 'free', start: s, end: e }));
  if (isToday) rows.push({ kind: 'now', start: nowMin });
  rows.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  // 시각 못 잡은 항목(여유 없음) 보강 — 미배치.
  const shown = new Set(L.tl.filter((x) => x.kind === 'study').map((x) => x.sid + '|' + x.type));
  items.forEach((it) => {
    if (!shown.has(it.sid + '|' + it.type))
      rows.push({
        kind: 'study',
        start: null,
        end: null,
        it,
        plannedMin: plannedByKey[it.sid + '|' + it.type] || it.min,
      });
  });

  const counts = {
    studies: items.filter((it) => it.type === 'new').length,
    revs: items.filter((it) => it.type === 'rev').length,
    ankis: items.filter((it) => it.type === 'anki').length,
    blanks: items.filter((it) => it.type === 'blank').length,
    mocks: items.filter((it) => it.type === 'mock').length,
  };

  return {
    date,
    ds: ds2,
    wd,
    isToday,
    studyMin,
    used,
    ratio,
    over,
    doneMinTot,
    planMin,
    freeMin: L.freeMin,
    defMin,
    ovVal: ovRaw,
    rows,
    counts,
  };
}

const TAG: Record<SessionType, { cls: string; label: string }> = {
  new: { cls: 'new', label: '학습' },
  rev: { cls: 'rev', label: '복습' },
  blank: { cls: 'blank', label: '백지' },
  mock: { cls: 'mock', label: '모의' },
  anki: { cls: 'anki', label: 'Anki' },
};

/** 학습/복습/Anki 한 줄 — 완료 체크박스 포함. */
function StudyRow({ ds: dsKey, row }: { ds: string; row: Extract<Row, { kind: 'study' }> }) {
  const toggleDone = useApp((s) => s.toggleDone);
  const done = useApp((s) => isDone(s.state, dsKey, row.it.sid, row.it.type));
  const x = row.it;
  const tag = TAG[x.type];
  const timeHtml = row.start != null && row.end != null ? `${toHM(row.start)}–${toHM(row.end)}` : '미배치';
  const dur = row.start != null && row.end != null ? hLabel(row.end - row.start) : hLabel(x.min);
  return (
    <div className={`${ds.tl}${done ? ' ' + ds.rowdone : ''}`}>
      <input
        type="checkbox"
        className={ds.donechk}
        checked={done}
        onChange={(e) => toggleDone(dsKey, x.sid, x.type, row.plannedMin, e.target.checked)}
        title="완료 표시"
        aria-label={`${x.name} 완료`}
      />
      <span className={ds.tm}>{row.start == null ? <span className={ds.muted}>미배치</span> : timeHtml}</span>
      <span className={ds.swatch} style={{ background: x.color || '#6ea8fe' }} />
      <span className={`${ds.tag} ${ds[tag.cls]}`}>{tag.label}</span>
      <span className={ds.nm}>
        {x.name}
        {x.chapters && x.chapters.length > 0 && (
          <span className={`${ds.muted} ${ds.tiny}`}> · {x.chapters.join(', ')}</span>
        )}
      </span>
      <span className={ds.mn}>{dur}</span>
    </div>
  );
}

/** 하루 본문(타임라인 행들). */
function DayBody({ d }: { d: DayData }) {
  if (!d.rows.length)
    return (
      <div className={`${ds.tl} ${ds.free}`}>
        <span className={`${ds.nm} ${ds.muted}`}>일과 블록 없음</span>
      </div>
    );
  return (
    <>
      {d.rows.map((row, i) => {
        if (row.kind === 'now')
          return (
            <div key={i} className={`${ds.tl} ${ds.nowline}`}>
              <span className={ds.tm}>{toHM(row.start)}</span>
              <span className={ds.nm}>⏱ 지금</span>
              <span className={ds.mn} />
            </div>
          );
        if (row.kind === 'free') {
          if (row.end - row.start < 5) return null;
          return (
            <div key={i} className={`${ds.tl} ${ds.free}`}>
              <span className={ds.tm}>
                {toHM(row.start)}–{toHM(row.end)}
              </span>
              <span className={`${ds.nm} ${ds.muted}`}>🟢 빈 시간</span>
              <span className={ds.mn}>{hLabel(row.end - row.start)}</span>
            </div>
          );
        }
        if (row.kind === 'block')
          return (
            <div key={i} className={`${ds.tl} ${ds.block}`}>
              <span className={ds.tm}>
                {toHM(row.start)}–{toHM(row.end)}
              </span>
              <span className={ds.swatch} style={{ background: row.color }} />
              <span className={`${ds.nm} ${ds.muted}`}>{row.name}</span>
              <span className={ds.mn}>{row.btype}</span>
            </div>
          );
        return <StudyRow key={i} ds={d.ds} row={row} />;
      })}
    </>
  );
}

/** 하루 머리글(요일·날짜·가용시간 인라인 입력) + 막대. */
function DayHeadBar({ d, k }: { d: DayData; k: number }) {
  const mutate = useApp((s) => s.mutate);
  const setOverride = (v: string) =>
    mutate((st) => {
      st.dayOverrides = st.dayOverrides || {};
      if (v === '' || v == null) delete st.dayOverrides[d.ds];
      else st.dayOverrides[d.ds] = +v;
    });
  const barColor = d.over ? 'var(--bad)' : d.ratio > 90 ? 'var(--warn)' : 'var(--acc)';
  return (
    <>
      <div className={ds.dh}>
        <span className={ds.dt}>
          {DOW_MON[k]}{' '}
          <span className={ds.muted} style={{ fontWeight: 400 }}>
            {fmtShort(d.date)}
          </span>
          {d.isToday && <span className={ds.todaychip}> 오늘</span>}
        </span>
        <span className={ds.cap}>
          가용{' '}
          <input
            type="number"
            step="0.5"
            min="0"
            value={d.ovVal}
            placeholder={String(d.defMin / 60)}
            aria-label={`${fmtShort(d.date)} 가용시간(시간)`}
            onChange={(e) => setOverride(e.target.value)}
            style={{ width: 54, display: 'inline-block', padding: '3px 6px', textAlign: 'center' }}
          />
          h<span className={`${ds.muted} ${ds.tiny}`}> · 배정 {(d.used / 60).toFixed(1)}h</span>
        </span>
      </div>
      {d.studyMin ? (
        <div className={ds.bar}>
          <i style={{ width: `${d.ratio}%`, background: barColor }} />
        </div>
      ) : null}
    </>
  );
}

/** 하루 꼬리(요약 칩). */
function DayFoot({ d }: { d: DayData }) {
  const { counts: c } = d;
  const extra = (c.blanks ? ` · 백지 ${c.blanks}` : '') + (c.mocks ? ` · 모의 ${c.mocks}` : '');
  return (
    <div className={ds.tl} style={{ border: 'none' }}>
      <span className={`${ds.nm} ${ds.tiny} ${ds.muted}`}>
        학습 {c.studies}모듈 · 복습 {c.revs} · Anki {c.ankis}
        {extra}
      </span>
      {d.planMin > 0 && (
        <span className={`${ds.pill} ${ds.tiny}${d.doneMinTot >= d.planMin ? ' ' + ds.good : ''}`}>
          완료 {(d.doneMinTot / 60).toFixed(1)}/{(d.planMin / 60).toFixed(1)}h
        </span>
      )}
      {d.freeMin > 0 && <span className={`${ds.pill} ${ds.tiny}`}>빈 {(d.freeMin / 60).toFixed(1)}h</span>}
    </div>
  );
}

function DayCard({ d, k, agenda }: { d: DayData; k: number; agenda?: boolean }) {
  return (
    <div className={`${ds.day}${agenda ? ' ' + ds.agenda : ''}${d.isToday ? ' ' + ds.today : ''}`}>
      <DayHeadBar d={d} k={k} />
      <div className={ds.body}>
        <DayBody d={d} />
        <DayFoot d={d} />
      </div>
    </div>
  );
}

/** 마감 임박 D-day 카드. */
function DeadlineCard() {
  const items = useApp((s) => s.state.items);
  const today = iso(new Date());
  const dl = items
    .filter((s) => s.deadline)
    .map((s) => ({
      name: s.name,
      color: s.color,
      deadline: s.deadline as string,
      dday: dayDiff(today, s.deadline as string),
    }))
    .sort((a, b) => a.dday - b.dday);
  if (!dl.length) return null;
  return (
    <div className={ds.card}>
      <h2 style={{ marginBottom: 8 }}>⏳ 마감 카운트다운</h2>
      <div className={ds.ddrow}>
        {dl.map((d) => {
          const { lab, cls } = ddayInfo(d.dday);
          return (
            <span key={d.name + d.deadline} className={`${ds.ddaychip}${cls ? ' ' + ds[cls] : ''}`}>
              <span className={ds.swatch} style={{ background: d.color }} />
              {d.name} <b>{lab}</b> <span className={`${ds.muted} ${ds.tiny}`}>{d.deadline}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** .ics 신선도 — 마지막 내보내기 서명을 현재 계획과 비교(어긋나면 재내보내기 배지). */
function IcsFreshnessNote() {
  const x = useApp((s) => s.state._icsExport) as { at?: string; sig?: string } | undefined;
  const today = useApp((s) => todayISO(s.state)); // 렌더 순수성: Date.now() 대신 앱 정본 '오늘'(테스트 _today 존중)
  if (!x || !x.at) return null;
  const when = new Date(x.at);
  const days = isNaN(when.getTime()) ? null : dayDiff(iso(when), today);
  const ago = days == null ? '' : days <= 0 ? '오늘' : days === 1 ? '어제' : `${days}일 전`;
  const stale = x.sig !== io.planSignature();
  if (stale)
    return (
      <div className={ds.warnbox}>
        📅 <b>캘린더(.ics)가 계획과 어긋났어요</b> — 마지막 내보내기({ago}) 이후 일정이 바뀌었습니다.
        <Button sm style={{ marginLeft: 6 }} onClick={() => io.exportICS()}>
          🔄 .ics 재내보내기
        </Button>
        <span className={`${ds.muted} ${ds.tiny}`}> — 일회성 스냅샷이라 자동 동기화되지 않아요.</span>
      </div>
    );
  return <div className={ds.foot}>📅 캘린더(.ics) 최신 상태 · 마지막 내보내기 {ago}.</div>;
}

export default function Schedule() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const [weekOffset, setWeekOffset] = useState(0);
  // 뷰 선택은 UI 설정 단일 store(useUI)가 소유 — 영속·IDB미러 일관(localStorage 직접 접근 제거).
  const schedView = useUI((s) => s.ui.schedView);
  const setView = useUI((s) => s.setSchedView);
  const [selDow, setSelDow] = useState<number | null>(null);

  const baseMon = mondayOf(parseISO(state.startDate));
  const curMon = addDays(baseMon, weekOffset * 7);

  const capWd = useStudyMinByWeekday();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayIso = iso(now);

  const parts = useMemo(
    () => Array.from({ length: 7 }, (_, k) => computeDay(state, res, capWd, nowMin, todayIso, curMon, k)),
    [state, res, capWd, nowMin, todayIso, curMon],
  );

  const weekToday = () => {
    const base = iso(mondayOf(parseISO(state.startDate)));
    setWeekOffset(Math.round(dayDiff(base, iso(mondayOf(new Date()))) / 7));
    setSelDow(null);
  };

  const warn =
    res.warnings.length > 0 ? (
      <div
        className={`${ds.warnbox}${res.warnings.some((w) => w.includes('못') || w.includes('초과')) ? ' ' + ds.bad : ''}`}
      >
        {res.warnings.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>
    ) : null;

  let sel = selDow;
  if (sel == null || sel < 0 || sel > 6) {
    const ti = parts.findIndex((p) => p.isToday);
    sel = ti >= 0 ? ti : 0;
  }
  const maxRef = Math.max(1, ...parts.map((p) => Math.max(p.studyMin, p.used)));

  return (
    <>
      {warn}
      <IcsFreshnessNote />
      <DeadlineCard />
      <div className={ds.card}>
        <div className={ds.row} style={{ alignItems: 'center' }}>
          <Button sm onClick={() => setWeekOffset((o) => o - 1)}>
            ◀ 이전 주
          </Button>
          <div style={{ flex: 1, textAlign: 'center', minWidth: 120 }}>
            <b style={{ fontSize: 15 }}>{weekLabel(curMon)}</b>
            <span className={`${ds.muted} ${ds.tiny}`}>
              {' '}
              {weekOffset === 0 ? '· 이번 주' : weekOffset > 0 ? `· +${weekOffset}주` : `· ${weekOffset}주`}
            </span>
          </div>
          <Button sm onClick={() => setWeekOffset((o) => o + 1)}>
            다음 주 ▶
          </Button>
          <Button sm variant="ghost" onClick={weekToday}>
            오늘
          </Button>
          <div className={ds.seg} role="tablist" aria-label="주간 보기 방식" style={{ marginLeft: 6 }}>
            <button
              role="tab"
              aria-selected={schedView === 'overview'}
              className={schedView === 'overview' ? ds.on : ''}
              onClick={() => setView('overview')}
            >
              개요
            </button>
            <button
              role="tab"
              aria-selected={schedView === 'cards'}
              className={schedView === 'cards' ? ds.on : ''}
              onClick={() => setView('cards')}
            >
              카드
            </button>
          </div>
        </div>
        <div className={ds.foot}>
          {schedView === 'overview' ? '위 막대에서 요일을 누르면 그날 일정이 아래에 펼쳐져요. ' : ''}각 날짜의{' '}
          <b>가용 시간</b>은 그 칸에서 바로 바꿀 수 있어요(그날만 적용). 모듈 {res.ML / 60}시간 단위.
        </div>
      </div>

      {schedView === 'cards' ? (
        <div className={ds.weekgrid}>
          {parts.map((d, k) => (
            <DayCard key={d.ds} d={d} k={k} />
          ))}
        </div>
      ) : (
        <div>
          <div className={ds.wkstrip} role="tablist" aria-label="요일 선택">
            {parts.map((p, k) => {
              const doneFrac = Math.round((p.doneMinTot / maxRef) * 100);
              const usedFrac = Math.round((p.used / maxRef) * 100);
              const remFrac = Math.max(0, usedFrac - doneFrac);
              const remColor = p.used > p.studyMin + 1 ? 'var(--bad)' : 'var(--acc)';
              return (
                <button
                  key={p.ds}
                  className={`${ds.wkcol}${k === sel ? ' ' + ds.sel : ''}${p.isToday ? ' ' + ds.today : ''}`}
                  role="tab"
                  aria-selected={k === sel}
                  onClick={() => setSelDow(k)}
                  data-tip={`${DOW_MON[k]} ${fmtShort(p.date)} · 배정 ${(p.used / 60).toFixed(1)}h`}
                >
                  <span className={ds.wd}>
                    {DOW_MON[k]}
                    {p.isToday && <span className={ds.wkdot} />}
                  </span>
                  <span className={ds.dd}>{p.date.getDate()}</span>
                  <span className={ds.colBar}>
                    <i style={{ height: `${doneFrac}%`, background: 'var(--good)' }} />
                    <i style={{ height: `${remFrac}%`, background: remColor }} />
                  </span>
                  <span className={ds.colH}>
                    {(p.used / 60).toFixed(1)}
                    <span className={ds.colSub}>h</span>
                  </span>
                </button>
              );
            })}
          </div>
          <DayCard d={parts[sel]!} k={sel} agenda />
        </div>
      )}
    </>
  );
}
