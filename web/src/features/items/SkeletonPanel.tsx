/* ============================================================
   SkeletonPanel — '뼈대'(가용시간의 골격) 편집 본문: 수업(요일별) + 그 밖의 일과 블록.
   옛 routine 탭의 좌측 편집 컬럼을 그대로 승계 — 계획 재개편 v3에서 뼈대 세그먼트가 '과목' 탭으로
   병합되면서, 이 편집기는 과목 탭 상단의 접이식 스트립 안에서 온디맨드로 펼쳐진다(§재설계 사상 4).
   우측 시그니처(24h 링·요일 막대)는 AvailRail.tsx가 상시 레일로 가져갔다.
   ⚠ features → features import 금지(eslint-plugin-boundaries)라 파일이 items/로 물리 이주했다.
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { DOW, BLOCK_TYPES, rid, toMin } from '@/lib/utils';
import { Button } from '@/components/ui';
import type { AppState } from '@/lib/types';

/* Skeleton.module.css → Tailwind 이식(C-7). 폼 위주라 전역 요소규칙(button/input/select)을
   `!` 로 이기는 자리가 많다 — 값이 전역과 같으면 클래스 없음, 다를 때만 `!`(§15 · tokenBridge 머리주석).
   전역 button:hover 가 더 높은 특이도로 로컬 hover 를 덮던 자리는 되살리지 않는다(전역이 이기게 둔다). */
const CLASSROW = 'mb-1.5 grid grid-cols-classrow items-center gap-1.5 max-narrow:grid-cols-classrow-narrow';
// 일과 블록 카드 — 왼쪽 색띠(3px·런타임 색)는 인라인 style 로 남긴다(border-left-width/color).
const BLK =
  'flex min-w-0 flex-col gap-2.25 rounded-blk border border-line2 px-3 py-2.5 transition-[border-color] duration-[0.14s] ease-[var(--ease)] hover:border-[var(--line-blk-hover)]';
const BLK_TOP = 'grid grid-cols-blktop items-center gap-2 max-narrow:grid-cols-[1fr_auto]';
const BLK_TIME = 'flex items-center gap-1.25 max-narrow:col-span-full';
const DAYS = 'flex flex-wrap items-center gap-0.75';
const DAYCHIP = 'min-w-7 rounded-chip! px-0! py-1.25! text-sm! leading-[normal] text-mut!';
const DAYCHIP_ON = 'bg-acc! border-acc! text-on-acc! font-bold! shadow-daychip';
const DAYCHIP_PRESET = 'min-w-auto bg-transparent! px-1.75! text-xs! hover:text-acc!';
const DAYSEP = 'mx-0.75 h-4.5 w-px bg-line';
const PERDAY = 'flex flex-wrap items-center gap-2.5';
const PERDAY_TOGGLE = 'border-0! bg-transparent! px-0! py-0.5! text-xs! font-bold! text-mut! leading-[normal]';
const PERDAY_RESET = 'bg-transparent! px-2! py-0.5! text-2xs! font-bold! text-mut!';
const PERDAY_GRID =
  'mt-1 flex flex-col gap-1.25 rounded-blk bg-[var(--tint-ink-faint)] px-2.75 py-2.25 shadow-inset-line2';
const PERDAY_ROW = 'grid grid-cols-perday items-center gap-1.5 max-narrow:grid-cols-perday-narrow';
const CLS_GRID = 'mt-2.5 grid grid-cols-cls items-start gap-2';
const BLK_GRID = 'mt-2.5 grid grid-cols-blk items-start gap-2';

/** 시각 입력 — 네이티브 time(15분 스텝). 옛 97개 <option> 셀렉트를 대체(가볍고 키보드·모바일 친화).
    빈 값(지움)은 이전 값을 유지해 무효 상태를 만들지 않는다. */
function TimeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="time"
      step={900}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value || value)}
    />
  );
}

