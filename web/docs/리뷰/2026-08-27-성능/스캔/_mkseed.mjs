/* 규모별 시드 생성기 — 트랙 A 의 SEED(2과목·3챕터)는 실사용 규모가 아니다.
   실측 앵커: 실 DB 기준 과목 5 · 챕터 51 · 코스 44 · 학기 3 (원장 I001/I029 실측치). */
import fs from 'node:fs';
const D = 'docs/리뷰/2026-08-27-성능/스캔';
const base = JSON.parse(fs.readFileSync(D + '/seed.json', 'utf8'));

function mk(nSub, chPerSub, nCourses, nSem, nCompDays) {
  const s = structuredClone(base);
  s.items = Array.from({ length: nSub }, (_, i) => ({
    id: 's' + i, source: '직접', name: `과목${i}`, color: '#4f8ff0',
    mode: i % 2 ? 'weekly' : 'deadline', weeklyHours: 4 + (i % 5), dailyMin: 30,
    deadline: i % 2 ? '' : '2026-08-15',
    chapters: Array.from({ length: chPerSub }, (_, j) => ({
      id: `s${i}c${j}`, name: `챕터 ${j}`, hours: 2 + (j % 4), done: j % 3 === 0,
    })),
  }));
  s.completions = {};
  for (let d = 0; d < nCompDays; d++) {
    const ds = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    const day = {};
    for (let i = 0; i < Math.min(nSub, 4); i++) day[`s${i}|s${i}c${d % chPerSub}`] = { done: true, min: 30 + i * 10 };
    s.completions[ds] = day;
  }
  s.cbms = Array.from({ length: Math.min(nSub * 4, 400) }, (_, i) => ({
    id: 'e' + i, ds: '2026-06-13', sid: 's' + (i % nSub), name: `과목${i % nSub}`,
    chapter: `챕터 ${i % chPerSub}`, code: 'C', note: '정의 혼동', conf: false,
  }));
  s.degree = {
    targetTotal: 130, reqMajorReq: 60, reqMajorSel: 30, reqLiberal: 30,
    semesters: Array.from({ length: nSem }, (_, k) => ({
      id: 'sm' + k, name: `202${k}-1학기`,
      courses: Array.from({ length: Math.ceil(nCourses / nSem) }, (_, c) => ({
        id: `sm${k}co${c}`, name: `강의 ${c}`, credits: 3,
        category: c % 3 === 0 ? '전공필수' : c % 3 === 1 ? '전공선택' : '교양',
        status: k < nSem - 1 ? '완료' : '수강중', grade: k < nSem - 1 ? 'A+' : '',
      })),
    })),
  };
  return s;
}

const real = mk(5, 11, 44, 3, 240);   // 실사용 규모(과목 5 · 챕터 55 · 코스 44 · 완료 240일)
const x10  = mk(50, 11, 440, 8, 730); // 10배 — 붕괴점 탐색
fs.writeFileSync(D + '/seed_real.json', JSON.stringify(real));
fs.writeFileSync(D + '/seed_x10.json', JSON.stringify(x10));
const n = (s) => ({
  bytes: JSON.stringify(s).length, items: s.items.length,
  chapters: s.items.reduce((a, i) => a + i.chapters.length, 0),
  completionDays: Object.keys(s.completions).length,
  courses: s.degree.semesters.reduce((a, x) => a + x.courses.length, 0),
  cbms: s.cbms.length,
});
console.log('base ', JSON.stringify(n(base)));
console.log('real ', JSON.stringify(n(real)));
console.log('x10  ', JSON.stringify(n(x10)));
