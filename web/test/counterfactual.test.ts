/* ============================================================
   counterfactual.test.ts — N-3 반사실 완주일 + G-1 실측 분(completionMin).
   둘 다 "회고·계획이 무엇을 입력으로 읽는가"의 계약이라 순수 층에서 잠근다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { completionMin, setDone } from '@/lib/persistence';
import { selectFinishGains } from '@/store/selectors';
import { schedule } from '@/lib/scheduler';
import type { AppState } from '@/lib/types';

describe('G-1 — 회고가 읽는 분은 실측 우선, 없으면 계획', () => {
  it('실측이 있으면 실측을 쓴다(체크박스가 아니라 실제로 집중한 시간)', () => {
    expect(completionMin({ min: 120, actualMin: 45 })).toBe(45);
  });
  it('실측이 없으면 계획 분으로 폴백한다(옛 저장·손 체크)', () => {
    expect(completionMin({ min: 120 })).toBe(120);
    expect(completionMin(undefined)).toBe(0);
  });
  it('0·음수 실측은 "안 쟀다"로 본다 — 쟀는데 0분과 섞이면 회고가 0으로 눌린다', () => {
    expect(completionMin({ min: 90, actualMin: 0 })).toBe(90);
  });
  it('setDone 은 실측을 넘겼을 때만 싣는다(손 체크는 필드 자체가 없다)', () => {
    const st = { completions: {} } as unknown as AppState;
    setDone(st, '2026-07-08', 'm', 'new', 120, true);
    expect(st.completions['2026-07-08']!['m|new']!.actualMin).toBeUndefined();
    setDone(st, '2026-07-08', 'p', 'new', 120, true, 47);
    expect(st.completions['2026-07-08']!['p|new']!.actualMin).toBe(47);
  });
});

describe('N-3 — 반사실 완주일', () => {
  /** 최근 14일 중 3일 이상 활동하되 이행률이 낮은 상태(=계수가 실제로 걸린다). */
  const laggingState = (): AppState => {
    const completions: Record<string, Record<string, { done: boolean; min: number }>> = {};
    for (const ds of ['2026-07-01', '2026-07-02', '2026-07-03']) completions[ds] = { 'm|new': { done: true, min: 20 } }; // 가용 대비 아주 적게
    return {
      startDate: '2026-06-25',
      _today: '2026-07-08',
      moduleLen: 120,
      reviewRatio: 20,
      adaptiveCapacity: true,
      completions,
      routine: [{ id: 'r1', name: '수면', type: '수면', start: '00:00', end: '16:00', days: [0, 1, 2, 3, 4, 5, 6] }],
      items: [
        {
          id: 'm',
          name: '미적분',
          source: '직접',
          mode: 'weekly',
          weeklyHours: 6,
          chapters: Array.from({ length: 12 }, (_, i) => ({ id: 'c' + i, name: `${i + 1}장`, hours: 3, done: false })),
        },
      ],
    } as unknown as AppState;
  };

  it('계수가 걸린 계획에서 "지키면 며칠 당겨지는가"를 준다 — 추정이 아니라 엔진 재실행', () => {
    const st = laggingState();
    expect(schedule(st).adaptApplied, '전제: 이 시드는 적응 계수가 걸린다').toBe(true);
    const gains = selectFinishGains(st);
    expect(gains.length).toBeGreaterThan(0);
    const g = gains[0]!;
    expect(g.days).toBeGreaterThan(0);
    expect(g.idealDate < g.finishDate, '이상 완주일이 더 이르다').toBe(true);
    // 반사실은 **같은 엔진에 adaptiveCapacity:false 를 넣은 결과**와 정확히 같아야 한다.
    const ideal = schedule({ ...st, adaptiveCapacity: false });
    expect(g.idealDate).toBe(ideal.itemStat.find((s) => s.id === 'm')!.finishDate);
  });

  it('계수가 안 걸렸으면 아무것도 계산하지 않는다(무거운 재실행을 안 한다)', () => {
    const st = { ...laggingState(), adaptiveCapacity: false } as AppState;
    expect(selectFinishGains(st)).toEqual([]);
  });
});
