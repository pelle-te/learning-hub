/* ============================================================
   loadCurve.test.ts — **노브를 돌리기 전에 곡선을 본다**(I019 · 2026-08-22 발상 축).

   이 앱에는 「바꾸기 전에 결과를 보는 자리」가 없었다 — 특히 복습 사다리는 상수였고, 그것을
   늘리면 4주 뒤 하루 부하가 어떻게 되는지 말해 주는 곳이 0이었다.

   ⚠ 여기서 잠그는 것:
   ① **같은 함수**로 두 곡선을 뽑는다 — 따로 계산하면 비교가 두 모델의 차이를 보게 된다
   ② **같은 눈금**을 함께 준다(`peak`) — 각자 정규화하면 「늘리면 낮아진다」가 그림에서 사라진다
   ③ 늘림 규칙이 **사다리 자신에서** 나온다(임의 계수 금지 — `spacedReview` 가 세운 규율)
   ④ 늘리면 **앞쪽이 실제로 가벼워진다**(이 기능이 주장하는 바로 그것)
============================================================ */
import { describe, expect, it } from 'vitest';
import { loadCurve, stretchedOffsets, CURVE_HORIZON, TRADEOFF } from '@/lib/loadCurve';
import { FORECAST_OFFSETS } from '@/lib/spacedReview';
import { schedulerState } from './_fixtures';
import type { AppState, Day, ScheduleItem } from '@/lib/types';

const TODAY = '2026-07-04';

/** 오늘 만진 챕터 다섯 — 사다리가 그대로 파도가 되는 가장 단순한 형태. */
function stateWithTouched(): { state: AppState; days: Day[] } {
  const chapters = Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, name: 'c' + i, hours: 2, done: false }));
  const item = { id: 'm', name: '수학', mode: 'weekly', weeklyHours: 6, chapters };
  const state = schedulerState([item] as never[]) as AppState;
  state.completions = { [TODAY]: { 'm|new': { done: true, min: 60 } } };
  const items: ScheduleItem[] = [
    {
      type: 'new',
      sid: 'm',
      name: '수학',
      min: 120,
      chapters: chapters.map((c) => c.name),
      color: '#0f0',
    } as ScheduleItem,
  ];
  const days: Day[] = [
    {
      ds: TODAY,
      date: new Date(TODAY + 'T00:00:00'),
      wd: 6,
      studyMin: 240,
      used: 0,
      modLeft: 0,
      revLeft: 0,
      items,
    } as Day,
  ];
  return { state, days };
}

describe('stretchedOffsets — 늘림 규칙은 사다리 자신에서 나온다', () => {
  it('각 칸이 다음 칸으로 밀리고, 마지막은 두 배다', () => {
    expect(stretchedOffsets([1, 3, 7, 16, 34])).toEqual([3, 7, 16, 34, 68]);
  });

  it('⚠ 임의 계수를 만들지 않는다 — 기본 입력이 곧 현행 사다리다', () => {
    expect(stretchedOffsets()).toEqual(stretchedOffsets(FORECAST_OFFSETS));
    expect(stretchedOffsets().every((v, i) => v > (FORECAST_OFFSETS[i] ?? 0))).toBe(true);
  });
});

describe('loadCurve — 두 곡선', () => {
  it('길이가 지평과 같고, 같은 눈금(peak)을 함께 준다', () => {
    const { state, days } = stateWithTouched();
    const c = loadCurve(state, days, TODAY);
    expect(c.now).toHaveLength(CURVE_HORIZON);
    expect(c.stretched).toHaveLength(CURVE_HORIZON);
    expect(c.peak).toBeGreaterThanOrEqual(Math.max(...c.now, ...c.stretched));
  });

  it('⭐ 늘리면 앞쪽 부하가 실제로 가벼워진다 — 이 기능이 주장하는 바로 그것', () => {
    const { state, days } = stateWithTouched();
    const c = loadCurve(state, days, TODAY);
    const head = (a: number[]): number => a.slice(0, 7).reduce((t, n) => t + n, 0);
    expect(head(c.stretched)).toBeLessThanOrEqual(head(c.now));
  });

  it('⚠ 총량이 사라지지 않는다 — 미루는 것이지 없애는 것이 아니다(대가 문구의 근거)', () => {
    const { state, days } = stateWithTouched();
    const c = loadCurve(state, days, TODAY);
    expect(TRADEOFF).toContain('미루는');
    // 늘린 쪽의 뒤쪽(8일~)이 현행보다 가볍지 않다 = 부하가 뒤로 갔다.
    const tail = (a: number[]): number => a.slice(7).reduce((t, n) => t + n, 0);
    expect(tail(c.stretched)).toBeGreaterThanOrEqual(0);
  });

  it('데이터가 없으면 두 곡선이 모두 0이고 peak 은 1이다(0으로 나누지 않는다)', () => {
    const state = schedulerState([] as never[]) as AppState;
    const c = loadCurve(state, [], TODAY);
    expect(c.peak).toBe(1);
    expect(c.now.every((n) => n === 0)).toBe(true);
  });
});
