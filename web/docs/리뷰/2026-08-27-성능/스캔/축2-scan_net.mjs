
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:4175/phone.html';
const profiles = [
  { name: '무제한',    down: -1,          up: -1,        rtt: 0 },
  { name: 'Fast 4G',  down: 9000*1024/8, up: 1500*1024/8, rtt: 170 },
  { name: 'Slow 4G',  down: 1600*1024/8, up: 750*1024/8,  rtt: 300 },
];
for (const p of profiles) {
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (p.down > 0) await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: p.down, uploadThroughput: p.up, latency: p.rtt });
  const recs = [];
  page.on('requestfinished', async (r) => {
    try {
      const t = r.timing();
      const resp = await r.response();
      const sz = await resp.body().then(b=>b.length).catch(()=>0);
      recs.push({ u: r.url().replace(/^https?:\/\/[^/]+/, ''), type: r.resourceType(), start: t.startTime, end: t.responseEnd, bytes: sz });
    } catch {}
  });
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  const load = Date.now() - t0;
  const fcp = await page.evaluate(() => new Promise((res) => {
    const e = performance.getEntriesByName('first-contentful-paint')[0];
    if (e) return res(e.startTime);
    new PerformanceObserver((l, o) => { for (const x of l.getEntries()) if (x.name === 'first-contentful-paint') { o.disconnect(); res(x.startTime); } }).observe({ type: 'paint', buffered: true });
    setTimeout(() => res(-1), 20000);
  }));
  const fontReady = await page.evaluate(async () => { const t=performance.now(); await document.fonts.ready; return performance.now(); });
  recs.sort((a,b)=>b.bytes-a.bytes);
  const font = recs.find(r=>/woff2/.test(r.u));
  const total = recs.reduce((a,b)=>a+b.bytes,0);
  console.log(`\n== ${p.name} ==  load=${load}ms  FCP=${typeof fcp==='number'?fcp.toFixed(0):fcp}ms  fonts.ready=${fontReady.toFixed(0)}ms  요청 ${recs.length}건 총 ${(total/1024).toFixed(0)}KB`);
  if (font) console.log(`   폰트: ${font.bytes} B, ${(font.end-font.start).toFixed(0)}ms 동안 전송(${font.start.toFixed(0)}→${font.end.toFixed(0)})`);
  recs.slice(0,6).forEach(r=>console.log(`   ${String(r.bytes).padStart(8)} B  ${(r.end-r.start).toFixed(0).padStart(6)}ms  ${r.type.padEnd(8)} ${r.u}`));
  await browser.close();
}
