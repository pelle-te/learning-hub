import { launch, prep, BASE } from './축1-lib.mjs';
const { browser, ctx } = await launch();
const page = await ctx.newPage();
await prep(page, {});
await page.goto(BASE + '/today', { waitUntil: 'load' });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const navs = [...document.querySelectorAll('nav')].map((n) => ({ label: n.getAttribute('aria-label'),
    children: [...n.querySelectorAll('a,button')].map((e) => ({ tag: e.tagName, href: e.getAttribute('href'),
      dataTab: e.getAttribute('data-tab'), aria: e.getAttribute('aria-label'), txt: (e.textContent||'').trim().slice(0,20) })) }));
  return { navs, bodyClass: document.body.className, viewport: [innerWidth, innerHeight],
    rootHtml: document.getElementById('root')?.firstElementChild?.outerHTML.slice(0, 1200) };
});
console.log(JSON.stringify(info, null, 1).slice(0, 6000));
await browser.close();
