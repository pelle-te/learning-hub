/* ============================================================
   scheduler.test.js — 스케줄러 회귀 테스트 (의존성 0 · Node 내장만)

   실행:  node test/scheduler.test.js        (러닝허브 폴더에서)
          또는  node 러닝허브/test/scheduler.test.js

   - utils.js + scheduler.js를 vm 컨텍스트에 로드(브라우저 없이).
   - 타임존을 Asia/Seoul로 고정(자기 재실행)해 iso() 회귀를 결정적으로 잡음.
   - schedule()은 전역 state만 읽고 DOM을 안 쓰므로 mock state로 테스트 가능.
   - 실패 시 비ZERO 종료 → 검사.sh / CI에 물리기 좋음.
============================================================ */
'use strict';

/* ── 0) 타임존을 KST로 고정해 자기 재실행 (iso() 타임존 회귀를 결정적으로) ── */
if (process.env.TZ !== 'Asia/Seoul') {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, TZ: 'Asia/Seoul' },
  });
  process.exit(r.status == null ? 1 : r.status);
}

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.resolve(__dirname, '..', 'js');
const SRC =
  fs.readFileSync(path.join(JS_DIR, 'utils.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(JS_DIR, 'scheduler.js'), 'utf8');

/* ── 1) 미니 테스트 프레임워크 ── */
let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; fails.push([name, e]); console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + `: 기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)}`); }
function approx(a, b, tol, msg) { if (Math.abs(a - b) > (tol || 1)) throw new Error((msg || 'approx') + `: 기대 ~${b}, 실제 ${a}`); }

/* ── 2) schedule() 실행 헬퍼 — 테스트마다 새 컨텍스트(상태 누수 방지) ── */
function run(state) {
  const sandbox = {
    state, console, Math, Date, Set, Map, Object, Array, JSON,
    String, Number, Boolean, parseInt, parseFloat, isNaN, RegExp,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'rununit.js' });
  return { r: sandbox.schedule(), sb: sandbox };
}

/* ── 3) mock state 빌더 ── */
let _id = 0;
const nid = () => 'id' + (++_id);
function mkChapters(spec) { // [[name,hours,done?], ...]
  return spec.map(([name, hours, done]) => ({ id: nid(), name, hours, done: !!done }));
}
function weeklyItem(name, weeklyHours, chapters, extra) {
  return Object.assign({ id: nid(), name, mode: 'weekly', weeklyHours, chapters: chapters || [] }, extra || {});
}
function dailyItem(name, dailyMin, extra) {
  return Object.assign({ id: nid(), name, mode: 'daily', dailyMin }, extra || {});
}
function baseState(items, over) {
  // 빈 routine = 하루 종일(1440분) 공부 가능 → 용량 넉넉(결정적 테스트에 유리)
  return Object.assign({
    startDate: '2026-06-23',
    moduleLen: 120,
    reviewRatio: 20,
    routine: [],
    dayOverrides: {},
    items: items || [],
  }, over || {});
}
function blk(name, type, s, e, days) { return { id: nid(), name, type, start: s, end: e, days }; }

/* helpers to inspect result */
const newItems = r => r.days.flatMap(d => d.items.filter(it => it.type === 'new').map(it => ({ ds: d.ds, di: r.days.indexOf(d), ...it })));
const stat = (r, name) => r.itemStat.find(s => s.name === name);

/* ============================================================
   테스트
============================================================ */
console.log('\nscheduler.test.js  (TZ=' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')\n');

