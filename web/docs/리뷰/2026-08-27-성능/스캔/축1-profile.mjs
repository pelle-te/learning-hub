/* CDP 샘플링 프로파일러로 «누가 CPU 를 쓰는가» 를 파일:라인까지 귀속한다. */
import { launch, prep, waitBooted, BASE, SEED, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';

const CPU = Number(process.env.CPU || 4);
const SCALE = Number(process.env.SCALE || 10);
const seed = SCALE > 1 ? scaleSeed(SCALE) : SEED;

function agg(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const total = profile.samples.length;
  for (const id of profile.samples) {
    const n = byId.get(id);
    if (!n) continue;
    const f = n.callFrame;
    const k = (f.functionName || '(anonymous)') + ' @ ' + (f.url || '').split('/').pop() + ':' + (f.lineNumber + 1);
    self.set(k, (self.get(k) || 0) + 1);
  }
  const dur = (profile.endTime - profile.startTime) / 1000;
  return { totalSamples: total, durMs: +dur.toFixed(1),
    top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)
      .map(([k, c]) => [k, +(c / total * dur).toFixed(1) + 'ms', +(c / total * 100).toFixed(1) + '%']) };
}

const out = {};
const { browser, ctx } = await launch({ reduce: true });

// ① 탭 전환(설정) 프로파일
{
  const page = await ctx.newPage();
  const cdp = await prep(page, { cpu: CPU, seed });
  const c = cdp || (await page.context().newCDPSession(page));
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(1200);
  for (const [label, key] of [['설정', 'settings'], ['계획', 'schedule'], ['과목', 'items'], ['주간 배분', 'alloc']]) {
    await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 100 });
    await c.send('Profiler.start');
    await page.evaluate((l) => { const b = [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find((x) => (x.getAttribute('aria-label') || '').startsWith(l)); b && b.click(); }, label);
    await page.waitForTimeout(900);
    const { profile } = await c.send('Profiler.stop');
    out['탭전환:' + key] = agg(profile);
    console.log('## 탭전환:' + key, out['탭전환:' + key].durMs + 'ms window');
    for (const r of out['탭전환:' + key].top.slice(0, 8)) console.log('   ', r.join('  '));
  }
  await page.close();
}

// ② 콜드 부팅 프로파일
{
  const page = await ctx.newPage();
  const cdp = await prep(page, { cpu: CPU, seed });
  const c = cdp || (await page.context().newCDPSession(page));
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 100 });
  await c.send('Profiler.start');
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(400);
  const { profile } = await c.send('Profiler.stop');
  out['부팅:today'] = agg(profile);
  console.log('## 부팅:today', out['부팅:today'].durMs + 'ms window');
  for (const r of out['부팅:today'].top.slice(0, 14)) console.log('   ', r.join('  '));
  await page.close();
}

await browser.close();
writeFileSync('축1-프로파일-cpu' + CPU + 'x-scale' + SCALE + '.json', JSON.stringify(out, null, 1));
console.log('WROTE 축1-프로파일-cpu' + CPU + 'x-scale' + SCALE + '.json');
