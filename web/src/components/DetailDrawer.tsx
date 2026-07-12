/* ============================================================
   DetailDrawer — 단일화면 대시보드 위에 띄우는 우측 슬라이드 패널(온디맨드 세부).
   today의 '오늘 상세' 오버레이를 컴포넌트화 — 데이터보드형 탭이 깊은 차트·표를 여기로 뺀다.
   순수 표현(components → lib만): open/onClose/title/children. Esc·바깥 클릭으로 닫힘.
============================================================ */
import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import s from './DetailDrawer.module.css';

export default function DetailDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
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
  return (
    <div
      className={s.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={s.panel} ref={panelRef} tabIndex={-1}>
        <div className={s.panelHead}>
          <b>{title}</b>
          <button type="button" className={s.panelX} onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className={s.panelBody}>{children}</div>
      </div>
    </div>
  );
}
