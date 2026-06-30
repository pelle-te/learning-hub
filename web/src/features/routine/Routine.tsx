/* ============================================================
   Routine — 탭: ⏰ 가용시간·수업·일과 (Phase 4 · 앱상태/Zustand)
   레거시 ui-routine.js의 renderAvailability를 React로 — 스케줄러 입력(빈 시간 계산):
   요일별 공부 가능 시간(파생) · 수업(요일별) · 그 밖의 일과 블록.
============================================================ */
import { useEffect, useState } from 'react';
import { useApp } from '@/store/useApp';
import { usePageChrome } from '@/store/usePageChrome';
import { freeWindowsForWeekday, blocksForWeekday } from '@/lib/scheduler';
import { DOW, BLOCK_TYPES, rid, toMin } from '@/lib/utils';
import { Button } from '@/components/ui';
import DayRing from './DayRing';
import ds from '@/styles/ds.module.css';
import r from './Routine.module.css';
import type { AppState } from '@/lib/types';

/** 15분 단위 시간 옵션(00:00~24:00) — 드롭다운 공용. */
const TIME_OPTS: string[] = (() => {
  const o: string[] = [];
  for (let m = 0; m <= 1440; m += 15)
    o.push(`${String((m / 60) | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return o;
})();
function TimeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {TIME_OPTS.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

/** 수업: 요일별 개별 시간(시작~끝). 내부적으로 routine 블록(type:'수업', days:[요일])로 저장. */
function ClassList({ dow }: { dow: number }) {
  const routine = useApp((s) => s.state.routine);
  const mutate = useApp((s) => s.mutate);
  const upd = (id: string, k: string, v: string) =>
    mutate((st) => {
      const b = st.routine.find((x) => x.id === id);
      if (b) (b as Record<string, unknown>)[k] = v;
    });
  const del = (id: string) =>
    mutate((st) => {
      st.routine = st.routine.filter((b) => b.id !== id);
    });

  const cls = routine
    .filter((b) => b.type === '수업' && b.days.includes(dow))
    .sort((x, y) => toMin(x.start) - toMin(y.start));
  if (!cls.length)
    return (
      <div className={`${ds.empty} ${ds.tiny}`} style={{ padding: '14px 6px' }}>
        {DOW[dow]}요일 수업이 없어요. 아래 <b>+ 수업 추가</b>로 넣으세요.
      </div>
    );
  return (
    <>
      {cls.map((b) => (
        <div key={b.id} className={r.classrow}>
          <input
            type="text"
            value={b.name}
            aria-label="수업 이름"
            placeholder="수업 이름"
            onChange={(e) => upd(b.id, 'name', e.target.value)}
          />
          <TimeSelect value={b.start} onChange={(v) => upd(b.id, 'start', v)} label="시작 시각" />
          <span className={r.csep}>~</span>
          <TimeSelect value={b.end} onChange={(v) => upd(b.id, 'end', v)} label="끝 시각" />
          <Button sm variant="ghost" danger onClick={() => del(b.id)} aria-label="삭제" title="삭제">
            ✕
          </Button>
        </div>
      ))}
    </>
  );
}

/** 그 밖의 일과 블록(수면·식사·취미 등). 비운 시간은 자동으로 공부 가능 시간. */
function BlockList() {
  const routine = useApp((s) => s.state.routine);
  const mutate = useApp((s) => s.mutate);
  const upd = (id: string, recipe: (b: AppState['routine'][number]) => void) =>
    mutate((st) => {
      const b = st.routine.find((x) => x.id === id);
      if (b) recipe(b);
    });
  const del = (id: string) =>
    mutate((st) => {
      st.routine = st.routine.filter((b) => b.id !== id);
    });
  const toggleDay = (id: string, d: number) =>
    upd(id, (b) => {
      b.days = b.days.includes(d) ? b.days.filter((x) => x !== d) : [...b.days, d].sort((a, c) => a - c);
    });
  const setDays = (id: string, mode: 'wd' | 'we' | 'all') =>
    upd(id, (b) => {
      b.days = mode === 'wd' ? [1, 2, 3, 4, 5] : mode === 'we' ? [0, 6] : [0, 1, 2, 3, 4, 5, 6];
    });

  // 요일별 시간 — times[dow]={start,end} 오버라이드. 펼침 토글은 로컬 상태.
  const [perDay, setPerDay] = useState<Set<string>>(() => new Set());
  const togglePerDay = (id: string) =>
    setPerDay((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setDayTime = (id: string, d: number, k: 'start' | 'end', v: string) =>
    upd(id, (b) => {
      const m = { ...(b.times || {}) };
      const cur = m[String(d)] || { start: b.start, end: b.end };
      m[String(d)] = { ...cur, [k]: v };
      b.times = m;
    });
  const clearTimes = (id: string) => upd(id, (b) => void delete b.times);

  const blocks = routine
    .filter((b) => b.type !== '수업')
    .slice()
    .sort((x, y) => toMin(x.start) - toMin(y.start));
  const blockTypes = Object.keys(BLOCK_TYPES).filter((t) => t !== '수업');
  return (
    <>
      {blocks.map((b) => (
        <div key={b.id} className={r.blk} style={{ borderLeftColor: BLOCK_TYPES[b.type] || 'var(--line2)' }}>
          <div className={r.blkTop}>
            <input
              type="text"
              className={r.blkName}
              value={b.name}
              aria-label="블록 이름"
              placeholder="블록 이름"
              onChange={(e) => upd(b.id, (x) => void (x.name = e.target.value))}
            />
            <select
              className={r.blkType}
              aria-label="블록 유형"
              value={b.type}
              onChange={(e) => upd(b.id, (x) => void (x.type = e.target.value))}
            >
              {blockTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <div className={r.blkTime}>
              <TimeSelect value={b.start} onChange={(v) => upd(b.id, (x) => void (x.start = v))} label="시작 시각" />
              <span className={r.csep}>~</span>
              <TimeSelect value={b.end} onChange={(v) => upd(b.id, (x) => void (x.end = v))} label="끝 시각" />
            </div>
            <Button sm variant="ghost" danger onClick={() => del(b.id)} aria-label="삭제" title="삭제">
              ✕
            </Button>
          </div>
          <div className={r.days}>
            {DOW.map((_, i) => {
              // DOW는 일=0..토=6. 일과 블록 요일도 같은 인덱스(일=0).
              return (
                <button
                  key={i}
                  type="button"
                  className={`${r.daychip}${b.days.includes(i) ? ' ' + r.on : ''}`}
                  onClick={() => toggleDay(b.id, i)}
                >
                  {DOW[i]}
                </button>
              );
            })}
            <span className={r.daysep} />
            <button type="button" className={`${r.daychip} ${r.preset}`} onClick={() => setDays(b.id, 'wd')}>
              평일
            </button>
            <button type="button" className={`${r.daychip} ${r.preset}`} onClick={() => setDays(b.id, 'we')}>
              주말
            </button>
            <button type="button" className={`${r.daychip} ${r.preset}`} onClick={() => setDays(b.id, 'all')}>
              매일
            </button>
          </div>
          <div className={r.perDay}>
            <button
              type="button"
              className={r.perDayToggle}
              onClick={() => togglePerDay(b.id)}
              aria-expanded={perDay.has(b.id)}
            >
              {perDay.has(b.id) ? '▾' : '▸'} 요일별 시간 다르게{b.times ? ' · 적용 중' : ''}
            </button>
            {b.times && (
              <button type="button" className={r.perDayReset} onClick={() => clearTimes(b.id)}>
                전 요일 공통으로
              </button>
            )}
          </div>
          {perDay.has(b.id) &&
            (b.days.length ? (
              <div className={r.perDayGrid}>
                {b.days
                  .slice()
                  .sort((a, c) => a - c)
                  .map((d) => {
                    const t = b.times?.[String(d)];
                    return (
                      <div key={d} className={`${r.perDayRow}${t ? ' ' + r.perDayRowOn : ''}`}>
                        <span className={r.perDayDow}>{DOW[d]}</span>
                        <TimeSelect
                          value={t?.start ?? b.start}
                          onChange={(v) => setDayTime(b.id, d, 'start', v)}
                          label={`${DOW[d]}요일 시작`}
                        />
                        <span className={r.csep}>~</span>
                        <TimeSelect
                          value={t?.end ?? b.end}
                          onChange={(v) => setDayTime(b.id, d, 'end', v)}
                          label={`${DOW[d]}요일 끝`}
                        />
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className={`${ds.empty} ${ds.tiny}`} style={{ padding: '8px 6px' }}>
                위에서 요일을 먼저 선택하세요.
              </div>
            ))}
        </div>
      ))}
    </>
  );
}

export default function Routine() {
  const mutate = useApp((s) => s.mutate);
  const state = useApp((s) => s.state);
  const now = new Date();
  const todayDow = now.getDay(); // 일=0..토=6
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [ringDow, setRingDow] = useState(todayDow); // 24h 링이 보여주는 요일
  const [classDow, setClassDow] = useState(1); // 수업 편집기에서 보는 요일(일=0..토=6)

  // 요일별 가용 창(시그니처 링 + 주간 막대 공용). 순수 파생 — freeWindowsForWeekday 단일 출처.
  const free = DOW.map((_, i) => freeWindowsForWeekday(state, i));
  const fw = free[ringDow]!;
  const ringBlocks = blocksForWeekday(state, ringDow);
  const weekFreeMin = free.reduce((t, f) => t + f.freeMin, 0);

  const addClass = (dow: number) =>
    mutate((st) => {
      st.routine.push({ id: rid(), name: '수업', type: '수업', start: '09:00', end: '10:00', days: [dow] });
    });
  const addBlock = () =>
    mutate((st) => {
      st.routine.push({
        id: rid(),
        name: '새 블록',
        type: '기타',
        start: '15:00',
        end: '16:00',
        days: [1, 2, 3, 4, 5],
      });
    });

  // 주간/선택 요일 가용 리드아웃을 상단 바로(데모 v6 헤더).
  const setChrome = usePageChrome((s) => s.setChrome);
  const clearChrome = usePageChrome((s) => s.clear);
  useEffect(() => {
    setChrome([
      {
        label: '주간 가용',
        value: (
          <>
            {(weekFreeMin / 60).toFixed(1)}
            <small> h</small>
          </>
        ),
        accent: true,
      },
      {
        label: `${DOW[ringDow]}요일`,
        value: (
          <>
            {(fw.freeMin / 60).toFixed(1)}
            <small> h</small>
          </>
        ),
      },
      {
        label: '일 평균',
        value: (
          <>
            {(weekFreeMin / 7 / 60).toFixed(1)}
            <small> h</small>
          </>
        ),
      },
    ]);
    return () => clearChrome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekFreeMin, fw.freeMin, ringDow]);

  return (
    <section className={r.wrap} aria-label="가용시간·수업·일과">
      <div className={r.cols}>
        {/* 좌 — 넓은 편집기(수업·일과) */}
        <div className={r.editCol}>
          <div className={ds.card}>
            <h2>
              수업 (요일별){' '}
              <span className={`${ds.muted} ${ds.tiny}`}>— 요일을 고르고 그 날 수업의 시작~끝을 직접 추가</span>
            </h2>
            <div className={ds.seg}>
              {DOW.map((d, i) => (
                <button key={d} className={i === classDow ? ds.on : ''} onClick={() => setClassDow(i)}>
                  {d}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <ClassList dow={classDow} />
            </div>
            <Button sm style={{ marginTop: 8 }} onClick={() => addClass(classDow)}>
              + 수업 추가
            </Button>
            <div className={ds.foot}>
              요일마다 수업 시간이 달라도 각각 지정할 수 있어요. 수업 시간은 공부 가능 시간에서 자동으로 빠집니다.
            </div>
          </div>

          <div className={ds.card}>
            <h2>
              그 밖의 일과 블록{' '}
              <span className={`${ds.muted} ${ds.tiny}`}>
                — 수면·식사·취미 등. 비운 시간은 자동으로 공부 가능 시간이 됩니다
              </span>
            </h2>
            <div style={{ marginTop: 10 }}>
              <BlockList />
            </div>
            <Button sm style={{ marginTop: 8 }} onClick={addBlock}>
              + 블록 추가
            </Button>
            <div className={ds.foot}>
              수면 블록으로 깨어있는 시간을 정하면 빈 시간이 정확해져요. 블록을 지워도 그 시간은 그냥 빈 시간(공부
              가능)이 될 뿐, 학습 항목은 사라지지 않습니다.
            </div>
          </div>
        </div>

        {/* 우 — 24h 발광 링 시그니처(요일 선택 → 링 갱신). 좌측과 같은 카드 재질로 통일. */}
        <aside className={r.sigCol}>
          <div className={`${ds.card} ${r.sigCard}`}>
            <div className={r.sigColHead}>
              가용시간 — AVAILABILITY
              <span className={r.sigDow}>{DOW[ringDow]}요일</span>
            </div>
            <DayRing
              dow={DOW[ringDow]!}
              blocks={ringBlocks}
              windows={fw.windows}
              wake0={fw.wake0}
              wake1={fw.wake1}
              freeMin={fw.freeMin}
              nowMin={ringDow === todayDow ? nowMin : null}
            />
            <span className={r.sigLegend}>
              <span>
                <i className={r.lgFree} />
                공부 가능
              </span>
              <span>
                <i className={r.lgBlock} />
                일과
              </span>
              <span>
                <i className={r.lgSleep} />
                수면
              </span>
            </span>
            <div className={r.wkbars} role="tablist" aria-label="요일 선택" style={{ width: '100%' }}>
              {DOW.map((d, i) => {
                const hrs = free[i]!.freeMin / 60;
                const max = Math.max(1, ...free.map((f) => f.freeMin / 60));
                return (
                  <button
                    key={d}
                    type="button"
                    role="tab"
                    aria-selected={i === ringDow}
                    className={`${r.wb}${i === ringDow ? ' ' + r.wbOn : ''}${i === todayDow ? ' ' + r.wbToday : ''}`}
                    onClick={() => setRingDow(i)}
                    title={`${d}요일 ${hrs.toFixed(1)}시간`}
                  >
                    <span className={r.wbBarWrap}>
                      <span className={r.wbBar} style={{ height: `${Math.round((hrs / max) * 100)}%` }} />
                    </span>
                    <span className={r.h}>{hrs.toFixed(1)}</span>
                    <span className={r.d}>{d}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className={r.sigHint}>
            깨어있는 시간에서 고정 일과를 빼면 남는 게 공부 가능 시간 — 스케줄러가 이 빈 시간에 블록을 배분합니다. 특정
            날짜는 <b>스케줄</b> 탭, 시작일·모듈 길이는 <b>설정</b>(⚙)에서.
          </div>
        </aside>
      </div>
    </section>
  );
}
