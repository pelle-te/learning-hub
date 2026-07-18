/* ============================================================
   shell/toast.tsx — 비차단 토스트(레거시 ui-kit.js의 window.toast 대체).
   명령형 API(toast/toastUndo)를 외부에 노출 — 이벤트 핸들러 어디서든 호출.
   상태는 작은 zustand 스토어, 표시는 <ToastHost/>(앱 루트에 1개). CSS는 .toast-host/.toast(전역) 재사용.
============================================================ */
import { useEffect, useRef, useState } from 'react';
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
const MAX_STACK = 4; // 연속 실패가 우하단을 도배하지 않게 — 초과 시 최고참부터 제거
const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (t) => set((s) => ({ items: [...s.items, t].slice(-MAX_STACK) })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

/** 비차단 알림. type 기본 'ok'. ms 기본: 오류(bad)는 6초(행동 지시를 읽을 시간), 그 외 2.6초.
    action={label,onAction}이면 우측 버튼. */
export function toast(msg: string, type: ToastType = 'ok', ms?: number, action?: ToastAction): void {
  useToastStore.getState().push({ id: ++_id, msg, type, ms: ms ?? (type === 'bad' ? 6000 : 2600), action });
}
/** 파괴적 동작 뒤 '되돌리기' 액션을 단 토스트. */
export function toastUndo(msg: string, onUndo: () => void): void {
  toast(msg, 'info', 6500, { label: '되돌리기', onAction: onUndo });
}

const ICON: Record<ToastType, string> = { ok: '✓', bad: '⚠', warn: '⚠', info: 'ℹ' };

function Toast({ item }: { item: ToastItem }) {
  const remove = useToastStore((s) => s.remove);
  // hover/포커스 일시정지 — 읽는 중에(또는 되돌리기를 누르려는 중에) 사라지지 않게.
  // 남은 시간을 이어서 계산한다.
  const [paused, setPaused] = useState(false);
  const leftRef = useRef(item.ms);
  const sinceRef = useRef(0); // 렌더 순수성 — 시각은 이펙트에서만 찍는다
  useEffect(() => {
    if (paused) return;
    sinceRef.current = Date.now();
    const t = setTimeout(() => remove(item.id), leftRef.current);
    return () => {
      clearTimeout(t);
      leftRef.current = Math.max(600, leftRef.current - (Date.now() - sinceRef.current));
    };
  }, [item.id, paused, remove]);
  // 오류(bad)는 즉시 읽히도록 assertive(role=alert), 그 외는 polite(role=status).
  const role = item.type === 'bad' ? 'alert' : 'status';
  return (
    /* 클릭은 '조기 닫기'(마우스 편의)일 뿐이다. 토스트는 타이머로 자동 소멸하므로 키보드
       사용자가 닫을 일이 없고, 전달은 role=alert/status + 호스트의 aria-live 가 담당한다.
       실제 조작(되돌리기)은 아래 진짜 <button> 이 소유한다. */
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      className={`toast ${item.type} in`}
      role={role}
      onClick={() => remove(item.id)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      /* ⚠ focus 도 일시정지시켜야 한다 — 예전엔 hover 만 멈췄다. 그래서 `되돌리기` 액션이
         있는 토스트에서 키보드 사용자가 버튼까지 Tab 으로 오는 동안(ToastHost 는 App 트리
         거의 끝이라 남은 포커스 요소를 전부 통과해야 한다) 타이머가 계속 돌아, 누르려는
         순간 토스트가 사라졌다. WCAG 2.2.1(Timing Adjustable)·2.1.1 위반이었고
         jsx-a11y 는 '핸들러 쌍의 부재'만 보지 타이밍·도달가능성은 못 봐서 조용했다. */
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
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
