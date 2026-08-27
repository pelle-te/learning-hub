/* 클릭 후 프레임마다 main 의 y 를 샘플링 — 「그린 뒤 튀는가」의 직접 증거. */
import { launch, prep, waitBooted, BASE, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';
const { browser, ctx } = await launch({ reduce: true });
const page = await ctx.newPage();
await prep(page, { seed: scaleSeed(10) });
await page.goto(BASE + '/today', { waitUntil: 'load' });
await waitBooted(page); await page.waitForTimeout(1400);
const out = [];
for (const label of ['과목', '오늘 학습', '주간 리뷰', '통계', '정본 원장', '계획']) {
  const r = await page.evaluate((l) => new Promise((res) => {
    const btn = [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')].find((b) => (b.getAttribute('aria-label')||'').startsWith(l));
    const main = () => document.querySelector('main');
    const samples = []; const t0 = performance.now();
    let n = 0;
    const tick = () => {
      const m = main(); const h = document.querySelector('header');
      samples.push({ dt: +(performance.now() - t0).toFixed(1), y: m ? Math.round(m.getBoundingClientRect().y) : null,
        hh: h ? Math.round(h.getBoundingClientRect().height) : null, txt: (m && m.innerText || '').slice(0, 12) });
      if (++n < 40) requestAnimationFrame(tick); else res({ label: l, samples });
    };
    btn.click();
    requestAnimationFrame(tick);
  }), label);
  // 압축: y 가 바뀌는 지점만
  const comp = []; let prev = null;
  for (const s of r.samples) { if (prev === null || s.y !== prev) { comp.push(s); prev = s.y; } }
  out.push({ label, transitions: comp, frames: r.samples.length });
  console.log('##', label, JSON.stringify(comp.map((c) => c.dt + 'ms:y' + c.y + '/h' + c.hh + '/' + JSON.stringify(c.txt))));
  await page.waitForTimeout(700);
}
await browser.close();
writeFileSync('축1-프레임샘플.json', JSON.stringify(out, null, 1));
