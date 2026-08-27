/* 상호작용 응답(INP 계열) — **진짜 입력**으로 Event Timing 을 받는다.
   합성 click 은 isTrusted=false 라 event 엔트리가 안 생긴다 → Playwright 입력만 쓴다. */
import { launch, prep, stat, waitBooted, BASE, SEED, scaleSeed } from './축1-lib.mjs';
import { writeFileSync } from 'node:fs';

const CPU = Number(process.env.CPU || 1);
const SCALE = Number(process.env.SCALE || 1);
const seed = SCALE > 1 ? scaleSeed(SCALE) : SEED;

const snap = (page) => page.evaluate(() => window.__perf.events.length);
const drain = (page, from) => page.evaluate((i) => window.__perf.events.slice(i), from);

/** 한 상호작용의 지연 = 같은 interactionId 의 event 중 최대 duration(웹 표준 INP 정의). */
function inpOf(events) {
  const byId = new Map();
  for (const e of events) {
    if (!e.id) continue;
    byId.set(e.id, Math.max(byId.get(e.id) || 0, e.dur));
  }
  return [...byId.values()];
}

async function scenario(ctx, name, path, act, reps) {
  const page = await ctx.newPage();
  await prep(page, { cpu: CPU, seed });
  await page.goto(BASE + path, { waitUntil: 'load' });
  await waitBooted(page);
  await page.waitForTimeout(1500);
  const all = [], raws = [];
  for (let i = 0; i < reps; i++) {
    const from = await snap(page);
    try { await act(page, i); } catch (e) { raws.push('ERR ' + String(e).slice(0, 90)); break; }
    await page.waitForTimeout(450);
    const ev = await drain(page, from);
    raws.push(ev);
    all.push(...inpOf(ev));
  }
  const res = { screen: name, path, reps, n: all.length, latencies: all.map((v) => +v.toFixed(0)),
    stat: stat(all), worst: raws.flat().filter((e) => e && e.dur).sort((a, b) => b.dur - a.dur).slice(0, 4) };
  await page.close();
  console.log(name, JSON.stringify({ n: res.n, p50: res.stat && res.stat.p50, p95: res.stat && res.stat.p95, max: res.stat && res.stat.max }));
  return res;
}

const { browser, ctx } = await launch();
const out = [];

out.push(await scenario(ctx, 'today·완료토글', '/today', async (p, i) => {
  const bs = p.locator('main button[aria-label$="완료 토글"]');
  const n = await bs.count();
  await bs.nth(i % Math.max(1, n)).click();
}, 10));

out.push(await scenario(ctx, 'today·⌘K열기', '/today', async (p) => {
  await p.keyboard.press('Control+k');
  await p.waitForTimeout(400);
  await p.keyboard.press('Escape');
}, 8));

out.push(await scenario(ctx, 'today·⌘K타이핑', '/today', async (p, i) => {
  if (i === 0) { await p.keyboard.press('Control+k'); await p.waitForTimeout(500); }
  await p.keyboard.type('통계'[i % 2], { delay: 0 });
  if (i % 2 === 1) { await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); }
}, 10));

out.push(await scenario(ctx, 'alloc·셀입력', '/alloc', async (p, i) => {
  const cells = p.locator('main input[type="number"]');
  const c = cells.nth(i % Math.max(1, await cells.count()));
  await c.click();
  await p.keyboard.type(String(1 + (i % 5)), { delay: 0 });
}, 10));

out.push(await scenario(ctx, 'review-run·다음카드', '/review-run', async (p, i) => {
  const b = p.getByRole('button', { name: i % 2 ? '애매해' : '떠오를 듯' });
  if (await b.count()) await b.first().click();
}, 10));

out.push(await scenario(ctx, 'day·오답추가입력', '/day', async (p, i) => {
  const t = p.locator('main input[type="text"]').first();
  await t.click();
  await p.keyboard.type('가나다', { delay: 0 });
}, 8));

await browser.close();
const name = '축1-INP-cpu' + CPU + 'x-scale' + SCALE + '.json';
writeFileSync(name, JSON.stringify(out, null, 1));
console.log('WROTE', name);