/* T1. 타임존/날짜키 — iso() 회귀의 핵심 가드 (KST에서 toISOString 쓰면 즉시 실패) */
test('T1 날짜키가 KST에서 하루 안 밀린다 + 연속 날짜', () => {
  const { r } = run(baseState([weeklyItem('수학', 5, mkChapters([['1장', 4]]))]));
  eq(r.days[0].ds, '2026-06-23', 'days[0]가 startDate와 같아야(밀림 없음)');
  for (let i = 1; i < Math.min(r.days.length, 40); i++) {
    const a = r.days[i - 1].ds, b = r.days[i].ds;
    const diff = Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
    eq(diff, 1, `날짜가 연속이어야 (${a}->${b})`);
    // ds가 그 날의 실제 요일과 일치하는지(파싱 일관성)
    eq(r.days[i].wd, new Date(b + 'T00:00:00').getDay(), 'wd가 ds 요일과 일치');
  }
});

/* T2. 완료(done) 챕터는 계획에서 제외 */
test('T2 done 챕터는 배분에서 빠지고 진행률에 반영', () => {
  const { r } = run(baseState([
    weeklyItem('통신', 6, mkChapters([['A', 2, true], ['B', 2], ['C', 2]])),
  ]));
  const learned = newItems(r).flatMap(it => it.chapters);
  assert(!learned.includes('A'), '완료한 A는 학습 계획에 나오면 안 됨');
  assert(learned.includes('B') && learned.includes('C'), 'B,C는 학습돼야');
  const s = stat(r, '통신');
  eq(s.totalCh, 3, '전체 챕터 수');
  assert(s.doneCh >= 1, 'doneCh가 완료분(1) 이상 반영');
});

/* T3. 모든 챕터 완료 → 학습 없음 / finished */
test('T3 전부 done이면 new 세션 없음 + finished', () => {
  const { r } = run(baseState([
    weeklyItem('끝난과목', 6, mkChapters([['A', 2, true], ['B', 2, true]])),
  ]));
  eq(newItems(r).length, 0, 'new 세션이 없어야');
  const s = stat(r, '끝난과목');
  eq(s.finished, true, 'finished=true');
  eq(s.finishDate, null, '학습일 없음');
});

/* T4. 용량 — 넉넉한 날엔 used가 가용시간을 넘지 않음 */
test('T4 하루 used가 가용시간(studyMin) 이내', () => {
  const { r } = run(baseState([weeklyItem('수학', 6, mkChapters([['1', 10], ['2', 10]]))]));
  r.days.forEach(d => assert(d.used <= d.studyMin + 1, `used(${d.used})<=studyMin(${d.studyMin}) @${d.ds}`));
  assert(r.capUsed <= r.capTotal + 1, 'capUsed<=capTotal');
});

/* T5. 페이스 — 총 시간/주당으로 마감 내 완료 */
test('T5 20h·주6h면 horizon 안에서 finished + finishDate 존재', () => {
  const { r } = run(baseState([weeklyItem('수학', 6, mkChapters([['1', 10], ['2', 10]]))]));
  const s = stat(r, '수학');
  eq(s.finished, true, '완료되어야');
  assert(s.finishDate, 'finishDate 있어야');
  approx(s.totalH, 20, 0.1, 'totalH=20');
});

/* T6. 복습 — 학습 이후에만, 내용·최소시간 보장 */
test('T6 복습은 학습 시작 이후에 배치되고 min>=15·챕터 동반', () => {
  const { r } = run(baseState([weeklyItem('수학', 6, mkChapters([['1', 6], ['2', 6]]))]));
  const news = newItems(r);
  const revs = r.days.flatMap((d, di) => d.items.filter(it => it.type === 'rev').map(it => ({ di, ...it })));
  assert(revs.length > 0, '복습이 생성되어야');
  const firstNew = Math.min(...news.map(n => n.di));
  const firstRev = Math.min(...revs.map(v => v.di));
  assert(firstRev > firstNew, `복습(${firstRev})은 첫 학습(${firstNew})보다 뒤`);
  revs.forEach(v => { assert(v.min >= 15, '복습 min>=15'); assert(v.chapters && v.chapters.length >= 0, 'chapters 배열'); });
});

