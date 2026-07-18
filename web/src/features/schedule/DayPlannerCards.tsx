/* ============================================================
   DayPlannerCards — 일 편집기의 순수 프레젠테이션 조각 3종.
   TrayRow(미지정 트레이 한 줄) · EventBand(일정 띠) · TimedCard(타임박스 카드).

   전부 props만 받아 그리는 무상태 컴포넌트라 1137줄짜리 DayPlanner에서 그대로 떼어냈다
   (상태·드래그 오케스트레이션은 DayPlanner가 계속 소유 — 여기로 새어나오면 안 된다).
   좌표 변환은 lib/dayPlanGeometry가 소유.
============================================================ */
import { hLabel, toHM } from '@/lib/utils';
import { pxToMin } from '@/lib/dayPlanGeometry';
import { SNAP, snap as snapMin } from '@/lib/dayPlans';
import { COL_CLASS, EDIT_BAR_ID, type DragKind } from './dayPlannerShared';
import s from './DayPlanner.module.css';

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
        /* 핸들러가 stopPropagation 뿐이다 — 상태를 바꾸지 않는 순수 드래그 차단 가드다.
           실제 조작은 안쪽 진짜 버튼 2개가 하고, 키보드로는 부모 드래그가 애초에 발동하지
           않으므로 이 가드가 없어도 무해하다. */
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
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
      {/* stopPropagation 뿐 — 툴바 버튼 클릭이 카드 onClick 으로 새지 않게 막는 마우스 전용
          가드다(키보드 경로엔 영향 없음). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
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
