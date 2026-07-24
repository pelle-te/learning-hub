/* ============================================================
   shell/modal.tsx — confirm/prompt 모달(레거시 ui-kit.js의 confirmModal/promptModal 대체).
   명령형 Promise API(confirm/prompt) — 호출부가 await. 표시는 <ModalHost/>(앱 루트 1개).
   CSS는 .modal-ov/.modal/.modal-*(전역) 재사용. Esc=취소, Enter=확인(prompt는 Ctrl/⌘+Enter).
============================================================ */
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
export interface PromptOpts {
  title?: string;
  value?: string;
  placeholder?: string;
  okLabel?: string;
}
interface ModalReq {
  id: number;
  kind: 'confirm' | 'prompt';
  message: string;
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  value?: string;
  placeholder?: string;
  resolve: (v: boolean | string | null) => void;
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
      kind: 'confirm',
      message,
      title: opts.title,
      okLabel: opts.okLabel,
      cancelLabel: opts.cancelLabel,
      danger: opts.danger,
      resolve: (v) => resolve(v as boolean),
    });
  });
}
/** 프롬프트 모달 → Promise<string|null>(취소 시 null). */
export function prompt(message: string, opts: PromptOpts = {}): Promise<string | null> {
  return new Promise((resolve) => {
    useModalStore.getState().open({
      id: ++_id,
      kind: 'prompt',
      message,
      title: opts.title,
      value: opts.value,
      placeholder: opts.placeholder,
      okLabel: opts.okLabel || '확인',
      resolve: (v) => resolve(v as string | null),
    });
  });
}

export function ModalHost() {
  const current = useModalStore((s) => s.current);
  const close = useModalStore((s) => s.close);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef<HTMLElement | null>(null);

  const isPrompt = current?.kind === 'prompt';
  const cancelVal = isPrompt ? null : false;
  const titleId = current ? `modal-t-${current.id}` : undefined;
  const bodyId = current ? `modal-b-${current.id}` : undefined;

  /* 포커스 관리는 이제 공유 훅이 소유한다 — 여기 손코딩돼 있던 것을 useFocusTrap 이 그대로
     추출해 갔는데(주석이 그렇게 적혀 있다) 정작 원본은 남아, 검증된 패턴의 **복제 두 벌**이
     ShortcutsHelp·DetailDrawer 와 갈라진 채 유지되고 있었다.
     ⚠ `active` 를 `!!current` 로 주는 것이 안전한 이유: finish()가 resolve 직후 close()로
     current 를 반드시 null 로 만들어, 연속된 모달 사이에 false 를 한 번 거친다(그래야 새
     모달에서 초기 포커스가 다시 잡힌다). */
  useEffect(() => {
    initialRef.current = inputRef.current || okRef.current;
  }, [current]);
  useFocusTrap(!!current, dialogRef, initialRef);
  useScrollLock(!!current);

  if (!current) return null;

  const finish = (v: boolean | string | null) => {
    current.resolve(v);
    close();
  };
  const okVal = () => (isPrompt ? (inputRef.current?.value.trim() ?? '') : true);

  // Tab 순환은 useFocusTrap(document 리스너)이 맡는다 — 여기는 확정/취소 키만.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(cancelVal);
    } else if (e.key === 'Enter') {
      if (isPrompt && document.activeElement === inputRef.current && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      finish(okVal());
    }
  };

  // body로 포털 — 앱 트리 안에 두면 조상이 만든 스태킹 컨텍스트에 갇혀 z-index가 무의미해진다.
  // DetailDrawer(시트)는 body 직속 포털이라, 확인창이 트리 안에 있으면 z-index를 아무리 올려도
  // 시트가 위를 덮었다(시트에서 '과목 삭제' → 확인창이 뒤에 떠 클릭이 안 되던 결함).
  return createPortal(
    /* 오버레이 mousedown-닫기 = 마우스 편의이고, 결과는 취소 버튼과 동일하다. 키보드 경로는
       위 onKey(ESC 취소 · Enter 확인, prompt 는 Ctrl/⌘+Enter) · trapTab(포커스 순환) ·
       열기 전 포커스 복원 · 취소/확인 진짜 버튼이 전부 갖고 있다. */
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="modal-ov in"
      onMouseDown={(e) => e.target === e.currentTarget && finish(cancelVal)}
      onKeyDown={onKey}
    >
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
        {isPrompt && (
          <textarea
            ref={inputRef}
            className="modal-in"
            rows={3}
            defaultValue={current.value || ''}
            placeholder={current.placeholder || ''}
          />
        )}
        <div className="modal-a">
          <button type="button" className="ghost modal-cancel" onClick={() => finish(cancelVal)}>
            {current.cancelLabel || '취소'}
          </button>
          <button
            ref={okRef}
            type="button"
            className={`primary modal-ok${current.danger ? ' modal-danger' : ''}`}
            onClick={() => finish(okVal())}
          >
            {current.okLabel || '확인'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
