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
/** 퇴장 애니(.toast.out) 길이와 맞춘 언마운트 지연(ms). CSS `exit-pop` = `--dur-fast`(120ms)와 짝.
 *  ⚠ 40ms 여유를 둔다 — 애니가 끝나기 *전에* 언마운트하면 마지막 프레임이 잘려 툭 사라진다.
 *  ⚠ 토큰을 JS 에서 읽지 않는 이유는 `lib/motion.ts` 의 `COMMIT_MS` 와 같다(그 머리주석 참조).
 *    드리프트는 `invariants.test.ts` 가 tokens.css 를 읽어 막는다. */
const TOAST_OUT_MS = 160;
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
  // 퇴장 2단계 — `out`(애니) → TOAST_OUT_MS 뒤 실제 제거. 예전엔 즉시 언마운트라
  // 등장만 애니되고 사라질 땐 툭 끊겼다(`.toast.out` CSS 는 있는데 아무도 안 붙였다).
  const [leaving, setLeaving] = useState(false);
  const leftRef = useRef(item.ms);
  const sinceRef = useRef(0); // 렌더 순수성 — 시각은 이펙트에서만 찍는다
  useEffect(() => {
    if (paused || leaving) return;
    sinceRef.current = Date.now();
    // setState 를 타이머 콜백에서 — 이펙트 본문의 동기 setState 가 아니라 React Compiler
    // `set-state-in-effect` 를 발화시키지 않는다(이 저장소가 여러 번 쓴 회피).
    const t = setTimeout(() => setLeaving(true), leftRef.current);
    return () => {
      clearTimeout(t);
      leftRef.current = Math.max(600, leftRef.current - (Date.now() - sinceRef.current));
    };
  }, [item.id, paused, leaving]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => remove(item.id), TOAST_OUT_MS);
    return () => clearTimeout(t);
  }, [leaving, item.id, remove]);
  // 퇴장 중엔 타이머 일시정지 조작을 받지 않는다(hover 로 되살아나면 애니가 뒤집힌다).
  const dismiss = () => setLeaving(true);
  /* ⚠⚠ **여기에 라이브 롤을 두지 않는다(H15 · 2026-07-26 감사).**
     라이브 리전은 콘텐츠가 바뀌기 **전에** DOM 에 있어야 공지가 나간다. 종전엔 `role=status`
     노드를 텍스트와 **동시에** 삽입해서, AT 에 따라 한 번도 안 읽힐 수 있었다 — 하필 행동을
     요구하는 것들(저장공간·클라우드 차단)이 그 부류다. 공지는 아래 `ToastHost` 의 **항상
     마운트된 빈 리전**이 맡고, 이 노드는 시각 + 조작(되돌리기 버튼)만 갖는다.
     ⚠ `aria-hidden` 을 걸지 않는 것도 의도다 — 걸면 그 되돌리기 버튼이 AT 에서 사라진다. */
  return (
    /* 클릭은 '조기 닫기'(마우스 편의)일 뿐이다. 토스트는 타이머로 자동 소멸하므로 키보드
       사용자가 닫을 일이 없고, 전달은 role=alert/status + 호스트의 aria-live 가 담당한다.
       실제 조작(되돌리기)은 아래 진짜 <button> 이 소유한다. */
    /* ⚠ `no-static-element-interactions` 도 함께 끈다(H15 로 롤이 빠지면서 새로 걸린다).
       근거는 위와 같다: 이 노드는 **상호작용 요소가 아니다** — 클릭은 마우스 편의이고,
       진짜 조작은 안쪽 `<button>`(되돌리기)이 갖는다. 롤을 다시 붙이면 H15 가 되살아난다. */
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={`toast ${item.type}${leaving ? ' out' : ''}`}
      onClick={dismiss}
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
      {/* UX-3 — 되돌리기 창이 얼마나 남았는지 보여준다. 되돌릴 게 있는 토스트에만 붙고,
          위 hover/focus 일시정지와 **같은 `paused` 상태**를 쓴다(바가 멈춰 있는데 타이머는
          돌아가는 식으로 갈리면, 보이는 것이 곧 거짓이 된다). 나머지는 CSS 가 소유한다. */}
      {item.action && (
        <span
          className="toast-life"
          style={{ animationDuration: `${item.ms}ms`, animationPlayState: paused ? 'paused' : 'running' }}
          aria-hidden="true"
        />
      )}
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
            dismiss();
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

  /* ⚠⚠ **공지는 항상 마운트된 빈 리전 둘이 맡는다(H15 · 2026-07-26 감사).**

     ① 라이브 리전은 **텍스트가 바뀌기 전에 DOM 에 있어야** 한다. 토스트 노드에 롤을 달면
        리전과 텍스트가 동시에 삽입돼 AT 에 따라 공지가 통째로 씹힌다.
     ② 중첩 politeness 문제도 함께 사라진다 — 종전 주석이 기록한 "호스트에 aria-live 를 두면
        오류의 assertive 가 조상의 polite 에 삼켜진다"는 **리전을 형제로 두면 성립하지 않는다.**
        polite/assertive 를 아예 다른 노드로 가른다.

     ⚠ 두 리전을 **동시에 채우지 않는다** — 하나가 차면 다른 하나는 비운다. 같은 문장이 두 번
        읽히는 것은 안 읽히는 것 다음으로 나쁘다. */
  const lastId = useRef<string | number | null>(null);
  const [live, setLive] = useState<{ polite: string; assertive: string }>({ polite: '', assertive: '' });
  useEffect(() => {
    const it = items[items.length - 1];
    if (!it || lastId.current === it.id) return;
    lastId.current = it.id;
    // 액션이 있으면 그 사실도 말한다 — 눈에 보이는 버튼이 SR 에는 존재를 알릴 길이 없다.
    const msg = it.action ? `${it.msg} — ${it.action.label}` : it.msg;
    setLive(it.type === 'bad' ? { polite: '', assertive: msg } : { polite: msg, assertive: '' });
  }, [items]);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {live.polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive">
        {live.assertive}
      </div>
      <div id="toastHost" className="toast-host">
        {items.map((it) => (
          <Toast key={it.id} item={it} />
        ))}
      </div>
    </>
  );
}
