import { launch, prep, waitBooted, BASE, scaleSeed, SEED } from './축1-lib.mjs';
const s10 = scaleSeed(10);
const cases = {
  '과목만 20': Object.assign(structuredClone(SEED), { items: s10.items }),
  '완료기록만': Object.assign(structuredClone(SEED), { completions: s10.completions }),
  '오답만': Object.assign(structuredClone(SEED), { cbms: s10.cbms }),
  '학기만': Object.assign(structuredClone(SEED), { degree: s10.degree }),
  '과목+완료': Object.assign(structuredClone(SEED), { items: s10.items, completions: s10.completions }),
};
const { browser, ctx } = await launch({ reduce: true });
for (const [tag, seed] of Object.entries(cases)) {
  const page = await ctx.newPage();
  await prep(page, { seed });
  await page.goto(BASE + '/review', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(1200);
  const t = await page.evaluate(() => (document.querySelector('main')?.innerText || '').slice(0, 70));
  console.log(tag.padEnd(12), /오류가 발생/.test(t) ? 'CRASH: ' + t.replace(/\n/g, ' ') : 'ok');
  await page.close();
}
await browser.close();
