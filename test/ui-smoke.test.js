/* ============================================================
   ui-smoke.test.js — UI 스모크 테스트 (의존성 0 · Node 내장만)

   실행:  node test/ui-smoke.test.js   (러닝허브 폴더에서)

   - 모든 js를 index.html 로드 순서로 DOM/localStorage stub 위에 올린다.
   - 각 render<Tab>()가 throw 없이 HTML 문자열을 만들고, 상태변경 핸들러가
     state를 갱신하는지 확인(스케줄러 테스트가 못 잡는 ui 회귀를 잡음).
============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.resolve(__dirname, '..', 'js');
const ORDER = ['utils', 'ui-kit', 'tabs', 'state', 'data-methodology', 'scheduler', 'ui-today', 'ui-schedule', 'ui-items',
  'ui-routine', 'ui-stats', 'ui-review', 'ui-vault', 'ui-anki', 'ui-degree', 'app'];
const SRC = ORDER.map(n => fs.readFileSync(path.join(JS_DIR, n + '.js'), 'utf8')).join('\n');

/* ── 미니 테스트 프레임워크 ── */
let passed = 0, failed = 0; const fails = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; fails.push([name, e]); console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

/* ── DOM/브라우저 stub ── */
function el() {
  return {
    innerHTML: '', value: '', checked: false, style: {}, dataset: {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild() {}, removeChild() {}, insertBefore() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, blur() {}, scrollIntoView() {}, click() {}, getContext() { return null; },
  };
}
function makeSandbox() {
  const store = new Map();
  const ids = {};
  const document = {
    getElementById(id) { return ids[id] || (ids[id] = el()); },
    createElement() { return el(); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    documentElement: el(), head: el(), body: el(), addEventListener() {},
  };
  const sandbox = {
    document, console,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    alert() {}, confirm() { return true; }, setTimeout(fn) { return 0; }, clearTimeout() {},
    location: { protocol: 'file:' },
    Math, Date, JSON, Object, Array, Set, Map, String, Number, Boolean, Intl,
    parseInt, parseFloat, isNaN, RegExp,
  };
  sandbox.window = sandbox;            // showDirectoryPicker 등은 정의 안 함(미지원 분기 타게)
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'runui.js' });   // app.js 부팅(render once) 포함
  sandbox.ev = expr => vm.runInContext(expr, sandbox);
  return sandbox;
}

/* 샘플 데이터 주입(다양한 분기 자극) */
function seed(sb) {
  sb.ev(`
    state.items = [
      {id:'m', source:'직접', name:'전자기학', color:'#6ea8fe', mode:'weekly', weeklyHours:6, deadline:'',
        chapters:[{id:'c1',name:'1장',hours:4,done:true},{id:'c2',name:'2장',hours:4,done:false},{id:'c3',name:'3장',hours:4,done:false}]},
      {id:'a', source:'Anki', name:'Anki: 전자기학', color:'#7ee0c0', mode:'daily', dailyMin:20}
    ];
    state.blankReviewWeekly = true;
    state.mockEveryWeeks = 1;
    state.peakStart = '09:00'; state.peakEnd = '12:00';
    state.summaries['` + '2026-06-28' + `'] = [{id:'s1',sid:'m',name:'전자기학',s1:'a',s2:'b',s3:'c'}];
    state.cbms = [{id:'cb',ds:'2026-06-28',sid:'m',name:'전자기학',chapter:'2장',code:'M',note:'유도막힘'}];
    state.backlog = [{id:'bl',ds:'2026-06-28',sid:'m',name:'전자기학',topic:'변위전류',note:'',done:false,doneDs:''}];
  `);
}

console.log('\nui-smoke.test.js\n');

const TABS = ['today', 'schedule', 'items', 'routine', 'stats', 'vault', 'anki', 'review', 'degree'];

/* U1. 부팅(기본 상태)에서 app.js가 throw 없이 초기 렌더 */
test('U1 기본 상태 부팅 렌더 OK', () => {
  const sb = makeSandbox();
  const html = sb.ev("document.getElementById('page').innerHTML");
  assert(typeof html === 'string' && html.length > 0, '초기 #page 비어있지 않아야');
});

/* U2. 데이터가 있는 상태에서 모든 탭이 throw 없이 HTML 생성 */
test('U2 모든 탭 render*가 throw 없이 HTML 생성', () => {
  const sb = makeSandbox();
  seed(sb);
  TABS.forEach(t => {
    sb.ev("TAB='" + t + "'; document.getElementById('page').innerHTML='';");
    sb.ev('render()');
    const html = sb.ev("document.getElementById('page').innerHTML");
    assert(typeof html === 'string' && html.length > 50, t + ' 탭이 충분한 HTML을 생성해야 (len=' + (html && html.length) + ')');
  });
});

/* U3. 상태변경 핸들러(실행 레이어)가 state를 갱신 */
test('U3 요약/오답/백로그 추가가 state에 반영', () => {
  const sb = makeSandbox();
  const n0 = sb.ev('summaryCount()');
  sb.ev("addSummary('2026-06-28','','전자기학','x','y','z')");
  assert(sb.ev('summaryCount()') === n0 + 1, '요약 +1');
  const c0 = sb.ev('(state.cbms||[]).length');
  sb.ev("addCbms('2026-06-28','','전자기학','2장','M','메모')");
  assert(sb.ev('(state.cbms||[]).length') === c0 + 1, 'CBMS +1');
  const b0 = sb.ev('(state.backlog||[]).length');
  sb.ev("addBacklog('','전자기학','주제','메모')");
  assert(sb.ev('(state.backlog||[]).length') === b0 + 1, '백로그 +1');
});

/* U4. 완료 체크(setDone)가 completions에 기록되고 통계가 반영 */
test('U4 setDone이 completions에 기록되고 totalDoneHours 증가', () => {
  const sb = makeSandbox();
  seed(sb);
  const h0 = sb.ev('totalDoneHours()');
  sb.ev("setDone('2026-06-28','m','new',120,true)");
  assert(sb.ev('totalDoneHours()') > h0, '완료시간 증가');
  sb.ev("setDone('2026-06-28','m','new',120,false)");
  assert(Math.abs(sb.ev('totalDoneHours()') - h0) < 1e-9, '체크 해제 시 원복');
});

/* U5. 테마 토글이 throw 없이 동작 + 재렌더 */
test('U5 toggleTheme 동작', () => {
  const sb = makeSandbox();
  const t0 = sb.ev('state.theme');
  sb.ev('toggleTheme()');
  assert(sb.ev('state.theme') !== t0, '테마가 바뀌어야');
});

/* U6. 백지 통과 기록(blankPass)이 state.blankResults에 반영(감사 F-04) */
test('U6 blankPass가 blankResults에 통과 기록', () => {
  const sb = makeSandbox();
  sb.ev("blankPass('2026-06-28','m','수학')");
  assert(sb.ev('(state.blankResults||[]).length') === 1, '통과 기록 +1');
  assert(sb.ev('state.blankResults[0].passed') === true, 'passed=true');
});

/* ── 요약 ── */
console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if (failed) { console.log('\n실패 상세:'); fails.forEach(([n, e]) => console.log(' - ' + n + ': ' + (e && e.message || e))); process.exit(1); }
process.exit(0);
