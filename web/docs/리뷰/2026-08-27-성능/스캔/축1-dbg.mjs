import { launch, prep, prepFixed, readPerf, BASE } from './축1-lib.mjs';
const { browser, ctx } = await launch();
for (const [name, fn] of [['clock.install', prep], ['setFixedTime', prepFixed]]) {
  const page = await ctx.newPage();
  await fn(page, {});
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => ({
    marks: performance.getEntriesByType('mark').map((m) => [m.name, +m.startTime.toFixed(1)]),
    measures: performance.getEntriesByType('measure').map((m) => [m.name, +m.duration.toFixed(1)]),
    nowWorks: performance.now(),
    rafOk: typeof requestAnimationFrame,
    main: (document.querySelector('main')?.innerText || '').slice(0, 60),
  }));
  console.log(name, JSON.stringify(r));
  await page.close();
}
await browser.close();
