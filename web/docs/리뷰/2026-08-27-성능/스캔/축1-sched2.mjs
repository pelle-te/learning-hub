import { launch, prep, waitBooted, BASE, scaleSeed } from './축1-lib.mjs';
const { browser, ctx } = await launch({ reduce: true });
const page = await ctx.newPage();
await prep(page, { seed: scaleSeed(10) });
await page.goto(BASE + '/today', { waitUntil: 'load' });
await waitBooted(page); await page.waitForTimeout(1300);
await page.evaluate(() => { window.__L = []; new PerformanceObserver((l) => { for (const e of l.getEntries())
  window.__L.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), srcs: [...(e.sources||[])].map((s) => ({
    sel: s.node && s.node.nodeName ? s.node.nodeName + (typeof s.node.className==='string'&&s.node.className?'.'+s.node.className.trim().split(/\s+/).slice(0,4).join('.'):'') : '?',
    prev: s.previousRect?[Math.round(s.previousRect.x),Math.round(s.previousRect.y),Math.round(s.previousRect.width),Math.round(s.previousRect.height)]:null,
    cur: s.currentRect?[Math.round(s.currentRect.x),Math.round(s.currentRect.y),Math.round(s.currentRect.width),Math.round(s.currentRect.height)]:null })) }); })
  .observe({ type: 'layout-shift', buffered: false }); });
for (const label of ['찾기', '계획', '연동 현황', '통계']) {
  const b = await page.evaluate(() => window.__L.length);
  await page.evaluate((l) => { [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find((x) => (x.getAttribute('aria-label')||'').startsWith(l)).click(); }, label);
  await page.waitForTimeout(1200);
  const ls = await page.evaluate((i) => window.__L.slice(i), b);
  console.log('## →', label, 'sum=' + ls.reduce((a,x)=>a+x.v,0).toFixed(4));
  for (const s of ls) { console.log('   v=' + s.v); for (const q of s.srcs.slice(0,4)) console.log('      ', q.sel, JSON.stringify(q.prev), '->', JSON.stringify(q.cur)); }
}
await browser.close();