/* T7. 마감 경고 — 주당 시간이 부족하면 warning */
test('T7 주당 시간 부족 시 마감 경고 발생', () => {
  const { r } = run(baseState([
    weeklyItem('빡센과목', 1, mkChapters(Array.from({ length: 20 }, (_, i) => ['c' + i, 2])), { deadline: '2026-06-30' }),
  ]));
  assert(r.warnings.length > 0, '경고가 있어야');
  assert(r.warnings.some(w => w.includes('빡센과목')), '과목명이 경고에 포함');
});

/* T8. daily(Anki) — 매일 고정 분 확보 */
test('T8 daily 항목은 매일 dailyMin 확보', () => {
  const { r } = run(baseState([
    dailyItem('Anki', 20),
    weeklyItem('수학', 6, mkChapters([['1', 6]])), // horizon 확보용
  ]));
  const ankis = r.days.flatMap(d => d.items.filter(it => it.type === 'anki'));
  assert(ankis.length >= 5, 'anki가 여러 날 잡혀야');
  ankis.forEach(a => eq(a.min, 20, 'dailyMin 20 확보'));
  const s = stat(r, 'Anki');
  assert(s && s.daily && s.days >= 5, 'daily 통계 days>=5');
});

/* T9. 인터리빙 — 같은 과목 연속 회피(여유 있는 날) */
test('T9 두 과목이 한 날 섞이고 인접 중복 없음', () => {
  const { r } = run(baseState([
    weeklyItem('X', 6, mkChapters([['x1', 20]])),
    weeklyItem('Y', 6, mkChapters([['y1', 20]])),
  ]));
  const d0new = r.days[0].items.filter(it => it.type === 'new');
  assert(d0new.length >= 2, '첫날 모듈 2개 이상');
  const sids = new Set(d0new.map(it => it.sid));
  assert(sids.size >= 2, '첫날 두 과목이 섞여야(인터리빙)');
  for (let i = 1; i < d0new.length; i++) assert(d0new[i].sid !== d0new[i - 1].sid, '같은 과목 연속 금지');
});

/* T10. 빈 입력 — 안전하게 빈 결과 */
test('T10 items 비면 days 빈 배열', () => {
  const { r } = run(baseState([]));
  eq(r.days.length, 0, 'days 비어야');
  eq(r.warnings.length, 0, '경고 없음');
});

/* T11. 날짜별 가용시간 덮어쓰기 */
test('T11 dayOverride가 그날 studyMin을 덮어씀', () => {
  const { r } = run(baseState(
    [weeklyItem('수학', 6, mkChapters([['1', 10]]))],
    { dayOverrides: { '2026-06-25': 1 } } // 1시간
  ));
  const d = r.days.find(x => x.ds === '2026-06-25');
  assert(d, '해당 날짜 존재');
  eq(d.studyMin, 60, 'override 1h=60분');
});

/* T12. 빈 구간(free window) 계산 — 수면+수업 제외한 가용시간 */
test('T12 수면/수업 블록 제외한 가용시간이 요일별로 정확', () => {
  const routine = [
    blk('수면', '수면', '00:00', '08:00', [0, 1, 2, 3, 4, 5, 6]), // 깨어있음 08:00~24:00 = 960
    blk('수업', '수업', '09:00', '12:00', [1]),                    // 월요일만 3h 점유
  ];
  const { r } = run(baseState([weeklyItem('수학', 6, mkChapters([['1', 10]]))], { routine }));
  const mon = r.days.find(d => d.wd === 1);   // 월: 960 - 180 = 780
  const tue = r.days.find(d => d.wd === 2);   // 화: 960
  eq(tue.studyMin, 960, '비수업일 960분');
  eq(mon.studyMin, 780, '수업일(월) 780분');
});

