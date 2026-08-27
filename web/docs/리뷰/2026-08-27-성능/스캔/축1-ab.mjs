/* ① `/` 와 `/today` 부팅 A/B(교대 실행 — 케이스 간 표류 배제)
   ② 진짜 마우스 클릭으로 탭 전환 시 layout-shift 의 hadRecentInput 이 실제로 참이 되는가 */
import { launch, prep, readPerf, stat, waitBooted, BASE, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const seed = scaleSeed(10);
const { browser, ctx } = await launch();
const out = {};

// ① A/B — 한 브라우저 안에서 번갈아
const rows = { '/': [], '/today': [] };
for (let i = 0; i < 12; i++) {
  for (const path of ['/', '/today']) {
    const page = await ctx.newPage();
    await prep(page, { seed });
    await page.goto(BASE + path, { waitUntil: 'load' });
    await waitBooted(page);
    await page.waitForTimeout(500);
    const p = await readPerf(page);
    rows[path].push(p);
    await page.close();
  }
}
out['부팅AB'] = {};
for (const [k, rs] of Object.entries(rows)) {
  const pick = (f) => stat(rs.map(f).filter((v) => v != null));
  out['부팅AB'][k] = {
    fcp: pick((r) => r.fcp), lcp: pick((r) => r.lcp),
    entryToData: pick((r) => r.marks.firstData - r.marks.entry),
    entryToApp: pick((r) => r.marks.app - r.marks.entry),
    appToData: pick((r) => r.marks.firstData - r.marks.app),
  };
}
console.log('## 부팅 A/B (12회 교대)');
for (const [k, v] of Object.entries(out['부팅AB'])) console.log(' ', k, JSON.stringify(v));

// ② 진짜 클릭의 hadRecentInput
{
  const page = await ctx.newPage();
  await prep(page, { seed });
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__ls2 = []; new PerformanceObserver((l) => { for (const e of l.getEntries())
    window.__ls2.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), input: e.hadRecentInput }); })
    .observe({ type: 'layout-shift', buffered: false }); });
  const seq = [];
  for (const label of ['통계', '과목', '연동 현황', '오늘 학습']) {
    const before = await page.evaluate(() => window.__ls2.length);
    await page.getByRole('button', { name: new RegExp('^' + label) }).first().click();
    await page.waitForTimeout(1300);
    const ls = await page.evaluate((b) => window.__ls2.slice(b), before);
    seq.push({ label, shifts: ls, sum: +ls.reduce((a, x) => a + x.v, 0).toFixed(4),
      sumCounted: +ls.filter((x) => !x.input).reduce((a, x) => a + x.v, 0).toFixed(4) });
    console.log('  진짜클릭', label, 'sum=' + seq.at(-1).sum, 'CWV집계분=' + seq.at(-1).sumCounted, JSON.stringify(ls));
  }
  out['진짜클릭_시프트'] = seq;
  await page.close();
}
await browser.close();
writeFileSync('축1-AB.json', JSON.stringify(out, null, 1));
console.log('WROTE 축1-AB.json');
