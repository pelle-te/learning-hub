/* ============================================================
   shell/modal.tsx — confirm 모달(레거시 ui-kit.js의 confirmModal 대체).
   명령형 Promise API(confirm) — 호출부가 await. 표시는 <ModalHost/>(앱 루트 1개).
   CSS는 .modal-ov/.modal/.modal-*(전역) 재사용. Esc=취소, Enter=확인.

   ⚠⚠ **`prompt` 는 은퇴했다(W8 · 2026-07-31).** 전 앱 유일한 호출부가 백지 복습의 '막힘 메모'
   였는데, 취소하면 **"막혔다"는 사실 자체가 기록되지 않았다** — 모달 하나가 데이터를 먹는
   형태였다. 지금은 사실을 먼저 커밋하고 메모는 그 행 아래 인라인 한 줄로 받는다
   (`features/today/TodayBlocks.tsx`). 함께 사라진 것: prompt 경로·`PromptOpts`·모달 안의
   textarea 와 그 Ctrl/⌘+Enter 분기.
   ⚠ **되살리지 말 것** — "값을 받는 모달"이 필요하다고 느껴지면 그건 대개 *커밋을 값 입력에
   묶고 있다*는 신호다. 커밋을 먼저 하고 값은 나중에 받는 형태가 이 앱의 규약이다. */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useScrollLock } from '@/hooks/useScrollLock';

export interface ConfirmOpts {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface ModalReq {
  id: number;
  message: string;
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}
interface ModalStore {
  current: ModalReq | null;
  open: (req: ModalReq) => void;
  close: () => void;
}
let _id = 0;
const useModalStore = create<ModalStore>((set) => ({
  current: null,
  open: (req) => set({ current: req }),
  close: () => set({ current: null }),
}));

/** 확인 모달 → Promise<boolean>. */
export function confirm(message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useModalStore.getState().open({
      id: ++_id,
      message,
      title: opts.title,
      okLabel: opts.okLabel,
      cancelLabel: opts.cancelLabel,
      danger: opts.danger,
      resolve,
    });
  });
}

export function ModalHost() {
  const current = useModalStore((s) => s.current);
  const close = useModalStore((s) => s.close);
  const okRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef<HTMLElement | null>(null);

  const titleId = current ? `modal-t-${current.id}` : undefined;
  const bodyId = current ? `modal-b-${current.id}` : undefined;

  /* 포커스 관리는 이제 공유 훅이 소유한다 — 여기 손코딩돼 있던 것을 useFocusTrap 이 그대로
     추출해 갔는데(주석이 그렇게 적혀 있다) 정작 원본은 남아, 검증된 패턴의 **복제 두 벌**이
     ShortcutsHelp·DetailDrawer 와 갈라진 채 유지되고 있었다.
     ⚠ `active` 를 `!!current` 로 주는 것이 안전한 이유: finish()가 resolve 직후 close()로
     current 를 반드시 null 로 만들어, 연속된 모달 사이에 false 를 한 번 거친다(그래야 새
     모달에서 초기 포커스가 다시 잡힌다). */
  useEffect(() => {
    initialRef.current = okRef.current;
  }, [current]);
  useFocusTrap(!!current, dialogRef, initialRef);
  useScrollLock(!!current);

  if (!current) return null;

  const finish = (v: boolean) => {
    current.resolve(v);
    close();
  };

  // Tab 순환은 useFocusTrap(document 리스너)이 맡는다 — 여기는 확정/취소 키만.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    }
  };

  // body로 포털 — 앱 트리 안에 두면 조상이 만든 스태킹 컨텍스트에 갇혀 z-index가 무의미해진다.
  // DetailDrawer(시트)는 body 직속 포털이라, 확인창이 트리 안에 있으면 z-index를 아무리 올려도
  // 시트가 위를 덮었다(시트에서 '과목 삭제' → 확인창이 뒤에 떠 클릭이 안 되던 결함).
  return createPortal(
    /* 오버레이 mousedown-닫기 = 마우스 편의이고, 결과는 취소 버튼과 동일하다. 키보드 경로는
       위 onKey(ESC 취소 · Enter 확인) · trapTab(포커스 순환) ·
       열기 전 포커스 복원 · 취소/확인 진짜 버튼이 전부 갖고 있다. */
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-ov in" onMouseDown={(e) => e.target === e.currentTarget && finish(false)} onKeyDown={onKey}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={current.title ? titleId : undefined}
        aria-describedby={bodyId}
      >
        {current.title && (
          <div id={titleId} className="modal-t">
            {current.title}
          </div>
        )}
        <div id={bodyId} className="modal-b">
          {current.message}
        </div>
        <div className="modal-a">
          <button type="button" className="ghost modal-cancel" onClick={() => finish(false)}>
            {current.cancelLabel || '취소'}
          </button>
          <button
            ref={okRef}
            type="button"
            className={`primary modal-ok${current.danger ? ' modal-danger' : ''}`}
            onClick={() => finish(true)}
          >
            {current.okLabel || '확인'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