/** 시작~끝 역전 경고(한 줄) — start>=end면 창이 0/음수라 스케줄러가 조용히 무시한다. */
function BadRange({ start, end }: { start: string; end: string }) {
  if (toMin(start) < toMin(end)) return null;
  return (
    <div className="ds-tiny" style={{ color: 'var(--bad)', marginTop: 4 }}>
      ⚠ 끝 시각이 시작보다 빨라요 — 이 블록은 무시됩니다.
    </div>
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
  const del = (id: string, name: string) => {
    ui.backupNow();
    mutate((st) => {
      st.routine = st.routine.filter((b) => b.id !== id);
    });
    ui.toastUndo(`"${name || '수업'}" 삭제됨`);
  };

  const cls = routine
    .filter((b) => b.type === '수업' && b.days.includes(dow))
    .sort((x, y) => toMin(x.start) - toMin(y.start));
  if (!cls.length)
    return (
      <div className="ds-empty ds-tiny" style={{ padding: '14px 6px' }}>
        {DOW[dow]}요일 수업이 없어요. 아래 <b>+ 수업 추가</b>로 넣으세요.
      </div>
    );
  return (
    <>
      {cls.map((b) => (
        <div key={b.id} className="min-w-0">
          <div className={CLASSROW}>
            <input
              type="text"
              value={b.name}
              aria-label="수업 이름"
              placeholder="수업 이름"
              onChange={(e) => upd(b.id, 'name', e.target.value)}
            />
            <TimeSelect value={b.start} onChange={(v) => upd(b.id, 'start', v)} label="시작 시각" />
            <span className="text-center text-mut max-narrow:hidden">~</span>
            <TimeSelect value={b.end} onChange={(v) => upd(b.id, 'end', v)} label="끝 시각" />
            <Button sm variant="ghost" danger onClick={() => del(b.id, b.name)} aria-label="삭제" title="삭제">
              ✕
            </Button>
          </div>
          <BadRange start={b.start} end={b.end} />
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
  const del = (id: string, name: string) => {
    ui.backupNow();
    mutate((st) => {
      st.routine = st.routine.filter((b) => b.id !== id);
    });
    ui.toastUndo(`"${name || '블록'}" 삭제됨`);
  };
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
        <div
          key={b.id}
          className={BLK}
          style={{ borderLeftColor: BLOCK_TYPES[b.type] || 'var(--line2)', borderLeftWidth: 3 }}
        >
          <div className={BLK_TOP}>
            <input
              type="text"
              className="min-w-0 font-semibold"
              value={b.name}
              aria-label="블록 이름"
              placeholder="블록 이름"
              onChange={(e) => upd(b.id, (x) => void (x.name = e.target.value))}
            />
            <select
              className="min-w-0"
              aria-label="블록 유형"
              value={b.type}
              onChange={(e) => upd(b.id, (x) => void (x.type = e.target.value))}
            >
              {blockTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <div className={BLK_TIME}>
              <TimeSelect value={b.start} onChange={(v) => upd(b.id, (x) => void (x.start = v))} label="시작 시각" />
              <span>~</span>
              <TimeSelect value={b.end} onChange={(v) => upd(b.id, (x) => void (x.end = v))} label="끝 시각" />
            </div>
            <Button sm variant="ghost" danger onClick={() => del(b.id, b.name)} aria-label="삭제" title="삭제">
              ✕
            </Button>
          </div>
          <BadRange start={b.start} end={b.end} />
          {/* 선택 상태를 색(.on)만으로 전하면 AT가 못 읽는다 → aria-pressed로 이중화(AvailRail 요일 막대와 같은 패턴).
              요일 토글은 다중 선택이라 tablist가 아니라 group+토글 버튼이 정직하다(WCAG 1.4.1·4.1.2). */}
          <div className={DAYS} role="group" aria-label="반복 요일">
            {DOW.map((_, i) => {
              // DOW는 일=0..토=6. 일과 블록 요일도 같은 인덱스(일=0).
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={b.days.includes(i)}
                  aria-label={`${DOW[i]}요일`}
                  className={`${DAYCHIP}${b.days.includes(i) ? ' ' + DAYCHIP_ON : ''}`}
                  onClick={() => toggleDay(b.id, i)}
                >
                  {DOW[i]}
                </button>
              );
            })}
            <span className={DAYSEP} />
            <button type="button" className={`${DAYCHIP} ${DAYCHIP_PRESET}`} onClick={() => setDays(b.id, 'wd')}>
              평일
            </button>
            <button type="button" className={`${DAYCHIP} ${DAYCHIP_PRESET}`} onClick={() => setDays(b.id, 'we')}>
              주말
            </button>
            <button type="button" className={`${DAYCHIP} ${DAYCHIP_PRESET}`} onClick={() => setDays(b.id, 'all')}>
              매일
            </button>
          </div>
          <div className={PERDAY}>
            <button
              type="button"
              className={PERDAY_TOGGLE}
              onClick={() => togglePerDay(b.id)}
              aria-expanded={perDay.has(b.id)}
            >
              {perDay.has(b.id) ? '▾' : '▸'} 요일별 시간 다르게{b.times ? ' · 적용 중' : ''}
            </button>
            {b.times && (
              <button type="button" className={PERDAY_RESET} onClick={() => clearTimes(b.id)}>
                전 요일 공통으로
              </button>
            )}
          </div>
          {perDay.has(b.id) &&
            (b.days.length ? (
              <div className={PERDAY_GRID}>
                {b.days
                  .slice()
                  .sort((a, c) => a - c)
                  .map((d) => {
                    const t = b.times?.[String(d)];
                    return (
                      <div key={d} className={PERDAY_ROW}>
                        <span className={`text-sm leading-[1.6] font-bold ${t ? 'text-acc' : 'text-mut'}`}>
                          {DOW[d]}
                        </span>
                        <TimeSelect
                          value={t?.start ?? b.start}
                          onChange={(v) => setDayTime(b.id, d, 'start', v)}
                          label={`${DOW[d]}요일 시작`}
                        />
                        <span>~</span>
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
              <div className="ds-empty ds-tiny" style={{ padding: '8px 6px' }}>
                위에서 요일을 먼저 선택하세요.
              </div>
            ))}
        </div>
      ))}
    </>
  );
}

export function SkeletonPanel() {
  const mutate = useApp((s) => s.mutate);
  const [classDow, setClassDow] = useState(1); // 수업 편집기에서 보는 요일(일=0..토=6)

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
    <div className="flex min-w-0 flex-col gap-3 pt-3 pb-1">
      <div className="ds-rule">
        <h2>
          수업 (요일별) <span className="ds-muted ds-tiny">— 요일을 고르고 그 날 수업의 시작~끝을 직접 추가</span>
        </h2>
        {/* 편집 중인 요일 = 단일 선택. tablist 계약(화살표 이동·tabpanel)을 이행하지 않으므로
            group+aria-pressed가 정직하다(AvailRail 요일 막대와 동일 · WCAG 1.4.1 색 단독 금지). */}
        <div className="ds-seg" role="group" aria-label="수업 편집 요일">
          {DOW.map((d, i) => (
            <button
              key={d}
              type="button"
              aria-pressed={i === classDow}
              aria-label={`${d}요일`}
              className={i === classDow ? 'ds-on' : ''}
              onClick={() => setClassDow(i)}
            >
              {d}
            </button>
          ))}
        </div>
        <div className={CLS_GRID}>
          <ClassList dow={classDow} />
        </div>
        <Button sm style={{ marginTop: 8 }} onClick={() => addClass(classDow)}>
          + 수업 추가
        </Button>
        <div className="ds-foot">
          요일마다 수업 시간이 달라도 각각 지정할 수 있어요. 수업 시간은 공부 가능 시간에서 자동으로 빠집니다.
        </div>
      </div>

      <div className="ds-rule">
        <h2>
          그 밖의 일과 블록{' '}
          <span className="ds-muted ds-tiny">— 수면·식사·취미 등. 비운 시간은 자동으로 공부 가능 시간이 됩니다</span>
        </h2>
        <div className={BLK_GRID}>
          <BlockList />
        </div>
        <Button sm style={{ marginTop: 8 }} onClick={addBlock}>
          + 블록 추가
        </Button>
        <div className="ds-foot">
          수면 블록으로 깨어있는 시간을 정하면 빈 시간이 정확해져요. 블록을 지워도 그 시간은 그냥 빈 시간(공부 가능)이
          될 뿐, 학습 항목은 사라지지 않습니다.
        </div>
      </div>
    </div>
  );
}
