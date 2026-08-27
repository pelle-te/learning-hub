import { launch, prep, waitBooted, BASE, SEED } from './축1-lib.mjs';
const mk = (o) => Object.assign(structuredClone(SEED), { cbms: SEED.cbms.concat([Object.assign({ id: 'x', ds: SEED.cbms[0].ds, sid: 'm', name: '미적분', chapter: '극한', code: 'C', note: 'n', conf: false }, o)]) });
const cases = {
  '정상 1건 추가': mk({}),
  '없는 챕터명': mk({ chapter: '없는장' }),
  "코드 'A'": mk({ code: 'A' }),
  "코드 'B'": mk({ code: 'B' }),
  "코드 'D'": mk({ code: 'D' }),
};
const { browser, ctx } = await launch({ reduce: true });
for (const [tag, seed] of Object.entries(cases)) {
  const page = await ctx.newPage();
  await prep(page, { seed });
  await page.goto(BASE + '/review', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(1000);
  const t = await page.evaluate(() => ({ txt: (document.querySelector('main')?.innerText || '').slice(0, 80),
    nItems: (JSON.parse(localStorage.getItem('study_planner_v3') || '{}').items || []).length }));
  console.log(tag.padEnd(14), /오류가 발생/.test(t.txt) ? 'CRASH: ' + t.txt.replace(/\n/g, ' ').slice(0, 60) : 'ok');
  await page.close();
}
await browser.close();
