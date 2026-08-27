import { launch, prep, stat, tbt, waitBooted, BASE, SEED, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';

const RUNS = Number(process.env.RUNS || 5);
const CPU = Number(process.env.CPU || 1);
const SCALE = Number(process.env.SCALE || 1);

/* 레일 aria-label → 탭 키(shell/tabs.ts 의 label 과 짝). 레일에 서는 것 = role:'destination'|'lens'. */
const RAIL = [
  ['찾기', 'find'], ['오늘 학습', 'today'], ['복습', 'review-run'], ['계획', 'schedule'],
  ['주간 배분', 'alloc'], ['과목', 'items'], ['졸업 계획', 'degree'], ['통계', 'stats'],
  ['하루', 'day'], ['주간 리뷰', 'review'], ['오답 노트', 'mistakes'], ['문항', 'questions'],
  ['정본 원장', 'ledger'], ['설정', 'settings'], ['연동 현황', 'integrations'],
];

const PROBE = (label, quietMs) => new Promise((resolve) => {
  const P = window.__perf;
  const btn = [...document.querySelectorAll('nav[aria-label="주요 메뉴"] button')]
    .find((b) => (b.getAttribute('aria-label') || '').startsWith(label));
  if (!btn) return resolve({ error: 'no-button:' + label });
  const ls0 = P.longtasks.length, sh0 = P.shifts.length, cls0 = P.cls;
  const root = document.getElementById('root') || document.body;
  let first = null, last = null, muts = 0, timer = null;
  const mo = new MutationObserver((recs) => {
    muts += recs.length;
    const now = performance.now();
    if (first == null) first = now;
    last = now;
    clearTimeout(timer); timer = setTimeout(done, quietMs);
  });
  const t0 = performance.now();
  mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  timer = setTimeout(done, quietMs + 3000);
  btn.click();
  function done() {
    mo.disconnect(); clearTimeout(timer);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const paint = performance.now();
      resolve({
        firstMut: first == null ? null : +(first - t0).toFixed(1),
        settled: last == null ? null : +(last - t0).toFixed(1),
        painted: +(paint - t0 - quietMs).toFixed(1),
        muts,
        longtasks: P.longtasks.slice(ls0),
        clsDelta: +(P.cls - cls0).toFixed(4),
        shifts: P.shifts.slice(sh0).slice(0, 8),
        url: location.pathname + location.search,
      });
    }));
  }
});

const seed = SCALE > 1 ? scaleSeed(SCALE) : SEED;
const REDUCE = process.env.REDUCE === '1';
const { browser, ctx } = await launch({ reduce: REDUCE });
const runsAll = {};

for (let r = 0; r < RUNS; r++) {
  const page = await ctx.newPage();
  await prep(page, { cpu: CPU, seed });
  await page.addInitScript('window.__probe = ' + PROBE.toString());
  await page.goto(BASE + '/today', { waitUntil: 'load' });
  await waitBooted(page);
  await page.waitForTimeout(1200);
  for (const [label, key] of RAIL) {
    const res = await page.evaluate(([l, q]) => window.__probe(l, q), [label, 250]).catch((e) => ({ error: String(e).slice(0, 120) }));
    (runsAll[key] ||= []).push(res);
    await page.waitForTimeout(200);
  }
  await page.close();
}
await browser.close();

const out = {};
for (const [key, rs] of Object.entries(runsAll)) {
  const ok = rs.filter((x) => !x.error);
  out[key] = {
    firstMut: stat(ok.map((x) => x.firstMut).filter((v) => v != null)),
    settled: stat(ok.map((x) => x.settled).filter((v) => v != null)),
    painted: stat(ok.map((x) => x.painted).filter((v) => v != null)),
    tbt: stat(ok.map((x) => tbt(x.longtasks))),
    maxLongtask: stat(ok.map((x) => Math.max(0, ...x.longtasks.map((l) => l.d)))),
    cls: stat(ok.map((x) => x.clsDelta)),
    muts: stat(ok.map((x) => x.muts)),
    url: ok[0] && ok[0].url, errors: rs.filter((x) => x.error).map((x) => x.error).slice(0, 2),
    worstShifts: ok.map((x) => x.shifts).sort((a, b) => b.reduce((s, y) => s + y.v, 0) - a.reduce((s, y) => s + y.v, 0))[0],
  };
}
const name = '축1-탭전환-cpu' + CPU + 'x-scale' + SCALE + (REDUCE ? '-reduce' : '') + '.json';
writeFileSync(name, JSON.stringify(out, null, 1));
const rows = Object.entries(out).map(([k, v]) => [k, v.painted && v.painted.p50, v.settled && v.settled.p50, v.tbt && v.tbt.p50, v.maxLongtask && v.maxLongtask.p50, v.cls && v.cls.p50, v.muts && v.muts.p50]);
rows.sort((a, b) => (b[1] || 0) - (a[1] || 0));
console.log('탭\tpainted\tsettled\tTBT\tmaxLT\tCLS\tmuts');
for (const r of rows) console.log(r.join('\t'));
console.log('WROTE', name);
