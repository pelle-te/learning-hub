import { launch, prep, readPerf, stat, tbt, waitBooted, BASE, SEED, SEED_EMPTY, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';

const RUNS = Number(process.env.RUNS || 9);

async function once(ctx, c) {
  const page = await ctx.newPage();
  await prep(page, { cpu: c.cpu, seed: c.seed });
  const t0 = Date.now();
  await page.goto(BASE + c.path, { waitUntil: 'load' });
  await waitBooted(page, 20000);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  await page.waitForTimeout(800);
  const p = await readPerf(page);
  p.wall = Date.now() - t0;
  await page.close();
  return p;
}

const S10 = scaleSeed(10);
const cases = [
  { key: 'today@1x', cpu: 1, seed: SEED, path: '/today' },
  { key: 'today@4x', cpu: 4, seed: SEED, path: '/today' },
  { key: 'today@1x-빈상태', cpu: 1, seed: SEED_EMPTY, path: '/today' },
  { key: 'today@1x-10배', cpu: 1, seed: S10, path: '/today' },
  { key: 'today@4x-10배', cpu: 4, seed: S10, path: '/today' },
  { key: 'stats@1x-10배', cpu: 1, seed: S10, path: '/stats' },
  { key: 'root@1x', cpu: 1, seed: SEED, path: '/' },
];

const { browser, ctx } = await launch();
const out = {};
for (const c of cases) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await once(ctx, c));
  const pick = (f) => stat(runs.map(f).filter((v) => v != null));
  const o = {
    fcp: pick((r) => r.fcp), lcp: pick((r) => r.lcp), dcl: pick((r) => r.dcl),
    entry: pick((r) => r.marks.entry), app: pick((r) => r.marks.app), firstData: pick((r) => r.marks.firstData),
    entryToApp: pick((r) => (r.marks.app != null && r.marks.entry != null ? r.marks.app - r.marks.entry : null)),
    appToData: pick((r) => (r.marks.firstData != null && r.marks.app != null ? r.marks.firstData - r.marks.app : null)),
    tbt: pick((r) => tbt(r.longtasks)),
    maxLongtask: pick((r) => Math.max(0, ...r.longtasks.map((l) => l.d))),
    cls: pick((r) => r.cls),
    wall: pick((r) => r.wall),
    marksMissing: runs.filter((r) => r.marks.firstData == null).length,
    longtasksSample: runs[Math.floor(runs.length / 2)].longtasks,
    shiftsWorst: runs.map((r) => r.shifts).sort((a, b) => b.reduce((x, y) => x + y.v, 0) - a.reduce((x, y) => x + y.v, 0))[0],
    nRes: runs[0].nRes,
  };
  out[c.key] = o;
  console.log(c.key, JSON.stringify({ fcp: o.fcp?.p50, lcp: o.lcp?.p50, firstData: o.firstData?.p50, appToData: o.appToData?.p50, tbt: o.tbt?.p50, maxLT: o.maxLongtask?.p50, cls: o.cls?.p50, missing: o.marksMissing }));
}
await browser.close();
writeFileSync('축1-boot.json', JSON.stringify(out, null, 1));
console.log('WROTE 축1-boot.json');
