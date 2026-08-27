import { launch, prep, readPerf, stat, waitBooted, BASE, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const CPU = Number(process.env.CPU || 4);
const seed = scaleSeed(10);
const { browser, ctx } = await launch();
const rows = { '/': [], '/today': [] };
for (let i = 0; i < 8; i++) for (const path of ['/', '/today']) {
  const page = await ctx.newPage();
  await prep(page, { seed, cpu: CPU });
  await page.goto(BASE + path, { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(500);
  rows[path].push(await readPerf(page));
  await page.close();
}
const out = {};
for (const [k, rs] of Object.entries(rows)) {
  const pick = (f) => stat(rs.map(f).filter((v) => v != null));
  out[k] = { fcp: pick((r) => r.fcp), lcp: pick((r) => r.lcp),
    entryToData: pick((r) => r.marks.firstData - r.marks.entry),
    appToData: pick((r) => r.marks.firstData - r.marks.app),
    fcpToLcp: pick((r) => (r.lcp || 0) - (r.fcp || 0)) };
  console.log(k, JSON.stringify(out[k]));
}
await browser.close();
writeFileSync('축1-AB-cpu' + CPU + 'x.json', JSON.stringify(out, null, 1));
