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
  ensureWeekAlloc,
  isWeekManaged,
  resetWeekAlloc,
  rowSumMin,
  setAllocCell,
  weekMonOf,
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
