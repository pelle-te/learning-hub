// @vitest-environment jsdom
/* ============================================================
   motionAxis.test.ts — **모션 자제 판정은 축이 하나다**(H19 · 2026-07-30 `/감사 근본`).

   자제해야 할 이유는 둘이다: OS 의 `prefers-reduced-motion` 과 앱 설정 '발광 효과 줄이기'
   (`data-fx="lite"`). 그런데 판정이 다섯 곳에 흩어져 있었고 **그중 둘만 후자를 알았다.**
   결과는 관측 가능한 거짓말이었다 — 설정 라벨이 "배경 오로라·**발광 펄스 정지**"를 약속하는데
   `commit()` 의 액센트 링 펄스는 계속 돌았다. `data-fx=lite` 의 CSS 백스톱은 **WAAPI 에
   원리적으로 안 닿기** 때문이고, 그건 `lib/motion.ts` 가 존재하는 이유와 정확히 같은 논거인데
   가드만 절반이었다.

   ⚠ 여기서 잠그는 것은 판정 함수 하나가 아니라 **약속의 이행**이다: 설정을 켜면 명령형 모션이
   실제로 멈추는가.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commit, prefersReducedMotion } from '@/lib/motion';

/** `matchMedia` 를 원하는 값으로 세운다(jsdom 기본은 미구현). */
function setOsReduce(on: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const animate = vi.fn(() => ({}) as Animation);
function fakeEl(): HTMLElement {
  const el = document.createElement('div');
  (el as unknown as { animate: unknown }).animate = animate;
  return el;
}

beforeEach(() => {
  animate.mockClear();
  setOsReduce(false);
  document.documentElement.removeAttribute('data-fx');
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-fx');
});

describe('판정 — 두 이유가 한 축으로 합쳐진다', () => {
  it('둘 다 꺼져 있으면 자제 아님', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('OS 설정만으로도 자제', () => {
    setOsReduce(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('⚠ **앱 설정만으로도 자제** — 종전엔 이 이유를 아는 곳이 다섯 중 둘뿐이었다', () => {
    document.documentElement.setAttribute('data-fx', 'lite');
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('⚠ 약속의 이행 — "발광 펄스 정지"가 실제로 지켜진다', () => {
  it('평소엔 commit 링이 돈다(이 검사가 반대 방향도 잰다)', () => {
    commit(fakeEl());
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('OS 자제면 안 돈다(종전에도 지켜지던 절반)', () => {
    setOsReduce(true);
    commit(fakeEl());
    expect(animate).not.toHaveBeenCalled();
  });

  it('⚠ **앱 설정으로도 안 돈다** — CSS 백스톱은 WAAPI 에 원리적으로 안 닿는다', () => {
    document.documentElement.setAttribute('data-fx', 'lite');
    commit(fakeEl());
    expect(
      animate,
      '설정 라벨이 "발광 펄스 정지"를 약속하는데 돌면 그건 화면이 하는 거짓말이다',
    ).not.toHaveBeenCalled();
  });
});
