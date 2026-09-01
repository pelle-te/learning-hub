/* ============================================================
   events.test.ts — 일정(Wave 5) CRUD·가용시간 차감 회귀 고정.
   일정은 tasks와 달리 **스케줄러 입력**이다(그 시간만큼 공부 가용을 깎고 자동초안이 그 자리를 피한다)
   → 여기서 잠그는 건 CRUD 경계뿐 아니라 (a)총량 차감 (b)구간 회피 (c)이중 차감 금지 (d)마이그레이션 안전.
   각 it는 수정 전 코드에서 실패하도록 썼다(회귀 가치 검증 — 보고서 참조).
============================================================ */
import { describe, expect, it } from 'vitest';
import { addEvent, updateEvent, removeEvent, eventsForDay, eventIntervals, eventMinutesForDay } from '@/lib/events';
import { boot, defaults, persist, sanitizeImported } from '@/lib/persistence';
import { dayStudyMin, freeWindowsForDay, freeWindowsForWeekday, layoutDay, studyMinByWeekday } from '@/lib/scheduler';
import { SCHEDULE_INPUT_KEYS } from '@/store/selectors';
import { selectSchedule } from '@/store/selectors';
import { parseISO, rid } from '@/lib/utils';
import { memKV } from '@/lib/kv';
import type { Day, RoutineBlock } from '@/lib/types';
import type { AppState } from '@/lib/schema';

const DS = '2026-06-23';
const WD = parseISO(DS).getDay();

const blk = (name: string, type: string, s: string, e: string, days: number[]): RoutineBlock => ({
  id: rid(),
  name,
  type,
  start: s,
  end: e,
  days,
});

/** 최소 시드 — 수면 00:00–07:00만 있는 하루(깨어있는 창 07:00–24:00 = 1020분).
 *  defaults()의 식사·수업을 쓰지 않는 이유: 차감 산술을 눈으로 검산 가능하게 유지하기 위해. */
const seed = (routine: RoutineBlock[] = [blk('수면', '수면', '00:00', '07:00', [0, 1, 2, 3, 4, 5, 6])]): AppState =>
  ({ ...defaults(), _today: DS, startDate: DS, routine, dayOverrides: {} }) as AppState;

