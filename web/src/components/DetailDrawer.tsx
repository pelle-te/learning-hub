/* ============================================================
   DetailDrawer — 단일화면 대시보드 위에 띄우는 우측 슬라이드 패널(온디맨드 세부).
   today의 '오늘 상세' 오버레이를 컴포넌트화 — 데이터보드형 탭이 깊은 차트·표를 여기로 뺀다.
   순수 표현(components → lib만): open/onClose/title/children. Esc·바깥 클릭으로 닫힘.
============================================================ */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useScrollLock } from '@/hooks/useScrollLock';

/* ── C-7 컴포넌트 티어 이식(Tailwind) ──────────────────────────────────────────
   ⚠ 원본은 `.overlayCenter .panel` 이라는 **조상 변형 자손 셀렉터**로 두 벌 기하를 갈랐다.
   규약 4 대로 자손에 직접 클래스를 준다 — placement 가 이미 prop 이므로 정적 맵 두 벌이면 된다
   (부칙: 동적 조립 금지 · 문자열이 통째로 소스에 있어야 Tailwind 가 클래스를 만든다).
   ⚠ 그리고 §15-8 ② — **한 속성은 한 문자열이 소유한다**: base 에 `justify-end` 를 두고 변형에서
   `justify-center` 로 덮으면 클래스 순서가 아니라 방출 순서로 갈린다. 정렬·폭·반경·보더처럼
   두 벌이 다른 속성은 전부 변형 쪽이 통째로 갖는다.
   닫기 버튼(`<button>`)은 언레이어드 전역 `button{}` 을 이겨야 하므로 해당 속성에 `!`. */
const OVERLAY_BASE =
  'fixed inset-0 z-[var(--z-modal)] flex bg-overlay backdrop-blur-overlay motion-reduce:animate-none';
/* 진입 애니는 별도로 뺐다(morphName 일 때 끄기 위해). View Transitions morph 로 여는 경우
   드로어 자체의 enter-pop/enter-fade 가 켜져 있으면 **새 스냅샷이 pop 시작(작고 투명) 상태로 잡혀**
   morph 가 "투명한 것으로 변형"이 된다 — 그래서 morph 열림에선 이 둘을 끄고 VT 가 전담한다. */
const OVERLAY_ENTER = 'animate-[enter-fade_var(--dur-fast)_var(--ease)]';
const OVERLAY = {
  right: 'justify-end',
  center: 'items-center justify-center px-drawer-pad-x py-drawer-pad-y max-mobile:p-0',
} as const;
const PANEL_BASE = 'flex w-full flex-col bg-bg shadow-float motion-reduce:animate-none';
const PANEL = {
  right: 'h-full max-w-drawer border-l border-line max-mobile:max-w-none max-mobile:border-l-0',
  center:
    'h-auto max-h-full max-w-drawer-sheet rounded-lg border border-line max-mobile:h-full max-mobile:max-h-none max-mobile:rounded-none max-mobile:border-0',
} as const;
const PANEL_ENTER = {
  right: 'animate-[enter-slide_var(--dur)_var(--ease)]',
  center: '[--pop-y:0] animate-[enter-pop_var(--dur)_var(--ease)]',
} as const;
const HEAD = 'flex flex-none items-center justify-between gap-3 border-b border-line px-5 py-4 text-md tracking-label';
/* 제목은 줄어들고 넘치면 말줄임 — min-w-0 이 없으면 flex 항목이 콘텐츠 폭 아래로 못 줄어
   좁은 시트에서 닫기 버튼을 패널 밖으로 밀어낸다. */
const TITLE = 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap';
/* ⚠ padding 을 건드리지 않는다 — 원본 `.panelX` 도 안 건드렸고, 실제 렌더는 전역 `button{}` 의
   8px 13px 이다(32×32 고정 박스 안이라 보이지는 않는다). 유틸로 0 을 주면 그건 이식이 아니라
   변경이다(절대규칙 #4). */
const CLOSE = 'size-8 flex-none rounded-chip! border! border-line! bg-transparent! text-ink! hover:bg-panel2!';
const BODY = 'min-h-0 flex-1 overflow-y-auto px-5 pt-4.5 pb-7 [scrollbar-width:thin]';

export default function DetailDrawer({
  open,
  onClose,
  title,
  children,
  placement = 'right',
  morphName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 'right'=우측 슬라이드 패널(기본·today 패턴) · 'center'=탭 프레임보다 작은 중앙 시트.
      중앙 시트는 "목록은 그대로 두고 한 항목만 파고든다"는 용도 — 뒤 목록의 조망을 깨지 않는다(과목 상세). */
  placement?: 'right' | 'center';
  /** View Transitions 공유요소 morph 이름(호출부가 여는 원본과 짝지어 준다). 주면 패널이 이 이름을
      갖고 진입 애니(enter-pop/enter-fade)를 끈다 — VT 가 원본→패널 morph 를 전담한다. 없으면 기존 동작. */
  morphName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef); // 포커스 트랩 + 복원(접근성 — aria-modal 선언만 있고 관리가 없던 결함 보완).
  useScrollLock(open); // 배경 스크롤 잠금 — 트랩의 짝(포커스가 안 새듯 스크롤도 안 새야 한다).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  // body로 포털 — 셸(#main 조상)이 스태킹 컨텍스트를 만들어, 여기 그대로 두면 position:fixed가 뷰포트가 아니라
  // 그 조상 박스를 기준으로 잡히고 z-index도 그 안에 갇힌다(헤더·사이드바가 오버레이를 덮고 패널 헤드가 잘림).
  // 모달은 뷰포트에 고정돼야 하는 물건이라 문서 최상위에서 그린다.
  return createPortal(
    /* 오버레이 클릭-닫기는 마우스 편의 레이어다. 키보드 경로는 셋 다 갖춰져 있다 —
       ESC(아래 useEffect) · useFocusTrap(진입 포커스 + Tab 순환 + 닫을 때 복원) · 헤더의
       진짜 닫기 버튼(aria-label="닫기"). 린트는 그 셋을 볼 수 없다. */
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <div
      className={`${OVERLAY_BASE} ${OVERLAY[placement]}${morphName ? '' : ` ${OVERLAY_ENTER}`}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`${PANEL_BASE} ${PANEL[placement]}${morphName ? '' : ` ${PANEL_ENTER[placement]}`}`}
        ref={panelRef}
        tabIndex={-1}
        style={morphName ? { viewTransitionName: morphName } : undefined}
      >
        <div className={HEAD}>
          <b className={TITLE} title={title}>
            {title}
          </b>
          <button type="button" className={CLOSE} onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className={BODY}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