/* T13. 백지 복습 — blankReviewWeekly일 때만, 용량 초과 없이, 학습 과목 단위로 생성 */
test('T13 blankReviewWeekly=true면 blank 블록 생성·용량 이내, 기본(off)이면 없음', () => {
  const items = [weeklyItem('수학', 6, mkChapters([['1', 6], ['2', 6], ['3', 6]]))];
  // 기본(플래그 없음) — strict 게이트라 생성되면 안 됨
  const off = run(baseState(items)).r;
  eq(off.days.flatMap(d => d.items.filter(it => it.type === 'blank')).length, 0, '플래그 없으면 blank 0');
  // 켜면 생성
  const on = run(baseState(items, { blankReviewWeekly: true })).r;
  const blanks = on.days.flatMap(d => d.items.filter(it => it.type === 'blank'));
  assert(blanks.length > 0, 'blank가 생성되어야');
  blanks.forEach(b => assert(b.min >= 30, 'blank min>=30'));
  on.days.forEach(d => assert(d.used <= d.studyMin + 1, `용량 이내 @${d.ds}`));
});

/* T14. 모의시험 — mockEveryWeeks>0이면 주기적으로 mock 블록, 용량 이내; 0이면 없음 */
test('T14 mockEveryWeeks=1이면 mock 블록 생성·용량 이내, 0이면 없음', () => {
  const items = [weeklyItem('수학', 6, mkChapters([['1', 8], ['2', 8], ['3', 8]]))];
  const off = run(baseState(items, { mockEveryWeeks: 0 })).r;
  eq(off.days.flatMap(d => d.items.filter(it => it.type === 'mock')).length, 0, 'mockEveryWeeks=0이면 mock 0');
  const on = run(baseState(items, { mockEveryWeeks: 1 })).r;
  const mocks = on.days.flatMap(d => d.items.filter(it => it.type === 'mock'));
  assert(mocks.length > 0, 'mock이 생성되어야');
  mocks.forEach(m => eq(m.min, on.ML, 'mock은 1모듈'));
  on.days.forEach(d => assert(d.used <= d.studyMin + 1, `용량 이내 @${d.ds}`));
});

/* T15. 적응형 용량 — 최근 완료율이 낮으면 미래 용량을 축소(방법론 1·10절) */
test('T15 적응형 용량: 최근 완료 낮으면 미래 day.studyMin 축소(정확히 factor배)', () => {
  const items = [weeklyItem('수학', 6, mkChapters([['1', 20], ['2', 20]]))];
  const comp = {};
  ['2026-06-29','2026-06-30','2026-07-01','2026-07-02','2026-07-03']
    .forEach(ds => { comp[ds] = { 'x|new': { done: true, min: 200 } }; });
  const on  = run(baseState(items, { _today: '2026-07-10', completions: comp })).r;
  const off = run(baseState(items, { _today: '2026-07-10', completions: comp, adaptiveCapacity: false })).r;
  assert(on.adapt < 1, 'adapt<1 이어야 (실제 ' + on.adapt + ')');
  approx(on.adapt, 0.5, 0.001, 'floor 0.5로 클램프');
  const fut = '2026-07-15';
  const dOn = on.days.find(d => d.ds === fut), dOff = off.days.find(d => d.ds === fut);
  assert(dOn && dOff, '미래 날짜 존재');
  assert(dOn.studyMin < dOff.studyMin, '적응 시 미래 용량이 작아야');
  eq(dOn.studyMin, Math.round(dOff.studyMin * on.adapt), '정확히 factor배');
  on.days.forEach(d => assert(d.used <= d.studyMin + 1, '용량 불변식 유지 @' + d.ds));
});

/* T16. 적응형 용량 — 완료 이력이 없으면 1.0(용량 불변) */
test('T16 적응형 용량: 이력 없으면 adapt=1, 미래 용량 그대로', () => {
  const r = run(baseState([weeklyItem('수학', 6, mkChapters([['1', 20]]))], { _today: '2026-07-10' })).r;
  eq(r.adapt, 1, '이력 없으면 adapt=1');
  const fut = r.days.find(d => d.ds === '2026-07-15');
  if (fut) eq(fut.studyMin, 1440, '미래 용량 그대로(1440)');
});

