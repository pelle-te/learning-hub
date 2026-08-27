/* 축1(체감) 공용 하네스 — 읽기 전용 계측. 소스는 건드리지 않는다.
   ⚠⚠ **Playwright 의 `page.clock.install()`/`setFixedTime()` 을 쓰지 않는다.** 그 스텁이
   `performance.mark` 를 없애서 앱의 부팅 웨이브 계량(`lib/perf.ts` 의 `ok()` 가드)이 통째로
   무동작이 된다(실측: 마크 0개 / 시계 없이는 3개). 대신 **시드의 날짜를 실제 오늘로 민다**. */
import { chromium } from '@playwright/test';

export const BASE = 'http://localhost:4174';
export const REF = '2026-06-15'; // e2e FIXED 기준일
const DAY = 86400000;
export const TODAY = new Date();
const ds = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const DELTA = Math.round((new Date(ds(TODAY) + 'T00:00:00Z') - new Date(REF + 'T00:00:00Z')) / DAY);

const RE = /^\d{4}-\d{2}-\d{2}$/;
const shiftStr = (s) => (RE.test(s) ? ds(new Date(new Date(s + 'T00:00:00Z').getTime() + DELTA * DAY)) : s);
export function shift(v) {
  if (typeof v === 'string') return shiftStr(v);
  if (Array.isArray(v)) return v.map(shift);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[shiftStr(k)] = shift(val);
    return o;
  }
  return v;
}

const RAW = {
  schemaVersion: 3, theme: 'dark', startDate: '2026-06-01', moduleLen: 120, reviewRatio: 20,
  completions: { '2026-06-13': { 'm|new': { done: true, min: 120 } }, '2026-06-14': { 'm|new': { done: true, min: 90 } } },
  items: [
    { id: 'm', source: '직접', name: '미적분', color: '#4f8ff0', mode: 'weekly', weeklyHours: 6, dailyMin: 30, deadline: '2026-08-15',
      chapters: [ { id: 'c1', name: '극한', hours: 3, done: true }, { id: 'c2', name: '미분', hours: 4, done: false } ] },
    { id: 'p', source: '직접', name: '일반물리', color: '#1eb5a3', mode: 'weekly', weeklyHours: 4, dailyMin: 30, deadline: '',
      chapters: [ { id: 'c3', name: '역학', hours: 5, done: false } ] },
  ],
  routine: [
    { id: 'r1', name: '수면', type: '수면', start: '00:00', end: '07:00', days: [0,1,2,3,4,5,6] },
    { id: 'r2', name: '수업', type: '수업', start: '09:00', end: '12:00', days: [1,3] },
  ],
  cbms: [ { id: 'e1', ds: '2026-06-13', sid: 'm', name: '미적분', chapter: '극한', code: 'C', note: '정의 혼동', conf: false } ],
  degree: { targetTotal: 130, reqMajorReq: 60, reqMajorSel: 30, reqLiberal: 30,
    semesters: [ { id: 's1', name: '2026-1학기', courses: [
      { id: 'co1', name: '미적분학', credits: 3, category: '전공필수', status: '완료', grade: 'A+' },
      { id: 'co2', name: '일반물리', credits: 3, category: '전공필수', status: '수강중', grade: '' } ] } ] },
};
export const SEED = shift(RAW);
export const SEED_EMPTY = shift({ schemaVersion: 3, theme: 'dark', startDate: '2026-06-01', moduleLen: 120, reviewRatio: 20,
  completions: {}, items: [], routine: RAW.routine, cbms: [],
  degree: { targetTotal: 130, reqMajorReq: 60, reqMajorSel: 30, reqLiberal: 30, semesters: [] } });

/** N배 시드 — 과목·챕터·오답·완료기록·학기를 곱한다(붕괴점 탐색용). */
export function scaleSeed(n, chapters = 12, histDays = 180) {
  const s = structuredClone(SEED);
  const items = [];
  for (let i = 0; i < 2 * n; i++) {
    const base = SEED.items[i % 2];
    items.push(Object.assign(structuredClone(base), { id: base.id + i, name: base.name + i,
      chapters: Array.from({ length: chapters }, (_, k) => ({ id: base.id + i + 'c' + k, name: '장' + k, hours: 2 + (k % 4), done: k % 3 === 0 })) }));
  }
  s.items = items;
  const comp = {};
  const t0 = new Date(ds(TODAY) + 'T00:00:00Z').getTime();
  for (let d = 0; d < histDays; d++) {
    const key = ds(new Date(t0 - d * DAY));
    const rec = {};
    for (let i = 0; i < Math.min(items.length, 6); i++) rec[items[i].id + '|new'] = { done: d % 2 === 0, min: 30 + (d % 60) };
    comp[key] = rec;
  }
  s.completions = comp;
  s.cbms = Array.from({ length: 40 * n }, (_, i) => ({ id: 'e' + i, ds: ds(new Date(t0 - (i % 120) * DAY)),
    sid: items[i % items.length].id, name: items[i % items.length].name, chapter: '장' + (i % chapters),
    code: ['C','B','M','S','T'][i % 5], note: '노트' + i, conf: i % 2 === 0 }));
  s.degree.semesters = Array.from({ length: 8 }, (_, k) => ({ id: 's' + k, name: '202' + k + '-1학기',
    courses: Array.from({ length: 7 }, (_, c) => ({ id: 's' + k + 'c' + c, name: '과목' + k + '-' + c, credits: 3,
      category: ['전공필수','전공선택','교양'][c % 3], status: k < 4 ? '완료' : '수강중', grade: 'A0' })) }));
  return s;
}

