/* 탭마다 헤더가 몇 px 인가 — 상단 리드아웃이 줄바꿈하면 본문 전체가 밀린다. */
import { launch, prep, waitBooted, BASE, scaleSeed, SEED } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const SCALE = Number(process.env.SCALE || 10);
const { browser, ctx } = await launch({ reduce: true });
const page = await ctx.newPage();
await prep(page, { seed: SCALE > 1 ? scaleSeed(SCALE) : SEED });
const RAIL = [['찾기','find'],['오늘 학습','today'],['복습','review-run'],['계획','schedule'],['주간 배분','alloc'],['과목','items'],['졸업 계획','degree'],['통계','stats'],['하루','day'],['주간 리뷰','review'],['오답 노트','mistakes'],['문항','questions'],['정본 원장','ledger'],['설정','settings'],['연동 현황','integrations']];
await page.goto(BASE + '/today', { waitUntil: 'load' });
await waitBooted(page); await page.waitForTimeout(1200);
const geo = () => page.evaluate(() => {
  const h = document.querySelector('header');
  const m = document.querySelector('main');
  const cluster = document.querySelector('header div[class*="items-center"][class*="self-center"]');
  const ro = document.querySelector('header div[class*="items-start"]');
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width) }; };
  return { url: location.pathname + location.search, header: r(h), main: r(m), cluster: r(cluster), readouts: r(ro),
    roN: ro ? ro.children.length : 0 };
});
const out = [];
for (const [label, key] of RAIL) {
  await page.evaluate((l) => { const b = [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find((x) => (x.getAttribute('aria-label') || '').startsWith(l)); b && b.click(); }, label);
  await page.waitForTimeout(1100);
  const g = await geo();
  out.push(Object.assign({ tab: key }, g));
  console.log(key.padEnd(12), 'header h=' + (g.header && g.header.h), 'main y=' + (g.main && g.main.y), 'main h=' + (g.main && g.main.h), '| cluster h=' + (g.cluster && g.cluster.h), 'w=' + (g.cluster && g.cluster.w), '| readouts n=' + g.roN, 'w=' + (g.readouts && g.readouts.w));
}
await browser.close();
writeFileSync('축1-헤더높이.json', JSON.stringify(out, null, 1));
const hs = out.map((o) => o.header && o.header.h).filter(Boolean);
console.log('header 높이 범위:', Math.min(...hs), '~', Math.max(...hs), '(차 ' + (Math.max(...hs) - Math.min(...hs)) + 'px)');
