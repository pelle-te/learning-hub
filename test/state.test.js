/* ============================================================
   state.test.js — 영속/마이그레이션 회귀 테스트 (의존성 0 · Node 내장만)

   실행:  node test/state.test.js   (러닝허브 폴더에서)

   - utils.js + state.js를 vm 컨텍스트에 로드(브라우저 없이).
   - localStorage/alert를 mock해 boot()·migrate()·persist() 라운드트립을 검증.
   - migrate는 '구버전 호환의 단일 창구'이자 데이터 손실 방지의 핵심이라 가드한다.
============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.resolve(__dirname, '..', 'js');
const SRC =
  fs.readFileSync(path.join(JS_DIR, 'utils.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(JS_DIR, 'state.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(JS_DIR, 'data-methodology.js'), 'utf8');   // 방법론 데이터(요약·CBMS·백지·Anki카드)는 분리됨

/* ── 미니 테스트 프레임워크 ── */
let passed = 0, failed = 0; const fails = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; fails.push([name, e]); console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + `: 기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)}`); }

/* ── mock localStorage(Map 기반) + 샌드박스 ── */
function makeSandbox() {
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const sandbox = {
    localStorage, console,
    alert: () => {}, confirm: () => true,
    Math, Date, JSON, Object, Array, Set, Map, String, Number, Boolean,
    parseInt, parseFloat, isNaN, RegExp,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'runstate.js' });
  sandbox.__store = store;
  // const/let 최상위 선언은 sandbox 프로퍼티가 안 되므로 컨텍스트에서 직접 평가한다.
  sandbox.ev = expr => vm.runInContext(expr, sandbox);
  return sandbox;
}

/* 최소 유효 상태(validShape 통과용) */
function oldShape(extra) {
  return Object.assign({
    items: [{ id: 'a', name: '수학', mode: 'weekly', weeklyHours: 5, chapters: [] }],
    routine: [],
    degree: { semesters: [] },
    startDate: '2026-01-01',
  }, extra || {});
}

console.log('\nstate.test.js\n');

/* S1. migrate가 누락된 새 필드를 기본값으로 보강 */
test('S1 migrate가 신규 필드(적응·실행레이어)를 보강', () => {
  const sb = makeSandbox();
  const m = sb.migrate(JSON.parse(JSON.stringify(oldShape())));
  assert(m, 'valid이면 객체 반환');
  eq(m.adaptiveCapacity, true, 'adaptiveCapacity 기본 true');
  eq(m.reviewViaAnki, false, 'reviewViaAnki 기본 false');
  eq(m.peakStart, '', 'peakStart 기본 빈값');
  assert(m.summaries && typeof m.summaries === 'object', 'summaries 보강');
  assert(Array.isArray(m.cbms), 'cbms 보강');
  assert(Array.isArray(m.backlog), 'backlog 보강');
  eq(m.blankReviewWeekly, true, 'blankReviewWeekly 기본');
  eq(m.schemaVersion, sb.ev('SCHEMA_VERSION'), 'schemaVersion 갱신');
});

/* S2. 잘못된 구조는 거부(null) — 엉뚱한 JSON으로 덮어써 깨지는 것 방지 */
test('S2 migrate는 무효 입력을 null로 거부', () => {
  const sb = makeSandbox();
  eq(sb.migrate(null), null, 'null 거부');
  eq(sb.migrate({}), null, '빈 객체(필수항목 없음) 거부');
  eq(sb.migrate({ items: [], routine: [] }), null, 'degree/startDate 없으면 거부');
});

/* S3. _today(테스트 시드)는 마이그레이션에서 제거(가져온 파일에 묻어와도) */
test('S3 migrate가 _today 시드를 제거', () => {
  const sb = makeSandbox();
  const m = sb.migrate(oldShape({ _today: '2026-06-28' }));
  assert(m._today == null, '_today 제거되어야');
});

/* S4. '공부' 블록 폐지 — migrate가 잔존 공부 블록을 제거 */
test('S4 migrate가 폐지된 "공부" 블록을 제거', () => {
  const sb = makeSandbox();
  const m = sb.migrate(oldShape({ routine: [
    { id: 'b1', name: '공부', type: '공부', start: '09:00', end: '11:00', days: [1] },
    { id: 'b2', name: '수면', type: '수면', start: '00:00', end: '07:00', days: [0,1,2,3,4,5,6] },
  ] }));
  eq(m.routine.length, 1, '공부 블록 제거 후 1개');
  eq(m.routine[0].type, '수면', '수면만 남음');
});

/* S5. persist → boot 라운드트립(데이터 보존) */
test('S5 persist 후 boot가 동일 데이터를 복원', () => {
  const sb = makeSandbox();
  sb.ev("state.items.push({id:'z',name:'추가과목',mode:'weekly',weeklyHours:3,chapters:[]})");
  sb.ev("state.summaries['2026-06-28']=[{id:'s1',sid:'',name:'추가과목',s1:'a',s2:'b',s3:'c'}]");
  sb.ev('persist()');
  const booted = sb.ev('boot()');
  assert(booted.items.some(i => i.name === '추가과목'), 'items 라운드트립');
  assert(booted.summaries['2026-06-28'], 'summaries 라운드트립');
});

