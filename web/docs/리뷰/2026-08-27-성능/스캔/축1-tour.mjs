/* 레일 전체 순회 — 전환마다 헤더 높이 · main y · 레이아웃 이동량. 헤더 고정 전/후. */
import { launch, prep, waitBooted, BASE, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const RAIL = [['찾기','find'],['오늘 학습','today'],['복습','review-run'],['계획','schedule'],['주간 배분','alloc'],['과목','items'],['졸업 계획','degree'],['통계','stats'],['하루','day'],['주간 리뷰','review'],['오답 노트','mistakes'],['문항','questions'],['정본 원장','ledger'],['설정','settings'],['연동 현황','integrations'],['찾기','find'],['계획','schedule']];
const seed = scaleSeed(10);
const { browser, ctx } = await launch({ reduce: true });
const out = {};
for (const fix of ['현재', '헤더고정']) {
  const page = await ctx.newPage();
  await prep(page, { seed });
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(1300);
  if (fix === '헤더고정') await page.addStyleTag({ content: 'header{height:110px!important;min-height:110px!important;box-sizing:border-box;align-items:center}' });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__L = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__L.push(+e.value.toFixed(4)); }).observe({ type: 'layout-shift', buffered: false }); });
  const rows = [];
  for (const [label, key] of RAIL) {
    const b = await page.evaluate(() => window.__L.length);
    await page.evaluate((l) => { const x = [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find((y) => (y.getAttribute('aria-label')||'').startsWith(l)); x && x.click(); }, label);
    await page.waitForTimeout(1000);
    const r = await page.evaluate((i) => ({ ls: window.__L.slice(i),
      h: Math.round(document.querySelector('header').getBoundingClientRect().height),
      my: Math.round(document.querySelector('main').getBoundingClientRect().y) }), b);
    rows.push({ key, sum: +r.ls.reduce((a, x) => a + x, 0).toFixed(4), header: r.h, mainY: r.my });
  }
  const total = +rows.reduce((a, r) => a + r.sum, 0).toFixed(4);
  out[fix] = { total, rows };
  console.log('##', fix, '전체 이동량 합 =', total);
  console.log('  ', rows.map((r) => r.key + ':' + r.sum + '(h' + r.header + ')').join(' '));
  await page.close();
}
await browser.close();
writeFileSync('축1-순회시프트.json', JSON.stringify(out, null, 1));
console.log('감소율', (100 * (1 - out['헤더고정'].total / out['현재'].total)).toFixed(1) + '%');
