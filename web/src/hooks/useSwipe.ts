/* ============================================================
   hooks/useSwipe.ts — 손가락 좌우 스와이프(+선택적 탭)를 요소에 붙이는 공유 훅(UX-B 팩).

   ## 왜 훅인가

   폰 앱에서 스와이프가 필요한 자리가 셋이다(복습 카드·일 뷰 날짜·주 뷰 날짜). 세 곳에
   각자 좌표 계산을 적으면 **축 우세 판정**이 세 벌로 갈리고, 그게 이 부류에서 가장 흔한
   결함이다 — 세로로 스크롤하려는 손짓을 가로 스와이프로 오인해 화면이 제멋대로 넘어간다.
   판정은 한 곳에만 산다.

   ## 설계 결정 (전부 실패 모드에서 역산했다)

   1. **축을 한 번 정하면 안 바꾼다.** 첫 8px 에서 |dx|>|dy| 면 'x', 아니면 'y' 로 잠근다.
      매 프레임 다시 비교하면 대각선 손짓이 축을 오가며 스크롤과 스와이프가 함께 일어난다.
      'y' 로 잠기면 그 제스처는 **끝까지** 스와이프가 아니다(스크롤 중 오발화 0).
   2. **포인터 캡처를 쓰지 않는다.** 캡처는 손가락이 요소를 벗어나도 pointerup 을 받게 해
      주지만, 캡처 중 `click` 의 타깃이 캡처 요소로 바뀌는 엔진이 있어 **안에 있는 버튼이
      죽는다**. 이 팩의 전제는 "버튼은 전부 유지"(a11y·focus-visible 계약)라 캡처를 버리고
      버블링 + `pointercancel`/`pointerleave` 정리로 간다.
   3. **스와이프가 성립하면 뒤따르는 click 을 삼킨다.** 버튼 위에서 손을 떼면 스와이프와
      버튼 클릭이 **둘 다** 일어난다(브라우저는 이동량과 무관하게 click 을 낸다).
      캡처 단계에서 한 번만 막는다.
   4. **탭은 상호작용 요소 위에서 발화하지 않는다.** 카드 전체가 '펼치기'인 화면에서
      '건너뛰기' 버튼을 누르면 펼치기까지 함께 일어난다 — 버튼은 자기 일만 해야 한다.
   5. **마우스는 무시한다.** 텍스트 드래그 선택이 스와이프로 읽히면 데스크톱에서 폰 화면을
      열어 본 사람에게 화면이 튄다. 손가락·펜만 받는다.

   ⚠ 이 훅은 **모션이 아니다** — 상태를 바꿀 뿐 애니메이션을 걸지 않으므로 reduced-motion
     가드가 필요 없다(모션을 얹는 쪽이 `lib/motion` 을 쓴다).
   ⚠ 화살표 버튼을 대체하지 **않는다**. 스와이프는 어포던스가 숨어 있어 발견성이 낮고
     키보드·스위치 접근에는 아예 닿지 않는다 — 버튼이 정본, 스와이프는 그 위의 편의다.
============================================================ */
import { useRef } from 'react';
import type { DOMAttributes } from 'react';

export interface SwipeHandlers {
  /** 왼쪽으로 밀었다 = "다음"(다음 날/다음 카드) — 내용이 왼쪽으로 빠지는 방향. */
  onSwipeLeft?: () => void;
  /** 오른쪽으로 밀었다 = "이전". */
  onSwipeRight?: () => void;
  /** 짧게 눌렀다 뗐다(움직임 거의 없음). 상호작용 요소 위에서는 발화하지 않는다. */
  onTap?: () => void;
}

export interface SwipeOptions {
  /** 스와이프로 인정할 최소 가로 이동(px). 기본 60 — 실수로 넘어가지 않을 만큼. */
  threshold?: number;
  /** 축을 정하는 최소 이동(px). 이보다 작으면 아직 방향을 모른다. */
  axisLock?: number;
  /** 탭으로 인정할 최대 이동(px). */
  tapSlop?: number;
}

/** 탭을 삼켜야 하는 자리 — 자기 동작을 이미 가진 것들. */
const INTERACTIVE = 'a,button,input,select,textarea,label,[role="button"],[contenteditable="true"]';

interface Track {
  id: number;
  x: number;
  y: number;
  axis: 'x' | 'y' | null;
}

/**
 * 좌우 스와이프 핸들러 묶음을 만든다. 반환값을 요소에 그대로 펼친다.
 *
 * ```tsx
 * const swipe = useSwipe({ onSwipeLeft: next, onSwipeRight: prev });
 * return <section {...swipe}>…</section>;
 * ```
 */
export function useSwipe(handlers: SwipeHandlers, options?: SwipeOptions): DOMAttributes<HTMLElement> {
  const threshold = options?.threshold ?? 60;
  const axisLock = options?.axisLock ?? 8;
  const tapSlop = options?.tapSlop ?? 10;

  // 렌더 중엔 읽지도 쓰지도 않는다(핸들러 전용) → React Compiler 의 ref 규칙과 무관.
  const track = useRef<Track | null>(null);
  const swallowClick = useRef(false);
  /* ⚠ 콜백을 ref 에 미러링하지 않는다 — React Compiler 가 렌더 중 ref 쓰기를 막기도 하지만,
     애초에 필요가 없다: 이 객체는 매 렌더 새로 만들어져 DOM 에 다시 붙으므로 핸들러는 늘 최신이다.
     제스처 도중 리렌더가 나도 pointerup 은 그때의 최신 클로저를 부른다. */

  const reset = (): void => {
    track.current = null;
  };

  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') return;
      swallowClick.current = false; // 앞선 제스처의 잔재가 다음 클릭을 삼키지 않게
      track.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null };
    },
    onPointerMove: (e) => {
      const t = track.current;
      if (!t || t.id !== e.pointerId || t.axis) return; // 축이 정해졌으면 더 볼 것 없다
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      if (Math.abs(dx) < axisLock && Math.abs(dy) < axisLock) return;
      t.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    },
    onPointerUp: (e) => {
      const t = track.current;
      reset();
      if (!t || t.id !== e.pointerId) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;

      if (t.axis === 'x' && Math.abs(dx) >= threshold) {
        swallowClick.current = true; // 버튼 위에서 뗐어도 그 버튼이 눌리면 안 된다
        (dx < 0 ? handlers.onSwipeLeft : handlers.onSwipeRight)?.();
        return;
      }
      if (t.axis === null && Math.abs(dx) <= tapSlop && Math.abs(dy) <= tapSlop) {
        const el = e.target;
        if (el instanceof Element && el.closest(INTERACTIVE)) return; // 버튼은 자기 일만
        handlers.onTap?.();
      }
    },
    onPointerCancel: reset, // 브라우저가 스크롤을 가져갔다
    onPointerLeave: reset, // 캡처를 안 쓰므로 요소를 벗어나면 이 제스처는 포기한다
    onClickCapture: (e) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}
