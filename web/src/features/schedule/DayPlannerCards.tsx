/* ============================================================
   DayPlannerCards — 일 편집기의 순수 프레젠테이션 조각 3종.
   TrayRow(미지정 트레이 한 줄) · EventBand(일정 띠) · TimedCard(타임박스 카드).

   전부 props만 받아 그리는 무상태 컴포넌트라 1137줄짜리 DayPlanner에서 그대로 떼어냈다
   (상태·드래그 오케스트레이션은 DayPlanner가 계속 소유 — 여기로 새어나오면 안 된다).
   좌표 변환은 lib/dayPlanGeometry가 소유.
============================================================ */
import { hLabel, toHM } from '@/lib/utils';
import { useKeymapDoc } from '@/hooks/useKeymap';
import { pxToMin } from '@/lib/dayPlanGeometry';
import { SNAP, snap as snapMin } from '@/lib/dayPlans';
import { COL_CLASS, EDIT_BAR_ID, type DragKind } from './dayPlannerShared';

/* ── C-7 이식(DayPlannerCards) — Tailwind 클래스 SSOT ────────────────────────────
   TrayRow(트레이 한 줄) · EventBand(일정 띠) · TimedCard(타임박스 카드) 셋 다 무상태 프레젠테이션.
   ⚠ 좌측 색 띠·채움은 런타임 --seg(과목색) 파생이라 인라인 style 이 얹는 사용 시점 해석(절대규칙 #3).
   ⚠ 카드/밴드는 <div> 라 전역 button 경합이 없지만, 안의 tool/durBtn 은 <button> 이라 전역 button
   (언레이어)을 이겨야 하므로 다른 값만 `!`(§ global element rules · TOOLBASE 참조). built-in 크기
   (text-xs/sm)만 companion line-height 를 흘려 폼컨트롤/자손엔 leading-[normal], 정상 흐름엔 원본 LH
   (1.6/1.15)를 명시(line-height 트랩). hover/focus 로 드러나는 툴바는 group-hover/-focus-within(§15).
   ⚠ tool 의 로컬 :hover 는 전역 button:hover(더 높은 명시도)에 이미 가려져 있어 되살리지 않는다. */
// 공용 아이콘 툴 버튼(색은 사용처에서 text-mut!/text-acc! 로 — 같은 property 라 한쪽만).
const TOOLBASE =
  'inline-flex h-5.5 w-5.5 flex-none items-center justify-center rounded-seg! border-transparent! bg-transparent! text-sm! leading-[normal] focus-visible:outline-offset-1! motion-reduce:transition-none';
const C = {
  trayRow:
    'seg-scope flex cursor-grab items-center gap-2 rounded-md border-solid border-l-[length:var(--bw-seg)] border-l-[color:var(--seg,var(--acc))] bg-[var(--tray-fill)] px-2.25 py-1.75 shadow-inset-line2 active:cursor-grabbing',
  grabDot: 'h-4 w-1 flex-none rounded-xs bg-[image:var(--grab-bar)] opacity-70',
  rowName: 'min-w-0 flex-1 truncate text-md font-bold',
  rowMeta: 'flex-none whitespace-nowrap text-2xs font-bold text-mut',
  durStep: 'inline-flex flex-none cursor-default items-center gap-0.5',
  durBtn:
    'inline-flex h-4.5 w-4.5 items-center justify-center rounded-chip-md! border-line2! bg-panel! leading-[1] font-extrabold! focus-visible:outline-offset-1!',
  durVal: 'min-w-8.5 text-center text-xs leading-[1.6] font-extrabold tabular-nums text-txt',
  rowDur: 'flex-none whitespace-nowrap text-xs leading-[1.6] font-extrabold tabular-nums text-mut',
  tool: `${TOOLBASE} text-mut!`,
  ev: 'seg-scope group absolute left-1 box-border flex min-h-4 items-start justify-between gap-1.5 overflow-hidden rounded-blk border-solid border-l-[length:var(--bw-seg)] border-l-[color:var(--event)] bg-[var(--ev-fill)] px-2 text-txt shadow-[var(--shadow-ev)] transition-shadow duration-140 ease-[var(--ease)] hover:z-[6] hover:shadow-[var(--shadow-ev-hover)] focus-within:z-[8] focus-within:-outline-offset-2 focus-within:outline-2 focus-within:outline-acc motion-reduce:transition-none',
  evSel: 'z-[9] outline-2 -outline-offset-1 outline-acc',
  cardMain: 'flex min-w-0 flex-col gap-px',
  cardName: 'truncate text-sm leading-[1.15] font-extrabold tracking-wk',
  cardMeta: 'whitespace-nowrap text-2xs font-bold opacity-[0.82]',
  cardTools:
    'flex flex-none gap-px opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none',
  card: 'seg-scope group absolute right-1 box-border flex min-h-4 cursor-grab items-start justify-between gap-1.5 overflow-hidden rounded-blk px-2 text-txt transition-[box-shadow,filter] duration-140 ease-[var(--ease)] hover:z-[6] hover:shadow-[var(--shadow-card-hover)] focus-within:z-[8] focus-within:-outline-offset-2 focus-within:outline-2 focus-within:outline-acc active:cursor-grabbing motion-reduce:transition-none',
  cardStudy:
    'border-solid border-l-[length:var(--bw-seg)] border-l-[color:var(--seg,var(--acc))] bg-[var(--seg-fill-20)] shadow-[var(--shadow-card-study)]',
  cardTask:
    '[border-left-style:dashed] border-l-[length:var(--bw-seg)] border-l-[color:var(--seg,var(--acc))] bg-[var(--seg-fill-12)] shadow-inset-line2',
  cardSel: 'z-[9] outline-2 -outline-offset-1 outline-acc',
  resizeHandle: 'absolute inset-x-0 bottom-0 h-1.75 cursor-ns-resize touch-none hover:bg-[var(--seg-handle)]',
} as const;