/* T17. 복습 위임 — reviewViaAnki면 합성 간격복습(rev) 슬롯을 만들지 않음 */
test('T17 reviewViaAnki=true(+daily)면 rev 슬롯 0, 기본은 생성', () => {
  const items = [dailyItem('Anki', 20), weeklyItem('수학', 6, mkChapters([['1', 6], ['2', 6]]))];
  const off = run(baseState(items)).r;
  const on  = run(baseState(items, { reviewViaAnki: true })).r;
  const revOff = off.days.flatMap(d => d.items.filter(it => it.type === 'rev')).length;
  const revOn  = on.days.flatMap(d => d.items.filter(it => it.type === 'rev')).length;
  assert(revOff > 0, '기본은 rev 생성');
  eq(revOn, 0, 'reviewViaAnki면 rev 0');
  eq(on.reviewViaAnki, true, '플래그 결과에 반영');
});

/* T18. 에너지 인식 배치 — 피크 시간대면 new가 피크 구간에서 시작 */
test('T18 피크 시간대면 layoutDay가 new를 피크 구간에 우선 배치', () => {
  const { sb } = run(baseState([weeklyItem('수학', 6, mkChapters([['1', 6]]))],
    { peakStart: '09:00', peakEnd: '12:00' }));
  const day = { wd: 3, items: [
    { type: 'rev', sid: 'r', name: '복습', min: 60 },
    { type: 'new', sid: 'n', name: '학습', min: 120 },
  ] };
  const L = sb.layoutDay(day);
  const ns = L.sessions.find(s => s.type === 'new');
  assert(ns && ns.start >= 540 && ns.start < 720, 'new가 피크(09:00~12:00)에서 시작 (start=' + (ns && ns.start) + ')');
});

/* T19. 복습 미배치/과적 경고 — 용량 대비 복습이 넘치면 침묵하지 않고 경고(감사 F-02, "no silent caps") */
test('T19 복습 용량 부족 시 경고가 노출된다(미배치/과적)', () => {
  // 8과목 × 20챕터를 풀가용(빈 routine) 속에 몰아넣고 복습비중을 5%로 깎으면
  // 학습은 많이 생성되나 복습예산이 부족해 일부 복습이 미배치/과적된다.
  const subs = [];
  for (let s = 0; s < 8; s++) {
    const ch = [];
    for (let i = 1; i <= 20; i++) ch.push(['s' + s + 'c' + i, 2]);
    subs.push(weeklyItem('과목' + s, 20, mkChapters(ch)));
  }
  const { r } = run(baseState(subs, { reviewRatio: 5 }));
  assert(r.warnings.some(w => w.includes('복습')), '복습 용량 경고가 있어야: ' + JSON.stringify(r.warnings));
});

/* T20. 백지 복습 단원(챕터) 단위 — 각 blank은 단원 1개를 다룬다(감사 F-03) */
test('T20 백지복습이 단원(챕터) 단위로 생성된다', () => {
  const items = [weeklyItem('수학', 6, mkChapters([['1장', 6], ['2장', 6], ['3장', 6]]))];
  const r = run(baseState(items, { blankReviewWeekly: true })).r;
  const blanks = r.days.flatMap(d => d.items.filter(it => it.type === 'blank'));
  assert(blanks.length > 0, 'blank이 생성되어야');
  blanks.forEach(b => eq((b.chapters || []).length, 1, '각 백지복습은 단원(챕터) 1개만'));
  const chs = new Set(blanks.map(b => b.chapters[0]));
  eq(chs.size, blanks.length, '단원 중복 없이 각 1개');
  r.days.forEach(d => assert(d.used <= d.studyMin + 1, `용량 이내 @${d.ds}`));
});

/* ── 요약 ── */
console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if (failed) { console.log('\n실패 상세:'); fails.forEach(([n, e]) => console.log(' - ' + n + ': ' + (e && e.message || e))); process.exit(1); }
process.exit(0);
