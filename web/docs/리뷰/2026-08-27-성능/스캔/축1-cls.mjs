/* 탭 전환의 레이아웃 이동 귀속 — sources 의 previousRect/currentRect 까지 받는다.
   ⚠ 합성 click 이라 hadRecentInput=false 다. 진짜 클릭이면 CWV 의 CLS 에서는 «입력 후 500ms
   제외» 규칙으로 빠지지만, **사용자 눈에는 그대로 보인다**. 그래서 «레이아웃 이동량»으로 읽는다. */
import { launch, prep, waitBooted, BASE, SEED, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';

const R = (r) => (r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null);
const ARM = () => {
  window.__ls = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ls.push({
    v: +e.value.toFixed(4), t: Math.round(e.startTime), input: e.hadRecentInput,
    srcs: [...(e.sources || [])].map((s) => ({
      sel: s.node && s.node.nodeName ? s.node.nodeName + (typeof s.node.className === 'string' && s.node.className ? '.' + s.node.className.trim().split(/\s+/).slice(0, 5).join('.') : '') : '?',
      prev: s.previousRect ? [Math.round(s.previousRect.x), Math.round(s.previousRect.y), Math.round(s.previousRect.width), Math.round(s.previousRect.height)] : null,
      cur: s.currentRect ? [Math.round(s.currentRect.x), Math.round(s.currentRect.y), Math.round(s.currentRect.width), Math.round(s.currentRect.height)] : null,
    })) }); }).observe({ type: 'layout-shift', buffered: false });
};

const { browser, ctx } = await launch();
const page = await ctx.newPage();
await prep(page, { seed: scaleSeed(10) });
await page.goto(BASE + '/today', { waitUntil: 'load' });
await waitBooted(page); await page.waitForTimeout(1500);

const out = {};
for (const [label, key] of [['통계', 'stats'], ['연동 현황', 'integrations'], ['과목', 'items'], ['주간 리뷰', 'review'], ['오늘 학습', 'today']]) {
  await page.evaluate(ARM);
  const before = await page.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
    return { frame: g('.hud-fill') || g('.hud-scroll'), frameCls: document.querySelector('.hud-fill') ? 'fill' : 'scroll',
      readoutCount: document.querySelectorAll('header div[class*=\'items-start\'] > div').length,
      scrollbar: (() => { const e = document.querySelector('.hud-fill,.hud-scroll'); return e ? e.offsetWidth - e.clientWidth : null; })() };
  });
  await page.evaluate((l) => { [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find((b) => (b.getAttribute('aria-label') || '').startsWith(l)).click(); }, label);
  await page.waitForTimeout(1400);
  const after = await page.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
    return { frame: g('.hud-fill') || g('.hud-scroll'), frameCls: document.querySelector('.hud-fill') ? 'fill' : 'scroll',
      scrollbar: (() => { const e = document.querySelector('.hud-fill,.hud-scroll'); return e ? e.offsetWidth - e.clientWidth : null; })(),
      headerH: (() => { const e = document.querySelector('header'); return e ? Math.round(e.getBoundingClientRect().height) : null; })() };
  });
  const ls = await page.evaluate(() => window.__ls);
  out[key] = { before, after, total: +ls.reduce((a, x) => a + x.v, 0).toFixed(4), shifts: ls };
  console.log('##', key, 'total', out[key].total, 'frame', before.frameCls, '->', after.frameCls, 'sb', before.scrollbar, '->', after.scrollbar);
  for (const s of ls) console.log('   ', s.v, JSON.stringify(s.srcs.slice(0, 3)));
}
await browser.close();
writeFileSync('축1-CLS귀속.json', JSON.stringify(out, null, 1));
console.log('WROTE 축1-CLS귀속.json');
