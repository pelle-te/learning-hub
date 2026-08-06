/* ============================================================
   lib/visibility.ts — "화면이 보이게 됐다 / 숨었다"의 **한 벌**(M-4 · 2026-08-06 감사).

   이 앱에는 `document.addEventListener('visibilitychange', …)` 가 **11벌** 있었다. 하나하나는
   서너 줄이지만 사본이 열한 개가 되면 값이 세 가지로 갈린다:

   · **조건의 철자가 둘이다** — `document.visibilityState === 'visible'` 과 `!document.hidden`,
     그리고 `document.hidden`. 같은 뜻인데 읽는 사람이 매번 대조해야 하고, 새로 쓰는 사람은
     가까운 사본을 복사한다(그래서 갈림이 유지된다).
   · **떼는 것을 손으로 짝지어야 한다** — 등록과 해제가 다른 줄, 종종 다른 화면(cleanup 목록의
     한가운데)에 있다. 짝이 어긋나도 아무 게이트가 안 잡는다.
   · **플랫폼 사실을 적을 자리가 없다** — 아래 ⚠ 는 `syncController` 가 W24 에서 실측으로
     확정한 것인데, 그 지식이 그 파일 안에만 있어서 나머지 열 사본은 모른 채로 산다.

   ⚠⚠ **`visibilitychange` 는 "이 앱으로 돌아왔다"가 아니다.** `document.hidden` 은 창이
   가려지거나 최소화될 때 바뀌고, **보이는 채로 포커스만 잃는 것**(alt-tab)은 그 상태를 안
   바꾼다. 포커스 복귀까지 덮어야 하면 `window` 의 `focus` 를 **따로** 걸어야 한다 — 실제로
   `syncController` 와 `useTodayISO` 가 그렇게 한다. 이 모듈은 그 사실을 숨기지 않는다(덮어
   주는 척하면 호출부가 안 잡히는 구간을 잡힌다고 믿는다).

   ## 여기 안 오는 것 (의도)

   `components/AmbientCanvas` 와 `useTodayISO` 는 이 이벤트를 **"무언가 바뀌었으니 다시 판정"**
   의 여러 트리거 중 하나로 쓴다(`focus`·`blur`·`reduce.change` 와 **같은 핸들러**를 공유한다).
   `onVisible`/`onHidden` 으로 접으면 그 대칭이 깨지고 한쪽 방향만 남는다 — 이 모듈이 파는 것은
   *방향이 있는* 두 사건이고, 저쪽이 원하는 것은 *방향 없는* 재판정이다. 다른 것을 같게 만들지
   않는다.
============================================================ */

/** 이벤트를 걸 수 없는 환경(SSR·워커·일부 테스트)에서 조용히 무동작이 되게. */
const NOOP = (): void => undefined;

function on(when: 'visible' | 'hidden', cb: () => void): () => void {
  if (typeof document === 'undefined') return NOOP;
  const h = (): void => {
    if ((document.visibilityState === 'visible') === (when === 'visible')) cb();
  };
  document.addEventListener('visibilitychange', h);
  return () => document.removeEventListener('visibilitychange', h);
}

/**
 * 화면이 **보이게 될 때** 부른다. 반환값이 해제 함수다(등록과 해제가 한 값이라 짝이 어긋날 수 없다).
 *
 * ⚠ 위 머리주석 — alt-tab 복귀는 이걸로 안 잡힌다. 그 구간까지 필요하면 `window` `focus` 를 함께.
 */
export function onVisible(cb: () => void): () => void {
  return on('visible', cb);
}

/**
 * 화면이 **숨을 때** 부른다. "떠나기 직전 1회"를 쓰는 자리의 정본 트리거다.
 *
 * ⚠ `pagehide` 가 아니라 이쪽인 이유: 데스크톱 셸은 창을 닫아도 `pagehide` 가 보장되지 않고
 * (WebView2), 반대로 최소화·앱 전환은 이 이벤트가 정확히 잡는다(`app/useLeaveCursor.ts` 실측).
 */
export function onHidden(cb: () => void): () => void {
  return on('hidden', cb);
}
