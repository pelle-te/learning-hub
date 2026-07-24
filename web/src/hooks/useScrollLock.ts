/* ============================================================
   useScrollLock — 모달/오버레이가 떠 있는 동안 배경 스크롤을 잠근다.

   왜: `aria-modal="true"` 는 "뒤는 비활성"이라고 **선언**하는데, 실제로는 오버레이 위에서
   휠·트랙패드가 뒤 문서를 계속 굴렸다. 확인창을 띄운 채 스크롤하면 배경이 움직여
   되돌아올 자리를 잃는다(모바일에서 특히 — 오버레이를 닫으면 엉뚱한 위치에 있다).
   useFocusTrap 이 '포커스가 새지 않게' 하는 것과 같은 짝의 문제다.

   ⚠ 잠글 때 스크롤바가 사라지며 생기는 **폭 점프**를 padding 으로 보정한다. 안 하면
   확인창이 뜰 때마다 배경 레이아웃이 15px 씩 옆으로 튄다(스크롤바가 겹치기형이면 0).
   ⚠ 원래 인라인 값을 기억해 복원한다 — 빈 문자열로 되돌리면 다른 곳이 건 인라인 값을
   지워 버린다. 오버레이가 겹칠 수 있으므로 **참조 카운트**로 마지막 하나가 풀 때만 복원.
============================================================ */
import { useEffect } from 'react';

let depth = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    if (depth === 0) {
      saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
      const gap = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = 'hidden';
      if (gap > 0) body.style.paddingRight = `${gap}px`;
    }
    depth += 1;
    return () => {
      depth -= 1;
      if (depth === 0 && saved) {
        body.style.overflow = saved.overflow;
        body.style.paddingRight = saved.paddingRight;
        saved = null;
      }
    };
  }, [active]);
}
