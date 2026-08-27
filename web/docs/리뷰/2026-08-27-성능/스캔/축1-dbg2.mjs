import { chromium } from '@playwright/test';
import { OBSERVER, SEED, BASE } from './축1-lib.mjs';
const browser = await chromium.launch({ args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.addInitScript(OBSERVER);
await page.addInitScript(([s]) => { try { localStorage.setItem('study_planner_v3', JSON.stringify({ ...s, theme: 'dark' })); } catch (e) {} }, [SEED]);
await page.goto(BASE + '/today', { waitUntil: 'load' });
await page.waitForTimeout(3000);
console.log(JSON.stringify(await page.evaluate(() => ({
  marks: performance.getEntriesByType('mark').map((m) => [m.name, +m.startTime.toFixed(1)]),
  measures: performance.getEntriesByType('measure').map((m) => [m.name, +m.duration.toFixed(1)]),
  perfMarkType: typeof performance.mark,
  perfCtor: performance.constructor && performance.constructor.name,
  perfChunk: performance.getEntriesByType('resource').filter((r) => /perf-/.test(r.name)).map((r) => [r.name.split('/').pop(), +r.responseEnd.toFixed(0)]),
}))));
await browser.close();
