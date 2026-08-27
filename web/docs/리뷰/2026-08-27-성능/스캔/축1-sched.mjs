import { launch, prep, waitBooted, BASE, scaleSeed, SEED } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const SCALE = Number(process.env.SCALE || 10);
const { browser, ctx } = await launch({ reduce: true });
const page = await ctx.newPage();
await prep(page, { seed: SCALE > 1 ? scaleSeed(SCALE) : SEED });
await page.goto(BASE + '/today', { waitUntil: 'load' });
await waitBooted(page); await page.waitForTimeout(1400);
await page.evaluate(() => { window.__L = []; new PerformanceObserver((l) => { for (const e of l.getEntries())
  window.__L.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime),
    srcs: [...(e.sources||[])].map((s) => ({ sel: s.node && s.node.nodeName ? s.node.nodeName + (typeof s.node.className==='string'&&s.node.className? '.'+s.node.className.trim().split(/\s+/).slice(0,4).join('.'):'') : '?',
      prev: s.previousRect?[Math.round(s.previousRect.x),Math.round(s.previousRect.y),Math.round(s.previousRect.width),Math.round(s.previousRect.height)]:null,
      cur: s.currentRect?[Math.round(s.currentRect.x),Math.round(s.currentRect.y),Math.round(s.currentRect.width),Math.round(s.currentRect.height)]:null })) }); })
  .observe({ type: 'layout-shift', buffered: false }); });
for (const label of ['계획', '오늘 학습', '계획']) {
  const b = await page.evaluate(() => window.__L.length);
  await page.evaluate((l) => { [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find((x) => (x.getAttribute('aria-label')||'').startsWith(l)).click(); }, label);
  await page.waitForTimeout(1400);
  const ls = await page.evaluate((i) => window.__L.slice(i), b);
  console.log('##', label, 'sum=' + ls.reduce((a,x)=>a+x.v,0).toFixed(4), 'n=' + ls.length);
  for (const s of ls.slice(0, 6)) console.log('   ', s.v, 't=' + s.t, JSON.stringify(s.srcs.slice(0, 3)));
}
const geo = await page.evaluate(() => {
  const g = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]; };
  return { url: location.pathname, main: g('main'), header: g('header'), subtabs: g('main [role="tablist"]'),
    scrollTop: (document.querySelector('.hud-fill,.hud-scroll')||{}).scrollTop };
});
console.log('geo', JSON.stringify(geo));
await browser.close();
