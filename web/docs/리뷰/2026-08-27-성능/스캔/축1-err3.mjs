import { launch, prep, waitBooted, BASE, scaleSeed, SEED } from './축1-lib.mjs';
const s10 = scaleSeed(10);
const valid = s10.cbms.map((c) => Object.assign({}, c, { sid: 'm', name: '미적분' }));
const one = SEED.cbms.concat([Object.assign({}, SEED.cbms[0], { id: 'orphan', sid: '없는과목', name: '삭제된과목' })]);
const cases = {
  '오답400·sid유효': Object.assign(structuredClone(SEED), { cbms: valid }),
  '오답2·고아 sid 1건': Object.assign(structuredClone(SEED), { cbms: one }),
};
const { browser, ctx } = await launch({ reduce: true });
for (const [tag, seed] of Object.entries(cases)) {
  for (const path of ['/review', '/mistakes', '/stats', '/today']) {
    const page = await ctx.newPage();
    await prep(page, { seed });
    await page.goto(BASE + path, { waitUntil: 'load' });
    await waitBooted(page); await page.waitForTimeout(1100);
    const t = await page.evaluate(() => (document.querySelector('main')?.innerText || '').slice(0, 90));
    console.log(tag.padEnd(18), path.padEnd(11), /오류가 발생/.test(t) ? 'CRASH: ' + t.replace(/\n/g, ' ').slice(0, 70) : 'ok');
    await page.close();
  }
}
await browser.close();
