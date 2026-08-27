
import { chromium } from 'playwright-core';
const URL = process.argv[2], label = process.argv[3];
const profiles = [
  { name: 'Fast 4G',  down: 9000*1024/8, up: 1500*1024/8, rtt: 170 },
  { name: 'Slow 4G',  down: 1600*1024/8, up: 750*1024/8,  rtt: 300 },
];
for (const p of profiles) {
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: p.down, uploadThroughput: p.up, latency: p.rtt });
  let bytes = 0, n = 0, fontBytes = 0;
  page.on('requestfinished', async (r) => { try { const resp = await r.response(); const b = await resp.body(); bytes += b.length; n++; if (/woff2/.test(r.url())) fontBytes = b.length; } catch {} });
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 180000 });
  const load = Date.now() - t0;
  const fcp = await page.evaluate(() => new Promise((res) => {
    const e = performance.getEntriesByName('first-contentful-paint')[0]; if (e) return res(e.startTime);
    new PerformanceObserver((l, o) => { for (const x of l.getEntries()) if (x.name === 'first-contentful-paint') { o.disconnect(); res(x.startTime); } }).observe({ type: 'paint', buffered: true });
    setTimeout(() => res(-1), 30000); }));
  const fr = await page.evaluate(async () => { await document.fonts.ready; return performance.now(); });
  console.log(`| ${label} | ${p.name} | ${typeof fcp==='number'?fcp.toFixed(0):fcp} | ${load} | ${fr.toFixed(0)} | ${(bytes/1024).toFixed(0)} | ${(fontBytes/1024).toFixed(0)} | ${n} |`);
  await browser.close();
}