describe('events — CRUD·경계(Wave 5)', () => {
  it('addEvent: id·at 부여 + events 지연 초기화(무마이그레이션)', () => {
    const s = seed();
    expect(s.events).toBeUndefined(); // 옵셔널 — 첫 쓰기 전엔 없음
    const e = addEvent(s, { ds: DS, title: '치과 예약', start: 900, min: 120 });
    expect(e.id).toBeTruthy();
    expect(typeof e.at).toBe('number');
    expect(s.events).toHaveLength(1);
    expect(s.events![0]!.title).toBe('치과 예약');
  });

  it('updateEvent/removeEvent', () => {
    const s = seed();
    const e = addEvent(s, { ds: DS, title: 'A', start: 600, min: 60 });
    updateEvent(s, e.id, { title: 'A2', note: '메모' });
    expect(s.events![0]!.title).toBe('A2');
    expect(s.events![0]!.note).toBe('메모');
    updateEvent(s, 'no-such-id', { title: 'X' }); // 미존재 → 무동작
    expect(s.events![0]!.title).toBe('A2');
    removeEvent(s, e.id);
    expect(s.events).toHaveLength(0);
  });

  it('경계: min<=0은 1분으로, start+min>1440은 그날 끝으로 클램프', () => {
    const s = seed();
    const zero = addEvent(s, { ds: DS, title: '0분', start: 600, min: 0 });
    expect(zero.min).toBe(1); // 폭0 유령 일정 방지
    const neg = addEvent(s, { ds: DS, title: '음수', start: 600, min: -30 });
    expect(neg.min).toBe(1);
    const over = addEvent(s, { ds: DS, title: '넘침', start: 1380, min: 600 });
    expect(over.start + over.min).toBe(1440); // 자정 넘김을 만들지 않는다
    const late = addEvent(s, { ds: DS, title: '늦음', start: 5000, min: 60 });
    expect(late.start).toBe(1439); // start는 0~1439
    expect(late.start + late.min).toBe(1440);
  });

  it('경계: updateEvent가 min만 바꿔도 재클램프(한쪽만 검사하는 구멍 방지)', () => {
    const s = seed();
    const e = addEvent(s, { ds: DS, title: 'B', start: 1300, min: 60 });
    updateEvent(s, e.id, { min: 600 });
    expect(s.events![0]!.start + s.events![0]!.min).toBe(1440);
  });

  it('선택자: eventsForDay는 그날만·시작순 / 다른 ds·잘못된 ds는 빈 배열', () => {
    const s = seed();
    addEvent(s, { ds: DS, title: '늦은 것', start: 900, min: 60 });
    addEvent(s, { ds: DS, title: '이른 것', start: 540, min: 60 });
    addEvent(s, { ds: '2026-06-24', title: '내일', start: 540, min: 60 });
    expect(eventsForDay(s, DS).map((e) => e.title)).toEqual(['이른 것', '늦은 것']);
    expect(eventsForDay(s, 'not-a-date')).toEqual([]);
    expect(eventIntervals(s, DS)).toEqual([
      [540, 600],
      [900, 960],
    ]);
  });

  it('eventMinutesForDay: 겹치는 두 일정은 합집합으로 1회만 센다', () => {
    const s = seed();
    addEvent(s, { ds: DS, title: '겹1', start: 600, min: 120 }); // 10:00–12:00
    addEvent(s, { ds: DS, title: '겹2', start: 660, min: 120 }); // 11:00–13:00
    expect(eventMinutesForDay(s, DS)).toBe(180); // 10:00–13:00
  });

  it('events가 배열이 아니어도(손상 데이터) 크래시 대신 안전 동작', () => {
    const s = seed();
    (s as unknown as Record<string, unknown>).events = 'garbage';
    expect(eventsForDay(s, DS)).toEqual([]);
    expect(() => addEvent(s, { ds: DS, title: '복구', start: 600, min: 60 })).not.toThrow();
    expect(s.events).toHaveLength(1);
  });
});

