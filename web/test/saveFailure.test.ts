/* ============================================================
   saveFailure.test.ts — 저장 실패 경로(useApp.flush) 회귀.
   ① localStorage 실패가 조용히 삼켜지지 않고 토스트로 안내(~30초 스로틀)
   ② localStorage가 실패해도 IDB 미러는 계속 시도(전소 복구의 최후 보루)
   storage는 kv.ts의 주입 인스턴스(node에선 memKV)라 setItem 스파이로 실패를 주입한다.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shell/toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/idb', () => ({ idbMirror: vi.fn(), idbLoad: vi.fn() }));

import { toast } from '@/shell/toast';
import { idbMirror } from '@/lib/idb';
import { storage } from '@/lib/kv';
import { defaults } from '@/lib/persistence';
import { useApp } from '@/store/useApp';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useApp flush — 저장 실패 안내 + IDB 미러 지속', () => {
  it('정상 저장에선 토스트 없음 + IDB 미러 호출', () => {
    useApp.getState().loadState(defaults()); // loadState는 즉시 flush(디바운스 X)
    expect(toast).not.toHaveBeenCalled();
    expect(idbMirror).toHaveBeenCalled();
  });

  it('persist 실패 시: IDB 미러는 그래도 시도 + 토스트는 ~30초에 1번만', () => {
    vi.useFakeTimers(); // Date.now까지 고정 → 스로틀 창을 결정적으로 검증
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.mocked(idbMirror).mockClear();
    vi.mocked(toast).mockClear();

    useApp.getState().loadState(defaults());
    expect(idbMirror).toHaveBeenCalledTimes(1); // localStorage 실패에도 미러는 시도
    expect(toast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast).mock.calls[0]![0]).toContain('저장 실패');
    expect(vi.mocked(toast).mock.calls[0]![1]).toBe('bad');

    useApp.getState().loadState(defaults()); // 30초 안 지남 → 스로틀
    expect(toast).toHaveBeenCalledTimes(1);
    expect(idbMirror).toHaveBeenCalledTimes(2); // 미러는 매번 시도

    vi.advanceTimersByTime(31_000); // 스로틀 창 경과
    useApp.getState().loadState(defaults());
    expect(toast).toHaveBeenCalledTimes(2);
  });
});
