/* ============================================================
   scheduleView.test.ts — Schedule 탭 하루치 뷰모델(순수) 회귀(Vitest).
   computeDay는 컴포넌트에서 분리된 순수 매핑 — state·byDs(ds→Day 인덱스)·capWd를 주입해
   배치/미배치 행, 블록/학습 세그먼트, 빈 입력을 검증한다(전역·DOM 없음).
   byDs는 실제로 indexDays(ScheduleResult)로 만들지만, 배치/미배치 경계를 결정적으로 만들기 위해
   여기선 최소 Day를 직접 빚어 주입한다(엔진 결합 없이 뷰 로직만 겨눔).
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  computeDay,
  deadlineDdays,
  indexDays,
  sortSubjectsByUrgency,
  subjectUrgency,
  timeSpan,
  SESSION_TYPE_META,
  type DayIndex,
  type Row,
} from '@/lib/scheduleView';
import { studyMinByWeekday } from '@/lib/scheduler';
import { parseISO } from '@/lib/utils';
import type { AppState, Day, ItemStat, ScheduleItem, ScheduleResult, SessionType } from '@/lib/types';

const DS = '2026-06-23'; // 기준일. curMon=이 날, k=0 → date=DS.
const MON = parseISO(DS);

/** 최소 유효 상태 — routine 비면 하루 종일(1440분) 공부 가능(배치 계산 결정적). */
function baseState(over?: Record<string, unknown>): AppState {
  return {
    startDate: DS,
    moduleLen: 120,
    reviewRatio: 20,
    routine: [],
    dayOverrides: {},
    completions: {},
    items: [],
    ...(over || {}),
  } as unknown as AppState;
}

function item(
  sid: string,
  name: string,
  min: number,
  type: SessionType = 'new',
  extra?: Partial<ScheduleItem>,
): ScheduleItem {
  return { type, sid, name, min, ...(extra || {}) };
}

/** ds 하나짜리 byDs를 최소 Day로 빚는다(computeDay는 items·used만 읽는다). */
function byDsOf(items: ScheduleItem[], used: number): DayIndex {
  const day = { ds: DS, date: MON, wd: MON.getDay(), studyMin: 0, used, modLeft: 0, revLeft: 0, items } as Day;
  return { [DS]: day } as unknown as DayIndex;
}

const kinds = (rows: Row[]) => rows.map((r) => r.kind);
const studies = (rows: Row[]) => rows.filter((r): r is Extract<Row, { kind: 'study' }> => r.kind === 'study');

describe('scheduleView/SESSION_TYPE_META — 세션 타입 표시 메타(정본)', () => {
  it('다섯 세션 타입 모두 cls·label을 갖는다', () => {
    (['new', 'rev', 'blank', 'mock', 'anki'] as SessionType[]).forEach((t) => {
      expect(SESSION_TYPE_META[t]).toBeTruthy();
      expect(typeof SESSION_TYPE_META[t].cls).toBe('string');
      expect(typeof SESSION_TYPE_META[t].label).toBe('string');
    });
    expect(SESSION_TYPE_META.new.label).toBe('학습');
    expect(SESSION_TYPE_META.anki.label).toBe('Anki');
  });
});

describe('scheduleView/indexDays — ds→Day 인덱스', () => {
  it('days를 ds 키로 색인한다', () => {
    const res = { days: [{ ds: 'a' }, { ds: 'b' }] } as unknown as ScheduleResult;
    const idx = indexDays(res);
    expect(Object.keys(idx).sort()).toEqual(['a', 'b']);
    expect(idx['b']!.ds).toBe('b');
  });
  it('days 부재도 빈 인덱스로 견딘다', () => {
    expect(indexDays({} as unknown as ScheduleResult)).toEqual({});
  });
});

