/* ============================================================
   shell/toast.tsx — 비차단 토스트(레거시 ui-kit.js의 window.toast 대체).
   명령형 API(toast/toastUndo)를 외부에 노출 — 이벤트 핸들러 어디서든 호출.
   상태는 작은 zustand 스토어, 표시는 <ToastHost/>(앱 루트에 1개). CSS는 .toast-host/.toast(전역) 재사용.
============================================================ */
import { useEffect } from 'react';
import { create } from 'zustand';

export type ToastType = 'ok' | 'bad' | 'warn' | 'info';
export interface ToastAction {
  label: string;
  onAction: () => void;
}
interface ToastItem {
  id: number;
  msg: string;
  type: ToastType;
  ms: number;
  action?: ToastAction;
}
interface ToastStore {
  items: ToastItem[];
  push: (t: ToastItem) => void;
  remove: (id: number) => void;
}
let _id = 0;
const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (t) => set((s) => ({ items: [...s.items, t] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

/** 비차단 알림. type 기본 'ok', ms 기본 2600. action={label,onAction}이면 우측 버튼. */
export function toast(msg: string, type: ToastType = 'ok', ms = 2600, action?: ToastAction): void {
  useToastStore.getState().push({ id: ++_id, msg, type, ms, action });
}
/** 파괴적 동작 뒤 '되돌리기' 액션을 단 토스트. */
export function toastUndo(msg: string, onUndo: () => void): void {
  toast(msg, 'info', 6500, { label: '되돌리기', onAction: onUndo });
}

const ICON: Record<ToastType, string> = { ok: '✓', bad: '⚠', warn: '⚠', info: 'ℹ' };

function Toast({ item }: { item: ToastItem }) {
  const remove = useToastStore((s) => s.remove);
  useEffect(() => {
    const t = setTimeout(() => remove(item.id), item.ms);
    return () => clearTimeout(t);
  }, [item.id, item.ms, remove]);
  // 오류(bad)는 즉시 읽히도록 assertive(role=alert), 그 외는 polite(role=status).
  const role = item.type === 'bad' ? 'alert' : 'status';
  return (
    <div className={`toast ${item.type} in`} role={role} onClick={() => remove(item.id)}>
      <span className="toast-i">{ICON[item.type]}</span>
      <span className="toast-m">{item.msg}</span>
      {item.action && (
        <button
          type="button"
          className="toast-act"
          onClick={(e) => {
            e.stopPropagation();
            try {
              item.action!.onAction();
            } catch {
              /* 액션 오류는 토스트를 닫는 걸 막지 않음 */
            }
            remove(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}

export function ToastHost() {
  const items = useToastStore((s) => s.items);
  return (
    <div id="toastHost" className="toast-host" aria-live="polite">
      {items.map((it) => (
        <Toast key={it.id} item={it} />
      ))}
    </div>
  );
}
