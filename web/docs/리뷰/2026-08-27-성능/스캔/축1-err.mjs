import { launch, prep, waitBooted, BASE, scaleSeed, SEED } from './축1-lib.mjs';
for (const [tag, seed] of [['scale1', SEED], ['scale10', scaleSeed(10)]]) {
  const { browser, ctx } = await launch({ reduce: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 200)); });
  await prep(page, { seed });
  await page.goto(BASE + '/review', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(1500);
  const txt = await page.evaluate(() => (document.querySelector('main')?.innerText || '').slice(0, 220));
  console.log('##', tag, '/review →', JSON.stringify(txt));
  console.log('   errs:', JSON.stringify(errs.slice(0, 3)));
  await browser.close();
}