describe('events — 가용시간 차감(Wave 5 핵심)', () => {
  it('일정이 그날 가용시간을 깎는다(dayStudyMin)', () => {
    const s = seed();
    const capWd = studyMinByWeekday(s);
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(1020); // 07:00–24:00
    addEvent(s, { ds: DS, title: '약속', start: 900, min: 120 }); // 15:00–17:00
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(900);
  });

  it('freeWindowsForDay: 일정 구간이 창에서 빠진다 / 일정 없으면 요일 창과 동일', () => {
    const s = seed();
    const wk = freeWindowsForWeekday(s, WD);
    expect(freeWindowsForDay(s, DS, WD)).toEqual(wk); // 무일정 = 종전 거동 100% 불변(추가 계산 0)
    addEvent(s, { ds: DS, title: '약속', start: 900, min: 120 });
    const day = freeWindowsForDay(s, DS, WD);
    expect(day.windows).toEqual([
      { s: 420, e: 900 },
      { s: 1020, e: 1440 },
    ]);
    expect(day.freeMin).toBe(900);
    expect(freeWindowsForWeekday(s, WD).freeMin).toBe(1020); // 요일 함수 거동은 불변(회귀 고정)
  });

  it('이중 차감 금지 ①: 수업과 완전히 겹치는 일정은 추가로 깎지 않는다', () => {
    const s = seed([
      blk('수면', '수면', '00:00', '07:00', [0, 1, 2, 3, 4, 5, 6]),
      blk('수업', '수업', '09:00', '12:00', [WD]),
    ]);
    const capWd = studyMinByWeekday(s);
    expect(capWd[WD]).toBe(840); // 1020 − 180
    addEvent(s, { ds: DS, title: '수업 중 상담', start: 600, min: 60 }); // 10:00–11:00 (수업 안)
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(840); // 이미 공부시간이 아니었음 → 차감 0
  });

  it('이중 차감 금지 ②: 부분 겹침은 창 밖으로 삐져나온 만큼만 깎는다', () => {
    const s = seed([
      blk('수면', '수면', '00:00', '07:00', [0, 1, 2, 3, 4, 5, 6]),
      blk('수업', '수업', '09:00', '12:00', [WD]),
    ]);
    const capWd = studyMinByWeekday(s);
    addEvent(s, { ds: DS, title: '수업 끝나고', start: 660, min: 120 }); // 11:00–13:00 → 12:00 이후 60분만 유효
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(780); // 840 − 60
  });

  it('이중 차감 금지 ③: 깨어있는 창 밖(수면 중) 일정은 차감 0', () => {
    const s = seed();
    const capWd = studyMinByWeekday(s);
    addEvent(s, { ds: DS, title: '새벽 알람', start: 180, min: 60 }); // 03:00–04:00 (수면)
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(1020);
  });

  it('이중 차감 금지 ④: 겹치는 두 일정은 합집합만큼만 1회 차감', () => {
    const s = seed();
    const capWd = studyMinByWeekday(s);
    addEvent(s, { ds: DS, title: '겹1', start: 600, min: 120 });
    addEvent(s, { ds: DS, title: '겹2', start: 660, min: 120 });
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(1020 - 180);
  });

  it('dayOverrides가 있어도 일정은 그 위에서 깎인다(설계 판단) · 음수 방지', () => {
    const s = seed();
    s.dayOverrides = { [DS]: 4 }; // "이 날은 4시간 공부"
    const capWd = studyMinByWeekday(s);
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(240);
    addEvent(s, { ds: DS, title: '약속', start: 900, min: 120 });
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(120); // 240 − 120
    addEvent(s, { ds: DS, title: '종일 행사', start: 420, min: 1000 });
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(0); // 0 아래로 내려가지 않는다
  });

  it('비수치 오버라이드 폴백 경로에서도 일정이 깎인다(L-10 회귀 유지)', () => {
    const s = seed();
    s.dayOverrides = { [DS]: '보통' }; // 비수치 → 요일 기본값 폴백
    const capWd = studyMinByWeekday(s);
    addEvent(s, { ds: DS, title: '약속', start: 900, min: 120 });
    expect(dayStudyMin(s, DS, WD, capWd)).toBe(900);
  });
});

describe('events — 자동초안이 일정 자리를 피한다(layoutDay)', () => {
  const dayOf = (s: AppState, items: Day['items']): Day => ({
    ds: DS,
    date: parseISO(DS),
    wd: WD,
    studyMin: dayStudyMin(s, DS, WD, studyMinByWeekday(s)),
    used: items.reduce((t, it) => t + it.min, 0),
    modLeft: 0,
    revLeft: 0,
    items,
  });

  it('자동 배치 블록이 일정 구간에 놓이지 않는다', () => {
    const s = seed();
    addEvent(s, { ds: DS, title: '약속', start: 420, min: 120 }); // 07:00–09:00 = 창 맨 앞
    const L = layoutDay(s, dayOf(s, [{ type: 'new', sid: 's1', name: '수학', min: 60 }]));
    const se = L.sessions[0]!;
    expect(se.start).toBe(540); // 일정 뒤(09:00)로 밀림 — 수정 전엔 420에 놓였다
    expect(se.end).toBe(600);
  });

  it('빈 시간(free)에 일정 구간이 포함되지 않는다', () => {
    const s = seed();
    addEvent(s, { ds: DS, title: '약속', start: 600, min: 120 }); // 10:00–12:00
    const L = layoutDay(s, dayOf(s, []));
    expect(L.free.some(([a, b]) => a < 720 && b > 600)).toBe(false);
    expect(L.freeMin).toBe(900); // 1020 − 120
  });

  it('일정이 없으면 배치·빈시간이 종전과 100% 동일(자동 불변식)', () => {
    const s = seed();
    const items = [{ type: 'new' as const, sid: 's1', name: '수학', min: 60 }];
    const L = layoutDay(s, dayOf(s, items));
    expect(L.sessions[0]!.start).toBe(420);
    expect(L.freeMin).toBe(1020 - 60);
  });

  it('schedule(): 일정이 있는 날은 총 편성량이 줄어든다', () => {
    const s = seed();
    s.items = [
      {
        id: 's1',
        name: '수학',
        mode: 'weekly',
        weeklyHours: 40,
        chapters: [],
      },
    ] as unknown as AppState['items'];
    const before = selectSchedule(s).days.find((d) => d.ds === DS)!.studyMin;
    const s2 = { ...s, events: [] } as AppState;
    addEvent(s2, { ds: DS, title: '약속', start: 900, min: 120 });
    const after = selectSchedule(s2).days.find((d) => d.ds === DS)!.studyMin;
    expect(after).toBe(before - 120);
  });
});

