/* ============================================================
   esm-smoke.test.js — 진짜 ESM 로딩 경로 검증 (의존성 0 · Node 내장만)

   실행:  node test/esm-smoke.test.js   (러닝허브 폴더에서)

   ui-smoke.test.js는 파일을 concat해 vm(sloppy)으로 돌려 *로직*을 본다.
   이 테스트는 브라우저가 실제로 타는 경로 — js/main.js를 진짜 ES모듈로
   import(strict·모듈 스코프·평가순서·전역 노출) — 가 깨지지 않는지 본다.
   여기서 통과하면 http 서버로 띄운 브라우저에서도 부팅·렌더가 동작한다.
============================================================ */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0, failed = 0; const fails = [];
function ok(name) { passed++; console.log('  ✓ ' + name); }
function bad(name, e) { failed++; fails.push([name, e]); console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

/* ── 브라우저 전역 stub (import 전에 globalThis에 깔아야 모듈 평가가 통과) ── */
function el() {
  return {
    innerHTML: '', value: '', checked: false, style: {}, dataset: {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; },
    appendChild() {}, removeChild() {}, insertBefore() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, blur() {}, scrollIntoView() {}, click() {}, getContext() { return null; },
  };
}
const ids = {};
const store = new Map();
globalThis.document = {
  getElementById(id) { return ids[id] || (ids[id] = el()); },
  createElement() { return el(); },
  querySelector() { return null; }, querySelectorAll() { return []; },
  documentElement: el(), head: el(), body: el(), addEventListener() {},
};
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
};
globalThis.window = globalThis;                 // ui-kit의 window.toast= , ui-vault의 window.showDirectoryPicker 분기
globalThis.location = { protocol: 'file:' };
globalThis.requestAnimationFrame = fn => { try { fn(); } catch (e) {} return 0; };
globalThis.alert = () => {}; globalThis.confirm = () => true;

console.log('\nesm-smoke.test.js\n');

(async () => {
  /* M1. main.js를 진짜 ES모듈로 import — 전체 그래프 평가 + app.js 부팅이 throw 없이 */
  try {
    const mainUrl = pathToFileURL(path.resolve(__dirname, '..', 'js', 'main.js')).href;
    await import(mainUrl);
    ok('M1 main.js ESM import + 부팅 OK');
  } catch (e) { bad('M1 main.js ESM import + 부팅 OK', e); printAndExit(); return; }

  /* M2. 전역 노출 확인 — Object.assign(globalThis, …)가 핸들러/레지스트리를 올렸나 */
  try {
    assert(typeof globalThis.render === 'function', 'render 노출');
    assert(typeof globalThis.go === 'function', 'go 노출');
    assert(typeof globalThis.toast === 'function', 'toast(ui-kit) 노출');
    assert(Array.isArray(globalThis.TAB_REGISTRY), 'TAB_REGISTRY 노출');
    assert(globalThis.TAB_REGISTRY.length === 13, '탭 13개 등록 (got ' + globalThis.TAB_REGISTRY.length + ')');
    ok('M2 전역 노출(핸들러·레지스트리·13탭) OK');
  } catch (e) { bad('M2 전역 노출(핸들러·레지스트리·13탭) OK', e); }

  /* M3. 공유 런타임 상태가 globalThis 슬롯에 있고 strict 재할당이 동작 */
  try {
    assert(globalThis.state && Array.isArray(globalThis.state.items), 'state 부팅됨');
    globalThis.go('schedule');                  // TAB 재할당(strict) + render
    assert(globalThis.TAB === 'schedule', 'go가 TAB 갱신');
    ok('M3 공유 런타임 상태(state·TAB) strict 동작 OK');
  } catch (e) { bad('M3 공유 런타임 상태(state·TAB) strict 동작 OK', e); }

  /* M4. 데이터 주입 후 모든 탭 render가 throw 없이 HTML 생성(strict 모듈 경로) */
  try {
    globalThis.state.items = [
      { id: 'm', source: '직접', name: '전자기학', color: '#6ea8fe', mode: 'weekly', weeklyHours: 6, deadline: '',
        chapters: [{ id: 'c1', name: '1장', hours: 4, done: true }, { id: 'c2', name: '2장', hours: 4, done: false }] },
      { id: 'a', source: 'Anki', name: 'Anki: 전자기학', color: '#7ee0c0', mode: 'daily', dailyMin: 20 },
    ];
    globalThis.state.summaries['2026-06-28'] = [{ id: 's1', sid: 'm', name: '전자기학', s1: 'a', s2: 'b', s3: 'c' }];
    globalThis.state.cbms = [{ id: 'cb', ds: '2026-06-28', sid: 'm', name: '전자기학', chapter: '2장', code: 'M', note: '막힘' }];
    ['today', 'journal', 'schedule', 'items', 'routine', 'settings', 'stats', 'integrations', 'review', 'degree', 'degreeReq'].forEach(t => {
      globalThis.TAB = t;
      const p = globalThis.document.getElementById('page'); p.innerHTML = '';
      globalThis.render();
      assert(typeof p.innerHTML === 'string' && p.innerHTML.length > 50, t + ' 탭 HTML 생성 (len=' + p.innerHTML.length + ')');
    });
    ok('M4 모든 탭 render(strict ESM) OK');
  } catch (e) { bad('M4 모든 탭 render(strict ESM) OK', e); }

  printAndExit();
})();

function printAndExit() {
  console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
  if (failed) { console.log('\n실패 상세:'); fails.forEach(([n, e]) => console.log(' - ' + n + ': ' + (e && e.message || e))); process.exit(1); }
  process.exit(0);
}
