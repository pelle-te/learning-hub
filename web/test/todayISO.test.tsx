// @vitest-environment jsdom
/* ============================================================
   todayISO.test.tsx — **자정을 실제로 넘겨 본다**(H20 · 2026-08-01 `/감사 근본`).

   감사의 검증사각 표가 이 검사를 **처방했다**(*"H20 자정 쓰기 → `_today` 시드로 유닛"*). 사각인
   이유는 축이 **시간**이라서다: 정적 검사도, 시각 스냅샷도, e2e 도 자정을 넘기지 않는다. 그래서
   이 결함은 **하루에 한 번, 화면 밖에서** 나타난다.

   ⚠ 고친 것 중 나쁜 쪽은 읽기가 아니라 **쓰기**였다: `Today.RitualCard`·`Journal.ShutdownChain` 은
   오버레이라 자기 틱이 없어, 열어 둔 채 자정을 넘겨 체크하면 **어제 날짜 키에 쓴다**. 사용자는
   오늘을 체크했다고 믿고, 기록은 어제에 붙고, 되돌릴 단서가 없다.

   ⚠ **`_today` 시드가 있으면 타이머를 걸지 않는다**는 것도 함께 잠근다 — 시뮬레이션·테스트는
   벽시계와 무관한데 거기서 타이머가 돌면 시드가 든 화면이 자정마다 이유 없이 재렌더된다.
============================================================ */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTodayISO } from '@/hooks/useTodayISO';

afterEach(() => {
  vi.useRealTimers();
});

/** 벽시계를 특정 시각에 고정한다(로컬 시간 기준 — `iso()` 가 로컬 날짜를 쓴다). */
function freeze(y: number, m: number, d: number, hh: number, mm: number) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(y, m - 1, d, hh, mm, 0, 0));
}

describe('useTodayISO — 자정 롤오버', () => {
  it('자정을 넘기면 **스스로** 다음 날짜로 바뀐다(재렌더 유발 없이도)', () => {
    freeze(2026, 8, 1, 23, 59); // 23:59
    const { result } = renderHook(() => useTodayISO());
    expect(result.current).toBe('2026-08-01');

    // 2분 흘려 자정을 넘긴다 — 훅이 건 setTimeout 이 그 사이에 터져야 한다.
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(result.current, '오버레이를 열어 둔 채 자정을 넘기면 어제 키에 쓴다(H20)').toBe('2026-08-02');
  });

  it('넘긴 뒤 **다음 자정에도** 다시 바뀐다 — 타이머가 재무장된다', () => {
    freeze(2026, 8, 1, 23, 59);
    const { result } = renderHook(() => useTodayISO());
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(result.current).toBe('2026-08-02');
    // 하루를 더 흘린다. 한 번만 무장하고 끝나면 여기서 멈춘다.
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(result.current, '재무장이 없으면 이틀째부터 다시 하루가 밀린다').toBe('2026-08-03');
  });

  it('자정 전에는 안 바뀐다 — 분 단위로 재렌더하지 않는다', () => {
    freeze(2026, 8, 1, 12, 0);
    const { result } = renderHook(() => useTodayISO());
    act(() => {
      vi.advanceTimersByTime(11 * 60 * 60 * 1000); // 23:00
    });
    expect(result.current).toBe('2026-08-01');
  });

  /* ⚠ `setTimeout` 은 시스템 절전 중에 흐르지 않는다 — 자정을 자면서 넘기면 타이머는 깨어난 뒤에야
     늦게 터지고, 그 사이 사용자가 먼저 화면을 볼 수 있다. 그래서 `focus`·`visibilitychange` 도 듣는다. */
  it('절전 복귀(focus)에서도 수렴한다 — 타이머가 늦게 터져도 화면이 먼저 맞는다', () => {
    freeze(2026, 8, 1, 23, 59);
    const { result } = renderHook(() => useTodayISO());
    expect(result.current).toBe('2026-08-01');

    // 타이머를 흘리지 **않고** 시계만 앞으로 돌린다 = "잠든 사이 자정이 지났다".
    act(() => {
      vi.setSystemTime(new Date(2026, 7, 2, 8, 30));
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current, '깨어났을 때 화면이 어제를 보여 주면 그 상태로 쓰기가 일어난다').toBe('2026-08-02');
  });

  it('`_today` 시드가 있으면 그 값을 쓰고 **자정에도 안 바뀐다**(시뮬레이션은 벽시계와 무관)', () => {
    freeze(2026, 8, 1, 23, 59);
    const { result } = renderHook(() => useTodayISO({ _today: '2026-01-15' }));
    expect(result.current).toBe('2026-01-15');
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(result.current, '시드가 든 화면이 자정마다 이유 없이 재렌더되면 안 된다').toBe('2026-01-15');
  });

  it('시드가 바뀌면 즉시 따라간다 — 파생이라 재렌더가 곧 정답이다', () => {
    freeze(2026, 8, 1, 10, 0);
    const { result, rerender } = renderHook(({ seed }: { seed?: string }) => useTodayISO({ _today: seed }), {
      initialProps: { seed: '2026-01-15' as string | undefined },
    });
    expect(result.current).toBe('2026-01-15');
    rerender({ seed: '2026-03-20' });
    expect(result.current).toBe('2026-03-20');
    // 시드를 떼면 벽시계로 돌아온다.
    rerender({ seed: undefined });
    expect(result.current).toBe('2026-08-01');
  });
});
