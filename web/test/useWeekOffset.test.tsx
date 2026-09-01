// @vitest-environment jsdom
/* ============================================================
   useWeekOffset.test.tsx — 주 네비 단일 기계(Schedule·Alloc 3중 복제 수렴) 회귀.
   ① 절대/상대 오프셋 계약 ② startDate 변경 리베이스(복제 시절엔 useState 초기화뿐이라 어긋났다)
   ③ 오프셋 라벨 경계 ④ maxRel 클램프(리뷰 변종: 미래 주 금지)를 겨눈다.
============================================================ */
// ⚠ `render` 는 아래에서 **지역으로 다시 선언**한다 — 같은 이름을 import 하면 충돌이다(V068).
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWeekOffset, type WeekOffsetOpts } from '@/hooks/useWeekOffset';
import type { AppState } from '@/lib/schema';

/** 결정적 '오늘' — _today가 앱의 단일 출처(todayISO 경유). 2026-06-17(수) → 그 주 월요일 06-15. */
const state = (startDate: string, today = '2026-06-17') =>
  ({ startDate, _today: today, items: [] }) as unknown as AppState;

const render = (st: AppState, opts?: WeekOffsetOpts) =>
  renderHook(({ s }: { s: AppState }) => useWeekOffset(s, opts), { initialProps: { s: st } });

describe('useWeekOffset', () => {
  it('초기값은 이번 주 — 절대 오프셋은 startDate 주 기준', () => {
    const { result } = render(state('2026-06-01')); // 06-01(월) → 06-15까지 2주
    expect(result.current.rel).toBe(0);
    expect(result.current.weekOffset).toBe(2);
    expect(result.current.weekMon).toBe('2026-06-15');
    expect(result.current.isThisWeek).toBe(true);
    expect(result.current.offsetLabel).toBe('이번 주');
  });

  it('prev/next: 주 이동 + 라벨 경계(+n주 / -n주)', () => {
    const { result } = render(state('2026-06-01'));
    act(() => result.current.next());
    expect(result.current.weekMon).toBe('2026-06-22');
    expect(result.current.weekOffset).toBe(3);
    expect(result.current.offsetLabel).toBe('+1주');
    act(() => result.current.prev());
    act(() => result.current.prev());
    expect(result.current.rel).toBe(-1);
    expect(result.current.offsetLabel).toBe('-1주');
    expect(result.current.weekMon).toBe('2026-06-08');
    act(() => result.current.weekToday());
    expect(result.current.offsetLabel).toBe('이번 주');
  });

  it('setWeekOffset은 절대 오프셋 계약(기존 setWeekOffset 자리 그대로)', () => {
    const { result } = render(state('2026-06-01'));
    act(() => result.current.setWeekOffset(4)); // todayOff=2 → rel=+2
    expect(result.current.rel).toBe(2);
    expect(result.current.weekMon).toBe('2026-06-29');
  });

  it('startDate가 바뀌어도 보고 있던 주·"이번 주" 기준이 어긋나지 않는다(리베이스 회귀)', () => {
    const { result, rerender } = render(state('2026-06-01'));
    act(() => result.current.next()); // +1주 = 06-22
    rerender({ s: state('2026-06-08') }); // 계획 시작일 변경(마운트 유지)
    expect(result.current.weekMon).toBe('2026-06-22'); // 보던 주 그대로
    expect(result.current.offsetLabel).toBe('+1주'); // 배지도 그대로
    expect(result.current.weekOffset).toBe(2); // 절대 오프셋만 새 기준(todayOff=1)으로 재계산
  });

  it('_today가 바뀌면 이번 주 기준이 따라 이동한다', () => {
    const { result, rerender } = render(state('2026-06-01'));
    rerender({ s: state('2026-06-01', '2026-06-24') }); // 한 주 뒤
    expect(result.current.weekMon).toBe('2026-06-22');
    expect(result.current.isThisWeek).toBe(true);
  });

  it('maxRel=0(리뷰 변종): 미래 주로는 못 간다', () => {
    const { result } = render(state('2026-06-01'), { maxRel: 0 });
    act(() => result.current.next());
    expect(result.current.rel).toBe(0);
    act(() => result.current.prev());
    expect(result.current.rel).toBe(-1);
    act(() => result.current.next());
    expect(result.current.rel).toBe(0);
  });

  it('startDate가 비어도(파싱 불가) 상대 네비는 살아있다', () => {
    const { result } = render(state(''));
    expect(result.current.weekOffset).toBe(0); // 절대 오프셋은 0으로 접음
    expect(result.current.weekMon).toBe('2026-06-15');
    act(() => result.current.next());
    expect(result.current.offsetLabel).toBe('+1주');
  });
});
