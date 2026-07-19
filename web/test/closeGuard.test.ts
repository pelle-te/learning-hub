// @vitest-environment jsdom
/* ============================================================
   closeGuard.test.ts — 창 닫기 가드의 **안전 속성**(2단계-C).

   이 가드는 1단계에서 한 번 앱을 못 닫게 만들었던 물건이다(`core:window:allow-destroy` 누락으로
   Tauri 가 닫기를 보류한 채 destroy 가 ACL 에 막혔다). 그래서 여기서 잠그는 건 "저장이 되는가"가
   아니라 **"무슨 일이 있어도 창이 닫히는가"** 다 — 저장 실패보다 앱이 안 닫히는 게 나쁘다.
   (저장이 실제로 되는지는 트랙 B `2단계-C` 가 진짜 WebView2 에서 잰다.)
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const destroy = vi.fn(async () => {});
const onCloseRequested = vi.fn();
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ destroy, onCloseRequested }),
}));

import { installCloseGuard } from '@/lib/tauri';

/** 등록된 핸들러를 꺼내 실제 닫기 요청처럼 부른다. */
async function fireClose(): Promise<{ prevented: boolean }> {
  const handler = onCloseRequested.mock.calls.at(-1)?.[0] as (e: { preventDefault: () => void }) => Promise<void>;
  let prevented = false;
  await handler({
    preventDefault: () => {
      prevented = true;
    },
  });
  return { prevented };
}

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  destroy.mockClear();
  onCloseRequested.mockReset();
  onCloseRequested.mockImplementation(async () => () => {});
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('installCloseGuard', () => {
  it('닫기를 보류하고 beforeClose 를 끝낸 뒤 창을 파괴한다', async () => {
    const order: string[] = [];
    await installCloseGuard(async () => {
      order.push('save');
    });
    destroy.mockImplementation(async () => void order.push('destroy'));
    const { prevented } = await fireClose();
    expect(prevented).toBe(true);
    expect(order).toEqual(['save', 'destroy']); // 저장이 먼저, 그 다음 파괴
  });

  it('⚠ beforeClose 가 던져도 창은 닫힌다', async () => {
    await installCloseGuard(async () => {
      throw new Error('저장 실패');
    });
    await fireClose();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('⚠ beforeClose 가 영영 안 끝나도 타임아웃 뒤 창은 닫힌다', async () => {
    vi.useFakeTimers();
    await installCloseGuard(() => new Promise<void>(() => {}), 3000);
    const done = fireClose();
    await vi.advanceTimersByTimeAsync(3100);
    await done;
    expect(destroy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('훅 등록이 실패하면 가드 없이 평소대로 닫히게 둔다(닫힘 > 저장)', async () => {
    onCloseRequested.mockRejectedValue(new Error('ACL'));
    const un = await installCloseGuard(async () => {});
    expect(typeof un).toBe('function');
    expect(() => un()).not.toThrow();
  });

  it('브라우저에선 no-op — 창 개념이 셸 전용이라 등록조차 하지 않는다', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await installCloseGuard(async () => {});
    expect(onCloseRequested).not.toHaveBeenCalled();
  });
});
