/* ============================================================
   scheduler.test.ts — 스케줄 엔진 회귀(Vitest). 레거시 test/scheduler.test.js(T1~T21)를
   새 lib/scheduler 대상으로 이식 — 동작 parity 보증. schedule(state)/layoutDay(state,day)는
   순수 함수라 state를 인자로 주입(전역·DOM 없음). iso()는 로컬 날짜라 TZ 무관.
============================================================ */
import { describe, expect, it } from 'vitest';
import { layoutDay, schedule, subjectMastery, sessionTimeMap } from '@/lib/scheduler';
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

  /* ── E25 계획 배치도 과목을 섞는다(2026-07-29) ────────────────────────
     이 앱은 복습 12장에 대해선 인터리빙을 지키면서(`interleaveBySubject`) **하루 6시간의 본
     학습에는 안 지키고** 있었다 — `layout` 이 생성 순을 그대로 배치했기 때문이다.
     ⚠ 이 케이스가 없으면 그 변경이 **관측되지 않는다**: 기존 스케줄러 테스트에는 같은 날 여러
       과목이 오는 픽스처가 없어, 인터리빙을 넣어도 전량 녹색이었다(실제로 그랬다). */
  it('T18-b 같은 날 여러 과목이면 라운드로빈으로 섞인다(블록 수·분은 불변)', () => {
    const state = baseState([weeklyItem('수학', 6, mkChapters([['1', 6]]))]);
    const day = {
      wd: 3,
      items: [
        { type: 'new', sid: 'a', name: '수학', min: 60 },
        { type: 'new', sid: 'a', name: '수학', min: 60 },
        { type: 'new', sid: 'b', name: '물리', min: 60 },
      ],
    } as unknown as Day;
    const L = layoutDay(state, day);
    const sids = L.sessions.filter((x) => x.type === 'new').map((x) => x.sid);
    expect(sids).toEqual(['a', 'b', 'a']); // 생성 순이면 a,a,b 였다
    expect(L.sessions.filter((x) => x.type === 'new')).toHaveLength(3); // 순열이다 — 개수 불변
  });

  it('T18-c peak 이 티어를 정하고 인터리빙이 그 안을 정한다(두 규칙이 안 싸운다)', () => {
    const state = baseState([weeklyItem('수학', 6, mkChapters([['1', 6]]))], {
      peakStart: '09:00',
      peakEnd: '12:00',
    });
    const day = {
      wd: 3,
      items: [
        { type: 'rev', sid: 'r1', name: '복습1', min: 30 },
        { type: 'new', sid: 'a', name: '수학', min: 60 },
        { type: 'new', sid: 'b', name: '물리', min: 60 },
      ],
    } as unknown as Day;
    const L = layoutDay(state, day);
    const order = L.sessions.map((x) => x.type);
    // new(피크 대상)가 먼저 = peak 이 티어를 정한다. 그 안에서 a,b 가 섞인다.
    expect(order.indexOf('new')).toBeLessThan(order.indexOf('rev'));
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

  // ── 버그 회귀(2026-07-10 · X-2·X-10·L-9·L-10) ──
  it('T31 한낮 수면(낮잠)은 공부 가능시간에서 차감(이중계상 방지)', () => {
    // 낮잠 13:00–14:00은 가장자리 수면이 아니라 awakeBounds에 안 잡히고, 옛 코드는 수면을 점유에서
    // 제외해 학습시간으로 제공(초과편성). 이제 한낮 수면 60분만큼 studyMin이 줄어야 한다(X-2).
    const withNap = schedule(
      baseState([weeklyItem('수학', 6, mkChapters([['1', 10]]))], {
        routine: [blk('낮잠', '수면', '13:00', '14:00', [0, 1, 2, 3, 4, 5, 6])],
      }),
    );
    const without = schedule(baseState([weeklyItem('수학', 6, mkChapters([['1', 10]]))]));
    expect(withNap.days[0].studyMin).toBeLessThan(without.days[0].studyMin);
    expect(withNap.days[0].studyMin).toBe(without.days[0].studyMin - 60); // 1440 → 1380
  });

  it('T32 경과한 과거 startDate·짧은 계획도 오늘 이후 일자를 만든다(빈 앱 방지)', () => {
    // startDate가 몇 달 전이고 계획이 가벼우면 endDate(페이스)가 오늘 이전이라 표시창이 오늘 미포함 →
    // 복귀 사용자에게 빈 Today/Schedule. 이제 표시창이 오늘까지 전방 확장돼야 한다(X-10).
    const r = schedule(
      baseState([weeklyItem('수학', 6, mkChapters([['1', 2]]))], { startDate: '2026-01-01', _today: '2026-07-10' }),
    );
    expect(r.days.length).toBeGreaterThan(0);
    expect(r.days.some((d) => d.ds >= '2026-07-10')).toBe(true);
    expect(r.days[r.days.length - 1].ds >= '2026-07-10').toBe(true);
  });

  it('T32b startDate가 546일보다 더 과거여도 오늘이 창 안에 들어온다(상한이 보장을 깨지 않음)', () => {
    // T32의 전방 확장 항에 페이스 경로와 같은 546 상한이 걸려 있어, 간격이 그보다 크면(929일)
    // 창이 오늘 *이전*에서 끝났다 → 오늘 탭이 비고, 그 상태의 편집이 빈 자동초안을 manual로
    // 승격시켜 그날이 영구히 빈 계획이 되는 경로. 오늘 항은 별도의 넉넉한 상한을 쓴다.
    const r = schedule(
      baseState([weeklyItem('수학', 6, mkChapters([['1', 2]]))], { startDate: '2024-01-01', _today: '2026-07-18' }),
    );
    expect(r.days.some((d) => d.ds === '2026-07-18')).toBe(true);
    expect(r.days[r.days.length - 1]!.ds >= '2026-07-18').toBe(true);
  });

  it('T33 subjectMastery: 빈 질의는 전과목 매칭 대신 null(indexOf 오염 방지)', () => {
    // b=''이면 a.indexOf('')===0이 모든 과목에 히트 → 첫 과목 숙달도를 아무 이름에나 붙이는 오염(L-9).
    const know = { subjects: [{ subject: '물리', mastery: 0.8 }] };
    const state = baseState([], { _knowState: know });
    expect(subjectMastery(state, '')).toBeNull();
    expect(subjectMastery(state, '   ')).toBeNull(); // 공백만도 정규화하면 빈 질의
  });

  it('T34 dayStudyMin: 비수치 오버라이드는 NaN 대신 요일 기본값으로 폴백', () => {
    // +('abc')=NaN이 그날 studyMin을 오염시켜 하루 전체 배분을 망가뜨리던 버그(L-10).
    const r = schedule(
      baseState([weeklyItem('수학', 6, mkChapters([['1', 10]]))], { dayOverrides: { '2026-06-25': 'abc' } }),
    );
    const d = r.days.find((x) => x.ds === '2026-06-25')!;
    expect(Number.isNaN(d.studyMin)).toBe(false);
    expect(d.studyMin).toBe(1440); // 빈 routine → 요일 기본값(1440)으로 폴백
  });

  it('T35 부분주 앵커(SD-4): 화요일 시작이면 첫 주 목표를 가용 6/7일 비중으로 축소', () => {
    // ML=120 → weeklyHours 8 = 주당 4모듈. 넉넉한 용량(빈 routine)이라 주간 목표=실배치.
    // 화요일 시작(2026-06-23)은 첫 주가 화~일 6일 → 4*6/7≈3.43 → 첫 주 3모듈(앵커).
    // 같은 날 같은 과목 모듈은 한 행으로 병합(min += ML)되므로 모듈 수 = min/ML로 센다.
    const wk0Modules = (r: ScheduleResult, name: string, cut: number) =>
      r.days
        .slice(0, cut + 1)
        .flatMap((d) => d.items)
        .filter((it) => it.type === 'new' && it.name === name)
        .reduce((n, it) => n + Math.round(it.min / 120), 0);
    const tue = schedule(baseState([weeklyItem('물리', 8, mkChapters([['C', 40]]))], { startDate: '2026-06-23' }));
    expect(wk0Modules(tue, '물리', 5)).toBe(3); // di 0..5 = 화~일(부분주) → 4*6/7 앵커 → 3
    // 대조군: 월요일 시작(2026-06-22)은 온전한 첫 주(월~일 7일) → wkFrac=1 → 4모듈 그대로.
    const mon = schedule(baseState([weeklyItem('물리', 8, mkChapters([['C', 40]]))], { startDate: '2026-06-22' }));
    expect(wk0Modules(mon, '물리', 6)).toBe(4); // di 0..6 = 월~일 → 4
  });
});

