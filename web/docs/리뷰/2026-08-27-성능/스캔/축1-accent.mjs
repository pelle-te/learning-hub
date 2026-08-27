/* Settings.tsx:136 `readAccentPreviews()` 의 실비용 — 그리고 스타일시트에서 읽는 대안의 비용. */
import { launch, prep, waitBooted, BASE, scaleSeed, SEED } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';

const BENCH = (reps) => {
  const ACCENTS = ['violet', 'lime', 'cyan', 'amber'];
  const root = document.documentElement;
  const t = (f) => { const a = performance.now(); const r = f(); return { ms: +(performance.now() - a).toFixed(2), r }; };

  // ① 현재 구현 그대로(Settings.tsx:120-143)
  const current = () => {
    const prevTheme = root.getAttribute('data-theme'), prevAccent = root.getAttribute('data-accent');
    root.setAttribute('data-theme', 'dark');
    const out = {};
    for (const a of ACCENTS) {
      if (a === 'violet') root.removeAttribute('data-accent'); else root.setAttribute('data-accent', a);
      out[a] = getComputedStyle(root).getPropertyValue('--acc').trim();
    }
    if (prevTheme == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prevTheme);
    if (prevAccent == null) root.removeAttribute('data-accent'); else root.setAttribute('data-accent', prevAccent);
    return out;
  };

  // ② 대안 — CSSOM 규칙에서 직접 읽는다(문서 스타일 무효화 0 · 강제 리컴퓨트 0)
  const fromSheets = () => {
    const out = {};
    const want = { violet: ':root', lime: ':root[data-accent="lime"]', cyan: ':root[data-accent="cyan"]', amber: ':root[data-accent="amber"]' };
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const rule of rules) {
        if (!rule.selectorText || !rule.style) continue;
        for (const [a, sel] of Object.entries(want)) {
          if (rule.selectorText.includes(sel.replace(':root', '')) || rule.selectorText === sel) {
            const v = rule.style.getPropertyValue('--acc').trim();
            if (v) out[a] = v;
          }
        }
      }
    }
    return out;
  };

  const res = { current: [], sheets: [], sample: null, sampleSheets: null };
  for (let i = 0; i < reps; i++) { const x = t(current); res.current.push(x.ms); res.sample = x.r; }
  for (let i = 0; i < reps; i++) { const x = t(fromSheets); res.sheets.push(x.ms); res.sampleSheets = x.r; }
  return res;
};

const out = {};
for (const cpu of [1, 4]) {
  const { browser, ctx } = await launch({ reduce: true });
  const page = await ctx.newPage();
  await prep(page, { cpu, seed: scaleSeed(10) });
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page); await page.waitForTimeout(1200);
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
  await page.addScriptTag({ content: `window.__bench = ${BENCH.toString()}` });
  const r = await page.evaluate((reps) => window.__bench(reps), 9).catch((e) => String(e).slice(0,200));
  out['cpu' + cpu + 'x'] = { nodes, r };
  await browser.close();
}
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
writeFileSync('축1-액센트프리뷰.json', JSON.stringify(out, null, 1));
