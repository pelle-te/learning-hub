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
import { toHM, hLabel, parseISO, DOW_MON, clamp } from '@/lib/utils';
import {
  blocksForWeekday,
  freeWindowsForDay,
  dayStudyMin,
  studyMinByWeekday,
  eventStudyLossMin,
} from '@/lib/scheduler';
import { addEvent, updateEvent, removeEvent, eventsForDay } from '@/lib/events';
import {
  blocksForDay,
  untimedBlocks,
  timedBlocks,
  isManual,
  placeBlock,
  unplaceBlock,
  resizeBlock,
  togglePin,
  addBlock,
  setBlockDone,
  removeBlock,
  resetDay,
  resolveSlot,
  snap as snapMin,
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
import type { AppState, ScheduleResult } from '@/lib/types';
import s from './DayPlanner.module.css';

type DragKind = 'block' | 'task';
const MIME = 'application/x-plan-item';
const COL_CLASS = 'planTimelineCol'; // 타임라인 컬럼 식별용(포인터 리사이즈 시 높이 측정).
const EDIT_BAR_ID = 'dayPlannerEditBar'; // 카드 안 편집 버튼이 aria-controls로 가리키는 편집 바(동시 1개).
const EV_FORM_ID = 'dayPlannerEventForm'; // '+ 일정'이 aria-controls로 가리키는 온디맨드 컴포저.
/** 일정 길이 프리셋 — 자유 입력 대신 셀렉트로 받는다(340px 트레이에서 숫자 입력 하나를 더 끼우면 제목이 뭉개진다).
 *  세밀 조정은 추가 후 편집 바(분 단위)에서 한다 — 추가는 빠르게, 정밀은 온디맨드. */
const EVENT_MINS = [30, 60, 90, 120, 180, 240] as const;

/* HH:MM → 분. */
function toMinLocal(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
/* 타임라인 시간↔픽셀 환산 SSOT — 트랙 전체가 span(분)이고 그 안의 '비율'이 곧 좌표다.
   전엔 같은 변환이 두 표현으로 갈라져 있었다(부모 pos()=%, TimedCard 리사이즈=pxPerMin) —
   한쪽만 고치면 조용히 어긋나는 형태라 비율 하나로 모은다. */
const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
/** 분 길이 → 트랙 높이 %(눈금·카드 top/height). */
const minToPct = (min: number, spanMin: number) => ratio(min, spanMin) * 100;
/** 드래그 픽셀 → 분(리사이즈). colH=타임라인 컬럼 높이(px). */
const pxToMin = (px: number, colH: number, spanMin: number) => ratio(px, colH) * spanMin;

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
}: {
  ds: string;
  res: ScheduleResult;
  nowMin: number;
  todayIso: string;
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
  // 일정(약속·시험·행사) 컴포저 — 평소엔 접혀 있고 '+ 일정'을 눌러야 펼쳐진다(온디맨드 세부).
  const [evOpen, setEvOpen] = useState(false);
  const [evTitle, setEvTitle] = useState('');
  const [evStart, setEvStart] = useState('09:00');
  const [evMin, setEvMin] = useState<number>(60);

  const date = parseISO(ds);
  const wd = date.getDay();
  const isToday = ds === todayIso;
  const manual = isManual(state, ds);

  const blocks = blocksForDay(state, res, ds);
  const untimed = untimedBlocks(blocks);
  const timed = timedBlocks(blocks);

  // 공부 블록 완료 — 수동 날은 블록별(setBlockDone: block.done + sid|type 집계 미러링),
  // 자동(미승격) 날은 sid|type 단일 블록이라 종전 completions 경로 그대로(가벼운 체크, 승격 강제 안 함).
  const blockDone = (b: {
    id: string;
    sid: string;
    type: 'anki' | 'new' | 'rev' | 'blank' | 'mock';
    done?: boolean;
  }) => (manual ? !!b.done : isDone(state, ds, b.sid, b.type));
  const toggleBlock = (
    b: { id: string; sid: string; type: 'anki' | 'new' | 'rev' | 'blank' | 'mock'; min: number },
    on: boolean,
  ) => {
    if (manual) mutate((st) => setBlockDone(st, ds, b.id, on, todayIso));
    else toggleDone(ds, b.sid, b.type, b.min, on);
  };
  const trayTasks = untimedTasksForDay(state, ds);
  const timedTasks = timedTasksForDay(state, ds);
  const inbox = inboxTasks(state); // '언젠가'(날짜 미정) 서랍 — 이 날로 끌어오거나 배정.

  // 일정(events)은 **가용을 깎는다** → 요일 창이 아니라 '그 날' 창을 써야 드롭존이 일정만큼 줄어든다.
  // (freeWindowsForWeekday를 쓰던 시절엔 3시에 약속이 있어도 그 자리에 공부 블록을 놓을 수 있었다.)
  const { wake0, wake1, windows } = freeWindowsForDay(state, ds, wd);
  const events = eventsForDay(state, ds);
  const routine = blocksForWeekday(state, wd).filter((b) => b.type !== '수면');
  const capMin = dayStudyMin(state, ds, wd, studyMinByWeekday(state));

  const hasSubjects = state.items.some((it) => it.name);
  const isEmpty = blocks.length === 0 && trayTasks.length === 0 && timedTasks.length === 0;

  // 과목 색은 저장값이 아니라 PALETTE 파생(DS §3 · 절대규칙 3) — 블록에 굳어 있는 color는 무시하고
  // 렌더 시 items에서 다시 끌어온다. 덕분에 과거에 저장된 임의 색(구 모의 블록의 보라 리터럴 등)도
  // 마이그레이션 없이 자동으로 사라지고, PALETTE 한 줄 교체가 이 뷰에도 그대로 반영된다.
  // sid를 못 찾으면(모의=sid 'mock') undefined → CSS 타입 폴백(.mock)이 색을 준다.
  const segColor = (sid: string) => state.items.find((it) => it.id === sid)?.color;

  // 왜 비었는가 — "다 배치됐다"와 "애초에 할 게 없다"는 다른 상태라, 후자를 '완료'로 축하하면 거짓말이 된다.
  // 다만 이걸로 화면을 덮진 않는다(사용자 지적) — 트레이 안 **한 줄 힌트**로만 원인을 짚는다.
  // 분기는 손댈 수 있는 것 위주로 3개만: 과목 없음 / 가용 0 / 그 외. 더 쪼개면 과설계다.
  const emptyHint = !isEmpty
    ? ''
    : !hasSubjects
      ? '과목을 추가하면 자동초안이 깔려요.'
      : capMin <= 0
        ? '이 날은 가용 학습시간이 0h예요 — 설정에서 늘리거나 아래에서 직접 추가하세요.'
        : '자동초안이 이 날엔 배분한 게 없어요 — 아래에서 직접 넣을 수 있어요.';

  // 타임라인 범위 — **깨어있는 창(wake0~wake1) 전체**.
  // 옛 방식은 '일정 있는 구간 ±1h'로 좁혔다. 이유는 "창 전체를 그리면 빈 구간 때문에 일정이 납작해진다"였는데,
  // 시간 행이 프레임을 채우도록 신축하면서 그 우려가 사라졌다. 반대로 좁은 범위는 실제 버그를 냈다 —
  // 일정이 하나도 없는 날엔 폴백이 `wake0 + 8h`라 07시 기상이면 **07:00–15:00만** 그렸다(사용자 지적).
  // 수면 블록은 창 산정에서 빠져 있다(넣으면 lo가 0시로 끌려간다).
  const ms: number[] = [];
  timed.forEach((b) => ms.push(b.start!, b.start! + b.min));
  timedTasks.forEach((t) => ms.push(t.start!, t.start! + (t.min || 30)));
  events.forEach((e) => ms.push(e.start, e.start + e.min)); // 새벽 일정도 화면 밖으로 잘리지 않게 union
  routine.forEach((b) => {
    if (b.type === '수면') return;
    ms.push(toMinLocal(b.start), toMinLocal(b.end));
  });
  // 창 **밖**의 일정(새벽 블록 등)은 union해 잘리지 않게 한다 — 안 그러면 화면 밖으로 사라진다.
  const lo = clamp(Math.floor(Math.min(wake0, ...ms) / 60) * 60, 0, 1440);
  const hiRaw = clamp(Math.ceil(Math.max(wake1, ...ms) / 60) * 60, 0, 1440);
  const hi = hiRaw > lo ? hiRaw : Math.min(1440, lo + 60); // 창이 비정상(0폭)이어도 최소 1시간
  const span = Math.max(1, hi - lo);
  const pos = (m: number) => minToPct(clamp(m, lo, hi) - lo, span);
  const ticks: number[] = [];
  for (let m = Math.ceil(lo / 60) * 60; m <= hi; m += 60) ticks.push(m);

  // 배치 합계(공부 블록 + 자유 할일) vs 가용 — 초과 경고(§6-3).
  const planMin = blocks.reduce((t, b) => t + b.min, 0) + timedTasks.reduce((t, x) => t + (x.min || 0), 0);
  const over = capMin > 0 && planMin > capMin + 1;
  // 초과의 '원인'까지 그 자리에서 — 일정이 가용을 깎아 초과가 났다면 얼마나 깎였는지 칩 툴팁에 덧붙인다
  // (일정 없는 날엔 scheduler가 창 계산 자체를 생략하므로 0). 별도 경고를 새로 만들진 않는다.
  const evLoss = eventStudyLossMin(state, ds, wd);

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
    // 일정도 점유다 — 드롭/⤵ 배치가 약속 시간을 비껴가게 한다(가용창 차감과 같은 사실을 상호작용에서도).
    ...events.map((e): [number, number] => [e.start, e.start + e.min]),
  ];
  // 일정 ↔ 카드 겹침 — 드롭·⤵는 일정을 점유로 보고 피하지만, 편집 바에서 시각을 직접 고치면 겹칠 수 있다.
  // 그때 서로 가리지 않게 **반폭 2레인**으로 쪼갠다(일정=왼쪽, 겹친 카드=오른쪽). 겹치지 않으면 둘 다 전폭이라
  // 평상시 레이아웃은 그대로다 — packLanes(주간 캘린더)처럼 일반 N레인까지 갈 필요가 없는 예외 경로다.
  const overlaps = (rs: [number, number][], s: number, m: number) => rs.some(([a, b]) => s < b && a < s + m);
  const evRanges = events.map((e): [number, number] => [e.start, e.start + e.min]);
  const cardRanges: [number, number][] = [
    ...timed.map((b): [number, number] => [b.start!, b.start! + b.min]),
    ...timedTasks.map((t): [number, number] => [t.start!, t.start! + (t.min || 30)]),
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

  // 공부 블록 수동 추가(§6-2 "+블록"/과목 칩) — 누를 때마다 별도 블록(같은 과목이어도 병합 안 함).
  // 완료는 블록별(setBlockDone)이라 같은 sid|type 여러 블록을 독립 체크할 수 있다.
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
    mutate((st) =>
      addBlock(st, res, ds, {
        type: blockType,
        sid: sid!,
        name,
        // 색은 저장하지 않는다 — 과목 색은 PALETTE 파생이라 렌더에서 segColor(sid)로 다시 뽑고,
        // 모의처럼 과목이 없는 블록은 CSS 타입 폴백(.mock)이 칠한다(색 리터럴을 상태에 굳히지 않는다).
        min: BLOCK_MIN[blockType]!,
        chapters: [],
      }),
    );
    ui.toast(`${name} · ${BLOCK_TYPES.find((x) => x.t === blockType)!.label} 블록 추가`, 'ok');
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

  // 일정 추가(약속·시험·행사) — 할 일과 달리 **시각이 필수**다(시각이 없으면 그건 그냥 할 일이다).
  // 그래서 트레이(미지정)를 거치지 않고 곧장 타임라인에 꽂힌다.
  const addEventNow = () => {
    const title = evTitle.trim();
    if (!title) return;
    mutate((st) => addEvent(st, { ds, title, start: toMinLocal(evStart), min: evMin }));
    setEvTitle('');
    ui.toast(`${evStart} · ${title} 일정 추가`, 'ok');
  };

  const trayAdder = (
    <div className={s.addWrap}>
      <div className={s.addRowTask}>
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
        </div>
      )}
      {/* 액션 줄 — 전엔 '+ 블록'이 위 격자의 둘째 줄을 전폭으로 먹었다. 같은 자리를 2열로 쪼개
          '+ 일정'을 나란히 두면 **줄 수가 늘지 않는다**(340px 트레이에 셋째 줄을 새로 만들지 않는 이유).
          과목이 없는 날은 '+ 일정'만 남아 전폭이 된다 — 일정은 과목과 무관하므로 과목 없이도 추가돼야 한다. */}
      <div className={s.addRowBtns}>
        {namedItems.length > 0 && (
          <button type="button" className={s.addBlockBtn} onClick={addStudyBlock} title="공부 블록 추가(트레이로)">
            + 블록
          </button>
        )}
        <button
          type="button"
          className={`${s.addBlockBtn}${evOpen ? ' ' + s.addBtnOn : ''}`}
          onClick={() => setEvOpen((v) => !v)}
          title="일정 추가(약속·시험·행사) — 과목과 무관한 단발 사건"
          aria-expanded={evOpen}
          aria-controls={evOpen ? EV_FORM_ID : undefined}
        >
          + 일정
        </button>
      </div>
      {/* 온디맨드 세부 — 시각·길이는 일정을 실제로 만들 때만 필요한 정보라 평소엔 숨긴다. */}
      {evOpen && (
        <div className={s.evForm} id={EV_FORM_ID}>
          <input
            className={s.addInput}
            value={evTitle}
            onChange={(e) => setEvTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEventNow()}
            placeholder="일정 (예: 병원 예약)"
            aria-label="일정 제목"
          />
          <div className={s.evFormRow}>
            <input
              type="time"
              className={s.evTime}
              value={evStart}
              onChange={(e) => e.target.value && setEvStart(e.target.value)}
              aria-label="일정 시작 시각"
            />
            <select
              className={s.addSel}
              value={evMin}
              onChange={(e) => setEvMin(Number(e.target.value))}
              aria-label="일정 길이"
            >
              {EVENT_MINS.map((m) => (
                <option key={m} value={m}>
                  {hLabel(m)}
                </option>
              ))}
            </select>
            <button type="button" className={s.addBtn} onClick={addEventNow} aria-label="일정 추가">
              ＋
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // 인라인 시각/분 편집(§6-2) — 타임박스 카드 클릭 시 하단 편집 바로 정밀 입력(드래그/키보드 대안).
  const selBlock = selId ? timed.find((b) => b.id === selId) : undefined;
  const selTask = selId && !selBlock ? timedTasks.find((t) => t.id === selId) : undefined;
  // 일정도 같은 편집 바를 쓴다 — 드래그를 안 붙였으니(§6-4 부담 회피) **여기가 유일한 시각/길이 편집 경로**다.
  const selEvent = selId && !selBlock && !selTask ? events.find((e) => e.id === selId) : undefined;
  const selStart = selBlock ? selBlock.start! : selTask ? selTask.start! : selEvent ? selEvent.start : 0;
  const selMin = selBlock ? selBlock.min : selTask ? selTask.min || 30 : selEvent ? selEvent.min : 30;
  const setSelStart = (m: number) => {
    if (selBlock) mutate((st) => placeBlock(st, res, ds, selBlock.id, m));
    else if (selTask) mutate((st) => placeTask(st, selTask.id, ds, Math.round(m / SNAP) * SNAP));
    // 일정은 SNAP(15분) 격자에 묶지 않는다 — 09:50 진료처럼 격자에 안 맞는 사건이 실제로 있다.
    else if (selEvent) mutate((st) => updateEvent(st, selEvent.id, { start: m }));
  };
  const setSelMin = (m: number) => {
    if (selEvent) {
      mutate((st) => updateEvent(st, selEvent.id, { min: Math.max(5, Math.round(m)) }));
      return;
    }
    const mm = Math.max(SNAP, Math.round(m / SNAP) * SNAP);
    if (selBlock) mutate((st) => resizeBlock(st, res, ds, selBlock.id, mm));
    else if (selTask) mutate((st) => updateTaskMin(st, selTask.id, mm));
  };
  const editBar = (selBlock || selTask || selEvent) && (
    <div className={s.editBar} id={EDIT_BAR_ID}>
      {selEvent ? (
        // 일정만 제목을 여기서 고친다(공부 블록=과목 파생, 할 일=트레이에서 다룸). 오타 수정 경로.
        <input
          className={s.editTitle}
          value={selEvent.title}
          onChange={(e) => mutate((st) => updateEvent(st, selEvent.id, { title: e.target.value }))}
          aria-label="일정 제목"
        />
      ) : (
        <span className={s.editName}>{selBlock ? selBlock.name : selTask!.title}</span>
      )}
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
      {/* 날짜 이동은 공통 nav(Schedule)가 소유 — 주·월과 같은 자리. 여긴 그 날의 상태만. */}
      <div className={s.head}>
        <div className={s.headRight}>
          <span className={`${s.mode}${manual ? ' ' + s.modeManual : ''}`}>{manual ? '내 계획' : '자동초안'}</span>
          {/* 계획/가용 숫자 자체는 상단 크롬 리드아웃이 정본 — 여기 다시 찍으면 같은 수가 두 번 보인다.
              대신 리드아웃에 없는 '초과' 경보만 남긴다(초과량은 여기서만 알 수 있는 정보). */}
          {over && (
            <span
              className={s.over}
              title={`계획 ${hLabel(planMin)} · 가용 ${hLabel(capMin)}${evLoss > 0 ? ` (일정 ${hLabel(evLoss)} 반영)` : ''}`}
            >
              가용 초과 +{hLabel(planMin - capMin)}
            </span>
          )}
          {manual && (
            <Button sm variant="ghost" onClick={() => mutate((st) => resetDay(st, ds))} title="자동 배치로 되돌리기">
              ↺ 다시 자동으로
            </Button>
          )}
        </div>
      </div>

      {/* 레이아웃(좌=트레이 · 우=타임라인)은 **항상** 띄운다.
          한때 비면 EmptyState로 화면을 통째로 갈아끼웠는데, "그냥 원래 하던것 처럼 왼쪽 블럭에
          오른쪽 일일 시간 뜨게 하면 될것 같은데 굳이 이렇게 할 필요 없어 보여"라는 지적을 받고 되돌렸다.
          '왜 비었는지'는 화면을 덮지 않고 트레이 안 한 줄 힌트(emptyHint)로 내렸다. */}
      <div className={s.grid2}>
        {/* ── 좌: 투두 트레이 ── */}
        {/* role 없는 div의 aria-label은 AT가 버린다(generic은 name-from-author 불허) →
                이름을 가질 수 있는 role="group"을 준다. 랜드마크(region)까지는 과하다(탭 안의 한 구획). */}
        <div className={s.tray} onDragOver={allowDrop} onDrop={onTrayDrop} role="group" aria-label="미지정 트레이">
          <div className={s.trayHead}>미지정 · 끌어서 시간박기</div>
          {trayAdder}
          <div className={s.trayList}>
            {untimed.length === 0 &&
              trayTasks.length === 0 &&
              /* 트레이가 빈 이유는 둘인데 전엔 둘 다 "완료 🎉"였다 — 계획할 게 없어서 빈 것을
                     다 해냈다고 축하하면 거짓말이다. 실제로 배치된 게 있을 때만 축하한다.
                     (여기 남는 '계획할 게 없다' 경로는 인박스만 있는 날 — 그땐 갈 곳을 가리킨다.) */
              (timed.length + timedTasks.length > 0 ? (
                <div className={s.trayEmpty}>모두 시간박기 완료 🎉</div>
              ) : (
                <div className={s.trayEmpty}>
                  이 날엔 계획할 항목이 없어요.
                  {emptyHint && (
                    <>
                      <br />
                      {emptyHint}
                    </>
                  )}
                </div>
              ))}
            {untimed.map((b) => (
              <TrayRow
                key={b.id}
                title={b.name}
                meta={TAG[b.type].label}
                color={segColor(b.sid)}
                mock={b.type === 'mock'}
                min={b.min}
                done={blockDone(b)}
                onToggle={(on) => toggleBlock(b, on)}
                onSetMin={manual ? (m) => mutate((st) => resizeBlock(st, res, ds, b.id, m)) : undefined}
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
                min={t.min ?? 30}
                free
                repeat={t.repeat}
                done={!!t.done}
                onToggle={(on) => mutate((st) => toggleTaskDone(st, t.id, on))}
                onSetMin={(m) => mutate((st) => updateTaskMin(st, t.id, Math.max(SNAP, m)))}
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
            role="group"
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
            {/* 일정 — 공부 블록·할 일과 **다른 종류의 것**이라 카드가 아니라 밴드로 그린다:
                과목색(PALETTE)이 아닌 의미론 토큰(--event), 완료 체크·핀·트레이 되돌리기 없음,
                드래그 없음(→ 키보드 대안 부담도 없음 · 시각은 편집 바에서 고친다). */}
            {events.map((e) => (
              <EventBand
                key={e.id}
                title={e.title}
                start={e.start}
                min={e.min}
                pos={pos}
                half={overlaps(cardRanges, e.start, e.min)}
                selected={selId === e.id}
                onSelect={() => setSelId((v) => (v === e.id ? null : e.id))}
                onDelete={() => mutate((st) => removeEvent(st, e.id))}
              />
            ))}
            {timed.map((b) => (
              <TimedCard
                key={b.id}
                kind="block"
                half={overlaps(evRanges, b.start!, b.min)}
                title={b.name}
                meta={TAG[b.type].label}
                color={segColor(b.sid)}
                mock={b.type === 'mock'}
                start={b.start!}
                min={b.min}
                spanMin={span}
                pinned={b.pinned}
                done={blockDone(b)}
                pos={pos}
                selected={selId === b.id}
                onSelect={() => setSelId((v) => (v === b.id ? null : b.id))}
                onDragStart={onDragStart('block', b.id, b.min)}
                onMove={(delta) => mutate((st) => placeBlock(st, res, ds, b.id, b.start! + delta))}
                onSetMin={(m) => mutate((st) => resizeBlock(st, res, ds, b.id, m))}
                onUnplace={() => mutate((st) => unplaceBlock(st, res, ds, b.id))}
                onPin={() => mutate((st) => togglePin(st, res, ds, b.id))}
                onToggle={(on) => toggleBlock(b, on)}
                onDelete={manual ? () => mutate((st) => removeBlock(st, ds, b.id)) : undefined}
              />
            ))}
            {timedTasks.map((t) => (
              <TimedCard
                key={t.id}
                kind="task"
                half={overlaps(evRanges, t.start!, t.min || 30)}
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
    </section>
  );
}

/* ── 트레이 한 줄 ────────────────────────────────────────────────────── */
function TrayRow({
  title,
  meta,
  color,
  mock,
  min,
  free,
  repeat,
  done,
  onToggle,
  onSetMin,
  onPlace,
  onDelete,
  onDragStart,
}: {
  title: string;
  meta: string;
  color?: string;
  /** 모의시험 블록 — 연결된 과목이 없어 팔레트 색이 없다. 색 리터럴 대신 CSS 토큰(.mock)으로 구분. */
  mock?: boolean;
  min?: number;
  free?: boolean;
  repeat?: 'daily' | 'weekly';
  done: boolean;
  onToggle: (on: boolean) => void;
  onSetMin?: (min: number) => void;
  onPlace: () => void;
  onDelete?: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={`${s.trayRow}${done ? ' ' + s.rowDone : ''}${free ? ' ' + s.rowFree : ''}${mock ? ' ' + s.mock : ''}`}
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
      </span>
      {/* 길이 편집(§6-2 인라인) — 스테퍼로 30분 단위(입력창은 draggable 행과 충돌해 버튼으로). */}
      {onSetMin && min != null ? (
        <span
          className={s.durStep}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          draggable={false}
        >
          <button
            type="button"
            className={s.durBtn}
            onClick={() => onSetMin(Math.max(SNAP, min - 30))}
            title="길이 30분 줄이기"
            aria-label={`${title} 길이 30분 줄이기`}
          >
            −
          </button>
          <span className={s.durVal}>{hLabel(min)}</span>
          <button
            type="button"
            className={s.durBtn}
            onClick={() => onSetMin(min + 30)}
            title="길이 30분 늘리기"
            aria-label={`${title} 길이 30분 늘리기`}
          >
            ＋
          </button>
        </span>
      ) : (
        min != null && <span className={s.rowDur}>{hLabel(min)}</span>
      )}
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

/* ── 일정 밴드(캘린더) ──────────────────────────────────────────────────
   약속·시험·행사 = 과목과 무관한 단발 사건. 공부 블록/할 일과 **의도적으로 다르게** 생겼다:
   완료 토글도 핀도 트레이 되돌리기도 없고(그 시각에 '일어나는' 것이지 해치우는 게 아니다),
   색도 과목 팔레트가 아니라 의미론 토큰(--event)이다(절대규칙 3 — 색 리터럴·팔레트 오용 금지).
   드래그를 붙이지 않았으므로 WCAG 2.1.1 키보드 대안 부담이 없다 — 시각·길이는 편집 바(✎)에서 고친다. */
function EventBand({
  title,
  start,
  min,
  half,
  selected,
  pos,
  onSelect,
  onDelete,
}: {
  title: string;
  start: number;
  min: number;
  half?: boolean;
  selected?: boolean;
  pos: (m: number) => number;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const top = pos(start);
  const height = Math.max(3, pos(start + min) - top);
  const compact = min < 45;
  const range = `${toHM(start)}–${toHM(start + min)}`;
  return (
    <div
      className={`${s.ev}${compact ? ' ' + s.compact : ''}${selected ? ' ' + s.evSel : ''}${half ? ' ' + s.evHalf : ''}`}
      style={{ top: `${top}%`, height: `${height}%` }}
      role="group"
      aria-label={`일정 ${title} ${range}`}
      data-tip={`${title}\n일정 · ${range}`}
    >
      <div className={s.cardMain}>
        <span className={s.cardName}>{title}</span>
        {!compact && <span className={s.cardMeta}>일정 · {range}</span>}
      </div>
      <div className={s.cardTools}>
        <button
          type="button"
          className={`${s.tool}${selected ? ' ' + s.toolOn : ''}`}
          onClick={onSelect}
          title="시각·길이 편집"
          aria-label={`${title} 시각·길이 편집`}
          aria-expanded={!!selected}
          aria-controls={selected ? EDIT_BAR_ID : undefined}
        >
          ✎
        </button>
        <button type="button" className={s.tool} onClick={onDelete} title="일정 삭제" aria-label={`${title} 일정 삭제`}>
          ✕
        </button>
      </div>
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
  mock,
  start,
  min,
  spanMin,
  pinned,
  done,
  selected,
  half,
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
  /** 모의시험 블록 — 과목색이 없으므로 CSS 토큰(.mock)으로 구분(색 리터럴 금지 · 절대규칙 3). */
  mock?: boolean;
  start: number;
  min: number;
  spanMin: number;
  pinned?: boolean;
  done: boolean;
  selected?: boolean;
  /** 같은 시간대에 일정이 있어 오른쪽 반폭으로 물러난 상태(일정이 왼쪽 레인). */
  half?: boolean;
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

  // 포인터 리사이즈 — 하단 핸들에서 아래로 끌면 길이 증가. px→분은 공용 pxToMin(변환 SSOT).
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const col = (e.currentTarget as HTMLElement).closest('.' + COL_CLASS) as HTMLElement | null;
    const colH = col?.getBoundingClientRect().height ?? 0;
    if (!colH) return;
    const y0 = e.clientY;
    const min0 = min;
    // 값 변화 가드 — pointermove는 60~120 Hz로 오는데 결과는 SNAP(15분) 격자라 대부분 같은 값이다.
    // 가드가 없으면 드래그 내내 매 이벤트가 store 커밋이 되고, persist가 400ms 디바운스라
    // 그 사이 recipe가 무제한 누적된다(드래그 1회에 수백 건 → 리베이스 시 일괄 재생).
    // 이제 커밋은 '실제로 다른 길이가 됐을 때'만 = 드래그 중 격자 칸을 넘은 횟수만큼.
    let lastMin = min0;
    const onMoveP = (ev: PointerEvent) => {
      const nm = Math.max(SNAP, snapMin(min0 + pxToMin(ev.clientY - y0, colH, spanMin)));
      if (nm === lastMin) return;
      lastMin = nm;
      onSetMin(nm);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMoveP);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMoveP);
    window.addEventListener('pointerup', onUp);
  };

  /* 카드는 '누를 수 있는 것'이 아니라 여러 조작(편집·완료·핀·삭제)을 담는 **묶음**이다.
     전엔 role="group"에 aria-pressed(그 role이 갖지 않는 무효 속성)를 달고 tabIndex로 포커스만 받되
     onKeyDown이 Alt 키만 처리해 Enter/Space로는 편집 바를 열 수 없었다(키보드로 유일하게 막힌 경로).
     → 이름 있는 group은 유지하되 무효 상태 속성은 떼고, 편집은 툴바의 **진짜 버튼**(✎)이 맡는다.
     Enter/Space·펼침 상태(aria-expanded/controls)를 네이티브로 얻고, Alt+화살표는 그 버튼에서
     컨테이너로 버블링돼 그대로 동작한다 → 컨테이너 tabIndex(중복 탭 스톱)는 없앴다.
     본문을 button으로 감싸지 않은 건 의도적이다: 본문이 곧 드래그 손잡이라 폼 컨트롤로 바꾸면
     시간박기 드래그가 브라우저별로 흔들린다(핵심 상호작용을 건드리지 않는 쪽을 택함). */
  return (
    <div
      className={`${s.card} ${kind === 'task' ? s.cardTask : s.cardStudy}${done ? ' ' + s.cardDone : ''}${compact ? ' ' + s.compact : ''}${selected ? ' ' + s.cardSel : ''}${mock ? ' ' + s.mock : ''}${half ? ' ' + s.cardHalf : ''}`}
      style={{ top: `${top}%`, height: `${height}%`, ...(color ? ({ ['--seg']: color } as React.CSSProperties) : {}) }}
      draggable
      onDragStart={onDragStart}
      onClick={() => onSelect?.()}
      role="group"
      onKeyDown={onKeyDown}
      aria-label={`${title} · ${meta} ${toHM(start)}–${toHM(start + min)}. Alt+화살표로 이동, Alt+Shift+화살표로 길이, Alt+Backspace로 트레이로.`}
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
        {/* 편집 바 여는 진짜 버튼 — 키보드로 카드에 들어오면 첫 탭 스톱이 여기고, Enter/Space가
            네이티브로 동작한다(마우스의 '카드 클릭'과 같은 일). 툴바는 focus-within에서 드러난다. */}
        <button
          type="button"
          className={`${s.tool}${selected ? ' ' + s.toolOn : ''}`}
          onClick={() => onSelect?.()}
          title="시각·길이 편집"
          aria-label={`${title} 시각·길이 편집`}
          aria-expanded={!!selected}
          aria-controls={selected ? EDIT_BAR_ID : undefined}
        >
          ✎
        </button>
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
