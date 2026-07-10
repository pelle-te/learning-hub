/* ============================================================
   scheduler.test.ts — 스케줄 엔진 회귀(Vitest). 레거시 test/scheduler.test.js(T1~T21)를
   새 lib/scheduler 대상으로 이식 — 동작 parity 보증. schedule(state)/layoutDay(state,day)는
   순수 함수라 state를 인자로 주입(전역·DOM 없음). iso()는 로컬 날짜라 TZ 무관.
============================================================ */
import { describe, expect, it } from 'vitest';
import { layoutDay, schedule, subjectMastery } from '@/lib/scheduler';
import type { AppState, Day, ScheduleItem, ScheduleResult } from '@/lib/types';

let _id = 0;
const nid = () => 'id' + ++_id;
type ChSpec = [string, number, boolean?];
function mkChapters(spec: ChSpec[]) {
  return spec.map(([name, hours, done]) => ({ id: nid(), name, hours, done: !!done }));
}
function weeklyItem(name: string, weeklyHours: number, chapters?: unknown[], extra?: Record<string, unknown>) {
  return { id: nid(), name, mode: 'weekly', weeklyHours, chapters: chapters || [], ...(extra || {}) };
}
function dailyItem(name: string, dailyMin: number, extra?: Record<string, unknown>) {
  return { id: nid(), name, mode: 'daily', dailyMin, ...(extra || {}) };
}
function baseState(items: unknown[], over?: Record<string, unknown>): AppState {
  // 빈 routine = 하루 종일(1440분) 공부 가능 → 결정적 테스트에 유리
  return {
    startDate: '2026-06-23',
    moduleLen: 120,
    reviewRatio: 20,
    routine: [],
    dayOverrides: {},
    items: items || [],
    ...(over || {}),
  } as unknown as AppState;
}
function blk(name: string, type: string, s: string, e: string, days: number[]) {
  return { id: nid(), name, type, start: s, end: e, days };
}

type NewItem = ScheduleItem & { ds: string; di: number };
const newItems = (r: ScheduleResult): NewItem[] =>
  r.days.flatMap((d) =>
    d.items.filter((it) => it.type === 'new').map((it) => ({ ds: d.ds, di: r.days.indexOf(d), ...it })),
  );
const stat = (r: ScheduleResult, name: string) => r.itemStat.find((s) => s.name === name);
const firstNewName = (r: ScheduleResult): string | null => {
  for (const d of r.days) for (const it of d.items) if (it.type === 'new') return it.name;
  return null;
};

