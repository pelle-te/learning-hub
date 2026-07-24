/* ============================================================
   useFocusTrap — 모달/오버레이 포커스 관리(접근성). shell/modal.tsx의 검증된 패턴을 공유 훅으로 추출.
   active=true가 되면 ① 직전 포커스 요소를 기억하고 패널의 첫 포커스 가능 요소로 이동,
   ② Tab을 패널 안에 가둬 첫/끝을 순환(배경으로 새지 않음),
   ③ active=false(닫힘)가 되면 직전 요소로 포커스 복원. role="dialog" aria-modal 오버레이와 짝.
============================================================ */
import { useEffect, type RefObject } from 'react';

/**
 * @param initialRef 열릴 때 포커스를 받을 요소(생략 시 패널의 첫 포커스 가능 요소).
 *   ⚠ 확인 모달은 **취소가 아니라 확인 버튼**을, prompt 는 입력을 먼저 잡아야 한다 —
 *   DOM 순서상 첫 요소는 취소라, 이 옵션이 없으면 modal.tsx 를 이 훅으로 수렴시키는 순간
 *   기본 포커스가 조용히 바뀐다(파괴적 확인창에서 특히 위험한 종류의 '무해한 리팩터').
 */
export function useFocusTrap(
  active: boolean,
  panelRef: RefObject<HTMLElement | null>,
  initialRef?: RefObject<HTMLElement | null>,
): void {
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
            /* `disabled` 뿐 아니라 **숨은 요소**도 뺀다 — `[hidden]`·`display:none`·접힌 섹션은
               `offsetParent === null` 이다. 안 빼면 Tab 순환이 보이지 않는 곳에 착지해 "포커스가
               사라진 것처럼" 보인다(접힌 섹션 안 버튼 등). */
          ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
        : [];
    // 열릴 때 지정 요소(없으면 패널 첫 요소, 그것도 없으면 패널 자체)로 포커스. 렌더 직후 50ms.
    const tid = setTimeout(() => (initialRef?.current || focusables()[0] || root)?.focus(), 50);
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
  }, [active, panelRef, initialRef]);
}
