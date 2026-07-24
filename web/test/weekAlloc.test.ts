/* ============================================================
   weekAlloc.test.ts — 주간 배분(재개편 v2 §12) 회귀.
   ① 엔진: 배분 있는 주는 new 블록이 사용자 요일 벡터대로 배치된다.
   ② 불변식: weekAlloc 부재(또는 그 주에 배분 없음)면 자동 산출 100% 동일(§12-4 회귀 고정).
   ③ lib/weekAlloc: 자동 파생·승격·셀 설정·이전주 복사·리셋·행/열 합.
============================================================ */
import { describe, expect, it } from 'vitest';
import { schedule } from '@/lib/scheduler';
import {
  allocView,
  colSumMin,
  copyPrevWeekAlloc,
  deriveAutoAlloc,
  neglectDaysBySid,
  NEGLECT_DAYS,
  ensureWeekAlloc,
  isUnschedulable,
  isWeekManaged,
  pruneAlloc,
  removeSidFromAlloc,
  resetWeekAlloc,
  rowSumMin,
  setAllocCell,
  weekAllocTotalMin,
  weekBudgetMin,
  weekMonOf,
  weeklyItems,
  zeroVec,
} from '@/lib/weekAlloc';
import type { AppState } from '@/lib/types';

let _id = 0;
const nid = () => 'id' + ++_id;
type ChSpec = [string, number, boolean?];
function mkChapters(spec: ChSpec[]) {
  return spec.map(([name, hours, done]) => ({ id: nid(), name, hours, done: !!done }));
}
function weeklyItem(name: string, weeklyHours: number, chapters?: unknown[], extra?: Record<string, unknown>) {
  return { id: nid(), name, mode: 'weekly', weeklyHours, chapters: chapters || [], ...(extra || {}) };
}
function baseState(items: unknown[], over?: Record<string, unknown>): AppState {
  return {
    startDate: '2026-06-23', // 화요일 → 그 주 월요일 = 2026-06-22
    moduleLen: 120,
    reviewRatio: 20,
    routine: [], // 빈 routine = 하루 종일 가용(결정적)
    dayOverrides: {},
    items: items || [],
    ...(over || {}),
  } as unknown as AppState;
}

const WK0 = '2026-06-22'; // schedule()가 쓰는 첫 주 월요일(firstMon)
const newOn = (r: ReturnType<typeof schedule>, ds: string, sid: string) =>
  (r.days.find((d) => d.ds === ds)?.items || []).filter((it) => it.type === 'new' && it.sid === sid);

describe('주간 배분 — 엔진 배분 주도(§12-4)', () => {
  it('배분 있는 주: new 블록이 사용자 요일 벡터대로 배치(월2·목1 은유)', () => {
    const phys = weeklyItem('물리', 6, mkChapters([['C', 40]]));
    const sid = phys.id;
    // vec index=wd(0=일..6=토): 화(2)=120분, 목(4)=60분.
    const r = schedule(baseState([phys], { weekAlloc: { [WK0]: { [sid]: [0, 0, 120, 0, 60, 0, 0] } } }));

    const tue = newOn(r, '2026-06-23', sid); // wd=2
    const thu = newOn(r, '2026-06-25', sid); // wd=4
    const wed = newOn(r, '2026-06-24', sid); // wd=3(미배분)
    expect(tue.length).toBe(1);
    expect(tue[0]!.min).toBe(120);
    expect(thu.length).toBe(1);
    expect(thu[0]!.min).toBe(60);
    expect(wed.length).toBe(0); // 배분 안 한 요일엔 new 없음
  });

  it('배분 주에도 복습은 배치된 챕터에서 자동 파생(엔진 자산 보존)', () => {
    const phys = weeklyItem('물리', 6, mkChapters([['C', 40]]));
    const sid = phys.id;
    const r = schedule(baseState([phys], { weekAlloc: { [WK0]: { [sid]: [0, 0, 120, 0, 0, 0, 0] } } }));
    const revs = r.days.flatMap((d) => d.items.filter((it) => it.type === 'rev' && it.sid === sid));
    expect(revs.length).toBeGreaterThan(0); // 화요일 학습 → 복습 사다리 씨앗
    revs.forEach((v) => expect((v.chapters || []).includes('C')).toBe(true));
  });

  it('배분에 없는 sid는 그 주 0(다른 과목만 배분해도 미배분 과목은 new 없음)', () => {
    const phys = weeklyItem('물리', 6, mkChapters([['C', 40]]));
    const math = weeklyItem('수학', 6, mkChapters([['M', 40]]));
    const r = schedule(baseState([phys, math], { weekAlloc: { [WK0]: { [phys.id]: [0, 0, 120, 0, 0, 0, 0] } } }));
    // 물리만 배분 — 그 주 수학 new는 하나도 없어야(배분 주는 배분이 전권).
    const mathNewWk0 = r.days
      .filter((d) => weekMonOf(d.ds) === WK0)
      .flatMap((d) => d.items.filter((it) => it.type === 'new' && it.sid === math.id));
    expect(mathNewWk0.length).toBe(0);
  });
});