describe('events — persist 계약·마이그레이션 안전', () => {
  it('일정이 없는 기존 저장본이 그대로 열린다(최우선 안전 요구)', () => {
    const kv = memKV();
    // events 필드가 아예 없는 구버전 저장본.
    const old = { ...defaults(), items: [], tasks: [{ id: 't1', title: '옛 할일' }] } as unknown as AppState;
    delete (old as unknown as Record<string, unknown>).events;
    kv.setItem('study_planner_v3', JSON.stringify(old));
    const s = boot(kv);
    expect(s).toBeTruthy();
    expect(s.events).toBeUndefined(); // 백필 없음 = 바이트 무손상(무마이그레이션 관례)
    expect(s.tasks).toHaveLength(1); // 기존 데이터 무손상
    // 필드 부재에도 모든 소비 경로가 빈 배열처럼 동작해야 한다.
    expect(eventsForDay(s, DS)).toEqual([]);
    expect(eventIntervals(s, DS)).toEqual([]);
    expect(() => dayStudyMin(s, DS, WD, studyMinByWeekday(s))).not.toThrow();
    expect(dayStudyMin(s, DS, WD, studyMinByWeekday(s))).toBe(studyMinByWeekday(s)[WD]);
  });

  it('일정을 저장→재부팅하면 그대로 복원된다(persist 왕복)', () => {
    const kv = memKV();
    const s = seed();
    addEvent(s, { ds: DS, title: '왕복', start: 900, min: 120 });
    persist(kv, s);
    const back = boot(kv);
    expect(back.events).toHaveLength(1);
    expect(back.events![0]!.title).toBe('왕복');
    expect(dayStudyMin(back, DS, WD, studyMinByWeekday(back))).toBe(900);
  });

  it('sanitizeImported: 비수치 start/min 일정은 제거(NaN이 그날 가용을 오염하지 않게)', () => {
    const s = seed();
    (s as unknown as Record<string, unknown>).events = [
      { id: 'a', ds: DS, title: '정상', start: 600, min: 60 },
      { id: 'b', ds: DS, title: '깨짐', start: 'x', min: 60 },
      { id: 'c', ds: DS, title: '깨짐2', start: 600, min: null },
      null,
    ];
    sanitizeImported(s);
    expect(s.events).toHaveLength(1);
    expect(Number.isFinite(dayStudyMin(s, DS, WD, studyMinByWeekday(s)))).toBe(true);
  });

  it('일정 추가 시 스케줄이 재계산된다(selectors 캐시 키 회귀)', () => {
    expect(SCHEDULE_INPUT_KEYS).toContain('events'); // 목록 누락 = 무증상 stale
    const base = seed();
    base.items = [
      { id: 's1', name: '수학', mode: 'weekly', weeklyHours: 40, chapters: [] },
    ] as unknown as AppState['items'];
    const r1 = selectSchedule(base);
    // events만 바뀐 새 state(다른 슬라이스는 참조 동일) — 캐시 키에 events가 없으면 거짓 히트로 r1을 재사용한다.
    const next = { ...base, events: [{ id: 'e1', ds: DS, title: '약속', start: 900, min: 120 }] } as AppState;
    const r2 = selectSchedule(next);
    expect(r2).not.toBe(r1);
    expect(r2.days.find((d) => d.ds === DS)!.studyMin).toBe(r1.days.find((d) => d.ds === DS)!.studyMin - 120);
  });
});
