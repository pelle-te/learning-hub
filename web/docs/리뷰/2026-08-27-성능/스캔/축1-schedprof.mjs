import { launch, prep, waitBooted, BASE, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const out = {};
for (const n of [10, 50]) {
  const { browser, ctx } = await launch({ reduce: true });
  const page = await ctx.newPage();
  const c = await page.context().newCDPSession(page);
  await prep(page, { seed: scaleSeed(n) });
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page, 40000); await page.waitForTimeout(1300);
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 50 });
  await c.send('Profiler.start');
  await page.evaluate(() => { [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find((x) => (x.getAttribute('aria-label')||'').startsWith('계획')).click(); });
  await page.waitForTimeout(1200);
  const { profile } = await c.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((x) => [x.id, x]));
  const m = new Map(); const dur = (profile.endTime - profile.startTime) / 1000; const tot = profile.samples.length;
  for (const id of profile.samples) { const nd = byId.get(id); if (!nd) continue;
    const u = (nd.callFrame.url || '(native/idle/gc)').split('/').pop();
    m.set(u, (m.get(u) || 0) + 1); }
  out['x' + n] = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => [k, +(v / tot * dur).toFixed(1) + 'ms', +(v / tot * 100).toFixed(1) + '%']);
  console.log('## schedule 전환 x' + n, '(' + dur.toFixed(0) + 'ms 창)');
  for (const r of out['x' + n]) console.log('   ', r.join('  '));
  await browser.close();
}
writeFileSync('축1-schedule프로파일.json', JSON.stringify(out, null, 1));
