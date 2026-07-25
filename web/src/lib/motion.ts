/* ============================================================
   lib/motion.ts — **명령형 모션**(WAAPI)의 공유 진입점.

   ## 왜 이 파일이 따로 있는가

   이 앱의 모션 자제(reduced-motion) 방어선은 `styles/global/features.css` 의 전역 백스톱이다 —
   `animation-duration/transition-duration` 을 0.001ms 로 눌러 **CSS 로 표현된 모션 전부**를 죽인다.
   그런데 **Web Animations API 는 그 백스톱이 원리적으로 안 닿는다**: WAAPI 애니메이션은 CSS
   캐스케이드가 아니라 애니메이션 타임라인에 직접 얹히므로, CSS 로는 취소할 수단이 없다.

   즉 "전역 CSS 가 알아서 막아 준다"는 이 저장소의 다른 자리에서 맞는 가정이 여기서만 틀리고,
   틀린 결과가 **조용하다**(모션 민감 사용자의 화면에서만 애니가 남는다 · 정적 검사·스냅샷 어느
   쪽도 못 본다). 그래서 명령형 모션은 전부 이 파일을 거치고, 가드는 여기 한 곳에만 산다.

   ⚠ 키프레임 값에 `var(--토큰)` 을 그대로 싣지 않는다 — WAAPI 의 커스텀 프로퍼티 치환은 엔진마다
     갈려 조용히 무애니가 된다. 색은 **계산값**으로 받는다(호출부가 이미 아는 값이면 그대로 넘긴다).
============================================================ */

/** 모션 자제 설정인가. matchMedia 가 없는 환경(테스트·SSR)에서는 '자제 아님'으로 본다. */
function reduced(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 요소에 안쪽 링을 한 번 번쩍인다 — "방금 여기에 무슨 일이 있었다"는 착지 신호.
 * @param el    대상. `animate` 가 없는 환경(jsdom 등)에서는 아무 일도 안 한다.
 * @param color 계산된 색. `var(...)` 참조면 그 요소에서 `--acc` 를 풀어 쓴다(토큰은 원천에 있다).
 *
 * 무한 반복·펄스가 아니라 **1회**다 — 상시 움직이는 요소는 주의를 계속 훔치고, 이 앱의
 * 넛지 원칙(발광·펄스 남발 금지)에 정면으로 어긋난다.
 */
export function pulseRing(el: HTMLElement, color: string): void {
  if (typeof el.animate !== 'function' || reduced()) return;
  const ring = color.startsWith('var(')
    ? getComputedStyle(el).getPropertyValue('--acc').trim() || 'currentColor'
    : color;
  el.animate([{ boxShadow: `inset 0 0 0 2px ${ring}` }, { boxShadow: 'inset 0 0 0 2px transparent' }], {
    duration: 340,
    easing: 'ease-out',
  });
}
