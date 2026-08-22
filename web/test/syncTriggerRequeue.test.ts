// @vitest-environment jsdom
/* ============================================================
   syncTriggerRequeue.test.ts — **도는 중에 온 트리거를 버리지 않는다**(C044 · 2026-08-22).

   ## 무엇이 틀렸었나

   `installSyncTriggers` 의 실행기는 `if (_running) return;` 하나였다. 그런데 `syncSoon` 은
   타이머가 뛰는 순간 `_editTimer = null` 로 **자기를 소비하고** `_activeRun()` 을 부르므로,
   그 호출이 겹침 가드에 막히면 **그 편집의 예약이 어디에도 안 남는다.**

   폴백 폴링은 없다(`pollMs` 는 호환용이고 데스크톱은 더 이상 주지 않는다 · W24). 남는 트리거는
   `focus`(최소 간격 **5분**) · `online`(전이 이벤트라 안 온다) · 다음 편집뿐이다. 실제 구간은
   두 번째 기기 온보딩처럼 드레인이 도는 동기화(그 파일이 *"27라운드 × 1.2초 ≈ 30초"* 라 실측을
   적어 뒀다)이고, 그 30초 안의 편집이 최대 5분 늦게 올라간다 — `syncController` 머리주석이
   결함으로 지목한 *"편집→다른 기기 반영이 최대 5분 늦었다"* 가 그대로 재현되는 것이다.

   ⚠ **유실이 아니라 지연이다**(워터마크 기반이라 다음 스캔이 반드시 집는다) — 그래서 Minor 다.

   ## 왜 큐가 아니라 부울인가

   도는 동안 편집이 열 번 와도 뒤에 붙는 실행은 **한 번**이면 충분하다(동기화는 «지금 상태
   전부»를 보낸다). 큐로 두면 30초 드레인 뒤에 열 번이 줄 선다 — 아래 셋째 케이스가 그것을 잰다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** `runSync` 를 손으로 붙잡아 «도는 중» 구간을 만든다. */
let 대기: (() => void)[] = [];
const 실행수 = { n: 0 };
vi.mock('@/lib/cloud/run', () => ({
  syncOnce: vi.fn(async () => ({ kind: 'disconnected' })),
}));
vi.mock('@/lib/cloud/client', () => ({ readCloudConfig: vi.fn(async () => null) }));
vi.mock('@/lib/visibility', () => ({ onVisible: () => () => undefined, onHidden: () => () => undefined }));

const { installSyncTriggers, syncSoon } = await import('@/store/syncController');
const controller = await import('@/store/syncController');

beforeEach(() => {
  대기 = [];
  실행수.n = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** `beforeSync` 를 붙잡아 실행을 열어 둔다 — 그동안 온 트리거가 어떻게 되는지 본다. */
const 붙잡는훅 = () =>
  vi.fn(
    () =>
      new Promise<void>((resolve) => {
        실행수.n += 1;
        대기.push(resolve);
      }),
  );

/** `beforeSync` 는 연결돼 있을 때만 돈다 → `readCloudConfig` 가 진실을 주게 갈아끼운다. */
async function 연결된채로설치(beforeSync: () => Promise<void>) {
  const client = await import('@/lib/cloud/client');
  vi.mocked(client.readCloudConfig).mockResolvedValue({ base: 'https://x', token: 't' } as never);
  return installSyncTriggers({ onEdit: false, beforeSync });
}

describe('installSyncTriggers — 겹침 가드가 트리거를 버리지 않는다', () => {
  it('⚠⚠ 도는 중에 온 편집 트리거가 실행이 끝난 뒤 이어진다', async () => {
    const hook = 붙잡는훅();
    const off = await 연결된채로설치(hook);

    syncSoon();
    await vi.advanceTimersByTimeAsync(1300); // 첫 실행 시작(디바운스 1200ms)
    expect(실행수.n, '첫 실행이 안 떴다').toBe(1);

    syncSoon(); // ← 도는 중에 편집
    await vi.advanceTimersByTimeAsync(1300);
    expect(실행수.n, '겹쳐 돌면 안 된다').toBe(1);

    대기.shift()!(); // 첫 실행 종료
    await vi.advanceTimersByTimeAsync(0);
    expect(실행수.n, '도는 중에 온 트리거가 버려졌다 — 다음 스캔까지 최대 5분').toBe(2);

    대기.forEach((r) => r());
    off();
  });

  it('도는 중에 트리거가 여럿 와도 **한 번**으로 접힌다 — 큐가 아니라 부울이다', async () => {
    const hook = 붙잡는훅();
    const off = await 연결된채로설치(hook);

    syncSoon();
    await vi.advanceTimersByTimeAsync(1300);
    for (let i = 0; i < 5; i++) {
      controller.syncSoon();
      await vi.advanceTimersByTimeAsync(1300);
    }
    expect(실행수.n).toBe(1);

    대기.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(실행수.n, '접힌 트리거가 줄을 섰다 — 드레인 뒤에 다섯 번이 연달아 돈다').toBe(2);

    대기.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(실행수.n, '이어붙인 실행이 자기 플래그를 다시 보고 무한히 이어졌다').toBe(2);

    off();
  });

  it('겹치지 않은 트리거는 그냥 돈다 — 가드가 정상 경로를 막지 않는다', async () => {
    const hook = 붙잡는훅();
    const off = await 연결된채로설치(hook);

    syncSoon();
    await vi.advanceTimersByTimeAsync(1300);
    대기.shift()!();
    await vi.advanceTimersByTimeAsync(0);

    syncSoon();
    await vi.advanceTimersByTimeAsync(1300);
    expect(실행수.n).toBe(2);

    대기.forEach((r) => r());
    off();
  });
});