describe('sessionTimeMap — sid|type → 첫 세션 시각(첫-세션-우선)', () => {
  it('같은 키의 첫 세션 시각만 취하고 이후 세션은 무시', () => {
    const ss = [
      { sid: 'A', type: 'new', start: 540, end: 600 },
      { sid: 'A', type: 'new', start: 700, end: 760 }, // 같은 키 → 무시
      { sid: 'B', type: 'rev', start: null, end: null }, // 미배치도 키는 등록
    ] as unknown as Parameters<typeof sessionTimeMap>[0];
    const m = sessionTimeMap(ss);
    expect(m['A|new']).toEqual({ start: 540, end: 600 });
    expect(m['B|rev']).toEqual({ start: null, end: null });
    expect(Object.keys(m).sort()).toEqual(['A|new', 'B|rev']);
  });

  it('빈 세션은 빈 맵', () => {
    expect(sessionTimeMap([])).toEqual({});
  });
});

/* ── ②#23(감사 2026-07-16) — 복습 사다리 적응: 완료일 앵커·백지 성과 반영 ── */
describe('복습 사다리 적응(②#23)', () => {
  /** 단일 세션(챕터 2h = 모듈 1개) 과목 헬퍼 — 복습 오프셋을 결정적으로 관찰. */
  function oneSession(over?: Record<string, unknown>) {
    const it = weeklyItem('적응과목', 6, mkChapters([['ch', 2]]));
    const r = schedule(baseState([it], over));
    const news = newItems(r);
    const revDis = r.days
      .flatMap((d, di) => d.items.filter((x) => x.type === 'rev' && x.sid === it.id).map(() => di))
      .sort((a, b) => a - b);
    return { it, r, news, revDis };
  }

  it('기본(기록 없음): 계획일 앵커 + 1·3·7·16 사다리(무회귀)', () => {
    const { news, revDis } = oneSession();
    expect(news.length).toBe(1);
    const di0 = news[0]!.di;
    expect(revDis).toEqual([di0 + 1, di0 + 3, di0 + 7, di0 + 16]);
  });

  it('완료일 앵커: doneDs가 계획일보다 늦으면 사다리가 실제 완료일에서 시작한다', () => {
    const base = oneSession();
    const di0 = base.news[0]!.di;
    const ds0 = base.news[0]!.ds;
    // 같은 계획을 5일 늦게 완료했다고 기록(doneDs) — 재스케줄 시 복습이 완료일 기준으로 밀려야 한다.
    const doneDs = base.r.days[di0 + 5]!.ds;
    const it = base.it;
    const r2 = schedule(
      baseState([it], { completions: { [ds0]: { [it.id + '|new']: { done: true, min: 120, doneDs } } } }),
    );
    const revDis2 = r2.days
      .flatMap((d, di) => d.items.filter((x) => x.type === 'rev' && x.sid === it.id).map(() => di))
      .sort((a, b) => a - b);
    expect(revDis2).toEqual([di0 + 5 + 1, di0 + 5 + 3, di0 + 5 + 7, di0 + 5 + 16]);
  });

  it('백지 실패 과목: 단축 사다리 1·2·4·8·16', () => {
    const it = weeklyItem('약한과목', 6, mkChapters([['ch', 2]]));
    const blank = { id: 'b1', ds: '2026-06-20', sid: it.id, name: '약한과목', passed: false, note: '' };
    const r = schedule(baseState([it], { blankResults: [blank] }));
    const di0 = r.days.findIndex((d) => d.items.some((x) => x.type === 'new' && x.sid === it.id));
    const revDis = r.days
      .flatMap((d, di) => d.items.filter((x) => x.type === 'rev' && x.sid === it.id).map(() => di))
      .sort((a, b) => a - b);
    expect(revDis).toEqual([di0 + 1, di0 + 2, di0 + 4, di0 + 8, di0 + 16]);
  });

  it('백지 통과 과목: 기본 사다리 + 34일 꼬리 1회', () => {
    const it = weeklyItem('강한과목', 6, mkChapters([['ch', 2]]));
    const blank = { id: 'b2', ds: '2026-06-20', sid: it.id, name: '강한과목', passed: true, note: '' };
    const r = schedule(baseState([it], { blankResults: [blank] }));
    const di0 = r.days.findIndex((d) => d.items.some((x) => x.type === 'new' && x.sid === it.id));
    const revDis = r.days
      .flatMap((d, di) => d.items.filter((x) => x.type === 'rev' && x.sid === it.id).map(() => di))
      .sort((a, b) => a - b);
    expect(revDis).toEqual([di0 + 1, di0 + 3, di0 + 7, di0 + 16, di0 + 34]);
  });

  it('최신 백지 결과가 이긴다(실패→통과 갱신 시 꼬리 사다리)', () => {
    const it = weeklyItem('갱신과목', 6, mkChapters([['ch', 2]]));
    const blanks = [
      { id: 'b3', ds: '2026-06-18', sid: it.id, name: '갱신과목', passed: false, note: '' },
      { id: 'b4', ds: '2026-06-21', sid: it.id, name: '갱신과목', passed: true, note: '' },
    ];
    const r = schedule(baseState([it], { blankResults: blanks }));
    const di0 = r.days.findIndex((d) => d.items.some((x) => x.type === 'new' && x.sid === it.id));
    const revDis = r.days
      .flatMap((d, di) => d.items.filter((x) => x.type === 'rev' && x.sid === it.id).map(() => di))
      .sort((a, b) => a - b);
    expect(revDis).toEqual([di0 + 1, di0 + 3, di0 + 7, di0 + 16, di0 + 34]);
  });
});
