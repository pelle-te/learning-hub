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
  'ui-routine', 'ui-stats', 'ui-review', 'ui-vault', 'ui-anki', 'ui-degree', 'ui-command', 'app'];
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
    Blob: function () {}, URL: { createObjectURL() { return 'blob:stub'; }, revokeObjectURL() {} },
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

/* U7. 완료 토글 일원화(감사 F-08) — 공용 toggleDoneAt/doneCheckbox가 같은 completions 경로 */
test('U7 공용 toggleDoneAt/doneCheckbox로 완료 일원화', () => {
  const sb = makeSandbox();
  seed(sb);
  sb.ev("TAB='today'; toggleDoneAt('2026-06-28','m','new',120,true)");
  assert(sb.ev("isDone('2026-06-28','m','new')") === true, '공용 토글이 완료 기록');
  const mk = sb.ev("doneCheckbox('2026-06-28','m','new',120,'전자기학')");
  assert(/donechk/.test(mk) && /toggleDoneAt/.test(mk), 'doneCheckbox가 공용 핸들러 마크업 생성');
  assert(/checked/.test(mk), '완료 상태가 checked로 반영');
  sb.ev("toggleDoneAt('2026-06-28','m','new',120,false)");
  assert(sb.ev("isDone('2026-06-28','m','new')") === false, '해제도 공용 경로로 동작');
  // 옛 탭별 핸들러는 제거됨(중복 렌더 경로 해소)
  assert(sb.ev("typeof toggleDoneToday") === 'undefined' && sb.ev("typeof toggleDone") === 'undefined', '탭별 토글 핸들러 제거');
});

/* U8. 유지율 스냅샷(감사 F-05) — recordRetentionSnapshot이 주별 due를 기록(같은 주 덮어씀) */
test('U8 recordRetentionSnapshot이 retentionLog에 주별 due 기록', () => {
  const sb = makeSandbox();
  sb.ev("recordRetentionSnapshot([{name:'d1',new:5,learn:2,review:13,total:200},{name:'d2',new:0,learn:0,review:10,total:50}])");
  assert(sb.ev('(state.retentionLog||[]).length') === 1, '스냅샷 +1');
  assert(sb.ev('state.retentionLog[0].due') === 30, 'due 합계=30');
  assert(sb.ev('state.retentionLog[0].cards') === 250, 'cards 합계=250');
  sb.ev("recordRetentionSnapshot([{name:'d1',new:1,learn:0,review:4,total:200}])");
  assert(sb.ev('(state.retentionLog||[]).length') === 1, '같은 주는 덮어씀(중복 누적 금지)');
  assert(sb.ev('state.retentionLog[0].due') === 5, '덮어쓴 due=5');
  assert(sb.ev('retentionTrend().has') === true && sb.ev('retentionTrend().latest.due') === 5, '추세 요약 동작');
});

/* U9. .ics 신선도(감사 F-10) — exportICS가 시각·서명 스탬프, 계획 변경 시 서명 불일치, export에서 제외 */
test('U9 exportICS 신선도 스탬프 + 계획 서명', () => {
  const sb = makeSandbox();
  seed(sb);
  const sig0 = sb.ev('planSignature()');
  sb.ev('exportICS()');
  assert(sb.ev('!!(state._icsExport && state._icsExport.at)'), '내보내기 시각 스탬프');
  assert(sb.ev('state._icsExport.sig') === sig0, '내보내기 시점 계획 서명 저장');
  sb.ev('state.items[0].weeklyHours = 9');
  assert(sb.ev('planSignature()') !== sig0, '계획이 바뀌면 서명도 바뀜(재내보내기 신호)');
  assert(sb.ev("Object.keys(exportSnapshot()).indexOf('_icsExport') < 0"), '_icsExport는 백업 JSON에서 제외(런타임 캐시)');
});

/* U10. 명령 팔레트(⌘K) — paletteCommands가 탭+액션을 제공, filterCmds가 좁히고, run이 동작 */
test('U10 명령 팔레트 commands/filter/run', () => {
  const sb = makeSandbox();
  const cmds = sb.ev('paletteCommands()');
  assert(Array.isArray(cmds) && cmds.length >= 9, '탭(9) 이상 명령 (len=' + (cmds && cmds.length) + ')');
  assert(cmds.some(c => /통계/.test(c.label)), '탭 이동 명령(통계) 포함');
  assert(cmds.some(c => /내보내기/.test(c.label)), '액션 명령(내보내기) 포함');
  const f = sb.ev("filterCmds('통계')");
  assert(f.length >= 1 && f.every(c => /통계/.test(c.label)), '필터가 일치 명령만 (got ' + f.length + ')');
  assert(sb.ev("filterCmds('존재하지않는명령zzz').length") === 0, '무일치 검색은 빈 목록');
  sb.ev("TAB='today'; paletteCommands().find(c=>c.id==='tab:stats').run()");
  assert(sb.ev('TAB') === 'stats', 'run이 go(stats) 실행');
  assert(sb.ev("typeof openPalette") === 'function' && sb.ev("typeof closePalette") === 'function', 'openPalette/closePalette 노출');
});