describe('주간 배분 — 무배분 불변식(§12-4 회귀 고정)', () => {
  // ⚠ 같은 items 인스턴스를 재사용해야 한다 — weeklyItem은 매 호출 새 id(nid)라 두 번 만들면 sid가 달라져 비교 무의미.
  // schedule()은 state.items를 변형하지 않으므로(days만 신설) 한 배열을 두 호출에 공유해도 안전.
  const items = () => [
    weeklyItem(
      '수학',
      6,
      mkChapters([
        ['1', 10],
        ['2', 10],
      ]),
    ),
    weeklyItem('영어', 4, mkChapters([['E', 20]])),
  ];

  it('weekAlloc 부재 vs 빈 객체 → days 산출 완전 동일', () => {
    const its = items();
    const a = schedule(baseState(its));
    const b = schedule(baseState(its, { weekAlloc: {} }));
    expect(JSON.stringify(b.days)).toBe(JSON.stringify(a.days));
  });

  it('다른 주만 배분해도 배분 없는 주는 자동 산출 불변', () => {
    const its = items();
    const a = schedule(baseState(its));
    // 존재하지 않는 먼 미래 주에만 빈 배분 키 — 실제 계획 주들엔 영향 없어야.
    const b = schedule(baseState(its, { weekAlloc: { '2099-01-05': {} } }));
    expect(JSON.stringify(b.days)).toBe(JSON.stringify(a.days));
  });
});

