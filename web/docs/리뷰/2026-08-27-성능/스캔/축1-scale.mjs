/* 규모 스윕 — 어디서 무너지는가. 과목수·챕터수·기록일수를 함께 키운다. */
import { launch, prep, readPerf, stat, tbt, waitBooted, BASE, SEED, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const SCALES = [1, 5, 10, 25, 50];
const out = {};
const { browser, ctx } = await launch({ reduce: true });
for (const n of SCALES) {
  const seed = n === 1 ? SEED : scaleSeed(n);
  const size = JSON.stringify(seed).length;
  const boots = [];
  for (let i = 0; i < 4; i++) {
    const page = await ctx.newPage();
    await prep(page, { seed });
    await page.goto(BASE + '/today', { waitUntil: 'load' });
    await waitBooted(page, 40000); await page.waitForTimeout(500);
    boots.push(await readPerf(page));
    await page.close();
  }
  // 탭 전환(가장 데이터 의존적인 셋)
  const page = await ctx.newPage();
  await prep(page, { seed });
  await page.addInitScript(`window.__sw = (l,q) => new Promise((res) => {
    const b=[...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find(x=>(x.getAttribute('aria-label')||'').startsWith(l));
    if(!b) return res(null);
    let first=null,last=null,timer=null; const t0=performance.now();
    const mo=new MutationObserver(()=>{const n=performance.now(); if(first==null)first=n; last=n; clearTimeout(timer); timer=setTimeout(done,q);});
    mo.observe(document.getElementById('root'),{childList:true,subtree:true,attributes:true,characterData:true});
    timer=setTimeout(done,6000); b.click();
    function done(){mo.disconnect();clearTimeout(timer);res(last==null?null:+(last-t0).toFixed(1));}
  })`);
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page, 40000); await page.waitForTimeout(1200);
  const sw = {};
  for (const [label, key] of [['과목','items'],['하루','day'],['통계','stats'],['오답 노트','mistakes'],['문항','questions'],['주간 배분','alloc'],['계획','schedule'],['오늘 학습','today']]) {
    sw[key] = await page.evaluate(([l, q]) => window.__sw(l, q), [label, 250]);
  }
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
  await page.close();
  out['x' + n] = { 시드KB: Math.round(size / 1024), 과목: seed.items.length, 챕터합: seed.items.reduce((a, i) => a + i.chapters.length, 0),
    오답: seed.cbms.length, 기록일: Object.keys(seed.completions).length, DOM노드: nodes,
    fcp: stat(boots.map((b) => b.fcp)), entryToData: stat(boots.map((b) => b.marks.firstData - b.marks.entry)),
    bootTBT: stat(boots.map((b) => tbt(b.longtasks))), bootMaxLT: stat(boots.map((b) => Math.max(0, ...b.longtasks.map((l) => l.d)))),
    탭전환: sw };
  console.log('x' + n, JSON.stringify({ KB: out['x'+n].시드KB, 과목: out['x'+n].과목, 오답: out['x'+n].오답, DOM: nodes,
    entryToData: out['x'+n].entryToData.p50, bootTBT: out['x'+n].bootTBT.p50, maxLT: out['x'+n].bootMaxLT.p50, sw }));
}
await browser.close();
writeFileSync('축1-규모스윕.json', JSON.stringify(out, null, 1));
console.log('WROTE 축1-규모스윕.json');
