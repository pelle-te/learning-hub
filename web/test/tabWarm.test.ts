/* ============================================================
   tabWarm.test.ts — **첫 라우트는 `lazy` 를 거치지 않는다**(부팅 260ms · 2026-08-01 실측).

   ## 왜 이 파일이 있나 — 없으면 조용히 되돌아온다

   콜드 부팅의 `boot:app→first-data` 가 **260ms** 였고, 그 구간은 **네트워크 요청 0 · 롱태스크 0 ·
   CPU 91.6% idle** 이었다. 범인은 React 가 Suspense **폴백 커밋 뒤** 거는 `setTimeout(≈248ms)`
   (깜빡임 억제)였다. 청크는 `modulepreload` 로 이미 와 있었으므로 **바이트를 깎아도 1ms 도 안
   움직였다** — `npm run budget` 4축 전부가 원리적으로 못 보는 층이다.

   ⚠ 그리고 **1차 처방이 실측으로 기각됐다**: 렌더 전에 `loader()` 를 await 해 모듈 캐시를 덥혔지만
   간격은 260 → 260 이었다. `React.lazy` 는 모듈이 캐시에 있어도 **첫 렌더에서 반드시 한 번
   throw** 하기 때문이다(이미 이행된 프라미스를 동기로 읽을 수 없다). 그래서 `warmTab` 은 캐시를
   덥히는 데서 그치지 않고 **해석된 컴포넌트를 `getReactTab` 이 돌려주게** 만든다.

   → 여기서 잠그는 것은 그 **한 가지 성질**이다: 덥힌 뒤의 `getReactTab` 은 `lazy` 가 아니다.
   이게 깨지면 260ms 가 돌아오는데 게이트는 전부 녹색이다(시각 스냅샷은 최종 정지 상태만 본다).
============================================================ */
import { describe, expect, it } from 'vitest';
import { getReactTab, warmTab, LOADERS } from '@/features/registry';

/** `React.lazy` 가 만든 것인가 — lazy 는 `$$typeof: Symbol(react.lazy)` 를 갖는다. */
const isLazy = (c: unknown): boolean =>
  typeof c === 'object' && c !== null && String((c as { $$typeof?: symbol }).$$typeof) === 'Symbol(react.lazy)';

describe('warmTab — 부팅 라우트가 Suspense 를 안 타게 한다', () => {
  it('덥히기 전에는 `lazy` 다(다른 탭은 지연 로드가 맞다)', () => {
    expect(isLazy(getReactTab('stats')), 'lazy 가 아니면 전 탭이 초기 번들에 실린다').toBe(true);
  });

  /* ⚠⚠ **모듈 캐시를 먼저 덥힌다 — 이 케이스가 시계에 의존하지 않게**(2026-08-07 · W6).
     `warmTab` 은 설계상 `WARM_CAP_MS`(1500ms) 와 **경주**한다(느린 청크에 부팅을 인질로 잡히지
     않으려는 제품 결정이고, 그 경주 자체는 옳다). 그런데 전체 스위트를 한 번에 돌리면 vitest 의
     변환 부하 때문에 첫 `import` 가 그 상한을 넘길 수 있고, 그러면 이 케이스만 **단독 실행에선
     통과하고 전체에선 실패**한다 — 즉 결함이 아니라 부하를 재게 된다(이 저장소가 flaky 를
     "결함으로, 결함을 flaky 로" 읽는다고 경고한 그 형태).
     먼저 같은 로더를 await 해 모듈 캐시를 채우면 `warmTab` 안의 `loader()` 가 즉시 이행되고,
     그 뒤 재는 것은 **`warmed` 에 실제 컴포넌트가 들어가는가** 하나로 좁혀진다(원래 명제). */
  it('덥힌 뒤에는 **lazy 가 아닌 실제 컴포넌트**를 돌려준다', async () => {
    await LOADERS.today!();
    await warmTab('today');
    const c = getReactTab('today');
    expect(c).toBeTruthy();
    expect(isLazy(c), 'lazy 로 남으면 첫 렌더가 throw → 폴백 커밋 → React 억제 260ms 가 돌아온다').toBe(false);
    expect(typeof c === 'function' || typeof c === 'object').toBe(true);
  });

  it('같은 키를 다시 덥혀도 **identity 가 안 바뀐다** — 바뀌면 React 가 remount 해 탭 상태가 날아간다', async () => {
    await warmTab('today');
    const a = getReactTab('today');
    await warmTab('today');
    expect(getReactTab('today')).toBe(a);
  });

  it('`LOADERS` 에 없는 키(`/subject/:id`·`/mini`·오타 딥링크)는 즉시 통과한다', async () => {
    expect(LOADERS['subject']).toBeUndefined();
    await expect(warmTab('subject')).resolves.toBeUndefined();
    expect(getReactTab('subject')).toBeNull();
  });
});