describe('lib/weekAlloc — 순수 CRUD', () => {
  it('weekMonOf: 그 주 월요일 ISO', () => {
    expect(weekMonOf('2026-06-23')).toBe('2026-06-22'); // 화 → 월
    expect(weekMonOf('2026-06-22')).toBe('2026-06-22'); // 월 → 자기
    expect(weekMonOf('2026-06-28')).toBe('2026-06-22'); // 일 → 그 주 월
  });

  it('deriveAutoAlloc: 그 주 new 블록 분을 (sid→7요일[분])으로 집계', () => {
    const phys = weeklyItem('물리', 8, mkChapters([['C', 40]]));
    const r = schedule(baseState([phys]));
    const derived = deriveAutoAlloc(r, WK0);
    const vec = derived[phys.id];
    expect(vec).toBeTruthy();
    // 파생 합 = 그 주 실제 new 분 합.
    const wk0NewMin = r.days
      .filter((d) => weekMonOf(d.ds) === WK0)
      .flatMap((d) => d.items.filter((it) => it.type === 'new' && it.sid === phys.id))
      .reduce((t, it) => t + it.min, 0);
    expect(rowSumMin(vec)).toBe(wk0NewMin);
  });

  it('ensureWeekAlloc: 없으면 자동 파생 스냅샷을 managed로 승격', () => {
    const phys = weeklyItem('물리', 8, mkChapters([['C', 40]]));
    const st = baseState([phys]);
    const r = schedule(st);
    expect(isWeekManaged(st, WK0)).toBe(false);
    const snap = ensureWeekAlloc(st, r, WK0);
    expect(isWeekManaged(st, WK0)).toBe(true);
    expect(JSON.stringify(snap)).toBe(JSON.stringify(deriveAutoAlloc(r, WK0)));
  });

  it('setAllocCell: 승격 후 (sid,wd) 칸을 분으로 설정', () => {
    const phys = weeklyItem('물리', 8, mkChapters([['C', 40]]));
    const st = baseState([phys]);
    const r = schedule(st);
    setAllocCell(st, r, WK0, phys.id, 2, 150); // 화(wd=2)=150분
    expect(st.weekAlloc![WK0]![phys.id]![2]).toBe(150);
    setAllocCell(st, r, WK0, phys.id, 2, -10); // 음수 → 0
    expect(st.weekAlloc![WK0]![phys.id]![2]).toBe(0);
  });

  it('allocView: managed면 명시값, 아니면 자동 파생', () => {
    const phys = weeklyItem('물리', 8, mkChapters([['C', 40]]));
    const st = baseState([phys]);
    const r = schedule(st);
    expect(JSON.stringify(allocView(st, r, WK0))).toBe(JSON.stringify(deriveAutoAlloc(r, WK0))); // 미승격
    setAllocCell(st, r, WK0, phys.id, 1, 90);
    expect(allocView(st, r, WK0)[phys.id]![1]).toBe(90); // 승격 후 명시값
  });

  it('copyPrevWeekAlloc: 이전 주 배분을 이 주로 스냅샷', () => {
    const phys = weeklyItem('물리', 8, mkChapters([['C', 200]]));
    const st = baseState([phys]);
    const r = schedule(st);
    const WK1 = '2026-06-29'; // 다음 주 월요일
    setAllocCell(st, r, WK0, phys.id, 2, 120); // 이전 주 화=120
    copyPrevWeekAlloc(st, r, WK1);
    expect(st.weekAlloc![WK1]![phys.id]![2]).toBe(120);
    // 깊은 복사(참조 공유 아님).
    st.weekAlloc![WK0]![phys.id]![2] = 999;
    expect(st.weekAlloc![WK1]![phys.id]![2]).toBe(120);
  });

  it('resetWeekAlloc: 그 주 삭제 → auto 복귀', () => {
    const phys = weeklyItem('물리', 8, mkChapters([['C', 40]]));
    const st = baseState([phys]);
    const r = schedule(st);
    setAllocCell(st, r, WK0, phys.id, 2, 120);
    expect(isWeekManaged(st, WK0)).toBe(true);
    resetWeekAlloc(st, WK0);
    expect(isWeekManaged(st, WK0)).toBe(false);
  });

  it('rowSumMin·colSumMin: 행/열 합', () => {
    const map: Record<string, number[]> = {
      a: [0, 0, 120, 0, 60, 0, 0],
      b: [0, 0, 30, 0, 0, 0, 0],
    };
    expect(rowSumMin(map.a)).toBe(180);
    expect(rowSumMin(undefined)).toBe(0);
    expect(colSumMin(map, 2)).toBe(150); // 화: 120+30
    expect(colSumMin(map, 4)).toBe(60);
    expect(colSumMin(map, 1)).toBe(0);
  });

  it('zeroVec: 길이 7 0벡터', () => {
    expect(zeroVec()).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

/* ============================================================
   아래는 평가웨이브(2026-07) 결함 회귀 고정. 653개 테스트가 못 잡은 이유는
   기존 불변식이 `weekAlloc = {}`(최상위 빈 맵)만 잠그고 `weekAlloc[wk] = {}`(주 단위 빈 객체)를
   미커버였기 때문 — 그 한 칸이 세 결함(무음 전멸·첫 주 복사·고아 sid)의 공통 뿌리였다.
============================================================ */

describe('주간 배분 — 빈 주 객체 계약(치명 회귀)', () => {
  const items = () => [weeklyItem('수학', 6, mkChapters([['M', 40]]))];

  it('weekAlloc[wk] = {} 는 managed가 아니다 — 자동 산출이 그대로 살아야', () => {
    const its = items();
    const a = schedule(baseState(its));
    // 빈 주 객체도 truthy라 예전 스케줄러는 이 주를 '전 과목 0분 배분'으로 돌려 new를 통째로 지웠다.
    const b = schedule(baseState(its, { weekAlloc: { [WK0]: {} } }));
    expect(JSON.stringify(b.days)).toBe(JSON.stringify(a.days));
    const wk0New = b.days
      .filter((d) => weekMonOf(d.ds) === WK0)
      .flatMap((d) => d.items.filter((it) => it.type === 'new'));
    expect(wk0New.length).toBeGreaterThan(0); // 무음 전멸 금지
  });

  it('isWeekManaged/allocView: 빈 주 객체는 managed 아님 → 자동 파생을 보여준다', () => {
    const its = items();
    const st = baseState(its, { weekAlloc: { [WK0]: {} } });
    const r = schedule(st);
    expect(isWeekManaged(st, WK0)).toBe(false); // 배지가 '내 배분'으로 거짓말하지 않게
    expect(JSON.stringify(allocView(st, r, WK0))).toBe(JSON.stringify(deriveAutoAlloc(r, WK0)));
  });

  it('과목 키가 있고 값이 전부 0인 주는 managed 존중(의도적 쉬는 주)', () => {
    const its = items();
    const sid = (its[0] as { id: string }).id;
    const st = baseState(its, { weekAlloc: { [WK0]: { [sid]: zeroVec() } } });
    expect(isWeekManaged(st, WK0)).toBe(true);
    const r = schedule(st);
    const wk0New = r.days
      .filter((d) => weekMonOf(d.ds) === WK0)
      .flatMap((d) => d.items.filter((it) => it.type === 'new'));
    expect(wk0New.length).toBe(0); // 사용자가 비운 주는 비워둔다
  });
});

describe('주간 배분 — 첫 주 지난주복사(무음 전멸 재현 경로)', () => {
  it('소스가 지평 밖(첫 주)이면 no-op — 0을 반환하고 그 주 블록이 보존된다', () => {
    const math = weeklyItem('수학', 6, mkChapters([['M', 40]]));
    const st = baseState([math]); // startDate=2026-06-23 → 첫 주 = WK0, 그 이전 주는 지평 밖
    const r = schedule(st);
    const before = schedule(st)
      .days.filter((d) => weekMonOf(d.ds) === WK0)
      .flatMap((d) => d.items.filter((it) => it.type === 'new')).length;
    expect(before).toBeGreaterThan(0);

    const copied = copyPrevWeekAlloc(st, r, WK0);
    expect(copied).toBe(0); // 호출부는 이 0으로 '복사할 지난 주 배분이 없어요' 신호를 준다
    expect(st.weekAlloc?.[WK0]).toBeUndefined(); // 빈 managed 주를 만들지 않았다
    const after = schedule(st)
      .days.filter((d) => weekMonOf(d.ds) === WK0)
      .flatMap((d) => d.items.filter((it) => it.type === 'new')).length;
    expect(after).toBe(before);
  });

  it('소스가 있으면 복사한 과목 수를 반환', () => {
    const phys = weeklyItem('물리', 8, mkChapters([['C', 200]]));
    const st = baseState([phys]);
    const r = schedule(st);
    const WK1 = '2026-06-29';
    setAllocCell(st, r, WK0, phys.id, 2, 120);
    expect(copyPrevWeekAlloc(st, r, WK1)).toBe(1);
  });
});

describe('주간 배분 — 고아 sid(삭제된 과목 잔재)', () => {
  it('colSumMin: 유효 sid 집합을 주면 고아 배분이 열 합을 부풀리지 않는다', () => {
    const map: Record<string, number[]> = {
      alive: [0, 60, 0, 0, 0, 0, 0], // 월(wd=1) 1h
      ghost: [0, 180, 0, 0, 0, 0, 0], // 삭제된 과목의 잔재 3h
    };
    expect(colSumMin(map, 1)).toBe(240); // 방어 없이는 푸터가 4h(보이는 행 합은 1h)
    expect(colSumMin(map, 1, new Set(['alive']))).toBe(60);
  });

  it('removeSidFromAlloc: 전 주에서 그 과목을 지우고, 빈 주는 키째 정리(auto 복귀)', () => {
    const st = baseState([], {
      weekAlloc: {
        [WK0]: { alive: [0, 60, 0, 0, 0, 0, 0], ghost: [0, 180, 0, 0, 0, 0, 0] },
        '2026-06-29': { ghost: [0, 120, 0, 0, 0, 0, 0] },
      },
    });
    expect(removeSidFromAlloc(st, 'ghost')).toBe(2);
    expect(colSumMin(st.weekAlloc![WK0]!, 1)).toBe(60);
    expect(st.weekAlloc!['2026-06-29']).toBeUndefined(); // 빈 주 객체를 남기면 그게 곧 §12-4 결함
    expect(isWeekManaged(st, '2026-06-29')).toBe(false);
  });

  it('pruneAlloc: 유효 sid 집합 밖 배분을 일괄 제거', () => {
    const st = baseState([], {
      weekAlloc: { [WK0]: { a: [0, 60, 0, 0, 0, 0, 0], b: [0, 30, 0, 0, 0, 0, 0], c: [0, 30, 0, 0, 0, 0, 0] } },
    });
    expect(pruneAlloc(st, ['a'])).toBe(2);
    expect(Object.keys(st.weekAlloc![WK0]!)).toEqual(['a']);
    expect(pruneAlloc(st, ['a'])).toBe(0); // 멱등
  });
});

describe('주간 배분 — 주당 0시간 과목(리드아웃 오염)', () => {
  it('isUnschedulable: 주당 목표 0/미입력 = 엔진이 new를 만들지 않는 과목', () => {
    const zero = weeklyItem('영어', 0) as unknown as import('@/lib/types').Item;
    const ok = weeklyItem('수학', 6) as unknown as import('@/lib/types').Item;
    expect(isUnschedulable(zero)).toBe(true);
    expect(isUnschedulable(ok)).toBe(false);
  });

  it('분자·분모가 같은 집합 — 0시간 과목에 배분해도 200% 같은 값이 안 나온다', () => {
    const math = weeklyItem('수학', 2, mkChapters([['M', 40]])); // 예산 2h
    const zero = weeklyItem('영어', 0, mkChapters([['E', 20]])); // 예산 0h — 엔진 무시
    const st = baseState([math, zero]);
    const r = schedule(st);
    setAllocCell(st, r, WK0, math.id, 1, 120); // 월 2h
    setAllocCell(st, r, WK0, zero.id, 2, 120); // 화 2h — 배분해도 안 굴러감

    expect(weekBudgetMin(st)).toBe(120);
    expect(weekAllocTotalMin(st, r, WK0)).toBe(120); // 예전 산식이면 240 → 200%
    expect(weeklyItems(st).length).toBe(2); // 행에서 사라지진 않는다(경고 배지 대상)
  });

  it('weeklyItems: 이름 없는 자리표시자·daily(Anki)는 배분 대상이 아니다', () => {
    const st = baseState([
      weeklyItem('수학', 6),
      { id: 'x', name: '', mode: 'weekly', weeklyHours: 3, chapters: [] },
      { id: 'y', name: 'Anki', mode: 'daily', dailyMin: 20, chapters: [] },
    ]);
    expect(weeklyItems(st).map((it) => it.name)).toEqual(['수학']);
  });
});

describe('주간 배분 — 방치 신호(ID-7 neglectDaysBySid)', () => {
  const TODAY = '2026-07-15';
  const comps = (rows: [ds: string, key: string, done: boolean][]) => {
    const out: Record<string, Record<string, { done: boolean; min: number }>> = {};
    for (const [ds, key, done] of rows) (out[ds] = out[ds] || {})[key] = { done, min: 60 };
    return out;
  };

  it('과목별 마지막 완료 뒤 경과일(완료만·미래 무시·최신 유지)', () => {
    const state = {
      completions: comps([
        ['2026-07-05', 'm|new', true], // m 10일 전
        ['2026-07-13', 'm|rev', true], // m 최신 = 2일 전(이게 이김)
        ['2026-07-01', 'p|new', true], // p 14일 전
        ['2026-07-14', 's|new', false], // 미완료 → 제외
        ['2026-08-01', 'p|rev', true], // 미래 → 무시
      ]),
    } as never;
    const n = neglectDaysBySid(state, TODAY);
    expect(n['m']).toBe(2); // 최신(07-13)
    expect(n['p']).toBe(14);
    expect(n['s']).toBeUndefined(); // 완료 이력 없음(미완료뿐) → 키 없음
  });

  it('완료 이력 없는 과목은 키 없음(신규 과목을 방치로 안 몬다)', () => {
    expect(neglectDaysBySid({ completions: {} } as never, TODAY)).toEqual({});
    expect(NEGLECT_DAYS).toBe(7);
  });
});
