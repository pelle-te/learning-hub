/* ============================================================
   swfix.spec.ts — **서비스워커가 다른 엔트리를 먹지 않는가**(2026-08-01).

   ## 왜 별도 스펙인가 — 트랙 A 는 이 층을 원리적으로 못 본다

   `playwright.config.ts` 는 `serviceWorkers: 'block'` 이다. 그 선택은 옳다(옛 precache 가
   스냅샷을 stale 하게 만드는 것을 막는다) — 하지만 그 대가로 **SW 가 일으키는 결함은 시각
   게이트에서 정의상 관측 불가**다. 이 파일이 그 사각 하나를 덮는다.

   ## 무엇이 났었나 (이 스펙의 존재 이유)

   C-6 이후 `index.html`(웹)과 `phone.html`(폰)이 **같은 Workers 오리진**에서 나가는데
   `navigateFallback: 'phone.html'` 이 범위 제한 없이 걸려 있었다. 그래서 `/phone` 을 한 번
   열면 SW 가 등록되고, 그 뒤 `/`·`/items`·`/today` 가 전부 **폰의 등록 코드 화면**이 됐다 —
   웹 진입점이 통째로 도달 불가. 라이브 배포 첫날 사용자가 보고했고, 재현·반증으로 확정했다
   (허용 목록을 빼면 이 케이스가 즉시 빨개진다 — 실제로 그렇게 확인했다).

   ⚠ **새 컨텍스트로 프로브하면 매번 초록이다**(SW 미등록). 이 결함의 조건은 "폰을 먼저 연
     적이 있다"이므로 **한 컨텍스트 안에서 순서대로** 방문해야 한다 — 아래가 그 형태다.
============================================================ */
import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'allow' });

/* ⚠ 이 케이스가 검사하는 것은 **두 엔트리가 한 오리진을 공유한다**는 사실이다.
   트랙 A 는 `serviceWorkers: 'block'` 이라 정의상 이 층을 못 본다 — 그래서 여기만 켠다. */
test('폰을 먼저 열어도 웹 루트가 웹으로 남는다(navigateFallback 범위)', async ({ page }) => {
  await page.goto('/phone.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20000 });
  expect(await page.evaluate(() => !!navigator.serviceWorker?.controller)).toBe(true);

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const t = await page.evaluate(() => document.body.innerText);
  console.log('ROOT TEXT:', JSON.stringify(t.trim().slice(0, 80)));
  // 폰의 연결 화면이 아니라 웹 셸이어야 한다.
  expect(t).not.toContain('등록 코드');
  expect(await page.locator('#main').count()).toBeGreaterThan(0);

  // 그리고 폰은 여전히 폴백을 받는다(오프라인 껍데기가 죽지 않았다).
  await page.goto('/phone', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => document.body.innerText)).toContain('러닝허브');
});
