/* ============================================================
   Routine — 탭: ⏰ 가용시간·수업·일과 (Phase 4 · 앱상태/Zustand)
   레거시 ui-routine.js의 renderAvailability를 React로 — 스케줄러 입력(빈 시간 계산):
   요일별 공부 가능 시간(파생) · 수업(요일별) · 그 밖의 일과 블록.
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { useStudyMinByWeekday } from '@/store/selectors';
import { DOW, BLOCK_TYPES, rid, toMin } from '@/lib/utils';
import { Button } from '@/components/ui';
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

  const blocks = routine
    .filter((b) => b.type !== '수업')
    .slice()
    .sort((x, y) => toMin(x.start) - toMin(y.start));
  const blockTypes = Object.keys(BLOCK_TYPES).filter((t) => t !== '수업');
  return (
    <>
      {blocks.map((b) => (
        <div key={b.id} className={r.blkrow}>
          <input
            type="text"
            value={b.name}
            aria-label="블록 이름"
            onChange={(e) => upd(b.id, (x) => void (x.name = e.target.value))}
          />
          <select
            aria-label="블록 유형"
            value={b.type}
            onChange={(e) => upd(b.id, (x) => void (x.type = e.target.value))}
          >
            {blockTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <TimeSelect value={b.start} onChange={(v) => upd(b.id, (x) => void (x.start = v))} label="시작 시각" />
          <TimeSelect value={b.end} onChange={(v) => upd(b.id, (x) => void (x.end = v))} label="끝 시각" />
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
          <Button sm variant="ghost" danger onClick={() => del(b.id)}>
            ✕
          </Button>
        </div>
      ))}
    </>
  );
}

export default function Routine() {
  const mutate = useApp((s) => s.mutate);
  const [classDow, setClassDow] = useState(1); // 수업 편집기에서 보는 요일(일=0..토=6)

  const cap = useStudyMinByWeekday();

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

  return (
    <>
      <div className={ds.card}>
        <h2>
          가용시간·수업·일과{' '}
          <span className={`${ds.muted} ${ds.tiny}`}>— 깨어있는 시간에서 고정 일과를 빼면 남는 게 공부 가능 시간</span>
        </h2>
        <div className={`${ds.tiny} ${ds.muted}`}>
          여기서 정한 빈 시간에 스케줄러가 블록을 배분합니다. 시작일·모듈 길이 같은 값은 <b>설정</b>(우측 상단 ⚙)에서.
        </div>
      </div>

      <div className={ds.card}>
        <h2>
          요일별 공부 가능 시간{' '}
          <span className={`${ds.muted} ${ds.tiny}`}>
            — 고정 블록(수면·식사·취미·수업)을 뺀 빈 시간 · 특정 날짜는 스케줄 탭에서 조정
          </span>
        </h2>
        <div className={r.wkbars}>
          {DOW.map((d, i) => (
            <div key={d} className={r.wb}>
              <div className={r.h}>
                {(cap[i]! / 60).toFixed(1)}
                <span className={ds.tiny}>h</span>
              </div>
              <div className={r.d}>{d}</div>
            </div>
          ))}
        </div>
      </div>

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
        <div className={r.blkrow} style={{ color: 'var(--mut)', fontSize: 11 }}>
          <div>이름</div>
          <div>유형</div>
          <div>시작</div>
          <div>끝</div>
          <div className={r.days}>요일</div>
          <div />
        </div>
        <div>
          <BlockList />
        </div>
        <Button sm style={{ marginTop: 8 }} onClick={addBlock}>
          + 블록 추가
        </Button>
        <div className={ds.foot}>
          수면 블록으로 깨어있는 시간을 정하면 빈 시간이 정확해져요. 블록을 지워도 그 시간은 그냥 빈 시간(공부 가능)이
          될 뿐, 학습 항목은 사라지지 않습니다.
        </div>
      </div>
    </>
  );
}