describe('scheduleView/computeDay — 배치·미배치·세그먼트·빈입력', () => {
  it('배치 vs 미배치: 다 채운 항목은 start≠null, 자리 못 잡은 항목은 start===null 행으로 남는다', () => {
    // A(1440분)가 하루를 다 채워 배치되고, B(60분)는 남은 자리 0 → 미배치.
    const state = baseState();
    const capWd = studyMinByWeekday(state); // 빈 routine → 전부 1440
    const byDs = byDsOf([item('A', '수학', 1440), item('B', '물리', 60)], 1500);
    const d = computeDay(state, byDs, capWd, 600, '2099-01-01', MON, 0);

    const st = studies(d.rows);
    const placed = st.filter((r) => r.start !== null);
    const unplaced = st.filter((r) => r.start === null);
    expect(placed.map((r) => r.it.sid)).toContain('A'); // A는 시각 배정
    expect(unplaced.map((r) => r.it.sid)).toEqual(['B']); // B는 미배치(start=null)
    expect(unplaced[0]!.end).toBeNull();

    expect(d.counts.studies).toBe(2); // 두 항목 모두 new
    expect(d.planMin).toBe(1500); // 계획 총합
    expect(d.over).toBe(true); // used(1500) > studyMin(1440)+1
    expect(d.ratio).toBe(100); // used/studyMin 캡 100
  });

  it('완료 표시된 항목의 계획분이 doneMinTot에 집계된다', () => {
    const state = baseState({ completions: { [DS]: { 'A|new': { done: true, min: 1440 } } } });
    const capWd = studyMinByWeekday(state);
    const byDs = byDsOf([item('A', '수학', 1440), item('B', '물리', 60)], 1500);
    const d = computeDay(state, byDs, capWd, 600, '2099-01-01', MON, 0);
    expect(d.doneMinTot).toBe(1440); // A만 완료 → A의 계획분
  });

  it('블록/학습 세그먼트 + isToday면 now 행이 붙는다', () => {
    // 식사 블록(비수면) 하나 → block 행. 오늘이면 now 행. 소량 학습은 그 사이 배치.
    const state = baseState({
      routine: [{ id: 'b1', name: '점심', type: '식사', start: '12:00', end: '13:00', days: [0, 1, 2, 3, 4, 5, 6] }],
    });
    const capWd = studyMinByWeekday(state);
    const byDs = byDsOf([item('A', '수학', 90)], 90);
    const d = computeDay(state, byDs, capWd, 600, DS, MON, 0); // todayIso===DS → isToday

    expect(d.isToday).toBe(true);
    expect(kinds(d.rows)).toContain('now');
    const block = d.rows.find((r) => r.kind === 'block') as Extract<Row, { kind: 'block' }> | undefined;
    expect(block).toBeTruthy();
    expect(block!.name).toBe('점심');
    expect(block!.btype).toBe('식사');
    expect(studies(d.rows).some((r) => r.it.sid === 'A' && r.start !== null)).toBe(true);
    // 행은 시각 오름차순(now·free 포함)
    const starts = d.rows.map((r) => r.start ?? 0);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('빈 입력: 그 ds에 Day가 없으면 학습/블록 없이 free(+오늘이면 now)만', () => {
    const state = baseState();
    const capWd = studyMinByWeekday(state);
    const d = computeDay(state, {} as DayIndex, capWd, 600, '2099-01-01', MON, 0);
    expect(studies(d.rows).length).toBe(0);
    expect(d.rows.some((r) => r.kind === 'block')).toBe(false);
    expect(d.planMin).toBe(0);
    expect(d.doneMinTot).toBe(0);
    expect(d.over).toBe(false);
    expect(d.counts).toEqual({ studies: 0, revs: 0, ankis: 0, blanks: 0, mocks: 0 });
    expect(d.rows.every((r) => r.kind === 'free')).toBe(true); // isToday=false → now 없음
  });

  it('counts가 세션 타입별로 분리 집계된다', () => {
    const state = baseState();
    const capWd = studyMinByWeekday(state);
    const byDs = byDsOf(
      [
        item('A', '수학', 30, 'new'),
        item('B', '물리', 20, 'rev'),
        item('C', '영어', 10, 'anki'),
        item('D', '화학', 15, 'blank'),
        item('E', '생물', 40, 'mock'),
      ],
      115,
    );
    const d = computeDay(state, byDs, capWd, 600, '2099-01-01', MON, 0);
    expect(d.counts).toEqual({ studies: 1, revs: 1, ankis: 1, blanks: 1, mocks: 1 });
  });
});

describe('scheduleView/deadlineDdays — Today·Schedule 공유 마감 D-day', () => {
  const stat = (over: Partial<ItemStat>): ItemStat =>
    ({ id: over.name || 'x', name: 'X', schedH: 0, ...over }) as ItemStat;

  it('가까운 순 정렬 + dday 계산(오늘 기준)', () => {
    const rows = deadlineDdays(
      [
        stat({ name: '먼과목', deadline: '2026-06-30' }), // D-7
        stat({ name: '가까운과목', deadline: '2026-06-25' }), // D-2
      ],
      DS, // 2026-06-23
    );
    expect(rows.map((r) => r.name)).toEqual(['가까운과목', '먼과목']);
    expect(rows[0]!.dday).toBe(2);
    expect(rows[1]!.dday).toBe(7);
  });

  it('완료(finished)·마감 지남(dday<0)·마감 없는 과목은 제외', () => {
    const rows = deadlineDdays(
      [
        stat({ name: '완료', deadline: '2026-06-25', finished: true }),
        stat({ name: '지남', deadline: '2026-06-20' }), // dday<0
        stat({ name: '마감없음' }),
        stat({ name: '유효', deadline: '2026-06-28' }),
      ],
      DS,
    );
    expect(rows.map((r) => r.name)).toEqual(['유효']);
    expect(rows[0]!.dday).toBe(5);
  });

  it('itemStat 부재도 빈 배열로 견딘다', () => {
    expect(deadlineDdays(undefined, DS)).toEqual([]);
    expect(deadlineDdays([], DS)).toEqual([]);
  });
});

describe('scheduleView/sortSubjectsByUrgency — 통계 과목 표시 순서(UX-2)', () => {
  const stat = (over: Partial<ItemStat>): ItemStat =>
    ({ id: over.name || 'x', name: 'X', schedH: 0, ...over }) as ItemStat;

  it('위험군을 위로 — 마감초과 > 시간부족 > 마감임박 > 평온', () => {
    const rows = sortSubjectsByUrgency(
      [
        stat({ name: '평온', deadline: '2026-08-30', finished: true }),
        stat({ name: '임박', deadline: '2026-06-27', finished: true }), // D-4
        stat({ name: '시간부족', deadline: '2026-08-01' }), // finished 아님
        stat({ name: '마감초과', deadline: '2026-08-01', finished: true, late: 3 }),
      ],
      DS, // 2026-06-23
    );
    expect(rows.map((r) => r.name)).toEqual(['마감초과', '시간부족', '임박', '평온']);
  });

  it('같은 등급 안에서는 **입력 순서를 지킨다**(위치 기억 보존 — 이 정렬의 존재 이유)', () => {
    const rows = sortSubjectsByUrgency([stat({ name: 'A' }), stat({ name: 'B' }), stat({ name: 'C' })], DS);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('원본 배열을 변형하지 않는다(표시용 정렬 — 데이터는 그대로)', () => {
    const src = [stat({ name: 'A' }), stat({ name: '급함', deadline: '2026-08-01' })];
    sortSubjectsByUrgency(src, DS);
    expect(src.map((r) => r.name)).toEqual(['A', '급함']);
  });

  it("'반복'(daily) 과목은 마감 축이 없어 등급 0 — 급하지 않은 게 아니라 잴 수 없다", () => {
    expect(subjectUrgency(stat({ name: 'Anki', daily: true, late: 5 }), DS)).toBe(0);
    expect(subjectUrgency(stat({ name: '마감없음' }), DS)).toBe(0);
  });

  it('마감이 지난 지 오래여도 late 가 0 이고 끝났으면 평온이다(경고를 만들어내지 않는다)', () => {
    expect(subjectUrgency(stat({ name: '옛날', deadline: '2026-01-01', finished: true }), DS)).toBe(0);
  });
});

/* ============================================================
   timeSpan — 주간 캘린더 spanOf()와 일 편집기 인라인 lo/hi가 동형 복제였던 것을 lib로 이주하며
   잠근다(뷰 안에 있어 단위테스트가 못 닿던 순수 함수 · 평가웨이브 2026-07).
   두 호출처의 인자 차이(스냅 60/30, 최소폭 9h/8h, 폴백, 클램프 창)를 옵션으로 흡수했으므로
   여기선 **각 호출처의 실제 인자로** 기존 산출과 같은지까지 확인한다.
============================================================ */
describe('timeSpan — 타임라인 표시 범위', () => {
  // WeekCalendar 호출 형태: snap 60 · minSpan 9h · fallback 08–20 · 클램프 0~1440(기본).
  const week = (mins: number[]) => timeSpan(mins, { snap: 60, minSpan: 9 * 60, fallback: { lo: 8 * 60, hi: 20 * 60 } });

  it('빈 배열 → 폴백 창(주간=08–20)', () => {
    expect(week([])).toEqual({ lo: 8 * 60, hi: 20 * 60 });
  });

  it('±1시간 여유 + 정시 스냅', () => {
    expect(week([9 * 60 + 30, 20 * 60])).toEqual({ lo: 8 * 60, hi: 21 * 60 }); // 8:30→8시, 21:00→21시
  });

  it('단일 값도 최소폭(9h)까지 벌린다', () => {
    const { lo, hi } = week([12 * 60]);
    expect(hi - lo).toBe(9 * 60);
    expect(lo).toBe(11 * 60); // 11시에서 시작해 아래로 벌림
  });

  it('0/1440 경계에서 최소폭을 반대쪽으로 흡수', () => {
    expect(week([5])).toEqual({ lo: 0, hi: 9 * 60 }); // 자정 직후 → lo가 0에 걸려 hi로 확장
    expect(week([1439])).toEqual({ lo: 1440 - 9 * 60, hi: 1440 }); // 자정 직전 → hi가 1440에 걸려 lo로 확장
  });

  it('일 편집기 형태(snap 30 · minSpan 8h · wake 창 클램프)', () => {
    const wake0 = 7 * 60;
    const wake1 = 23 * 60;
    const day = (mins: number[]) =>
      timeSpan(mins, {
        snap: 30,
        minSpan: 8 * 60,
        min: wake0,
        max: wake1,
        fallback: { lo: wake0, hi: wake0 + 8 * 60 },
      });
    expect(day([])).toEqual({ lo: wake0, hi: wake0 + 8 * 60 }); // 일정 없음 → 기상~+8h
    expect(day([9 * 60 + 40, 10 * 60 + 10])).toEqual({ lo: 8 * 60 + 30, hi: 16 * 60 + 30 }); // 8:40→8:30, 11:10→11:30 후 8h로 확장
    expect(day([22 * 60])).toEqual({ lo: 15 * 60, hi: 23 * 60 }); // 상한(wake1)에 걸려 lo로 흡수
  });

  it('클램프 창이 뒤집혀 hi<=lo가 되면 폴백으로 되돌린다(일 편집기의 마지막 방어선)', () => {
    // 밤샘 일과로 wake0(22시) > wake1(6시)이면 클램프 창이 역전된다 — 예전 인라인 코드의 `if (hi<=lo)` 가드와 동형.
    const r = timeSpan([12 * 60], {
      snap: 30,
      minSpan: 8 * 60,
      min: 22 * 60,
      max: 6 * 60,
      fallback: { lo: 600, hi: 1080 },
    });
    expect(r).toEqual({ lo: 600, hi: 1080 });
    expect(r.hi).toBeGreaterThan(r.lo);
  });
});
