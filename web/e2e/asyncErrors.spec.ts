import { test, expect, expectAsyncFailures, asyncFailures } from './_test';
import { A11Y_EXTRA, TABS, boot, settle } from './_fixtures';

/* ============================================================
   asyncErrors.spec.ts — **전 화면 순회의 비동기 실패**(C067 · 2026-08-22 · 근본 원인 **R2**).

   ## 무엇이 비어 있었나 — 셋이 동시에 0이었다

   코드 축 1회차가 **R2** 를 *"비동기 실패가 어느 층에도 안 걸린다"* 로 세웠고 근거가 셋이었다:
   · 타입 인지 린트 **off** → `C051` 이 켰다(위반 114 → 0).
   · `unhandledrejection` 핸들러 **0건**(`lib/telemetry.ts` 가 I052 에 걷혔다).
   · **e2e 가 `pageerror` 를 검사하지 않는다**(저장소 전체에 `phone.spec.ts` 한 곳뿐이었다).

   ## ⚠⚠ 이 파일만으로는 부족하다 — 그 사실이 이 파일의 절반이다

   `C051` 이 범위 밖에 둔 **69곳**(`onClick={async …}`)은 **눌러야** 거부가 난다. 아래 순회는
   화면을 *열* 뿐이라 그 부류를 원리적으로 못 본다 — 실제로 **0건**이 나오는데, 그 0은
   «없다»가 아니라 «이 순회는 안 누른다»다. 누르는 것은 `smoke`·`plan`·`visual`·`a11y` 이고,
   그래서 감시는 **`./_test` 의 `test` 래퍼**로 올라가 트랙 A 전량이 자동으로 덮인다.
   여기 남는 것은 «부팅·라우팅 경로에서 나는 것» 축이다.

   ⚠ 트랙 A(Chromium + `vite preview`)라 **WebView2 에서만 나는 것은 못 본다**(트랙 B 의 몫).
============================================================ */

/* ⚠ 배열 타입을 **명시한다**(V068 · 2026-09-01). `TABS.map(...)` 과 `A11Y_EXTRA` 를 그냥 이으면
   합집합 타입이 되어 `'prep' in 화면 && 화면.prep(page)` 가 **호출 불가**로 잡힌다. 이 파일이
   어느 타입 검사에도 안 걸려 있어서 그 사실이 드러난 적이 없었다(`a11y.spec.ts` 는 같은 자리에
   이미 `검사화면[]` 을 적어 두고 있었다 — 관용구가 한 곳에만 있었던 것이다). */
type 순회화면 = {
  key: string;
  path: string;
  prep?: (page: import('@playwright/test').Page) => Promise<void>;
  ready?: (page: import('@playwright/test').Page) => Promise<unknown>;
};
const 화면들: 순회화면[] = [...TABS.map((t) => ({ key: t, path: '/' + t })), ...A11Y_EXTRA];

test('⚠⚠ 전 화면을 도는 동안 잡히지 않은 비동기 실패가 0이다 (R2 의 셋째 축)', async ({ page }) => {
  await boot(page, 'dark');

  for (const 화면 of 화면들) {
    if ('prep' in 화면 && 화면.prep) await 화면.prep(page);
    await page.goto(화면.path);
    if ('ready' in 화면 && 화면.ready) await 화면.ready(page);
    await settle(page);
  }
  /* 단언은 `_test` 의 auto 픽스처가 케이스 종료 시 한다 — 여기서 또 하면 두 벌이 된다.
     대신 «순회가 실제로 돌았는가»(0의 분모)를 남긴다. */
  expect(화면들.length, '로스터가 비었다 — 이 케이스가 아무것도 안 잰다').toBeGreaterThan(10);
});

test('⚠⚠ 감시가 진짜로 잡는다 — 일부러 던져 확인한다(조용한 통과 방어)', async ({ page }) => {
  /* ⚠ 이 케이스가 없으면 위 「0건」이 «리스너가 안 붙어서 0» 인지 구분할 수 없다.
     예외를 **선언**으로 둔다(무시 목록이 아니라) — 무시 목록은 조용히 자라지만 선언은 여기 보인다. */
  expectAsyncFailures(page, 2);
  await boot(page, 'dark');
  await page.goto('/today');

  await page.evaluate(() => {
    void Promise.reject(new Error('의도된 거부(테스트)'));
    setTimeout(() => {
      throw new Error('의도된 동기 예외(테스트)');
    }, 0);
  });
  await settle(page);

  const kinds = new Set(asyncFailures(page).map((f) => f.kind));
  expect(kinds.has('rejection'), '떠 있는 거부를 못 잡는다 — 위 케이스의 0은 무의미하다').toBe(true);
  expect(kinds.has('pageerror'), '동기 예외를 못 잡는다').toBe(true);
});
