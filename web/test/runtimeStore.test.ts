// @vitest-environment jsdom
/* ============================================================
   runtimeStore.test.ts — B1/B3 런타임캐시 분리의 두 계약.
   ① plan-무관 캐시(_ankiLive·_icsExport) 갱신은 AppState 참조를 갈지 않아
      selectSchedule(참조 캐시)이 schedule()을 재계산하지 않는다.
   ② 디스크 JSON은 분리 이전과 동일: flush가 병합 저장, boot/loadState가 추출 —
      persist 2계층(내보내기/로컬) 계약 불변.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '@/store/useApp';
import { useRuntime, splitRuntime, mergeRuntime } from '@/store/useRuntime';
import { selectSchedule } from '@/store/selectors';
import { KEY } from '@/lib/persistence';
import type { AppState } from '@/lib/types';

beforeEach(() => {
  localStorage.clear();
  useRuntime.setState({ cache: {} });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useRuntime — selectSchedule 비무효화(B1/B3)', () => {
  it('plan-무관 캐시 갱신은 state 참조·schedule 결과를 유지한다', () => {
    const before = useApp.getState().state;
    const resBefore = selectSchedule(before);
    useRuntime.getState().set('_ankiLive', { decks: [{ due: 12 }] });
    useRuntime.getState().set('_icsExport', { at: '2026-07-02T00:00:00Z', sig: 'x' });
    const after = useApp.getState().state;
    expect(after).toBe(before); // state 참조 불변
    expect(selectSchedule(after)).toBe(resBefore); // schedule() 재계산 없음(동일 객체)
  });

  it('AN-16: plan-무관 state 슬라이스(summaries) 변경은 루트가 갈려도 schedule을 재계산하지 않는다', () => {
    vi.useFakeTimers(); // mutate가 거는 디바운스 flush를 흡수(localStorage 잔여 방지)
    const before = useApp.getState().state;
    const resBefore = selectSchedule(before);
    useApp.getState().mutate((s) => {
      s.summaries = s.summaries || {};
      s.summaries['2026-07-01'] = [{ id: 'x', sid: '', name: '', s1: 'a', s2: '', s3: '', at: 0 }];
    });
    const after = useApp.getState().state;
    expect(after).not.toBe(before); // immer가 새 루트를 만든다(루트 참조 캐시라면 여기서 헛돌았음)
    expect(selectSchedule(after)).toBe(resBefore); // 그러나 schedule 입력 슬라이스는 불변 → 캐시 히트
    vi.advanceTimersByTime(600);
  });

  it('plan 입력(_knowState) 갱신은 여전히 state 참조를 갈아 재계산한다(정확성)', () => {
    const before = useApp.getState().state;
    const resBefore = selectSchedule(before);
    useApp.getState().setRuntimeCache('_knowState', { subjects: [{ subject: '수학', mastery: 0.5 }] });
    const after = useApp.getState().state;
    expect(after).not.toBe(before);
    expect(selectSchedule(after)).not.toBe(resBefore);
  });
});

describe('useRuntime — 디스크 왕복 대칭(계약 불변)', () => {
  it('splitRuntime: 런타임 키를 state에서 뽑아 store로 옮긴다(_knowState는 잔류)', () => {
    const s = {
      items: [],
      _ankiLive: { decks: [] },
      _icsExport: { at: 'x', sig: 'y' },
      _knowState: { subjects: [] },
    } as unknown as AppState;
    splitRuntime(s);
    const rec = s as unknown as Record<string, unknown>;
    expect(rec._ankiLive).toBeUndefined();
    expect(rec._icsExport).toBeUndefined();
    expect(rec._knowState).toEqual({ subjects: [] }); // schedule() 입력은 state 소유
    expect(useRuntime.getState().cache._ankiLive).toEqual({ decks: [] });
  });

  it('mergeRuntime: 저장 직전 병합 — 디스크 JSON 형태는 분리 이전과 동일', () => {
    useRuntime.getState().set('_ankiLive', { decks: [{ due: 3 }] });
    const merged = mergeRuntime({ items: [] } as unknown as AppState) as unknown as Record<string, unknown>;
    expect(merged._ankiLive).toEqual({ decks: [{ due: 3 }] });
  });

  it('flush(디바운스)가 런타임 캐시를 localStorage JSON에 함께 남긴다', () => {
    vi.useFakeTimers();
    useRuntime.getState().set('_ankiLive', { decks: [{ due: 7 }] });
    useApp.getState().mutate((s) => {
      s.moduleLen = 90; // 아무 변형 — 디바운스 flush 트리거
    });
    vi.advanceTimersByTime(500);
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    expect(saved._ankiLive).toEqual({ decks: [{ due: 7 }] }); // 낙관적 캐시 로컬 잔존(다음 부팅 즉시 표시)
    expect(saved.moduleLen).toBe(90);
  });

  it('loadState(가져오기/복구)도 런타임 키를 분리해 소비처가 즉시 읽는다', () => {
    const snap = {
      ...useApp.getState().state,
      _ankiLive: { decks: [{ due: 5 }] },
    } as unknown as AppState;
    useApp.getState().loadState(snap);
    const rec = useApp.getState().state as unknown as Record<string, unknown>;
    expect(rec._ankiLive).toBeUndefined();
    expect(useRuntime.getState().cache._ankiLive).toEqual({ decks: [{ due: 5 }] });
  });
});