/* S6. 손상 데이터 — 기본값으로 시작하되 원본을 CORRUPT_KEY에 보존(영구손실 방지 P1-7) */
test('S6 손상 raw는 CORRUPT_KEY에 보존하고 기본값으로 부팅', () => {
  const sb = makeSandbox();
  sb.ev("localStorage.setItem(KEY,'{이건 깨진 JSON')");
  const b = sb.ev('boot()');
  assert(b && Array.isArray(b.items), '기본값으로 안전 부팅');
  eq(sb.ev('localStorage.getItem(CORRUPT_KEY)'), '{이건 깨진 JSON', '원본을 corrupt 키에 보존');
});

/* S7. Anki 카드 생성 — 요약·오답을 TSV 라인으로 */
test('S7 buildAnkiCards가 요약·오답을 TSV로 생성', () => {
  const sb = makeSandbox();
  sb.ev("state.summaries['2026-06-28']=[{id:'s',sid:'',name:'전자기학',s1:'현상',s2:'도구',s3:'결과'}]");
  sb.ev("state.cbms=[{id:'c',ds:'2026-06-28',sid:'',name:'전자기학',chapter:'3장',code:'M',note:'유도막힘'}]");
  const lines = sb.ev("buildAnkiCards('','')");
  eq(lines.length, 2, '요약1 + 오답1 = 2장');
  lines.forEach(l => assert(l.split('\t').length === 3, 'front\\tback\\ttags 3열'));
  assert(lines[0].includes('전자기학'), '과목명 포함');
});

/* S8. addCbms confidence — '찍어서 맞음' 플래그 기록(감사 F-06) */
test('S8 addCbms가 확신없음(conf) 플래그를 기록', () => {
  const sb = makeSandbox();
  sb.ev("addCbms('2026-06-28','','수학','3장','M','메모',true)");
  eq(sb.ev('state.cbms[state.cbms.length-1].conf'), true, 'conf=true 기록');
  sb.ev("addCbms('2026-06-28','','수학','3장','M','메모2')");   // 6인자(미지정)
  eq(sb.ev('state.cbms[state.cbms.length-1].conf'), false, '미지정 시 false');
});

/* S9. 백지 결과 — 막힘이면 CBMS(C) 자동 연결 + 통과율 집계(감사 F-04) */
test('S9 setBlankResult: 막힘→CBMS(C) 연결·통과율 집계', () => {
  const sb = makeSandbox();
  const c0 = sb.ev('(state.cbms||[]).length');
  sb.ev("setBlankResult('2026-06-28','m','수학',false,'변위전류 유도','3장')");
  eq(sb.ev('(state.cbms||[]).length'), c0 + 1, '막힘이면 CBMS +1');
  eq(sb.ev('state.cbms[state.cbms.length-1].code'), 'C', '개념(C)로 연결');
  // 같은 날·과목 재기록은 CBMS 중복 생성 안 함
  sb.ev("setBlankResult('2026-06-28','m','수학',false,'다시','3장')");
  eq(sb.ev('(state.cbms||[]).length'), c0 + 1, '중복 막힘은 CBMS 추가 안 함');
  sb.ev("setBlankResult('2026-06-28','n','물리',true,'','')");
  const pr = sb.ev("blankPassRate('','')");
  eq(pr.total, 2, '기록 2(과목 m·n)');
  eq(pr.passed, 1, '통과 1');
});

/* S10. 내보내기 스냅샷 — 런타임 스캔 캐시 제외(감사 F-01) */
test('S10 exportSnapshot이 런타임 스캔 캐시를 제외', () => {
  const sb = makeSandbox();
  sb.ev("state._vaultScan={at:1,subjects:[1,2,3]}; state._ankiLive={decks:[]}; state._ankiFile={decks:[]}");
  const snap = sb.ev('exportSnapshot()');
  assert(snap._vaultScan === undefined && snap._ankiLive === undefined && snap._ankiFile === undefined, '3개 캐시 제외');
  assert(Array.isArray(snap.items) && typeof snap.startDate === 'string', '실데이터는 유지');
});

/* S11. migrate가 retentionLog를 보강(F-05) + _icsExport는 export에서 제외(F-10) */
test('S11 retentionLog 보강 + _icsExport export 제외', () => {
  const sb = makeSandbox();
  const m = sb.migrate(oldShape());                 // 구버전엔 retentionLog 없음
  assert(Array.isArray(m.retentionLog), 'migrate가 retentionLog 배열 보강');
  sb.ev("state._icsExport={at:'2026-06-28T00:00:00Z',sig:'x'}");
  const snap = sb.ev('exportSnapshot()');
  assert(snap._icsExport === undefined, '_icsExport는 백업 JSON에서 제외(런타임 캐시)');
});

/* ── 요약 ── */
console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if (failed) { console.log('\n실패 상세:'); fails.forEach(([n, e]) => console.log(' - ' + n + ': ' + (e && e.message || e))); process.exit(1); }
process.exit(0);
