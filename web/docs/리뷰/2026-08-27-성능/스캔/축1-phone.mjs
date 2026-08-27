/* 폰 엔트리(phone.html · SQLite wasm+OPFS 워커) 부팅 체감 — 세 배포 실물 중 셋째. */
import { chromium } from '@playwright/test';
import { OBSERVER, BASE } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';

const RUNS = Number(process.env.RUNS || 6);
const out = {};
for (const cpu of [1, 4]) {
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.addInitScript(OBSERVER);
    await page.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/enroll/claim', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ deviceId: 'perf-device', refreshToken: 'perf-refresh' }) }));
    if (cpu > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
    const t0 = Date.now();
    await page.goto(BASE + '/phone.html', { waitUntil: 'load' });
    await page.getByLabel('등록 코드').fill('PERF-CODE');
    const tConnect = Date.now();
    await page.getByRole('button', { name: '연결' }).click();
    await page.getByRole('group', { name: '화면 전환' }).waitFor({ timeout: 30000 });
    const connectMs = Date.now() - tConnect;
    await page.waitForTimeout(600);
    const p = await page.evaluate(() => {
      const m = (id) => { const e = performance.getEntriesByName(id, 'mark'); return e.length ? +e[0].startTime.toFixed(1) : null; };
      const P = window.__perf;
      return { fcp: P.paints['first-contentful-paint'], lcp: P.lcp, cls: +P.cls.toFixed(4),
        entry: m('hub:entry'), app: m('hub:app'), firstData: m('hub:first-data'),
        lt: P.longtasks, marks: performance.getEntriesByType('mark').map((x) => [x.name, +x.startTime.toFixed(1)]) };
    });
    p.connectMs = connectMs; p.wall = Date.now() - t0;
    rows.push(p);
    await ctx.close();
  }
  const st = (f) => { const a = rows.map(f).filter((v) => v != null).sort((x, y) => x - y); return a.length ? { n: a.length, p50: a[Math.floor(a.length / 2)], min: a[0], max: a[a.length - 1] } : null; };
  out['cpu' + cpu + 'x'] = { fcp: st((r) => r.fcp), lcp: st((r) => r.lcp), cls: st((r) => r.cls),
    entry: st((r) => r.entry), app: st((r) => r.app), firstData: st((r) => r.firstData),
    entryToApp: st((r) => (r.app != null && r.entry != null ? r.app - r.entry : null)),
    연결후_화면: st((r) => r.connectMs), tbt: st((r) => r.lt.reduce((a, l) => a + Math.max(0, l.d - 50), 0)),
    maxLT: st((r) => Math.max(0, ...r.lt.map((l) => l.d))), marksSample: rows[0].marks };
  console.log('cpu' + cpu + 'x', JSON.stringify(out['cpu' + cpu + 'x']));
  await browser.close();
}
writeFileSync('축1-폰부팅.json', JSON.stringify(out, null, 1));
console.log('WROTE 축1-폰부팅.json');