/** 관측기 — 첫 스크립트보다 먼저 심는다. */
export const OBSERVER = () => {
  const W = window;
  W.__perf = { lcp: 0, cls: 0, shifts: [], longtasks: [], events: [], paints: {} };
  const on = (type, cb, extra) => { try { new PerformanceObserver(cb).observe(Object.assign({ type, buffered: true }, extra || {})); } catch (e) {} };
  on('largest-contentful-paint', (l) => { for (const e of l.getEntries()) W.__perf.lcp = e.startTime; });
  on('layout-shift', (l) => { for (const e of l.getEntries()) { if (!e.hadRecentInput) {
    W.__perf.cls += e.value;
    W.__perf.shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4),
      srcs: (e.sources || []).map((s) => { const n = s.node; if (!n || !n.nodeName) return '?';
        const c = typeof n.className === 'string' ? n.className.split(' ').slice(0, 4).join('.') : '';
        return n.nodeName + (c ? '.' + c : ''); }) }); } } });
  on('longtask', (l) => { for (const e of l.getEntries()) W.__perf.longtasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }); });
  on('event', (l) => { for (const e of l.getEntries()) W.__perf.events.push({ name: e.name, t: Math.round(e.startTime),
    id: e.interactionId, dur: e.duration, delay: +(e.processingStart - e.startTime).toFixed(1),
    proc: +(e.processingEnd - e.processingStart).toFixed(1), present: +(e.startTime + e.duration - e.processingEnd).toFixed(1) }); }, { durationThreshold: 16 });
  on('paint', (l) => { for (const e of l.getEntries()) W.__perf.paints[e.name] = e.startTime; });
};

export async function launch(o) {
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: (o && o.reduce) ? 'reduce' : 'no-preference' });
  return { browser, ctx };
}

/** 시드 + Tauri 스텁 + 관측기. **시계는 건드리지 않는다**(머리주석 참조). */
export async function prep(page, opts) {
  const o = opts || {};
  const seed = o.seed || SEED, theme = o.theme || 'dark';
  await page.addInitScript(OBSERVER);
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = { invoke: () => Promise.reject(new Error('NOT_FOUND 축1 스텁')), transformCallback: (cb) => cb };
  });
  await page.addInitScript(([s, th]) => {
    try { localStorage.setItem('study_planner_v3', JSON.stringify(Object.assign({}, s, { theme: th }))); } catch (e) {}
  }, [seed, theme]);
  let cdp = null;
  if (o.cpu > 1 || o.net) {
    cdp = await page.context().newCDPSession(page);
    if (o.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.cpu });
    if (o.net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', o.net); }
  }
  return cdp;
}

export async function readPerf(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const m = (id) => { const e = performance.getEntriesByName(id, 'mark'); return e.length ? +e[0].startTime.toFixed(1) : null; };
    const P = window.__perf;
    return {
      fcp: P.paints['first-contentful-paint'] != null ? +P.paints['first-contentful-paint'].toFixed(1) : null,
      lcp: P.lcp ? +P.lcp.toFixed(1) : null,
      cls: +P.cls.toFixed(4),
      shifts: P.shifts, longtasks: P.longtasks, events: P.events,
      dcl: nav.domContentLoadedEventEnd != null ? +nav.domContentLoadedEventEnd.toFixed(1) : null,
      marks: { entry: m('hub:entry'), app: m('hub:app'), firstData: m('hub:first-data') },
      nRes: performance.getEntriesByType('resource').length,
    };
  });
}

export const stat = (a) => {
  if (!a || !a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: +s[0].toFixed(1), p50: +q(0.5).toFixed(1), p75: +q(0.75).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
};

/** TBT — longtask 의 50ms 초과분 합. */
export const tbt = (lts, from, to) => lts.filter((l) => (from == null || l.t >= from) && (to == null || l.t <= to))
  .reduce((a, l) => a + Math.max(0, l.d - 50), 0);

/** 앱이 첫 화면을 데이터로 그릴 때까지 — 마크가 진짜다. */
export async function waitBooted(page, timeout = 20000) {
  await page.waitForFunction(() => performance.getEntriesByName('hub:first-data', 'mark').length > 0, null, { timeout }).catch(() => {});
}
