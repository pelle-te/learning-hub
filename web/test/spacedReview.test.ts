/* ============================================================
   spacedReview.test.ts — 개념(챕터) 간격반복 위험 + freeMinAfter(홈 헬퍼) 회귀.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  chapterReviews,
  chapterShift,
  dueForecast,
  examStaleChapters,
  pullForwardCandidates,
  interleaveBySubject,
  leechChapters,
  maintenanceReviews,
  riskChapters,
  failingSids,
  riskOf,
  riskSummary,
  shiftContext,
  LEECH_FAILS,
  type ChapterReview,
  type ReviewRisk,
} from '@/lib/spacedReview';
import { REVIEW_OFFSETS } from '@/lib/utils';
import { touchReview } from '@/lib/persistence';
import { freeMinAfter } from '@/lib/scheduler';
import type { Day, ScheduleItem } from '@/lib/types';

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

/* ── P-3 CBMS 코드가 사다리를 가른다(2026-08-01) ─────────────────────────────
   여기까지 CBMS 는 **아무것도 안 바꿨다**(`grep cbms lib/scheduler/ lib/spacedReview.ts` 0건).
   잠그는 것 둘: ① 지식 결손 계열(C·B·M)만 앞당긴다 ② 챕터 코드가 **과목 단위 백지 신호를
   이긴다** — 더 정밀한 신호가 있는데 거친 신호로 덮으면 오탐이 남는다. */
