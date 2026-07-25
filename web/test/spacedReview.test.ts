/* ============================================================
   spacedReview.test.ts — 개념(챕터) 간격반복 위험 + freeMinAfter(홈 헬퍼) 회귀.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  chapterReviews,
  dueForecast,
  interleaveBySubject,
  riskChapters,
  failingSids,
  riskOf,
  riskSummary,
  type ChapterReview,
  type ReviewRisk,
} from '@/lib/spacedReview';
import { touchReview } from '@/lib/persistence';
import { freeMinAfter } from '@/lib/scheduler';
import type { AppState, Day, ScheduleItem } from '@/lib/types';

const TODAY = '2026-07-04';

const newIt = (sid: string, name: string, chapters: string[]): ScheduleItem => ({
  type: 'new',
  sid,
  name,
  min: 120,
  chapters,
  color: '#0f0',
});
const day = (ds: string, items: ScheduleItem[]): Day =>
  ({ ds, date: new Date(ds + 'T00:00:00'), wd: 0, studyMin: 0, used: 0, modLeft: 0, revLeft: 0, items }) as Day;

function stateWith(done: [string, string, string][]): AppState {
  const completions: Record<string, Record<string, { done: boolean; min: number }>> = {};
  for (const [ds, sid, type] of done) {
    (completions[ds] = completions[ds] || {})[sid + '|' + type] = { done: true, min: 60 };
  }
  return { items: [], completions } as unknown as AppState;
}

describe('spacedReview — riskOf 임계(REVIEW_OFFSETS 16/7 정렬)', () => {
  it('16↑ overdue, 7↑ due, 그 외 fresh', () => {
    expect(riskOf(16)).toBe('overdue');
    expect(riskOf(20)).toBe('overdue');
    expect(riskOf(7)).toBe('due');
    expect(riskOf(15)).toBe('due');
    expect(riskOf(6)).toBe('fresh');
    expect(riskOf(0)).toBe('fresh');
  });
});

describe('spacedReview — 성패 가중 간격(ID-10 · 실패 방향만)', () => {
  it('직전 백지가 막힘이면 사다리를 한 칸 앞당긴다(7→3 · 16→7)', () => {
    expect(riskOf(3, true)).toBe('due'); // 평소엔 fresh
    expect(riskOf(7, true)).toBe('overdue'); // 평소엔 due
    expect(riskOf(2, true)).toBe('fresh'); // 앞당겨도 갓 본 건 갓 본 것
  });

  it('통과 방향은 **일부러** 안 바꾼다 — 잊은 챕터를 안 보여주는 쪽이 더 나쁘다', () => {
    // failing=false 는 기존 임계 그대로. 성공했다고 간격을 늘리는 경로는 이 함수에 없다.
    expect(riskOf(6)).toBe('fresh');
    expect(riskOf(7)).toBe('due');
    expect(riskOf(16)).toBe('overdue');
  });

  const blanks = (rows: [string, string, boolean][]): AppState =>
    ({
      blankResults: rows.map(([ds, sid, passed], i) => ({ id: 'b' + i, ds, sid, name: '', passed, note: '' })),
    }) as unknown as AppState;

  it('과목당 가장 최근 결과만 본다 — 통과가 뒤따르면 실패 표식이 풀린다(낙인 금지)', () => {
    const st = blanks([
      ['2026-06-20', 'm', false],
      ['2026-06-28', 'm', true], // 더 최근에 통과
      ['2026-06-22', 'p', false], // 물리는 실패가 최신
    ]);
    const f = failingSids(st, TODAY);
    expect(f.has('m')).toBe(false);
    expect(f.has('p')).toBe(true);
  });

  it('미래 기록은 무시한다(시드·시계 어긋남 방어)', () => {
    expect(failingSids(blanks([['2026-09-01', 'm', false]]), TODAY).has('m')).toBe(false);
  });

  it('기록이 없으면 아무 과목도 앞당기지 않는다', () => {
    expect(failingSids({} as AppState, TODAY).size).toBe(0);
  });

  it('chapterReviews 가 그 과목 챕터의 위험을 실제로 올린다', () => {
    // 수학 5장 = age 8 → 평소 due. 직전 백지가 막힘이면 overdue(임계 7)로 올라간다.
    const days = [day('2026-06-26', [newIt('m', '수학', ['5장'])])];
    const base = stateWith([['2026-06-26', 'm', 'new']]);
    expect(chapterReviews(base, days, TODAY)[0]!.risk).toBe('due');

    const failed = { ...base, ...blanks([['2026-06-27', 'm', false]]) } as AppState;
    expect(chapterReviews(failed, days, TODAY)[0]!.risk).toBe('overdue');
  });
});

describe('spacedReview — chapterReviews', () => {
  const days = [
    day('2026-06-18', [newIt('m', '수학', ['1장'])]), // age 16 → overdue (완료)
    day('2026-06-25', [newIt('m', '수학', ['4장'])]), // 미완료 → 제외
    day('2026-06-26', [newIt('m', '수학', ['5장'])]), // age 8 → due (완료)
    day('2026-06-30', [newIt('m', '수학', ['2장'])]), // age 4 → fresh (완료)
    day('2026-07-04', [newIt('p', '물리', ['역학'])]), // 오늘 → fresh (완료)
    day('2026-07-10', [newIt('m', '수학', ['3장'])]), // 미래 → 무시(완료여도)
  ];
  const state = stateWith([
    ['2026-06-18', 'm', 'new'],
    ['2026-06-26', 'm', 'new'],
    ['2026-06-30', 'm', 'new'],
    ['2026-07-04', 'p', 'new'],
    ['2026-07-10', 'm', 'new'],
  ]);

  it('완료 세션만·미래 제외·경과일/위험 계산', () => {
    const revs = chapterReviews(state, days, TODAY);
    const byCh = Object.fromEntries(revs.map((r) => [r.chapter, r]));
    expect(byCh['4장']).toBeUndefined(); // 미완료
    expect(byCh['3장']).toBeUndefined(); // 미래
    expect(byCh['1장']!.daysSince).toBe(16);
    expect(byCh['1장']!.risk).toBe('overdue');
    expect(byCh['5장']!.risk).toBe('due');
    expect(byCh['2장']!.risk).toBe('fresh');
    expect(byCh['역학']!.daysSince).toBe(0);
    // 위험 큰 순 정렬(첫 항목 = 가장 오래됨)
    expect(revs[0]!.chapter).toBe('1장');
  });

  it('riskChapters = due/overdue만, riskSummary 집계', () => {
    const risky = riskChapters(state, days, TODAY);
    expect(risky.map((r) => r.chapter)).toEqual(['1장', '5장']);
    expect(riskSummary(state, days, TODAY)).toEqual({ overdue: 1, due: 1 });
  });

  it('reviewTouches(ReviewRun 챕터 터치)가 lastDs를 갱신해 overdue를 푼다 — 감사 #22', () => {
    // 계획상 마지막 완료가 16일 전(overdue)인 챕터를 오늘 ReviewRun으로 인출한 시나리오.
    const days2 = [day('2026-06-18', [newIt('m', '수학', ['1장'])])];
    const s2 = stateWith([['2026-06-18', 'm', 'new']]);
    expect(chapterReviews(s2, days2, TODAY)[0]!.risk).toBe('overdue');
    touchReview(s2, 'm', '1장', TODAY);
    const rev = chapterReviews(s2, days2, TODAY)[0]!;
    expect(rev.lastDs).toBe(TODAY);
    expect(rev.daysSince).toBe(0);
    expect(rev.risk).toBe('fresh');
  });

  it('터치는 최신만 유지(과거 터치가 최신 완료를 되감지 않음) · 미래 터치는 무시', () => {
    const days2 = [day('2026-07-02', [newIt('m', '수학', ['1장'])])];
    const s2 = stateWith([['2026-07-02', 'm', 'new']]);
    touchReview(s2, 'm', '1장', '2026-06-20'); // 계획 완료(07-02)보다 과거
    expect(chapterReviews(s2, days2, TODAY)[0]!.lastDs).toBe('2026-07-02');
    touchReview(s2, 'm', '1장', '2026-08-01'); // 미래 ds — 스캔과 동일하게 무시
    expect(chapterReviews(s2, days2, TODAY)[0]!.lastDs).toBe('2026-07-02');
  });

  it('touchReview는 단조 증가(같은 키에 과거 ds를 써도 되돌아가지 않음)', () => {
    const s2 = stateWith([]);
    touchReview(s2, 'm', '1장', '2026-07-03');
    touchReview(s2, 'm', '1장', '2026-07-01');
    expect(s2.reviewTouches!['m|1장']).toBe('2026-07-03');
  });

  it('마지막으로 만진 날 = 여러 세션 중 최신', () => {
    const days2 = [day('2026-06-20', [newIt('m', '수학', ['1장'])]), day('2026-07-02', [newIt('m', '수학', ['1장'])])];
    const s2 = stateWith([
      ['2026-06-20', 'm', 'new'],
      ['2026-07-02', 'm', 'new'],
    ]);
    const revs = chapterReviews(s2, days2, TODAY);
    expect(revs).toHaveLength(1);
    expect(revs[0]!.lastDs).toBe('2026-07-02');
    expect(revs[0]!.daysSince).toBe(2);
  });
});

describe('spacedReview — dueForecast(ID-1 복습 부하 예보)', () => {
  it('오늘 만진 챕터는 1·3·7일에 파도로 계상(오프셋 사다리) · horizon 밖(16)은 제외', () => {
    const days = [day(TODAY, [newIt('p', '물리', ['역학'])])];
    const s = stateWith([[TODAY, 'p', 'new']]);
    const fc = dueForecast(s, days, TODAY, 14);
    expect(fc).toHaveLength(14);
    const on = (off: number) => fc.find((f) => f.offset === off)!;
    expect(on(1).chapters).toBe(1);
    expect(on(3).chapters).toBe(1);
    expect(on(7).chapters).toBe(1);
    expect(on(2).chapters).toBe(0); // 오프셋 사이 빈 날
    expect(fc.some((f) => f.offset === 16)).toBe(false); // horizon(14) 밖
    // 날짜·요일 파생 검증
    expect(on(1).ds).toBe('2026-07-05');
    expect(on(7).ds).toBe('2026-07-11');
    expect(on(1).wd).toBe(new Date('2026-07-05T00:00:00').getDay());
  });

  it('이미 모든 오프셋 지난(overdue) 챕터는 예보에서 빠진다(=오늘탭 backlog)', () => {
    const days = [day('2026-06-18', [newIt('m', '수학', ['1장'])])]; // daysSince 16
    const s = stateWith([['2026-06-18', 'm', 'new']]);
    const fc = dueForecast(s, days, TODAY);
    expect(fc.reduce((t, f) => t + f.chapters, 0)).toBe(0);
  });

  it('중간 사다리 챕터 — 남은 오프셋만 미래로 투영', () => {
    const days = [day('2026-06-30', [newIt('m', '수학', ['2장'])])]; // daysSince 4
    const s = stateWith([['2026-06-30', 'm', 'new']]);
    const fc = dueForecast(s, days, TODAY);
    expect(fc.filter((f) => f.chapters > 0).map((f) => f.offset)).toEqual([3, 12]); // 7-4, 16-4
  });

  it('같은 날 여러 챕터 → 과목별 집계·개수 내림차순', () => {
    const days = [day(TODAY, [newIt('p', '물리', ['역학', '열']), newIt('m', '수학', ['1장'])])];
    const s = stateWith([
      [TODAY, 'p', 'new'],
      [TODAY, 'm', 'new'],
    ]);
    const on1 = dueForecast(s, days, TODAY).find((f) => f.offset === 1)!;
    expect(on1.chapters).toBe(3);
    expect(on1.subjects.map((x) => [x.subject, x.count])).toEqual([
      ['물리', 2],
      ['수학', 1],
    ]);
  });

  it('horizon 인자가 예보 길이를 정한다', () => {
    const fc = dueForecast(stateWith([]), [], TODAY, 7);
    expect(fc).toHaveLength(7);
    expect(fc[0]!.offset).toBe(1);
    expect(fc[6]!.offset).toBe(7);
  });
});

describe('spacedReview — interleaveBySubject(ID-2 과목 인터리빙)', () => {
  const cr = (sid: string, chapter: string, daysSince: number): ChapterReview => ({
    sid,
    subject: sid.toUpperCase(),
    chapter,
    lastDs: '2026-06-01',
    daysSince,
    risk: riskOf(daysSince) as ReviewRisk,
  });
  // 위험순(daysSince desc) 정렬 입력 가정. m 3장·p 2장·e 1장 전부 overdue.
  const key = (c: ChapterReview) => `${c.sid}:${c.chapter}`;

  it('티어 안에서 과목 라운드로빈으로 끼운다(같은 과목 연속 금지)', () => {
    const input = [
      cr('m', 'm1', 30),
      cr('m', 'm2', 28),
      cr('m', 'm3', 26),
      cr('p', 'p1', 25),
      cr('p', 'p2', 24),
      cr('e', 'e1', 20),
    ];
    // 과목 회전 순 = 가장 급한 챕터 등장 순(m→p→e). 라운드: [m1,p1,e1],[m2,p2],[m3].
    expect(interleaveBySubject(input).map(key)).toEqual(['m:m1', 'p:p1', 'e:e1', 'm:m2', 'p:p2', 'm:m3']);
  });

  it('위험 티어는 절대 넘지 않는다 — overdue 전부가 due 앞(overdue 밀림 금지)', () => {
    const input = [
      cr('m', 'm1', 20), // overdue
      cr('m', 'm2', 18), // overdue
      cr('p', 'p1', 10), // due
      cr('p', 'p2', 9), // due
    ];
    const out = interleaveBySubject(input);
    const firstDue = out.findIndex((c) => c.risk === 'due');
    const lastOverdue = out.map((c) => c.risk).lastIndexOf('overdue');
    expect(lastOverdue).toBeLessThan(firstDue);
    // 티어 경계 넘어 인터리브하지 않는다: overdue 는 m만 2장이라 [m1,m2], due 는 [p1,p2].
    expect(out.map(key)).toEqual(['m:m1', 'm:m2', 'p:p1', 'p:p2']);
  });

  it('과목이 하나뿐이면 항등(순서 그대로) · 빈 입력은 빈 출력 · 결정적', () => {
    const single = [cr('m', 'm1', 30), cr('m', 'm2', 20), cr('m', 'm3', 10)];
    expect(interleaveBySubject(single).map(key)).toEqual(['m:m1', 'm:m2', 'm:m3']);
    expect(interleaveBySubject([])).toEqual([]);
    const input = [cr('m', 'm1', 30), cr('p', 'p1', 25), cr('m', 'm2', 20)];
    expect(interleaveBySubject(input)).toEqual(interleaveBySubject(input)); // 안정
  });
});

describe('scheduler — freeMinAfter(now 이후 남은 자유시간)', () => {
  const free: [number, number][] = [
    [540, 600], // 09:00–10:00
    [900, 1080], // 15:00–18:00
  ];
  it('now가 창 중간이면 남은 뒷부분만', () => {
    expect(freeMinAfter(free, 570)).toBe(30 + 180); // 09:30 이후
  });
  it('now가 모든 창 뒤면 0', () => {
    expect(freeMinAfter(free, 1200)).toBe(0);
  });
  it('now가 하루 시작이면 전부', () => {
    expect(freeMinAfter(free, 0)).toBe(60 + 180);
  });
});