/* U11. Undo 토스트 — toastUndo가 액션 버튼 토스트를 만든다(throw 없이) */
test('U11 toastUndo 액션 토스트 생성', () => {
  const sb = makeSandbox();
  assert(sb.ev("typeof toastUndo") === 'function', 'toastUndo 노출');
  sb.ev("toastUndo('초기화했어요.')");   // throw 없이 동작(requestAnimationFrame 미정의 환경 가드 포함)
});

/* U12. Stage 2 시각화 — 스트릭 히트맵 + CBMS 레이더 */
test('U12 스트릭 히트맵·CBMS 레이더 렌더', () => {
  const sb = makeSandbox();
  seed(sb);
  const hm = sb.ev('streakHeatmap()');
  assert(/hm-grid/.test(hm) && /hm-c/.test(hm), '히트맵 그리드 생성');
  const rd = sb.ev('cbmsRadar()');
  assert(/<svg/.test(rd) && /polygon/.test(rd), 'CBMS 레이더 SVG(오답 있을 때)');
  sb.ev('state.cbms = []');
  assert(/오답을 기록/.test(sb.ev('cbmsRadar()')), '오답 없으면 빈 안내');
});

/* U13. Stage 2 테마 3종 순환(dark→light→sepia→dark) */
test('U13 테마 3종 순환', () => {
  const sb = makeSandbox();
  sb.ev("state.theme='dark'; toggleTheme()"); assert(sb.ev('state.theme') === 'light', 'dark→light');
  sb.ev('toggleTheme()'); assert(sb.ev('state.theme') === 'sepia', 'light→sepia');
  sb.ev('toggleTheme()'); assert(sb.ev('state.theme') === 'dark', 'sepia→dark');
});

/* U14. Stage 3 — 일일 의식 + 노트형 요약 내보내기 + rituals 마이그레이션 */
test('U14 의식·노트형 내보내기', () => {
  const sb = makeSandbox();
  seed(sb);
  sb.ev("setRitual('2026-06-28','plan',true)");
  assert(sb.ev("getRitual('2026-06-28').plan") === true, '의식 plan 기록');
  const rc = sb.ev("ritualCard('2026-06-28', null)");
  assert(/오늘 한눈에/.test(rc) && /toggleRitual/.test(rc), '의식 카드 렌더');
  sb.ev("addSummary('2026-06-28','m','전자기학','현상','도구','결과')");
  const md = sb.ev("buildSummaryNotes('','')");
  assert(/요약 노트/.test(md) && /전자기학/.test(md) && /결과/.test(md), '마크다운 노트 생성');
  assert(sb.ev("buildSummaryNotes('1999-01-01','1999-12-31')") === '', '범위 밖이면 빈 문자열');
  assert(sb.ev("typeof state.rituals === 'object'"), 'rituals 스키마 보강');
});

/* U15. Stage 4(안전 변형) — 챕터 타임라인 부분 렌더(F-09): 대용량서 최근 N일만 DOM에 */
test('U15 챕터 타임라인 부분 렌더', () => {
  const sb = makeSandbox();
  sb.ev("globalThis.__r={chapterLog:Array.from({length:120},(_,i)=>({ds:'2026-'+String(1+Math.floor(i/28)).padStart(2,'0')+'-'+String(1+(i%28)).padStart(2,'0'),date:null,name:'X',color:'#6ea8fe',chapters:['c']}))}");
  const html = sb.ev('chapterTimeline(__r)');
  assert(/부분 렌더/.test(html), '초과분 생략 안내');
  const rows = (html.match(/class="tl"/g) || []).length;
  assert(rows <= 60, '렌더 행 ≤ CAP (got ' + rows + ')');
  // 소량이면 생략 없음
  sb.ev("globalThis.__r2={chapterLog:[{ds:'2026-06-01',name:'X',color:'#6ea8fe',chapters:['c']}]}");
  assert(!/부분 렌더/.test(sb.ev('chapterTimeline(__r2)')), '소량은 전부 렌더');
});

/* ── 요약 ── */
console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if (failed) { console.log('\n실패 상세:'); fails.forEach(([n, e]) => console.log(' - ' + n + ': ' + (e && e.message || e))); process.exit(1); }
process.exit(0);
