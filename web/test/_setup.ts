/* ============================================================
   _setup.ts — 테스트 전역 설정(vitest `setupFiles`).

   ## 왜 있나 — `test:coverage` 만 간헐 실패하던 것의 실제 처방 (2026-07-30 · 선존 결함)

   `npm run test` 는 3/3 통과하는데 `npm run test:coverage` 는 3회 중 1~2회 실패했다. 실패는 늘
   같은 형태였다: `items`·`schedule` 처럼 **lazy(Suspense) feature 를 렌더하는 케이스**의
   `findByRole` timeout. 원인은 코드가 아니라 **대기 예산**이다 — Testing Library 의 비동기 유틸
   기본 대기는 **1000ms** 인데, v8 계측이 붙으면 lazy 청크의 import+평가가 그 예산을 넘긴다.

   ⚠ `testTimeout` 을 올리는 것으로는 **안 고쳐진다**(첫 시도가 그랬다). 그건 *케이스 전체*의
   상한이고, 여기서 터지는 것은 `findBy*` 내부의 `waitFor` 예산이라 별개 노브다. 증상이 같아서
   같은 노브로 보이는 함정.

   ⚠ 예산을 늘리는 것이 "테스트를 무르게 하는 것"이 아니다 — 단언은 그대로고, **없는 것을 없다고
   말하기까지 기다리는 시간**만 늘어난다. 진짜로 안 뜨는 요소는 여전히 실패하고, 느려지는 대가는
   실패 경로에서만 난다.

   ⚠ 왜 고치는 것이 중요한가: 이 상태로 두면 게이트가 **flaky 를 결함으로, 결함을 flaky 로** 읽는다
   (CLAUDE.md 가 명시한 함정). 이번 세션에서 실제로 E17 작업 중 6건이 실패해 회귀로 의심했고,
   이전 커밋을 stash 로 되돌려 같은 빈도로 실패함을 확인해야 판별이 됐다 — 그 판별 비용이 매번
   드는 게이트는 신뢰할 수 없다.
============================================================ */

/* ⚠ jsdom 케이스에만 적용한다. 이 저장소의 테스트 대부분은 **node 환경**(순수 lib)이고
   (`environment: 'node'` 기본 + 파일 상단 `@vitest-environment jsdom` 프라그마로 옵트인),
   Testing Library 를 무조건 import 하면 DOM 없는 환경에서 불필요한 부담·경고가 생긴다. */
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/dom');
  configure({ asyncUtilTimeout: 5_000 });
}
