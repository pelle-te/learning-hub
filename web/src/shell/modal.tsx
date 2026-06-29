/* ============================================================
   shell/modal.tsx — confirm/prompt 모달(레거시 ui-kit.js의 confirmModal/promptModal 대체).
   명령형 Promise API(confirm/prompt) — 호출부가 await. 표시는 <ModalHost/>(앱 루트 1개).
   CSS는 .modal-ov/.modal/.modal-*(전역) 재사용. Esc=취소, Enter=확인(prompt는 Ctrl/⌘+Enter).
============================================================ */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

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
  const restoreRef = useRef<HTMLElement | null>(null);

  const isPrompt = current?.kind === 'prompt';
  const cancelVal = isPrompt ? null : false;
  const titleId = current ? `modal-t-${current.id}` : undefined;
  const bodyId = current ? `modal-b-${current.id}` : undefined;

  useEffect(() => {
    if (!current) return;
    // 열릴 때 직전 포커스 요소를 기억 → 닫힐 때 복원(접근성 — 키보드 맥락 유지).
    restoreRef.current = document.activeElement as HTMLElement | null;
    const el = inputRef.current || okRef.current;
    const t = setTimeout(() => el?.focus(), 50);
    return () => {
      clearTimeout(t);
      restoreRef.current?.focus?.();
    };
  }, [current]);

  if (!current) return null;

  const finish = (v: boolean | string | null) => {
    current.resolve(v);
    close();
  };
  const okVal = () => (isPrompt ? (inputRef.current?.value.trim() ?? '') : true);

  // 포커스 트랩 — Tab이 모달 밖으로 새지 않게 첫/끝 포커스 요소 사이를 순환.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const f = root.querySelectorAll<HTMLElement>('button, textarea, input, [href], [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0]!;
    const last = f[f.length - 1]!;
    const act = document.activeElement;
    if (e.shiftKey && act === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && act === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(cancelVal);
    } else if (e.key === 'Enter') {
      if (isPrompt && document.activeElement === inputRef.current && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      finish(okVal());
    } else {
      trapTab(e);
    }
  };

  return (
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
    </div>
  );
}
