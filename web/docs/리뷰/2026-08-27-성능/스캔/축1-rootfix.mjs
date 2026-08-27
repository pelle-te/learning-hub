/* F1 수정 시뮬 — 앱 스크립트보다 먼저 `/` 를 `/today` 로 정규화한다(= main.tsx 한 줄과 동치). */
import { launch, prep, readPerf, stat, waitBooted, BASE, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const CPU = Number(process.env.CPU || 1);
const seed = scaleSeed(10);
const { browser, ctx } = await launch();
const rows = { '/ (현재)': [], '/ +정규화(수정)': [], '/today (참조)': [] };
for (let i = 0; i < 10; i++) {
  for (const key of Object.keys(rows)) {
    const page = await ctx.newPage();
    if (key === '/ +정규화(수정)') await page.addInitScript(() => { if (location.pathname === '/') history.replaceState(null, '', '/today'); });
    await prep(page, { seed, cpu: CPU });
    await page.goto(BASE + (key.startsWith('/today') ? '/today' : '/'), { waitUntil: 'load' });
    await waitBooted(page); await page.waitForTimeout(400);
    const p = await readPerf(page);
    p.path = await page.evaluate(() => location.pathname);
    rows[key].push(p);
    await page.close();
  }
}
const out = {};
for (const [k, rs] of Object.entries(rows)) {
  const pick = (f) => stat(rs.map(f).filter((v) => v != null));
  out[k] = { landed: rs[0].path, fcp: pick((r) => r.fcp), lcp: pick((r) => r.lcp),
    entryToData: pick((r) => r.marks.firstData - r.marks.entry),
    appToData: pick((r) => r.marks.firstData - r.marks.app),
    fcpToLcp: pick((r) => (r.lcp || 0) - (r.fcp || 0)) };
  console.log(k.padEnd(18), 'landed=' + out[k].landed,
    'entry→data p50=' + out[k].entryToData.p50, '| app→data p50=' + out[k].appToData.p50,
    '| fcp p50=' + out[k].fcp.p50, 'lcp p50=' + out[k].lcp.p50, '| fcp→lcp p50=' + out[k].fcpToLcp.p50);
}
await browser.close();
writeFileSync('축1-루트수정시뮬-cpu' + CPU + 'x.json', JSON.stringify(out, null, 1));
