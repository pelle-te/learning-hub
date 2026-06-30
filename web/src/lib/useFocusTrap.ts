/* ============================================================
   useFocusTrap — 모달/오버레이 포커스 관리(접근성). shell/modal.tsx의 검증된 패턴을 공유 훅으로 추출.
   active=true가 되면 ① 직전 포커스 요소를 기억하고 패널의 첫 포커스 가능 요소로 이동,
   ② Tab을 패널 안에 가둬 첫/끝을 순환(배경으로 새지 않음),
   ③ active=false(닫힘)가 되면 직전 요소로 포커스 복원. role="dialog" aria-modal 오버레이와 짝.
============================================================ */
import { useEffect, type RefObject } from 'react';

export function useFocusTrap(active: boolean, panelRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const root = panelRef.current;
    const restore = document.activeElement as HTMLElement | null;
    const focusables = (): HTMLElement[] =>
      root
        ? Array.from(
            root.querySelectorAll<HTMLElement>(
              'button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute('disabled'))
        : [];
    // 열릴 때 패널 첫 요소(없으면 패널 자체)로 포커스 이동. 렌더 직후 타이밍(50ms) — modal.tsx와 동일.
    const tid = setTimeout(() => (focusables()[0] || root)?.focus(), 50);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const f = focusables();
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
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(tid);
      document.removeEventListener('keydown', onKey);
      restore?.focus?.(); // 닫힐 때 직전 포커스(트리거)로 복원.
    };
  }, [active, panelRef]);
}
