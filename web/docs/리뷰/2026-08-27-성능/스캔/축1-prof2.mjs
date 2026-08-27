/* 청크(URL) 단위 귀속 — 함수명은 난독화돼 무의미하지만 청크 이름은 소스 폴더와 1:1 이다. */
import { launch, prep, waitBooted, BASE, scaleSeed, SEED } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const CPU = Number(process.env.CPU || 4);
function byUrl(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const m = new Map(); const dur = (profile.endTime - profile.startTime) / 1000;
  for (const id of profile.samples) { const n = byId.get(id); if (!n) continue;
    const u = (n.callFrame.url || '(native/gc/idle)').split('/').pop() || '(native)';
    m.set(u, (m.get(u) || 0) + 1); }
  const total = profile.samples.length;
  return { durMs: +dur.toFixed(1), top: [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)
    .map(([k, c]) => [k, +(c / total * dur).toFixed(1), +(c / total * 100).toFixed(1) + '%']) };
}
const out = {};
for (const [tag, seed] of [['scale1', SEED], ['scale10', scaleSeed(10)]]) {
  const { browser, ctx } = await launch({ reduce: true });
  const page = await ctx.newPage();
  const cdp = await prep(page, { cpu: CPU, seed });
  const c = cdp || (await page.context().newCDPSession(page));
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 60 });
  await c.send('Profiler.start');
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(300);
  const { profile } = await c.send('Profiler.stop');
  out['부팅@' + tag] = byUrl(profile);
  console.log('## 부팅', tag, out['부팅@' + tag].durMs + 'ms');
  for (const r of out['부팅@' + tag].top) console.log('   ', r.join('  '));
  await browser.close();
}
writeFileSync('축1-프로파일-청크별.json', JSON.stringify(out, null, 1));
