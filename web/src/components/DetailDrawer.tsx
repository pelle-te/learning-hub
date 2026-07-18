/* ============================================================
   DetailDrawer — 단일화면 대시보드 위에 띄우는 우측 슬라이드 패널(온디맨드 세부).
   today의 '오늘 상세' 오버레이를 컴포넌트화 — 데이터보드형 탭이 깊은 차트·표를 여기로 뺀다.
   순수 표현(components → lib만): open/onClose/title/children. Esc·바깥 클릭으로 닫힘.
============================================================ */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import s from './DetailDrawer.module.css';

export default function DetailDrawer({
  open,
  onClose,
  title,
  children,
  placement = 'right',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 'right'=우측 슬라이드 패널(기본·today 패턴) · 'center'=탭 프레임보다 작은 중앙 시트.
      중앙 시트는 "목록은 그대로 두고 한 항목만 파고든다"는 용도 — 뒤 목록의 조망을 깨지 않는다(과목 상세). */
  placement?: 'right' | 'center';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef); // 포커스 트랩 + 복원(접근성 — aria-modal 선언만 있고 관리가 없던 결함 보완).
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
    <div
      className={`${s.overlay}${placement === 'center' ? ' ' + s.overlayCenter : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={s.panel} ref={panelRef} tabIndex={-1}>
        <div className={s.panelHead}>
          <b className={s.panelTitle} title={title}>
            {title}
          </b>
          <button type="button" className={s.panelX} onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className={s.panelBody}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
