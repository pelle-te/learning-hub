// @vitest-environment jsdom
/* ============================================================
   researchJobs.test.tsx — 탐구 잡 갱신이 **폴링에서 이벤트로** 바뀐 것(4단계-D · 설계 갭 ⑤).

   여기서 잠그는 건 두 가지이고 둘 다 조용히 깨지는 부류다.

   ① **셸에서 폴링이 꺼지는가.** 안 꺼지면 이벤트 구독을 붙여 놓고도 3초마다 잡 전체(각 20,000자)를
      계속 다시 실어 나른다 — 갭 ⑤ 를 "해소했다"고 적어 놓고 비용은 그대로인 상태가 된다.
      기능은 멀쩡히 동작하므로 e2e 로도, 눈으로도 안 잡힌다.
   ② **구독이 새지 않는가.** `listen` 은 Promise 라, 붙기 전에 언마운트되면 해제 함수를 받을 곳이
      사라져 리스너가 영원히 남는다(탭을 오갈 때마다 하나씩 쌓인다).
============================================================ */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/** Rust 이벤트를 손으로 발화할 수 있게 `listen` 을 가로챈다. */
let fire: (() => void) | undefined;
const unlisten = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, cb: () => void) => {
    fire = cb;
    return unlisten;
  }),
}));

import { useResearchJobs } from '@/store/queries';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const RUNNING_JOB = {
  id: 'r1',
  topic: '위상수학',
  scope: '',
  status: 'running',
  code: null,
  startedAt: 1,
  endedAt: null,
  out: '수집 중…',
};

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  unlisten.mockClear();
  fire = undefined;
  invoke.mockResolvedValue([RUNNING_JOB]);
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('useResearchJobs — 셸', () => {
  it('running 잡이 있어도 폴링하지 않는다(이벤트가 대신한다)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useResearchJobs(true), { wrapper });
      await vi.waitFor(() => expect(result.current.data).toHaveLength(1));

      const callsAfterFirstLoad = invoke.mock.calls.length;
      // 폴링이 살아 있다면 이 구간에서 여러 번 더 불렸을 것이다(3초 간격).
      await vi.advanceTimersByTimeAsync(15_000);

      expect(invoke.mock.calls.length, '셸에서 3초 폴링이 여전히 돌고 있다 — 갭 ⑤ 가 해소되지 않았다').toBe(
        callsAfterFirstLoad,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('이벤트가 오면 다시 읽는다', async () => {
    const { result } = renderHook(() => useResearchJobs(true), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    const before = invoke.mock.calls.length;

    invoke.mockResolvedValue([{ ...RUNNING_JOB, out: '수집 중… 더 나온 출력' }]);
    await waitFor(() => expect(fire).toBeTypeOf('function'));
    fire!();

    await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(result.current.data?.[0]?.out).toContain('더 나온 출력'));
  });

  it('언마운트하면 구독을 해제한다', async () => {
    const { unmount, result } = renderHook(() => useResearchJobs(true), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});

describe('useResearchJobs — 브라우저(폴백 유지)', () => {
  it('셸이 아니면 폴링을 남겨 둔다(dev·트랙 A 에는 이벤트가 없다)', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, jobs: [RUNNING_JOB] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useResearchJobs(true), { wrapper });
      await vi.waitFor(() => expect(result.current.data).toHaveLength(1));
      const before = fetchMock.mock.calls.length;

      await vi.advanceTimersByTimeAsync(7000);

      expect(
        fetchMock.mock.calls.length,
        '브라우저 폴백에서 폴링이 죽었다 — dev 에서 잡 진행이 안 보인다',
      ).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