describe('scheduler (T1~T21 parity)', () => {
  it('T1 날짜키가 하루 안 밀린다 + 연속 날짜', () => {
    const r = schedule(baseState([weeklyItem('수학', 5, mkChapters([['1장', 4]]))]));
    expect(r.days[0].ds).toBe('2026-06-23');
    for (let i = 1; i < Math.min(r.days.length, 40); i++) {
      const a = r.days[i - 1].ds;
      const b = r.days[i].ds;
      const diff = Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
      expect(diff).toBe(1);
      expect(r.days[i].wd).toBe(new Date(b + 'T00:00:00').getDay());
    }
  });

  it('T2 done 챕터는 배분에서 빠지고 진행률에 반영', () => {
    const r = schedule(
      baseState([
        weeklyItem(
          '통신',
          6,
          mkChapters([
            ['A', 2, true],
            ['B', 2],
            ['C', 2],
          ]),
        ),
      ]),
    );
    const learned = newItems(r).flatMap((it) => it.chapters || []);
    expect(learned.includes('A')).toBe(false);
    expect(learned.includes('B') && learned.includes('C')).toBe(true);
    const s = stat(r, '통신')!;
    expect(s.totalCh).toBe(3);
    expect(s.doneCh! >= 1).toBe(true);
  });

  it('T3 전부 done이면 new 세션 없음 + finished', () => {
    const r = schedule(
      baseState([
        weeklyItem(
          '끝난과목',
          6,
          mkChapters([
            ['A', 2, true],
            ['B', 2, true],
          ]),
        ),
      ]),
    );
    expect(newItems(r).length).toBe(0);
    const s = stat(r, '끝난과목')!;
    expect(s.finished).toBe(true);
    expect(s.finishDate).toBeNull();
  });

  it('T4 하루 used가 가용시간(studyMin) 이내', () => {
    const r = schedule(
      baseState([
        weeklyItem(
          '수학',
          6,
          mkChapters([
            ['1', 10],
            ['2', 10],
          ]),
        ),
      ]),
    );
    r.days.forEach((d) => expect(d.used <= d.studyMin + 1).toBe(true));
    expect(r.capUsed <= r.capTotal + 1).toBe(true);
  });

  it('T5 20h·주6h면 horizon 안에서 finished + finishDate', () => {
    const r = schedule(
      baseState([
        weeklyItem(
          '수학',
          6,
          mkChapters([
            ['1', 10],
            ['2', 10],
          ]),
        ),
      ]),
    );
    const s = stat(r, '수학')!;
    expect(s.finished).toBe(true);
    expect(s.finishDate).toBeTruthy();
    expect(Math.abs(s.totalH! - 20)).toBeLessThanOrEqual(0.1);
  });

  it('T6 복습은 학습 이후·min>=15·챕터 동반', () => {
    const r = schedule(
      baseState([
        weeklyItem(
          '수학',
          6,
          mkChapters([
            ['1', 6],
            ['2', 6],
          ]),
        ),
      ]),
    );
    const news = newItems(r);
    const revs = r.days.flatMap((d, di) => d.items.filter((it) => it.type === 'rev').map((it) => ({ di, ...it })));
    expect(revs.length > 0).toBe(true);
    const firstNew = Math.min(...news.map((n) => n.di));
    const firstRev = Math.min(...revs.map((v) => v.di));
    expect(firstRev > firstNew).toBe(true);
    revs.forEach((v) => {
      expect(v.min >= 15).toBe(true);
      expect(Array.isArray(v.chapters)).toBe(true);
    });
  });

  it('T7 주당 시간 부족 시 마감 경고', () => {
    const r = schedule(
      baseState([
        weeklyItem('빡센과목', 1, mkChapters(Array.from({ length: 20 }, (_, i) => ['c' + i, 2] as ChSpec)), {
          deadline: '2026-06-30',
        }),
      ]),
    );
    expect(r.warnings.length > 0).toBe(true);
    expect(r.warnings.some((w) => w.includes('빡센과목'))).toBe(true);
  });

  it('T8 daily 항목은 매일 dailyMin 확보', () => {
    const r = schedule(baseState([dailyItem('Anki', 20), weeklyItem('수학', 6, mkChapters([['1', 6]]))]));
    const ankis = r.days.flatMap((d) => d.items.filter((it) => it.type === 'anki'));
    expect(ankis.length >= 5).toBe(true);
    ankis.forEach((a) => expect(a.min).toBe(20));
    const s = stat(r, 'Anki')!;
    expect(!!s.daily && s.days! >= 5).toBe(true);
  });

  it('T9 두 과목이 한 날 섞이고 인접 중복 없음', () => {
    const r = schedule(
      baseState([weeklyItem('X', 6, mkChapters([['x1', 20]])), weeklyItem('Y', 6, mkChapters([['y1', 20]]))]),
    );
    const d0new = r.days[0].items.filter((it) => it.type === 'new');
    expect(d0new.length >= 2).toBe(true);
    const sids = new Set(d0new.map((it) => it.sid));
    expect(sids.size >= 2).toBe(true);
    for (let i = 1; i < d0new.length; i++) expect(d0new[i].sid !== d0new[i - 1].sid).toBe(true);
  });

  it('T10 items 비면 days 빈 배열', () => {
    const r = schedule(baseState([]));
    expect(r.days.length).toBe(0);
    expect(r.warnings.length).toBe(0);
  });

  it('T11 dayOverride가 그날 studyMin을 덮어씀', () => {
    const r = schedule(
      baseState([weeklyItem('수학', 6, mkChapters([['1', 10]]))], { dayOverrides: { '2026-06-25': 1 } }),
    );
    const d = r.days.find((x) => x.ds === '2026-06-25')!;
    expect(d.studyMin).toBe(60);
  });

  it('T12 수면/수업 블록 제외한 가용시간이 요일별로 정확', () => {
    const routine = [
      blk('수면', '수면', '00:00', '08:00', [0, 1, 2, 3, 4, 5, 6]),
      blk('수업', '수업', '09:00', '12:00', [1]),
    ];
    const r = schedule(baseState([weeklyItem('수학', 6, mkChapters([['1', 10]]))], { routine }));
    const mon = r.days.find((d) => d.wd === 1)!;
    const tue = r.days.find((d) => d.wd === 2)!;
    expect(tue.studyMin).toBe(960);
    expect(mon.studyMin).toBe(780);
  });

  it('T13 blankReviewWeekly 게이트 + 용량 이내', () => {
    const items = () => [
      weeklyItem(
        '수학',
        6,
        mkChapters([
          ['1', 6],
          ['2', 6],
          ['3', 6],
        ]),
      ),
    ];
    const off = schedule(baseState(items()));
    expect(off.days.flatMap((d) => d.items.filter((it) => it.type === 'blank')).length).toBe(0);
    const on = schedule(baseState(items(), { blankReviewWeekly: true }));
    const blanks = on.days.flatMap((d) => d.items.filter((it) => it.type === 'blank'));
    expect(blanks.length > 0).toBe(true);
    blanks.forEach((b) => expect(b.min >= 30).toBe(true));
    on.days.forEach((d) => expect(d.used <= d.studyMin + 1).toBe(true));
  });

  it('T14 mockEveryWeeks 게이트 + 용량 이내', () => {
    const items = () => [
      weeklyItem(
        '수학',
        6,
        mkChapters([
          ['1', 8],
          ['2', 8],
          ['3', 8],
        ]),
      ),
    ];
    const off = schedule(baseState(items(), { mockEveryWeeks: 0 }));
    expect(off.days.flatMap((d) => d.items.filter((it) => it.type === 'mock')).length).toBe(0);
    const on = schedule(baseState(items(), { mockEveryWeeks: 1 }));
    const mocks = on.days.flatMap((d) => d.items.filter((it) => it.type === 'mock'));
    expect(mocks.length > 0).toBe(true);
    mocks.forEach((m) => expect(m.min).toBe(on.ML));
    on.days.forEach((d) => expect(d.used <= d.studyMin + 1).toBe(true));
  });

  it('T15 적응형 용량: 최근 완료 낮으면 미래 용량 축소(factor배)', () => {
    const items = [
      weeklyItem(
        '수학',
        6,
        mkChapters([
          ['1', 20],
          ['2', 20],
        ]),
      ),
    ];
    const comp: Record<string, Record<string, { done: boolean; min: number }>> = {};
    ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03'].forEach((ds) => {
      comp[ds] = { 'x|new': { done: true, min: 200 } };
    });
    const on = schedule(baseState(items, { _today: '2026-07-10', completions: comp }));
    const off = schedule(baseState(items, { _today: '2026-07-10', completions: comp, adaptiveCapacity: false }));
    expect(on.adapt! < 1).toBe(true);
    expect(Math.abs(on.adapt! - 0.5)).toBeLessThanOrEqual(0.001);
    const fut = '2026-07-15';
    const dOn = on.days.find((d) => d.ds === fut)!;
    const dOff = off.days.find((d) => d.ds === fut)!;
    expect(dOn.studyMin < dOff.studyMin).toBe(true);
    expect(dOn.studyMin).toBe(Math.round(dOff.studyMin * on.adapt!));
    on.days.forEach((d) => expect(d.used <= d.studyMin + 1).toBe(true));
  });

  it('T16 적응형 용량: 이력 없으면 adapt=1', () => {
    const r = schedule(baseState([weeklyItem('수학', 6, mkChapters([['1', 20]]))], { _today: '2026-07-10' }));
    expect(r.adapt).toBe(1);
    const fut = r.days.find((d) => d.ds === '2026-07-15');
    if (fut) expect(fut.studyMin).toBe(1440);
  });

  it('T17 reviewViaAnki면 rev 슬롯 0', () => {
    const items = () => [
      dailyItem('Anki', 20),
      weeklyItem(
        '수학',
        6,
        mkChapters([
          ['1', 6],
          ['2', 6],
        ]),
      ),
    ];
    const off = schedule(baseState(items()));
    const on = schedule(baseState(items(), { reviewViaAnki: true }));
    expect(off.days.flatMap((d) => d.items.filter((it) => it.type === 'rev')).length > 0).toBe(true);
    expect(on.days.flatMap((d) => d.items.filter((it) => it.type === 'rev')).length).toBe(0);
    expect(on.reviewViaAnki).toBe(true);
  });

  it('T18 피크 시간대면 new를 피크 구간에 우선 배치', () => {
    const state = baseState([weeklyItem('수학', 6, mkChapters([['1', 6]]))], { peakStart: '09:00', peakEnd: '12:00' });
    const day = {
      wd: 3,
      items: [
        { type: 'rev', sid: 'r', name: '복습', min: 60 },
        { type: 'new', sid: 'n', name: '학습', min: 120 },
      ],
    } as unknown as Day;
    const L = layoutDay(state, day);
    const ns = L.sessions.find((s) => s.type === 'new')!;
    expect(ns.start! >= 540 && ns.start! < 720).toBe(true);
  });

  it('T19 복습 용량 부족 시 경고 노출', () => {
    const subs: unknown[] = [];
    for (let s = 0; s < 8; s++) {
      const ch: ChSpec[] = [];
      for (let i = 1; i <= 20; i++) ch.push(['s' + s + 'c' + i, 2]);
      subs.push(weeklyItem('과목' + s, 20, mkChapters(ch)));
    }
    const r = schedule(baseState(subs, { reviewRatio: 5 }));
    expect(r.warnings.some((w) => w.includes('복습'))).toBe(true);
  });

  it('T20 백지복습이 단원(챕터) 단위로 생성', () => {
    const items = [
      weeklyItem(
        '수학',
        6,
        mkChapters([
          ['1장', 6],
          ['2장', 6],
          ['3장', 6],
        ]),
      ),
    ];
    const r = schedule(baseState(items, { blankReviewWeekly: true }));
    const blanks = r.days.flatMap((d) => d.items.filter((it) => it.type === 'blank'));
    expect(blanks.length > 0).toBe(true);
    blanks.forEach((b) => expect((b.chapters || []).length).toBe(1));
    const chs = new Set(blanks.map((b) => (b.chapters || [])[0]));
    expect(chs.size).toBe(blanks.length);
    r.days.forEach((d) => expect(d.used <= d.studyMin + 1).toBe(true));
  });

  it('T21 그래프 우선순위: 약한 과목을 먼저 배치(배열순서 무관)', () => {
    const mkItems = () => [
      weeklyItem(
        '대수',
        4,
        mkChapters([
          ['ch1', 2],
          ['ch2', 2],
          ['ch3', 2],
        ]),
      ),
      weeklyItem(
        '미적분',
        4,
        mkChapters([
          ['ch1', 2],
          ['ch2', 2],
          ['ch3', 2],
        ]),
      ),
    ];
    const know = {
      subjects: [
        { subject: '대수', mastery: 0.9 },
        { subject: '미적분', mastery: 0.1 },
      ],
    };
    const off = schedule(baseState(mkItems(), { _knowState: know, graphPriority: false }));
    expect(firstNewName(off)).toBe('대수');
    const on = schedule(baseState(mkItems(), { _knowState: know, graphPriority: true }));
    expect(firstNewName(on)).toBe('미적분');
    const noKnow = schedule(baseState(mkItems(), { graphPriority: true }));
    expect(firstNewName(noKnow)).toBe('대수');
  });

  // ── 버그 회귀(2026-07 코드 점검) ──
  it('T22 자정 넘는 수면(23:00–07:00) 한 칸이 심야를 공부에서 제외(옛 버그: 1440)', () => {
    const routine = [blk('수면', '수면', '23:00', '07:00', [0, 1, 2, 3, 4, 5, 6])];
    const r = schedule(baseState([weeklyItem('수학', 6, mkChapters([['1', 10]]))], { routine }));
    expect(r.days[0].studyMin).toBe(960); // 07:00–23:00 = 960분
  });

  it('T23 두 칸 수면(00:00–07:00 + 23:00–24:00)도 자정 넘김과 동일하게 해석', () => {
    const routine = [
      blk('수면', '수면', '00:00', '07:00', [0, 1, 2, 3, 4, 5, 6]),
      blk('수면', '수면', '23:00', '24:00', [0, 1, 2, 3, 4, 5, 6]),
    ];
    const r = schedule(baseState([weeklyItem('수학', 6, mkChapters([['1', 10]]))], { routine }));
    expect(r.days[0].studyMin).toBe(960);
  });

  it('T24 시작일이 빈 값이어도 days가 비지 않는다(오늘로 폴백)', () => {
    const r = schedule(baseState([weeklyItem('수학', 6, mkChapters([['1', 10]]))], { startDate: '' }));
    expect(r.days.length).toBeGreaterThan(0);
  });

  // ── 버그 회귀(2026-07-02 라운드) ──
  it('T25 자정 넘는 비수면 블록(알바 23:00–01:00)도 공부 가능시간에서 제외(옛 버그: 통째 무시)', () => {
    const routine = [blk('알바', '활동', '23:00', '01:00', [0, 1, 2, 3, 4, 5, 6])];
    const r = schedule(baseState([weeklyItem('수학', 6, mkChapters([['1', 10]]))], { routine }));
    expect(r.days[0].studyMin).toBe(1320); // 1440 − (23:00–24:00 60 + 00:00–01:00 60)
  });

  it('T26 layoutDay: 자정 걸침 블록은 두 세그먼트로 분할(end<start인 깨진 항목 없음)', () => {
    const state = baseState([], { routine: [blk('야근', '활동', '22:00', '02:00', [3])] });
    const day = { wd: 3, items: [] } as unknown as Day;
    const L = layoutDay(state, day);
    const segs = L.tl.filter((t) => t.kind === 'block' && t.name === '야근');
    expect(segs.map((t) => [t.start, t.end]).sort((a, b) => a[0]! - b[0]!)).toEqual([
      [0, 120],
      [1320, 1440],
    ]);
    L.tl.forEach((t) => expect(t.end > t.start).toBe(true));
  });

  it('T27 subjectMastery: 정확 일치 우선·포함은 길이차 최소(옛 버그: 첫-포함 히트 오매핑)', () => {
    const know = {
      subjects: [
        { subject: '물리화학', mastery: 0.2 },
        { subject: '물리', mastery: 0.8 },
      ],
    };
    const state = baseState([], { _knowState: know });
    expect(subjectMastery(state, '물리')).toBe(0.8); // 정확 일치가 앞의 포함 히트를 이김
    const know2 = {
      subjects: [
        { subject: '수학과 물리', mastery: 0.3 },
        { subject: '수학Ⅱ', mastery: 0.6 },
      ],
    };
    expect(subjectMastery(baseState([], { _knowState: know2 }), '수학')).toBe(0.6); // 길이차 최소 후보
  });

  it('T28 같은 날 같은 과목 학습 모듈은 한 행으로 병합(완료 키 sid|type 충돌 방지)', () => {
    const ch: ChSpec[] = [];
    for (let i = 1; i <= 10; i++) ch.push(['ch' + i, 4]);
    const r = schedule(baseState([weeklyItem('수학', 40, mkChapters(ch))]));
    r.days.forEach((d) => {
      const news = d.items.filter((it) => it.type === 'new');
      expect(new Set(news.map((it) => it.sid)).size).toBe(news.length); // 하루에 같은 sid 학습행 1개
    });
    const maxMin = Math.max(...newItems(r).map((it) => it.min));
    expect(maxMin).toBeGreaterThan(120); // 병합이 실제로 일어남(모듈 2개 이상 합쳐진 날 존재)
  });

  // ── 버그 회귀(2026-07-10 · N-6) ──
  it('T29 챕터 없는 과목은 마감이 있어도 "다 못 끝내요" 경고를 내지 않는다', () => {
    // _hadChapters=false면 chaptersLeft()가 늘 true → finished가 영영 false라 옛 코드는 경고를 영구 오탐.
    const r = schedule(baseState([weeklyItem('무챕터과목', 5, [], { deadline: '2027-01-01' })]));
    expect(r.warnings.some((w) => w.includes('다 못 끝내요'))).toBe(false);
    expect(r.warnings.some((w) => w.includes('무챕터과목'))).toBe(false);
  });

  it('T30 챕터가 있는데 주당 시간 부족하면 마감 경고는 그대로 뜬다', () => {
    // 가드가 정상 경고(T7 계열)까지 삼키지 않는지 — 챕터 있는 과목은 여전히 경고.
    const r = schedule(
      baseState([
        weeklyItem('빡센과목', 1, mkChapters(Array.from({ length: 20 }, (_, i) => ['c' + i, 2] as ChSpec)), {
          deadline: '2026-06-30',
        }),
      ]),
    );
    expect(r.warnings.some((w) => w.includes('빡센과목') && w.includes('다 못 끝내요'))).toBe(true);
  });
});
