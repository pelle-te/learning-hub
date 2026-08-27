/* ① 헤더 높이를 고정하면 탭 전환 시프트가 사라지는가(런타임 CSS 주입 · 소스 불변)
   ② Settings 청크 모듈 평가 비용은 첫 전환에만 붙는가(1회차 vs 2회차) */
import { launch, prep, waitBooted, BASE, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const seed = scaleSeed(10);
const RAIL = [['통계','stats'],['과목','items'],['연동 현황','integrations'],['오늘 학습','today'],['설정','settings'],['찾기','find'],['계획','schedule'],['졸업 계획','degree']];

async function sweep(page, tag) {
  await page.evaluate(() => { window.__ls3 = []; new PerformanceObserver((l) => { for (const e of l.getEntries())
    window.__ls3.push(+e.value.toFixed(4)); }).observe({ type: 'layout-shift', buffered: false }); });
  const rows = [];
  for (const [label] of RAIL) {
    const before = await page.evaluate(() => window.__ls3.length);
    const t = await page.evaluate((l) => { const b = [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find((x) => (x.getAttribute('aria-label') || '').startsWith(l)); const t0 = performance.now(); b && b.click(); return t0; }, label);
    await page.waitForTimeout(1100);
    const ls = await page.evaluate((b) => window.__ls3.slice(b), before);
    rows.push({ label, sum: +ls.reduce((a, x) => a + x, 0).toFixed(4), n: ls.length });
  }
  const total = +rows.reduce((a, r) => a + r.sum, 0).toFixed(4);
  console.log(tag, 'shift 합', total, JSON.stringify(rows.map((r) => [r.label, r.sum])));
  return { tag, total, rows };
}

const out = {};
const { browser, ctx } = await launch({ reduce: true });

// ① before / after
for (const fix of [false, true]) {
  const page = await ctx.newPage();
  await prep(page, { seed });
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(1200);
  const h = await page.evaluate(() => Math.round(document.querySelector('header').getBoundingClientRect().height));
  if (fix) await page.addStyleTag({ content: 'header{min-height:102px !important;box-sizing:border-box}' });
  await page.waitForTimeout(300);
  out[fix ? '헤더고정' : '현재'] = await sweep(page, fix ? '[헤더 min-height:102px]' : '[현재]');
  out[fix ? '헤더고정' : '현재'].headerAtToday = h;
  await page.close();
}

// ② settings 첫 전환 vs 재전환
{
  const page = await ctx.newPage();
  await prep(page, { seed });
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(1200);
  const probe = async (label) => page.evaluate(async (l) => {
    const btn = [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find((b) => (b.getAttribute('aria-label') || '').startsWith(l));
    return new Promise((res) => {
      let first = null, last = null, timer = null;
      const t0 = performance.now();
      const mo = new MutationObserver(() => { const n = performance.now(); if (first == null) first = n; last = n; clearTimeout(timer); timer = setTimeout(done, 250); });
      mo.observe(document.getElementById('root'), { childList: true, subtree: true, attributes: true, characterData: true });
      timer = setTimeout(done, 3000);
      btn.click();
      function done() { mo.disconnect(); clearTimeout(timer); res({ first: first && +(first - t0).toFixed(1), settled: last && +(last - t0).toFixed(1) }); }
    });
  }, label);
  const seq = [];
  for (const l of ['설정', '오늘 학습', '설정', '오늘 학습', '설정']) { seq.push({ l, r: await probe(l) }); await page.waitForTimeout(400); }
  out['settings_1차vs재방문'] = seq;
  console.log('settings 순차:', JSON.stringify(seq));
  await page.close();
}
await browser.close();
writeFileSync('축1-수정시뮬.json', JSON.stringify(out, null, 1));
console.log('WROTE 축1-수정시뮬.json');
