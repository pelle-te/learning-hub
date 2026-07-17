/* ============================================================
   DayPlanner — 배치 세그먼트 '일' 뷰(계획개편 §6). 타임블로킹 편집기.
   좌=투두 트레이(미지정 공부 블록 + 자유 할 일), 우=하루 타임라인(가용창 드롭존 + 타임박스 카드).
   드래그로 시간박기(트레이→캘린더 = start 부여), 트레이로 되돌리면 미지정 복귀. 키보드 대안 필수(§6-4).
   자동엔진은 초안 제안자 — 첫 편집에 dayPlans[ds]가 manual로 승격되고 그 위에서 사용자가 배치한다.
   (React Compiler ON — 수동 useMemo 대신 파생을 인라인해 자동 메모이제이션에 맡긴다.)
============================================================ */
import { useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { isDone } from '@/lib/persistence';
import { toHM, hLabel, parseISO, fmtShort, DOW_MON, clamp } from '@/lib/utils';
import { blocksForWeekday, freeWindowsForWeekday, dayStudyMin, studyMinByWeekday } from '@/lib/scheduler';
import {
  blocksForDay,
  untimedBlocks,
  timedBlocks,
  isManual,
  placeBlock,
  unplaceBlock,
  resizeBlock,
  togglePin,
  addOrMergeBlock,
  removeBlock,
  resetDay,
  resolveSlot,
  SNAP,
} from '@/lib/dayPlans';
import {
  untimedTasksForDay,
  timedTasksForDay,
  inboxTasks,
  addTask,
  updateTask,
  removeTask,
  toggleTaskDone,
  placeTask,
  unplaceTask,
} from '@/lib/tasks';
import { SESSION_TYPE_META as TAG } from '@/lib/scheduleView';
import { Button } from '@/components/ui';
import EmptyState from '@/components/EmptyState';
import type { AppState, ScheduleResult } from '@/lib/types';
import s from './DayPlanner.module.css';

type DragKind = 'block' | 'task';
const MIME = 'application/x-plan-item';
const COL_CLASS = 'planTimelineCol'; // 타임라인 컬럼 식별용(포인터 리사이즈 시 높이 측정).

/* HH:MM → 분. */
function toMinLocal(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
/** 자유 할일 소요(min) 갱신 — 리사이즈용(placeTask는 start만 다룸). */
function updateTaskMin(st: AppState, id: string, min: number): void {
  const t = (st.tasks || []).find((x) => x.id === id);
  if (t) t.min = min;
}

export function DayPlanner({
  ds,
  res,
  nowMin,
  todayIso,
  onNav,
}: {
  ds: string;
  res: ScheduleResult;
  nowMin: number;
  todayIso: string;
  onNav: (deltaDays: number, toToday?: boolean) => void;
}) {
  const state = useApp((st) => st.state);
  const mutate = useApp((st) => st.mutate);
  const toggleDone = useApp((st) => st.toggleDone);
  const colRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState('');
  const [inboxDraft, setInboxDraft] = useState('');
  const [repeatMode, setRepeatMode] = useState<'none' | 'daily' | 'weekly'>('none'); // +할일 반복 모드
  const [taskSid, setTaskSid] = useState(''); // +할일 과목 링크(선택)
  const [blockSid, setBlockSid] = useState(''); // +블록 대상 과목
  const [blockType, setBlockType] = useState<'new' | 'rev' | 'anki' | 'blank' | 'mock'>('new');
  const [selId, setSelId] = useState<string | null>(null); // 인라인 편집 대상 카드(시각/분 입력)

  const date = parseISO(ds);
  const wd = date.getDay();
  const isToday = ds === todayIso;
  const manual = isManual(state, ds);

  const blocks = blocksForDay(state, res, ds);
  const untimed = untimedBlocks(blocks);
  const timed = timedBlocks(blocks);
  const trayTasks = untimedTasksForDay(state, ds);
  const timedTasks = timedTasksForDay(state, ds);
  const inbox = inboxTasks(state); // '언젠가'(날짜 미정) 서랍 — 이 날로 끌어오거나 배정.

  const { wake0, wake1, windows } = freeWindowsForWeekday(state, wd);
  const routine = blocksForWeekday(state, wd).filter((b) => b.type !== '수면');
  const capMin = dayStudyMin(state, ds, wd, studyMinByWeekday(state));

  const hasSubjects = state.items.some((it) => it.name);
  const isEmpty = blocks.length === 0 && trayTasks.length === 0 && timedTasks.length === 0;

  // 타임라인 범위 — 깨어있는 창 기준 + 배치 카드/일과 포함, 30분 격자 스냅.
  const ms: number[] = [wake0, wake1];
  timed.forEach((b) => ms.push(b.start!, b.start! + b.min));
  timedTasks.forEach((t) => ms.push(t.start!, t.start! + (t.min || 30)));
  routine.forEach((b) => ms.push(toMinLocal(b.start), toMinLocal(b.end)));
  let lo = Math.floor(Math.min(...ms) / 30) * 30;
  let hi = Math.ceil(Math.max(...ms) / 30) * 30;
  if (!Number.isFinite(lo)) lo = 6 * 60;
  if (!Number.isFinite(hi)) hi = 24 * 60;
  lo = Math.max(0, lo);
  hi = Math.min(1440, hi);
  if (hi - lo < 120) hi = Math.min(1440, lo + 120);
  const span = Math.max(1, hi - lo);
  const pos = (m: number) => ((clamp(m, lo, hi) - lo) / span) * 100;
  const ticks: number[] = [];
  for (let m = Math.ceil(lo / 60) * 60; m <= hi; m += 60) ticks.push(m);

  // 배치 합계(공부 블록 + 자유 할일) vs 가용 — 초과 경고(§6-3).
  const planMin = blocks.reduce((t, b) => t + b.min, 0) + timedTasks.reduce((t, x) => t + (x.min || 0), 0);
  const over = capMin > 0 && planMin > capMin + 1;

  /* ── 드래그 시간박기 ─────────────────────────────────────────────── */
  const onDragStart = (kind: DragKind, id: string, dur: number) => (e: React.DragEvent) => {
    e.dataTransfer.setData(MIME, JSON.stringify({ kind, id, dur }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const readDrag = (e: React.DragEvent): { kind: DragKind; id: string; dur: number } | null => {
    const raw = e.dataTransfer.getData(MIME);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { kind: DragKind; id: string; dur: number };
    } catch {
      return null;
    }
  };
  // 점유 구간(고정 일과 + 타임박스 카드) — 겹침 해소용. excludeId=드래그/이동 대상은 제외(자기와 안 겹침).
  const occupiedExcept = (excludeId?: string): [number, number][] => [
    ...timed.filter((b) => b.id !== excludeId).map((b): [number, number] => [b.start!, b.start! + b.min]),
    ...timedTasks.filter((t) => t.id !== excludeId).map((t): [number, number] => [t.start!, t.start! + (t.min || 30)]),
    ...routine.map((b): [number, number] => [toMinLocal(b.start), toMinLocal(b.end)]),
  ];
  const onTimelineDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const d = readDrag(e);
    const el = colRef.current;
    if (!d || !el) return;
    const rect = el.getBoundingClientRect();
    const frac = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    const at = resolveSlot(occupiedExcept(d.id), lo + frac * span, d.dur, 1440); // §6-2 밀거나 거부
    if (at == null) {
      ui.toast('그 시간대에 빈 자리가 없어요 — 다른 시간에 놓아보세요.', 'warn');
      return;
    }
    if (d.kind === 'block') mutate((st) => placeBlock(st, res, ds, d.id, at));
    else mutate((st) => placeTask(st, d.id, ds, at));
  };
  const onTrayDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const d = readDrag(e);
    if (!d) return;
    if (d.kind === 'block') mutate((st) => unplaceBlock(st, res, ds, d.id));
    else mutate((st) => unplaceTask(st, d.id));
  };
  const allowDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(MIME)) e.preventDefault();
  };

  // 키보드 시간박기 대안(§6-4) — 트레이 항목을 첫 가용창 시작에 박되 겹침 해소로 빈칸을 찾는다.
  const placeFirstFree = (kind: DragKind, id: string, min: number) => {
    const win = windows.find((w) => w.e - w.s >= Math.min(min, SNAP)) ?? windows[0];
    const at = resolveSlot(occupiedExcept(id), win ? win.s : wake0, min, 1440);
    if (at == null) {
      ui.toast('빈 시간이 없어요 — 가용시간을 늘리거나 다른 걸 옮기세요.', 'warn');
      return;
    }
    if (kind === 'block') mutate((st) => placeBlock(st, res, ds, id, at));
    else mutate((st) => placeTask(st, id, ds, at));
    ui.toast(`${toHM(at)}에 배치`, 'ok');
  };

  // 공부 블록 수동 추가(§6-2 "+블록"/과목 칩) — 과목·유형 픽 → addOrMergeBlock(같은 sid|type 병합).
  const namedItems = state.items.filter((it) => it.name);
  const ML = state.moduleLen || 120;
  const BLOCK_MIN: Record<string, number> = {
    new: ML,
    rev: Math.max(15, Math.round(ML * 0.25)),
    anki: 20,
    blank: Math.max(30, Math.round(ML * 0.4)),
    mock: ML,
  };
  const BLOCK_TYPES = [
    { t: 'new', label: '집중' },
    { t: 'rev', label: '복습' },
    { t: 'anki', label: 'Anki' },
    { t: 'blank', label: '백지' },
    { t: 'mock', label: '모의' },
  ] as const;

  const addFreeTask = () => {
    const title = draft.trim();
    if (!title) return;
    const linked = taskSid ? namedItems.find((it) => it.id === taskSid) : undefined;
    mutate((st) =>
      addTask(st, {
        title,
        ds,
        sid: taskSid || undefined,
        color: linked?.color,
        repeat: repeatMode === 'none' ? undefined : repeatMode,
      }),
    );
    setDraft('');
  };
  const addStudyBlock = () => {
    const isMock = blockType === 'mock';
    const sid = isMock ? 'mock' : blockSid || namedItems[0]?.id;
    if (!isMock && !sid) return;
    const item = namedItems.find((it) => it.id === sid);
    const name = isMock ? '모의시험' : item?.name || '과목';
    const merged = blocksForDay(state, res, ds).some((b) => b.sid === sid && b.type === blockType);
    mutate((st) =>
      addOrMergeBlock(st, res, ds, {
        type: blockType,
        sid: sid!,
        name,
        color: isMock ? '#b794f6' : item?.color,
        min: BLOCK_MIN[blockType]!,
        chapters: [],
      }),
    );
    ui.toast(`${name} · ${BLOCK_TYPES.find((x) => x.t === blockType)!.label} 블록 ${merged ? '병합' : '추가'}`, 'ok');
  };
  const REPEAT_NEXT = { none: 'daily', daily: 'weekly', weekly: 'none' } as const;
  const REPEAT_LABEL = { none: '🔁', daily: '🔁일', weekly: '🔁주' } as const;
  const REPEAT_TITLE = {
    none: '반복 없음 — 눌러 매일',
    daily: '매일 반복 — 눌러 매주',
    weekly: '매주 반복 — 눌러 끔',
  } as const;
  const addInboxTask = () => {
    const title = inboxDraft.trim();
    if (!title) return;
    mutate((st) => addTask(st, { title })); // ds 미부여 → 인박스('언젠가')
    setInboxDraft('');
  };
  const pullToDay = (id: string) => mutate((st) => updateTask(st, id, { ds })); // 인박스 → 이 날 트레이

  const trayAdder = (
    <div className={s.addWrap}>
      <div className={s.addRow}>
        <input
          className={s.addInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addFreeTask()}
          placeholder="+ 할 일 (예: 과제 제출)"
          aria-label="자유 할 일 추가"
        />
        {namedItems.length > 0 && (
          <select
            className={s.addSel}
            value={taskSid}
            onChange={(e) => setTaskSid(e.target.value)}
            aria-label="할 일 연결 과목(선택)"
            title="연결 과목(선택) — 색·필터용"
          >
            <option value="">과목—</option>
            {namedItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={`${s.addBtn}${repeatMode !== 'none' ? ' ' + s.repeatOn : ''}`}
          onClick={() => setRepeatMode((m) => REPEAT_NEXT[m])}
          title={REPEAT_TITLE[repeatMode]}
          aria-label={`반복: ${repeatMode === 'none' ? '없음' : repeatMode === 'daily' ? '매일' : '매주'}`}
        >
          {REPEAT_LABEL[repeatMode]}
        </button>
        <button type="button" className={s.addBtn} onClick={addFreeTask} aria-label="할 일 추가">
          ＋
        </button>
      </div>
      {namedItems.length > 0 && (
        <div className={s.addRow}>
          {blockType !== 'mock' && (
            <select
              className={s.addSel}
              value={blockSid || namedItems[0]!.id}
              onChange={(e) => setBlockSid(e.target.value)}
              aria-label="공부 블록 과목"
            >
              {namedItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          )}
          <select
            className={s.addSel}
            value={blockType}
            onChange={(e) => setBlockType(e.target.value as typeof blockType)}
            aria-label="공부 블록 유형"
          >
            {BLOCK_TYPES.map((x) => (
              <option key={x.t} value={x.t}>
                {x.label}
              </option>
            ))}
          </select>
          <button type="button" className={s.addBlockBtn} onClick={addStudyBlock} title="공부 블록 추가(트레이로)">
            + 블록
          </button>
        </div>
      )}
    </div>
  );

  // 인라인 시각/분 편집(§6-2) — 타임박스 카드 클릭 시 하단 편집 바로 정밀 입력(드래그/키보드 대안).
  const selBlock = selId ? timed.find((b) => b.id === selId) : undefined;
  const selTask = selId && !selBlock ? timedTasks.find((t) => t.id === selId) : undefined;
  const selStart = selBlock ? selBlock.start! : selTask ? selTask.start! : 0;
  const selMin = selBlock ? selBlock.min : selTask ? selTask.min || 30 : 30;
  const setSelStart = (m: number) => {
    if (selBlock) mutate((st) => placeBlock(st, res, ds, selBlock.id, m));
    else if (selTask) mutate((st) => placeTask(st, selTask.id, ds, Math.round(m / SNAP) * SNAP));
  };
  const setSelMin = (m: number) => {
    const mm = Math.max(SNAP, Math.round(m / SNAP) * SNAP);
    if (selBlock) mutate((st) => resizeBlock(st, res, ds, selBlock.id, mm));
    else if (selTask) mutate((st) => updateTaskMin(st, selTask.id, mm));
  };
  const editBar = (selBlock || selTask) && (
    <div className={s.editBar}>
      <span className={s.editName}>{selBlock ? selBlock.name : selTask!.title}</span>
      <label className={s.editField}>
        시작
        <input
          type="time"
          value={toHM(selStart)}
          onChange={(e) => {
            const [h, m] = e.target.value.split(':').map(Number);
            if (Number.isFinite(h) && Number.isFinite(m)) setSelStart(h! * 60 + m!);
          }}
          aria-label="시작 시각"
        />
      </label>
      <label className={s.editField}>
        길이
        <input
          type="number"
          min={15}
          step={15}
          value={selMin}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setSelMin(n);
          }}
          aria-label="길이(분)"
        />
        분
      </label>
      <Button sm variant="ghost" onClick={() => setSelId(null)}>
        닫기
      </Button>
    </div>
  );

  return (
    <section className={s.wrap} aria-label={`${DOW_MON[(wd + 6) % 7]} 일일 계획`}>
      <div className={s.head}>
        <div className={s.dnav}>
          <Button sm onClick={() => onNav(-1)} aria-label="이전 날">
            ◀
          </Button>
          <div className={s.dlabel}>
            <b>{fmtShort(date)}</b>
            <span className={s.dow}>
              {DOW_MON[(wd + 6) % 7]}요일{isToday && ' · 오늘'}
            </span>
          </div>
          <Button sm onClick={() => onNav(1)} aria-label="다음 날">
            ▶
          </Button>
          {!isToday && (
            <Button sm variant="ghost" onClick={() => onNav(0, true)}>
              오늘
            </Button>
          )}
        </div>
        <div className={s.headRight}>
          <span className={`${s.mode}${manual ? ' ' + s.modeManual : ''}`}>{manual ? '내 계획' : '자동초안'}</span>
          <span className={`${s.cap}${over ? ' ' + s.over : ''}`}>
            {hLabel(planMin)}
            {capMin > 0 && <span className={s.capMut}> / 가용 {hLabel(capMin)}</span>}
          </span>
          {manual && (
            <Button sm variant="ghost" onClick={() => mutate((st) => resetDay(st, ds))} title="자동 배치로 되돌리기">
              ↺ 다시 자동으로
            </Button>
          )}
        </div>
      </div>

      {isEmpty && !hasSubjects ? (
        <EmptyState
          glyph="🗓"
          title="오늘 계획이 비어 있어요"
          desc={<>학습 항목을 추가하면 자동초안이 깔리고, 자유 할 일은 아래에서 바로 추가할 수 있어요.</>}
          actions={trayAdder}
        />
      ) : (
        <>
          <div className={s.grid2}>
            {/* ── 좌: 투두 트레이 ── */}
            <div className={s.tray} onDragOver={allowDrop} onDrop={onTrayDrop} aria-label="미지정 트레이">
              <div className={s.trayHead}>미지정 · 끌어서 시간박기</div>
              {trayAdder}
              <div className={s.trayList}>
                {untimed.length === 0 && trayTasks.length === 0 && (
                  <div className={s.trayEmpty}>모두 시간박기 완료 🎉</div>
                )}
                {untimed.map((b) => (
                  <TrayRow
                    key={b.id}
                    title={b.name}
                    meta={TAG[b.type].label}
                    color={b.color}
                    min={b.min}
                    done={isDone(state, ds, b.sid, b.type)}
                    onToggle={(on) => toggleDone(ds, b.sid, b.type, b.min, on)}
                    onPlace={() => placeFirstFree('block', b.id, b.min)}
                    onDelete={manual ? () => mutate((st) => removeBlock(st, ds, b.id)) : undefined}
                    onDragStart={onDragStart('block', b.id, b.min)}
                  />
                ))}
                {trayTasks.map((t) => (
                  <TrayRow
                    key={t.id}
                    title={t.title}
                    meta="할 일"
                    color={t.color}
                    min={t.min}
                    free
                    repeat={t.repeat}
                    done={!!t.done}
                    onToggle={(on) => mutate((st) => toggleTaskDone(st, t.id, on))}
                    onPlace={() => placeFirstFree('task', t.id, t.min || 30)}
                    onDelete={() => mutate((st) => removeTask(st, t.id))}
                    onDragStart={onDragStart('task', t.id, t.min || 30)}
                  />
                ))}
              </div>

              {/* 언젠가(인박스) 서랍 — 날짜 미정 할 일. 이 날로 끌어오거나 배정. */}
              <details className={s.inbox} open={inbox.length > 0}>
                <summary className={s.inboxHead}>언젠가 {inbox.length > 0 && <b>{inbox.length}</b>}</summary>
                <div className={s.addRow}>
                  <input
                    className={s.addInput}
                    value={inboxDraft}
                    onChange={(e) => setInboxDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addInboxTask()}
                    placeholder="+ 날짜 미정 할 일"
                    aria-label="언젠가 할 일 추가"
                  />
                  <button type="button" className={s.addBtn} onClick={addInboxTask} aria-label="언젠가 할 일 추가">
                    ＋
                  </button>
                </div>
                <div className={s.inboxList}>
                  {inbox.map((t) => (
                    <div
                      key={t.id}
                      className={s.trayRow}
                      draggable
                      onDragStart={onDragStart('task', t.id, t.min || 30)}
                      style={t.color ? ({ ['--seg']: t.color } as React.CSSProperties) : undefined}
                    >
                      <span className={s.grabDot} aria-hidden="true" />
                      <span className={s.rowName}>{t.title}</span>
                      <button
                        type="button"
                        className={s.tool}
                        onClick={() => pullToDay(t.id)}
                        title="이 날로 가져오기"
                        aria-label={`${t.title} 이 날로 가져오기`}
                      >
                        ↙
                      </button>
                      <button
                        type="button"
                        className={s.tool}
                        onClick={() => mutate((st) => removeTask(st, t.id))}
                        title="삭제"
                        aria-label={`${t.title} 삭제`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            </div>

            {/* ── 우: 하루 타임라인 ── */}
            <div className={s.timeline}>
              <div className={s.gutter}>
                {ticks.map((m) => (
                  <span key={m} className={s.tick} style={{ top: `${pos(m)}%` }}>
                    {toHM(m)}
                  </span>
                ))}
              </div>
              <div
                ref={colRef}
                className={`${s.col} ${COL_CLASS}`}
                onDragOver={allowDrop}
                onDrop={onTimelineDrop}
                aria-label="타임라인 — 여기로 끌어 시간박기"
              >
                {ticks.map((m) => (
                  <span key={m} className={s.grid} style={{ top: `${pos(m)}%` }} />
                ))}
                {windows.map((w, i) => (
                  <span
                    key={i}
                    className={s.win}
                    style={{ top: `${pos(w.s)}%`, height: `${Math.max(0, pos(w.e) - pos(w.s))}%` }}
                    aria-hidden="true"
                  />
                ))}
                {routine.map((b, i) => {
                  const bs = toMinLocal(b.start);
                  const be = toMinLocal(b.end);
                  if (be <= lo || bs >= hi || be <= bs) return null;
                  return (
                    <div
                      key={i}
                      className={s.occ}
                      style={{ top: `${pos(bs)}%`, height: `${Math.max(1.6, pos(be) - pos(bs))}%` }}
                    >
                      <span className={s.occName}>{b.name}</span>
                    </div>
                  );
                })}
                {timed.map((b) => (
                  <TimedCard
                    key={b.id}
                    kind="block"
                    title={b.name}
                    meta={TAG[b.type].label}
                    color={b.color}
                    start={b.start!}
                    min={b.min}
                    spanMin={span}
                    pinned={b.pinned}
                    done={isDone(state, ds, b.sid, b.type)}
                    pos={pos}
                    selected={selId === b.id}
                    onSelect={() => setSelId((v) => (v === b.id ? null : b.id))}
                    onDragStart={onDragStart('block', b.id, b.min)}
                    onMove={(delta) => mutate((st) => placeBlock(st, res, ds, b.id, b.start! + delta))}
                    onSetMin={(m) => mutate((st) => resizeBlock(st, res, ds, b.id, m))}
                    onUnplace={() => mutate((st) => unplaceBlock(st, res, ds, b.id))}
                    onPin={() => mutate((st) => togglePin(st, res, ds, b.id))}
                    onToggle={(on) => toggleDone(ds, b.sid, b.type, b.min, on)}
                    onDelete={manual ? () => mutate((st) => removeBlock(st, ds, b.id)) : undefined}
                  />
                ))}
                {timedTasks.map((t) => (
                  <TimedCard
                    key={t.id}
                    kind="task"
                    title={t.title}
                    meta="할 일"
                    color={t.color}
                    start={t.start!}
                    min={t.min || 30}
                    spanMin={span}
                    done={!!t.done}
                    pos={pos}
                    selected={selId === t.id}
                    onSelect={() => setSelId((v) => (v === t.id ? null : t.id))}
                    onDragStart={onDragStart('task', t.id, t.min || 30)}
                    onMove={(delta) => mutate((st) => placeTask(st, t.id, ds, (t.start || 0) + delta))}
                    onSetMin={(m) => mutate((st) => updateTaskMin(st, t.id, Math.max(SNAP, m)))}
                    onUnplace={() => mutate((st) => unplaceTask(st, t.id))}
                    onToggle={(on) => mutate((st) => toggleTaskDone(st, t.id, on))}
                    onDelete={() => mutate((st) => removeTask(st, t.id))}
                  />
                ))}
                {isToday && nowMin >= lo && nowMin <= hi && (
                  <span className={s.now} style={{ top: `${pos(nowMin)}%` }} aria-hidden="true">
                    <span className={s.nowCap}>{toHM(nowMin)}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          {editBar}
        </>
      )}
    </section>
  );
}

/* ── 트레이 한 줄 ────────────────────────────────────────────────────── */
function TrayRow({
  title,
  meta,
  color,
  min,
  free,
  repeat,
  done,
  onToggle,
  onPlace,
  onDelete,
  onDragStart,
}: {
  title: string;
  meta: string;
  color?: string;
  min?: number;
  free?: boolean;
  repeat?: 'daily' | 'weekly';
  done: boolean;
  onToggle: (on: boolean) => void;
  onPlace: () => void;
  onDelete?: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={`${s.trayRow}${done ? ' ' + s.rowDone : ''}${free ? ' ' + s.rowFree : ''}`}
      draggable
      onDragStart={onDragStart}
      style={color ? ({ ['--seg']: color } as React.CSSProperties) : undefined}
    >
      <input
        type="checkbox"
        className={s.chk}
        checked={done}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={`${title} 완료`}
      />
      <span className={s.grabDot} aria-hidden="true" />
      <span className={s.rowName}>{title}</span>
      <span className={s.rowMeta}>
        {repeat && <span title={repeat === 'daily' ? '매일 반복' : '매주 반복'}>🔁 </span>}
        {meta}
        {min ? ` · ${hLabel(min)}` : ''}
      </span>
      <button
        type="button"
        className={s.tool}
        onClick={onPlace}
        title="첫 빈 시간에 배치"
        aria-label={`${title} 시간박기`}
      >
        ⤵
      </button>
      {onDelete && (
        <button type="button" className={s.tool} onClick={onDelete} title="삭제" aria-label={`${title} 삭제`}>
          ✕
        </button>
      )}
    </div>
  );
}

/* ── 타임박스 카드(캘린더) ──────────────────────────────────────────────
   드래그로 이동, Alt+↑↓ 시간(±15), Alt+Shift+↑↓ 길이(±15), 하단 핸들 포인터 리사이즈,
   툴바로 완료·핀·트레이·삭제(§6-4 키보드 대안). */
function TimedCard({
  kind,
  title,
  meta,
  color,
  start,
  min,
  spanMin,
  pinned,
  done,
  selected,
  pos,
  onSelect,
  onDragStart,
  onMove,
  onSetMin,
  onUnplace,
  onPin,
  onToggle,
  onDelete,
}: {
  kind: DragKind;
  title: string;
  meta: string;
  color?: string;
  start: number;
  min: number;
  spanMin: number;
  pinned?: boolean;
  done: boolean;
  selected?: boolean;
  pos: (m: number) => number;
  onSelect?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onMove: (delta: number) => void;
  onSetMin: (min: number) => void;
  onUnplace: () => void;
  onPin?: () => void;
  onToggle: (on: boolean) => void;
  onDelete?: () => void;
}) {
  const top = pos(start);
  const height = Math.max(3, pos(start + min) - top);
  const compact = min < 45;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (e.shiftKey) onSetMin(min - SNAP);
      else onMove(-SNAP);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (e.shiftKey) onSetMin(min + SNAP);
      else onMove(SNAP);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      onUnplace();
    }
  };

  // 포인터 리사이즈 — 하단 핸들에서 아래로 끌면 길이 증가. col 높이로 px→분 환산(spanMin 기준).
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const col = (e.currentTarget as HTMLElement).closest('.' + COL_CLASS) as HTMLElement | null;
    const colH = col?.getBoundingClientRect().height ?? 0;
    if (!colH) return;
    const pxPerMin = colH / spanMin;
    const y0 = e.clientY;
    const min0 = min;
    const onMoveP = (ev: PointerEvent) => {
      const nm = Math.round((min0 + (ev.clientY - y0) / pxPerMin) / SNAP) * SNAP;
      onSetMin(Math.max(SNAP, nm));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMoveP);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMoveP);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={`${s.card} ${kind === 'task' ? s.cardTask : s.cardStudy}${done ? ' ' + s.cardDone : ''}${compact ? ' ' + s.compact : ''}${selected ? ' ' + s.cardSel : ''}`}
      style={{ top: `${top}%`, height: `${height}%`, ...(color ? ({ ['--seg']: color } as React.CSSProperties) : {}) }}
      draggable
      onDragStart={onDragStart}
      onClick={() => onSelect?.()}
      tabIndex={0}
      role="group"
      aria-pressed={selected}
      onKeyDown={onKeyDown}
      aria-label={`${title} · ${meta} ${toHM(start)}–${toHM(start + min)}. 클릭=시각/분 편집, Alt+화살표로 이동, Alt+Shift로 길이.`}
      data-tip={`${title}\n${meta} · ${toHM(start)}–${toHM(start + min)}`}
    >
      <div className={s.cardMain}>
        <span className={s.cardName}>
          {pinned && '📌 '}
          {title}
        </span>
        {!compact && (
          <span className={s.cardMeta}>
            {meta} · {toHM(start)}–{toHM(start + min)}
          </span>
        )}
      </div>
      <div className={s.cardTools} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={s.tool} onClick={() => onToggle(!done)} title="완료" aria-label="완료 토글">
          {done ? '↺' : '✓'}
        </button>
        {onPin && (
          <button
            type="button"
            className={`${s.tool}${pinned ? ' ' + s.toolOn : ''}`}
            onClick={onPin}
            title="핀(재초안에서 보존)"
            aria-label="핀 토글"
            aria-pressed={!!pinned}
          >
            📌
          </button>
        )}
        <button
          type="button"
          className={s.tool}
          onClick={onUnplace}
          title="트레이로(미지정)"
          aria-label="트레이로 되돌리기"
        >
          ⤴
        </button>
        {onDelete && (
          <button type="button" className={s.tool} onClick={onDelete} title="삭제" aria-label="삭제">
            ✕
          </button>
        )}
      </div>
      <span className={s.resizeHandle} onPointerDown={startResize} aria-hidden="true" />
    </div>
  );
}
