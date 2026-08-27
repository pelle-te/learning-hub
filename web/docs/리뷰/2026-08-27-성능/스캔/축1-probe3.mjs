import { launch, prep, waitBooted, BASE, SEED, scaleSeed } from './축1-lib.mjs';
const { browser, ctx } = await launch();
const page = await ctx.newPage();
await prep(page, { seed: scaleSeed(10) });
const list = async (p) => page.evaluate(() => [...document.querySelectorAll('main button, main input, main [role="button"], main [role="checkbox"], main a')]
  .slice(0, 45).map((e) => ({ tag: e.tagName, type: e.getAttribute('type'), role: e.getAttribute('role'),
    aria: e.getAttribute('aria-label'), txt: (e.textContent || '').trim().slice(0, 26), cls: (typeof e.className === 'string' ? e.className : '').slice(0, 40) })));
for (const path of ['/today', '/alloc', '/review-run', '/stats', '/ledger', '/day']) {
  await page.goto(BASE + path, { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(1200);
  console.log('=====', path, await page.evaluate(() => location.pathname + location.search));
  console.log(JSON.stringify(await list(page)));
}
await browser.close();
