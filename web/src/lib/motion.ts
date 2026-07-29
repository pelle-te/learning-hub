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

/** 같은 판정을 **인라인 스타일**에서 써야 하는 자리용(H16) — 판정 자체는 여전히 한 곳이다.
 *  (`Items` 의 하이라이트 펄스처럼 스크롤이 아니라 transition 문자열을 고르는 경우.) */
export function prefersReducedMotion(): boolean {
  return reduced();
}

/* ── D-7 모션 어휘 — 이 앱의 움직임은 네 마디만 말한다 ────────────────────
   키프레임이 35개였다(fade 9종·pulse 5종·pop 3종·slide 3종이 **같은 일을 이름만 달리**).
   이름이 많다는 것은 문법이 없다는 뜻이고, 문법이 없으면 새 화면마다 새 움직임이 생긴다.
   움직임이 말할 수 있는 것은 넷뿐이다:

   · **enter**   — 처음 존재하게 됨(없던 것이 생김). 짧은 페이드 + 미세 상승.
   · **commit**  — **내 행동이 반영됨**(아래 `commit()`). 1회 · 액센트 링 · 되돌아옴.
   · **live**    — 시스템이 스스로 변함(지금 진행 중·수신 중). **무한 애니는 여기만 허용**.
   · **transit** — 화면과 화면 사이(뷰 트랜지션 · D-8 이 방향 문법을 준다).

   ⚠ 예외는 **1페이지 1개**까지 — 시그니처 비주얼(오늘 히어로 오로라 등)은 정체성이라 문법
     밖에 둔다. 예외 없는 문법은 원칙 3(시그니처 하나)을 죽인다.
   ⚠ CSS 로 표현된 enter/live 는 키프레임이 소유하고, 여기 있는 것은 **명령형(WAAPI)** 뿐이다
     — 이유는 이 파일 머리주석(전역 reduced-motion 백스톱이 WAAPI 에 안 닿는다). */

/** `commit` 의 유일한 길이 — 340ms. 눈이 알아채되 다음 동작을 막지 않는 값. */
const COMMIT_MS = 340;

/**
 * **commit** — "내가 한 것이 반영됐다"를 그 자리에서 1회 번쩍인다(안쪽 액센트 링).
 * @param el    대상. `animate` 가 없는 환경(jsdom 등)에서는 아무 일도 안 한다.
 * @param color 계산된 색. 생략·`var(...)` 이면 그 요소에서 `--acc` 를 풀어 쓴다(토큰은 원천에 있다).
 *
 * 무한 반복·펄스가 아니라 **1회**다 — 상시 움직이는 요소는 주의를 계속 훔치고, 이 앱의
 * 넛지 원칙(발광·펄스 남발 금지)에 정면으로 어긋난다.
 *
 * ⚠ **성공 신호가 토스트뿐이면 안 된다.** 토스트는 화면 구석에서 뜨고 사라지므로 "무엇이"
 *   바뀌었는지를 말하지 못한다. 값이 바뀐 자리에서 번쩍이는 것이 그 답이다.
 */
/**
 * **reveal** — 요소를 보이는 곳으로 스크롤한다. 모션 자제면 즉시 점프(H16 · 2026-07-26 감사).
 *
 * `scrollIntoView({behavior:'smooth'})` 는 **인자가 CSS 백스톱을 이긴다** — `scroll-behavior`
 * 를 눌러도 명령형 인자가 그대로 산다. 그래서 이 판정이 호출부마다 복제돼 있었고, 4곳 중
 * 한 곳(`journal/shared.tsx`)만 가드를 빠뜨려 새고 있었다. 판정이 여러 곳에 흩어진 것이
 * 원인이므로 처방은 "그 한 줄을 고치기"가 아니라 **판정을 한 곳으로 모으기**다.
 *
 * ⚠ 이 파일에 두는 이유: WAAPI 와 같은 부류의 결함이다(전역 CSS 백스톱이 원리적으로 안 닿는
 * 명령형 모션). 머리주석의 논거가 그대로 적용된다.
 */
export function reveal(el: Element | null | undefined, block: ScrollLogicalPosition = 'center'): void {
  el?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block });
}

export function commit(el: HTMLElement | null | undefined, color = 'var(--acc)'): void {
  if (!el || typeof el.animate !== 'function' || reduced()) return;
  const ring = color.startsWith('var(')
    ? getComputedStyle(el).getPropertyValue('--acc').trim() || 'currentColor'
    : color;
  el.animate([{ boxShadow: `inset 0 0 0 2px ${ring}` }, { boxShadow: 'inset 0 0 0 2px transparent' }], {
    duration: COMMIT_MS,
    easing: 'ease-out',
  });
}