/* ── 트레이 한 줄 ────────────────────────────────────────────────────── */
export function TrayRow({
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
      className={`${C.trayRow} ${done ? 'opacity-50' : ''} ${free ? '[--seg:var(--mut)]' : ''} ${mock ? '[--seg:var(--bad)]' : ''}`}
      draggable
      onDragStart={onDragStart}
      style={color ? ({ ['--seg']: color } as React.CSSProperties) : undefined}
    >
      <input type="checkbox" checked={done} onChange={(e) => onToggle(e.target.checked)} aria-label={`${title} 완료`} />
      <span className={C.grabDot} aria-hidden="true" />
      <span className={`${C.rowName} ${done ? 'line-through' : ''}`}>{title}</span>
      <span className={C.rowMeta}>
        {repeat && <span title={repeat === 'daily' ? '매일 반복' : '매주 반복'}>🔁 </span>}
        {meta}
      </span>
      {/* 길이 편집(§6-2 인라인) — 스테퍼로 30분 단위(입력창은 draggable 행과 충돌해 버튼으로). */}
      {onSetMin && min != null ? (
        /* 핸들러가 stopPropagation 뿐이다 — 상태를 바꾸지 않는 순수 드래그 차단 가드다.
           실제 조작은 안쪽 진짜 버튼 2개가 하고, 키보드로는 부모 드래그가 애초에 발동하지
           않으므로 이 가드가 없어도 무해하다. */
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <span
          className={C.durStep}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          draggable={false}
        >
          <button
            type="button"
            className={C.durBtn}
            onClick={() => onSetMin(Math.max(SNAP, min - 30))}
            title="길이 30분 줄이기"
            aria-label={`${title} 길이 30분 줄이기`}
          >
            −
          </button>
          <span className={C.durVal}>{hLabel(min)}</span>
          <button
            type="button"
            className={C.durBtn}
            onClick={() => onSetMin(min + 30)}
            title="길이 30분 늘리기"
            aria-label={`${title} 길이 30분 늘리기`}
          >
            ＋
          </button>
        </span>
      ) : (
        min != null && <span className={C.rowDur}>{hLabel(min)}</span>
      )}
      <button
        type="button"
        className={C.tool}
        onClick={onPlace}
        title="첫 빈 시간에 배치"
        aria-label={`${title} 시간박기`}
      >
        ⤵
      </button>
      {onDelete && (
        <button type="button" className={C.tool} onClick={onDelete} title="삭제" aria-label={`${title} 삭제`}>
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
export function EventBand({
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
      className={`${C.ev} ${compact ? 'py-0.5' : 'py-1.25'} ${selected ? C.evSel : 'z-[5]'} ${half ? 'right-[var(--evhalf)]' : 'right-1'}`}
      style={{ top: `${top}%`, height: `${height}%` }}
      role="group"
      aria-label={`일정 ${title} ${range}`}
      data-tip={`${title}\n일정 · ${range}`}
    >
      <div className={C.cardMain}>
        <span className={C.cardName}>{title}</span>
        {!compact && <span className={C.cardMeta}>일정 · {range}</span>}
      </div>
      <div className={C.cardTools}>
        <button
          type="button"
          className={`${TOOLBASE} ${selected ? 'text-acc!' : 'text-mut!'}`}
          onClick={onSelect}
          title="시각·길이 편집"
          aria-label={`${title} 시각·길이 편집`}
          aria-expanded={!!selected}
          aria-controls={selected ? EDIT_BAR_ID : undefined}
        >
          ✎
        </button>
        <button type="button" className={C.tool} onClick={onDelete} title="일정 삭제" aria-label={`${title} 일정 삭제`}>
          ✕
        </button>
      </div>
    </div>
  );
}

/* ── 타임박스 카드(캘린더) ──────────────────────────────────────────────
   드래그로 이동, Alt+↑↓ 시간(±15), Alt+Shift+↑↓ 길이(±15), 하단 핸들 포인터 리사이즈,
   툴바로 완료·핀·트레이·삭제(§6-4 키보드 대안). */
export function TimedCard({
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

  /* E16 — 이 Alt 조합들은 **`aria-label` 문장 하나에만** 적혀 있었다. 즉 스크린리더 사용자에게만
     문서화되고 `?` 치트시트엔 없었다(있는데 아무도 모르는 키의 전형). 등록은 요소 스코프
     `onKeyDown` 이라 전역 리스너로 옮길 수 없으므로 설명만 올린다. */
  useKeymapDoc('이 화면 · 일일 배치', [
    { display: 'Alt + ↑ / ↓', label: '블록 시간 ±15분' },
    { display: 'Alt + Shift + ↑ / ↓', label: '블록 길이 ±15분' },
    { display: 'Alt + Backspace', label: '트레이로 되돌리기' },
  ]);

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
    /* 위 주석의 계약대로 키보드 대안이 전부 같은 요소 위에 있다 — onKeyDown 의 Alt+↑↓(이동) ·
       Alt+Shift+↑↓(길이, 포인터 리사이즈 핸들의 대안) · Alt+Backspace(트레이 복귀), 그리고
       aria-label 이 그 키들을 스크린리더에 직접 안내한다. onClick 은 툴바 ✎ 버튼과 완전히
       같은 onSelect 를 부르는 마우스 중복 경로다. */
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={`${C.card} ${kind === 'task' ? C.cardTask : C.cardStudy} ${done ? 'opacity-[0.42] saturate-[0.6]' : ''} ${compact ? 'py-0.5' : 'py-1.25'} ${selected ? C.cardSel : ''} ${mock ? '[--seg:var(--bad)]' : ''} ${half ? 'left-[var(--evhalf)]' : 'left-1'}`}
      style={{ top: `${top}%`, height: `${height}%`, ...(color ? ({ ['--seg']: color } as React.CSSProperties) : {}) }}
      draggable
      onDragStart={onDragStart}
      onClick={() => onSelect?.()}
      role="group"
      onKeyDown={onKeyDown}
      aria-label={`${title} · ${meta} ${toHM(start)}–${toHM(start + min)}. Alt+화살표로 이동, Alt+Shift+화살표로 길이, Alt+Backspace로 트레이로.`}
      data-tip={`${title}\n${meta} · ${toHM(start)}–${toHM(start + min)}`}
    >
      <div className={C.cardMain}>
        <span className={`${C.cardName} ${done ? 'line-through' : ''}`}>
          {pinned && '📌 '}
          {title}
        </span>
        {!compact && (
          <span className={C.cardMeta}>
            {meta} · {toHM(start)}–{toHM(start + min)}
          </span>
        )}
      </div>
      {/* stopPropagation 뿐 — 툴바 버튼 클릭이 카드 onClick 으로 새지 않게 막는 마우스 전용
          가드다(키보드 경로엔 영향 없음). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className={C.cardTools} onClick={(e) => e.stopPropagation()}>
        {/* 편집 바 여는 진짜 버튼 — 키보드로 카드에 들어오면 첫 탭 스톱이 여기고, Enter/Space가
            네이티브로 동작한다(마우스의 '카드 클릭'과 같은 일). 툴바는 focus-within에서 드러난다. */}
        <button
          type="button"
          className={`${TOOLBASE} ${selected ? 'text-acc!' : 'text-mut!'}`}
          onClick={() => onSelect?.()}
          title="시각·길이 편집"
          aria-label={`${title} 시각·길이 편집`}
          aria-expanded={!!selected}
          aria-controls={selected ? EDIT_BAR_ID : undefined}
        >
          ✎
        </button>
        <button type="button" className={C.tool} onClick={() => onToggle(!done)} title="완료" aria-label="완료 토글">
          {done ? '↺' : '✓'}
        </button>
        {onPin && (
          <button
            type="button"
            className={`${TOOLBASE} ${pinned ? 'text-acc!' : 'text-mut!'}`}
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
          className={C.tool}
          onClick={onUnplace}
          title="트레이로(미지정)"
          aria-label="트레이로 되돌리기"
        >
          ⤴
        </button>
        {onDelete && (
          <button type="button" className={C.tool} onClick={onDelete} title="삭제" aria-label="삭제">
            ✕
          </button>
        )}
      </div>
      <span className={C.resizeHandle} onPointerDown={startResize} aria-hidden="true" />
    </div>
  );
}
