import { launch, prep, BASE, SEED } from './축1-lib.mjs';
const { browser, ctx } = await launch();
const page = await ctx.newPage();
await prep(page, {});
await page.goto(BASE + '/today', { waitUntil: 'load' });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const anchors = [...document.querySelectorAll('a[href]')].map((a) => ({
    href: a.getAttribute('href'), label: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 30),
    inNav: !!a.closest('nav'), navLabel: a.closest('nav')?.getAttribute('aria-label') || null }));
  return { url: location.href, title: document.title, anchors,
    mainText: (document.querySelector('main')?.innerText || '').slice(0, 300) };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