describe('spacedReview — CBMS 코드가 복습 사다리를 가른다(P-3)', () => {
  const days = [day('2026-06-26', [newIt('m', '수학', ['5장'])])]; // age 8 → 평소 due
  const base = stateWith([['2026-06-26', 'm', 'new']]);
  const withCbms = (code: string, chapter = '5장', ds = '2026-06-27'): AppState =>
    ({
      ...base,
      cbms: [{ id: 'x', ds, sid: 'm', name: '수학', chapter, code, note: '', conf: false, at: 1 }],
    }) as unknown as AppState;
  /** 과목 단위 백지 실패 — 위 ID-10 블록의 헬퍼와 같은 형태(스코프가 달라 여기 한 벌 더 둔다). */
  const blankFail = (ds: string, sid: string) => ({
    blankResults: [{ id: 'b0', ds, sid, name: '', passed: false, note: '' }],
  });

  it("'개념(C)'은 앞당긴다 — 몰라서 틀렸다", () => {
    expect(chapterReviews(withCbms('C'), days, TODAY)[0]!.risk).toBe('overdue');
  });

  it("⚠ '실수(S)'는 앞당기지 않는다 — 알지만 틀린 것은 개념 결손이 아니다", () => {
    expect(chapterReviews(withCbms('S'), days, TODAY)[0]!.risk).toBe('due');
  });

  it("'시간(T)'도 앞당기지 않는다(속도 문제이지 지식 결손이 아니다)", () => {
    expect(chapterReviews(withCbms('T'), days, TODAY)[0]!.risk).toBe('due');
  });

  it("'경계(B)'·'수학(M)'은 앞당긴다", () => {
    expect(chapterReviews(withCbms('B'), days, TODAY)[0]!.risk).toBe('overdue');
    expect(chapterReviews(withCbms('M'), days, TODAY)[0]!.risk).toBe('overdue');
  });

  /* ⚠⚠ 이 케이스가 "오탐 제거"의 본체다. 종전엔 과목 백지가 막히면 **그 과목 전 챕터**가
     앞당겨졌다 — 검산 한 번 놓친 챕터가 정말 모르는 챕터와 같은 급함을 가졌다. */
  it('⚠ 챕터의 CBMS 코드가 과목 단위 백지 신호를 이긴다', () => {
    const st = { ...withCbms('S'), ...blankFail('2026-06-27', 'm') } as AppState;
    expect(chapterReviews(st, days, TODAY)[0]!.risk).toBe('due'); // 백지는 실패했지만 실수였다
  });

  it('CBMS 가 없는 챕터는 종전대로 과목 단위 백지 신호로 떨어진다(폴백)', () => {
    const st = { ...withCbms('S', '다른장'), ...blankFail('2026-06-27', 'm') } as AppState;
    expect(chapterReviews(st, days, TODAY)[0]!.risk).toBe('overdue');
  });

  it('가장 최근 코드만 본다 — 옛 실패가 영원히 따라다니지 않는다(낙인 금지)', () => {
    const st = {
      ...base,
      cbms: [
        { id: 'a', ds: '2026-06-27', sid: 'm', name: '수학', chapter: '5장', code: 'C', note: '', conf: false, at: 1 },
        { id: 'b', ds: '2026-06-29', sid: 'm', name: '수학', chapter: '5장', code: 'S', note: '', conf: false, at: 2 },
      ],
    } as unknown as AppState;
    expect(chapterReviews(st, days, TODAY)[0]!.risk).toBe('due'); // 최근 것이 실수 → 안 앞당김
  });

  it('미래 기록은 무시한다(시드·시계 어긋남 방어)', () => {
    expect(chapterReviews(withCbms('C', '5장', '2026-09-01'), days, TODAY)[0]!.risk).toBe('due');
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

describe('spacedReview — 가용선(N-9 · 부하와 가용을 같은 단위로)', () => {
  /** 계획 배열의 미래 날 — studyMin(그날 가용)과 이미 잡힌 블록을 실어 가용선의 입력이 된다. */
  const planDay = (ds: string, studyMin: number, items: ScheduleItem[] = []): Day =>
    ({
      ds,
      date: new Date(ds + 'T00:00:00'),
      wd: new Date(ds + 'T00:00:00').getDay(),
      studyMin,
      used: 0,
      modLeft: 0,
      revLeft: 0,
      items,
    }) as Day;
  const revIt = (sid: string, min: number): ScheduleItem => ({ type: 'rev', sid, name: '복습', min });
  /** 완료 이력 + 챕터 분량(hours)을 함께 가진 상태. ML=120 → 복습 1블록 = 30분. */
  const stateOf = (chapters: { sid: string; name: string; ch: [string, number][] }[], done: [string, string][]) => {
    const s = stateWith(done.map(([ds, sid]) => [ds, sid, 'new'] as [string, string, string]));
    return {
      ...s,
      moduleLen: 120,
      items: chapters.map((c) => ({
        id: c.sid,
        name: c.name,
        chapters: c.ch.map(([name, hours]) => ({ id: name, name, hours })),
      })),
    } as unknown as AppState;
  };

  it('막대는 개수가 아니라 **분량**을 센다 — 같은 2개라도 블록이 다르다', () => {
    const days = [day(TODAY, [newIt('p', '물리', ['역학', '열'])])];
    const big = stateOf(
      [
        {
          sid: 'p',
          name: '물리',
          ch: [
            ['역학', 4],
            ['열', 2],
          ],
        },
      ],
      [[TODAY, 'p']],
    );
    const small = stateOf(
      [
        {
          sid: 'p',
          name: '물리',
          ch: [
            ['역학', 0.5],
            ['열', 0.5],
          ],
        },
      ],
      [[TODAY, 'p']],
    );
    const on1 = (s: AppState) => dueForecast(s, days, TODAY).find((f) => f.offset === 1)!;
    expect(on1(big).chapters).toBe(2);
    expect(on1(small).chapters).toBe(2); // 개수는 같은데
    expect(on1(big).blocks).toBe(3); // 6h = 3모듈치 = 3블록
    expect(on1(small).blocks).toBe(1); // 1h = 0.5모듈 → 반올림 0이 아니라 최소 1블록
  });

  it('분량을 모르는 챕터는 엔진과 같은 1h 폴백(계획과 예보가 다른 세계를 말하지 않게)', () => {
    const days = [day(TODAY, [newIt('p', '물리', ['미등록장'])])];
    const s = stateOf([{ sid: 'p', name: '물리', ch: [['역학', 4]] }], [[TODAY, 'p']]);
    expect(dueForecast(s, days, TODAY).find((f) => f.offset === 1)!.load[0]!.hours).toBe(1);
  });

  it('가용선 = (그날 가용 − 이미 잡힌 비복습 블록) ÷ 복습 1블록 · 넘으면 over', () => {
    const s = stateOf(
      [
        {
          sid: 'p',
          name: '물리',
          ch: [
            ['역학', 4],
            ['열', 2],
          ],
        },
      ],
      [[TODAY, 'p']],
    );
    const days = [
      day(TODAY, [newIt('p', '물리', ['역학', '열'])]),
      planDay('2026-07-05', 60), // 가용 60분 → 2블록. 부하 3블록 → 초과
      planDay('2026-07-07', 240, [newIt('p', '물리', ['다음장'])]), // 240 − 120(학습) = 120 → 4블록
    ];
    const fc = dueForecast(s, days, TODAY);
    const at = (off: number) => fc.find((f) => f.offset === off)!;
    expect(at(1).capBlocks).toBe(2);
    expect(at(1).over).toBe(true);
    expect(at(3).capBlocks).toBe(4);
    expect(at(3).over).toBe(false); // 3블록 ≤ 4블록
  });

  it('가용에서 rev 는 빼지 않는다 — 계획의 rev 가 곧 이 예보라 빼면 이중계상', () => {
    const s = stateOf([{ sid: 'p', name: '물리', ch: [['역학', 4]] }], [[TODAY, 'p']]);
    const days = [day(TODAY, [newIt('p', '물리', ['역학'])]), planDay('2026-07-05', 120, [revIt('p', 60)])];
    // 60분 rev 를 빼면 2블록이 됐을 것 — 안 빼므로 120/30 = 4블록.
    expect(dueForecast(s, days, TODAY).find((f) => f.offset === 1)!.capBlocks).toBe(4);
  });

  it('계획 배열에 없는 날은 가용을 **모른다**(null) — 모르면 초과라고 말하지 않는다', () => {
    const s = stateOf([{ sid: 'p', name: '물리', ch: [['역학', 8]] }], [[TODAY, 'p']]);
    const fc = dueForecast(s, [day(TODAY, [newIt('p', '물리', ['역학'])])], TODAY);
    expect(fc[0]!.blocks).toBe(4);
    expect(fc[0]!.capBlocks).toBeNull();
    expect(fc[0]!.over).toBe(false);
  });

  it('앞당길 후보 — 분량 큰 것부터, 여유 있는 가장 이른 날로, 같은 날에 몰아주지 않는다', () => {
    const s = stateOf(
      [
        {
          sid: 'p',
          name: '물리',
          ch: [
            ['역학', 4],
            ['열', 2],
            ['파동', 2],
          ],
        },
      ],
      [[TODAY, 'p']],
    );
    const days = [
      day(TODAY, [newIt('p', '물리', ['역학', '열', '파동'])]),
      planDay('2026-07-05', 30), // +1일: 1블록(부하 4블록 → 초과)
      planDay('2026-07-06', 60), // +2일: 2블록 여유
      planDay('2026-07-08', 60), // +4일: 2블록 여유
    ];
    const fc = dueForecast(s, days, TODAY);
    expect(fc.find((f) => f.offset === 1)!.over).toBe(true);
    const cands = pullForwardCandidates(fc, 1);
    expect(cands.map((c) => c.chapter.chapter)).toEqual(['역학', '열', '파동']); // 분량 큰 순
    // +1일 앞엔 여유 있는 날이 없다 → 전부 '오늘'(null). 앞선 날이 생기면 그 날을 쓴다.
    expect(cands.map((c) => c.toOffset)).toEqual([null, null, null]);
    // +3일(사다리의 다음 파도) 기준 앞선 여유는 +2일의 2블록뿐 → 두 후보가 나눠 쓰고 세 번째는 오늘.
    expect(pullForwardCandidates(fc, 3).map((c) => c.toOffset)).toEqual([2, 2, null]);
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

describe('spacedReview — 유지 큐(N-10 · 끝낸 챕터가 사라지지 않게)', () => {
  /** 챕터 카탈로그만 있는 상태 — 스케줄(days)은 일부러 비운다. done 챕터는 계획에 원리적으로
   *  안 나타나므로, 유지 스캔이 **스케줄과 무관하게** 동작하는 것이 이 기능의 요점이다. */
  const catalog = (chs: { name: string; done: boolean; doneDs?: string }[]): AppState =>
    ({
      items: [{ id: 'p', name: '물리', chapters: chs.map((c) => ({ id: c.name, name: c.name, hours: 2, ...c })) }],
    }) as unknown as AppState;

  it('스케줄이 비어도 끝낸 챕터를 찾는다 — 진행 중 챕터는 여기 없다', () => {
    const s = catalog([
      { name: '역학', done: true, doneDs: '2026-05-01' },
      { name: '전자기', done: false },
    ]);
    expect(chapterReviews(s, [], TODAY)).toHaveLength(0); // 스케줄 경로는 못 본다(= 옛 구멍)
    const keep = maintenanceReviews(s, TODAY);
    expect(keep.map((c) => c.chapter)).toEqual(['역학']);
    expect(keep[0]!.maintenance).toBe(true);
    expect(keep[0]!.anchored).toBe(true);
    expect(keep[0]!.daysSince).toBe(64);
  });

  it('유지는 **절대 overdue 가 아니다**(한 단 강등) — 진행 중 밀림이 향수에 밀리지 않게', () => {
    const s = catalog([{ name: '역학', done: true, doneDs: '2025-01-01' }]); // 1년 반 방치
    expect(maintenanceReviews(s, TODAY)[0]!.risk).toBe('due');
  });

  it('사다리 첫 칸(34일) 전이면 fresh — 막 끝낸 챕터를 곧바로 되돌리지 않는다', () => {
    const fresh = catalog([{ name: '역학', done: true, doneDs: '2026-07-01' }]); // 3일 전
    expect(maintenanceReviews(fresh, TODAY)[0]!.risk).toBe('fresh');
    const old = catalog([{ name: '역학', done: true, doneDs: '2026-05-31' }]); // 34일 전
    expect(maintenanceReviews(old, TODAY)[0]!.risk).toBe('due');
  });

  it('앵커를 모르면(옛 done 챕터) 오래됐다고 단정하지 않고 due 로만 — 인출 한 번이 앵커를 만든다', () => {
    const s = catalog([{ name: '역학', done: true }]);
    const before = maintenanceReviews(s, TODAY)[0]!;
    expect(before.anchored).toBe(false);
    expect(before.lastDs).toBe('');
    expect(before.risk).toBe('due');
    touchReview(s, 'p', '역학', TODAY); // 러너에서 한 번 인출
    const after = maintenanceReviews(s, TODAY)[0]!;
    expect(after.anchored).toBe(true);
    expect(after.daysSince).toBe(0);
    expect(after.risk).toBe('fresh'); // 방금 봤으니 다음 칸까지 조용하다
  });

  it('앵커 = 끝낸 날과 마지막 인출 중 최신 · 미래 값은 무시(시드·시계 어긋남)', () => {
    const s = catalog([{ name: '역학', done: true, doneDs: '2026-05-01' }]);
    touchReview(s, 'p', '역학', '2026-06-20');
    expect(maintenanceReviews(s, TODAY)[0]!.lastDs).toBe('2026-06-20');
    // 미래 터치는 저장소를 덮지만(touchReview 는 단조 증가) 앵커로는 안 쓴다 → 끝낸 날로 폴백.
    // 요점은 **미래 앵커가 음수 경과일을 만들지 않는 것**이다(그러면 유지가 영영 안 뜬다).
    touchReview(s, 'p', '역학', '2026-09-01');
    const after = maintenanceReviews(s, TODAY)[0]!;
    expect(after.lastDs).toBe('2026-05-01');
    expect(after.daysSince).toBeGreaterThan(0);
  });

  it('예보는 **앵커를 아는 것만** 투영한다 — 모르는 날짜를 특정 날에 그리면 가용선까지 거짓이 된다', () => {
    const known = catalog([{ name: '역학', done: true, doneDs: '2026-06-10' }]); // daysSince 24 → 34-24=+10일
    const fc = dueForecast(known, [], TODAY);
    expect(fc.filter((f) => f.chapters > 0).map((f) => f.offset)).toEqual([10]);
    const unknown = catalog([{ name: '역학', done: true }]);
    expect(dueForecast(unknown, [], TODAY).reduce((t, f) => t + f.chapters, 0)).toBe(0);
  });
});

describe('Q-4 통과 방향 개방 — 비대칭이 풀렸다', () => {
  it('기본(신호 없음)은 종전 그대로 7=due · 16=overdue', () => {
    expect(riskOf(6)).toBe('fresh');
    expect(riskOf(7)).toBe('due');
    expect(riskOf(16)).toBe('overdue');
  });

  it('실패 방향은 종전 그대로 한 칸 앞당김(3=due · 7=overdue)', () => {
    expect(riskOf(3, true)).toBe('due');
    expect(riskOf(7, true)).toBe('overdue');
  });

  it('⭐ 통과 방향은 한 칸 미룸(16=due · 34=overdue) — 이게 새로 열린 방향이다', () => {
    expect(riskOf(7, false, true)).toBe('fresh'); // 종전엔 due 였다
    expect(riskOf(15, false, true)).toBe('fresh');
    expect(riskOf(16, false, true)).toBe('due'); // 종전엔 overdue
    expect(riskOf(33, false, true)).toBe('due');
    expect(riskOf(34, false, true)).toBe('overdue');
  });

  it('⚠ 상한은 한 칸이다 — 34일이면 붙은 챕터도 overdue 가 된다(방치 금지)', () => {
    expect(riskOf(60, false, true)).toBe('overdue');
  });

  it('⚠ 신호가 갈리면 failing 이 이긴다 — 위험 쪽으로 틀리는 편이 안전하다', () => {
    expect(riskOf(7, true, true)).toBe('overdue'); // strong 을 무시하고 앞당김
  });
});

/* ── A-4 만성 실패(leech) ─────────────────────────────────────────────────
   `blankResults` 를 직접 세는 함수라 위 `stateWith`(completions 기반) 대신 자체 픽스처를 쓴다. */
function stateWithBlanks(rows: [string, string, string, boolean][], itemNames: [string, string][] = []): AppState {
  return {
    items: itemNames.map(([id, name]) => ({ id, name, chapters: [] })),
    blankResults: rows.map(([ds, sid, chapter, passed], i) => ({ id: 'b' + i, ds, sid, chapter, passed })),
    completions: {},
  } as unknown as AppState;
}
const fail = (ds: string, ch = '3장'): [string, string, string, boolean] => [ds, 'c', ch, false];

describe('A-4 leechChapters — 만성 실패는 처방이 다르다', () => {
  it('임계는 **사다리의 칸 수**에서 파생한다(임의 계수 금지)', () => {
    expect(LEECH_FAILS).toBe(REVIEW_OFFSETS.length);
  });

  it('LEECH_FAILS 회 미만이면 leech 가 아니다', () => {
    const st = stateWithBlanks([fail('2026-06-01'), fail('2026-06-10'), fail('2026-06-20')], [['c', '회로이론']]);
    expect(leechChapters(st, TODAY)).toEqual([]);
  });

  it('LEECH_FAILS 회 이상 + 마지막도 막힘이면 leech — 간격과 과목명을 함께 낸다', () => {
    const st = stateWithBlanks(
      [fail('2026-06-01'), fail('2026-06-08'), fail('2026-06-11'), fail('2026-06-14')],
      [['c', '회로이론']],
    );
    const [l] = leechChapters(st, TODAY);
    expect(l).toMatchObject({ sid: 'c', subject: '회로이론', chapter: '3장', fails: 4, attempts: 4 });
    // 간격이 **줄어드는데도** 계속 실패했다 = "더 자주 보기"가 안 통했다는 증거
    expect(l!.gaps).toEqual([7, 3, 3]);
  });

  it('⚠ 마지막이 통과면 제외한다 — 과거의 실패가 영원히 따라다니면 그건 낙인이다', () => {
    const st = stateWithBlanks(
      [
        fail('2026-06-01'),
        fail('2026-06-08'),
        fail('2026-06-11'),
        fail('2026-06-14'),
        ['2026-06-20', 'c', '3장', true],
      ],
      [['c', '회로이론']],
    );
    expect(leechChapters(st, TODAY)).toEqual([]);
  });

  it('미래 기록은 안 센다(시드·시계 어긋남 방어)', () => {
    const st = stateWithBlanks([fail('2026-06-01'), fail('2026-06-08'), fail('2026-06-11'), fail('2099-01-01')]);
    expect(leechChapters(st, TODAY)).toEqual([]);
  });

  it('⭐ leech 는 **앞당김을 받지 않는다** — 같은 처방의 반복을 멈추는 것이 이 항목의 전부다', () => {
    const rows: [string, string, string, boolean][] = [
      fail('2026-06-01'),
      fail('2026-06-08'),
      fail('2026-06-11'),
      fail('2026-06-14'),
    ];
    const st = stateWithBlanks(rows, [['c', '회로이론']]);
    const ctx = shiftContext(st, TODAY);
    expect(ctx.leeches.has('c|3장')).toBe(true);
    /* 막힌 기록이 넷인데도 failing 이 false 다(= 기본 사다리로 되돌아간다).
       ⚠ I-1(W7) — `coef` 도 **null** 이다: 계수는 *얼마나 붙었나*의 함수인데 leech 는 그 질문의
       답이 이미 나와 있고(안 붙는다) 처방이 간격이 아니다. 계수를 주면 A-4 가 멈춘 앞당김이
       다른 이름으로 되살아난다. */
    expect(chapterShift('c', '3장', ctx)).toEqual({ failing: false, strong: false, coef: null });
    // 대조군: 세 번만 막힌 다른 챕터는 종전대로 앞당겨진다
    const st3 = stateWithBlanks([fail('2026-06-01', '5장'), fail('2026-06-08', '5장'), fail('2026-06-11', '5장')]);
    expect(chapterShift('c', '5장', shiftContext(st3, TODAY)).failing).toBe(true);
  });
});

/* ── A-3 시험일 앵커 ────────────────────────────────────────────────────── */
describe('A-3 examStaleChapters — "그날 내가 이걸 기억하고 있나"', () => {
  // TODAY=2026-07-04 기준. 사다리 투영은 예보와 같은 오프셋(1·3·7·16·34)을 쓴다.
  const days3 = [day('2026-07-01', [newIt('c', '회로이론', ['3장'])])];
  const st3 = stateWith([['2026-07-01', 'c', 'new']]);

  it('시험 전 마지막으로 걸리는 칸을 찾아 **시험 당일의 나이**를 낸다', () => {
    // daysSince=3 · 시험까지 21일 → 걸리는 칸은 +0·+4·+13 → 마지막은 +13 → 나이 21-13=8(due)
    const [s] = examStaleChapters(st3, days3, TODAY, '2026-07-25');
    expect(s).toMatchObject({ chapter: '3장', ageAtExam: 8, riskAtExam: 'due', untouched: false });
    expect(s!.lastBefore).toBe('2026-07-17');
  });

  it('⭐ 시험 전에 한 칸도 안 걸리면 `untouched` — **지금 넣지 않으면 시험까지 다시 안 본다**', () => {
    // daysSince=20(6/14 학습) · 시험까지 5일 → 다음 칸은 +14 로 시험 뒤 → 나이 20+5=25(overdue)
    const days20 = [day('2026-06-14', [newIt('c', '회로이론', ['3장'])])];
    const st20 = stateWith([['2026-06-14', 'c', 'new']]);
    const [s] = examStaleChapters(st20, days20, TODAY, '2026-07-09');
    expect(s).toMatchObject({ ageAtExam: 25, riskAtExam: 'overdue', untouched: true });
    expect(s!.lastBefore).toBe('2026-06-14'); // 마지막으로 **본** 날 그대로
  });

  it('그날 괜찮을 챕터(fresh)는 목록에 없다 — 나열하면 다시 사람이 골라야 한다', () => {
    // 시험이 4일 뒤면 +4 칸에 걸려 나이 0
    expect(examStaleChapters(st3, days3, TODAY, '2026-07-08')).toEqual([]);
  });

  it('지난 시험으로 오늘을 겁주지 않는다', () => {
    expect(examStaleChapters(st3, days3, TODAY, '2026-06-30')).toEqual([]);
  });

  it('⚠ 판정은 `riskOf` 를 그대로 쓴다 — "시험용 위험"을 따로 정의하지 않는다', () => {
    const [s] = examStaleChapters(st3, days3, TODAY, '2026-07-25');
    expect(s!.riskAtExam).toBe(riskOf(s!.ageAtExam));
  });
});
