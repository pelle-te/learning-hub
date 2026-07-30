/* ============================================================
   browserDbWorker.test.ts — 폰 SQLite **워커의 수명**(H13 · 2026-07-30 `/감사 근본`).

   이 파일 전까지 `browserDb.ts` 에는 `terminate()` 가 한 번도 없었고(전 저장소 0건) 테스트도
   0건이었다. 결과가 둘이다:

   ① **좀비가 OPFS 락을 쥔다** — 멎은 워커는 `FileSystemSyncAccessHandle` 을 놓지 않는다.
      그 상태로 새 워커를 세우면 SAH 풀을 못 잡아 **조용히 `:memory:` 로 내려앉는다**
      (앱은 정상으로 보이고 저장만 사라진다).
   ② **모든 연산이 30초씩 매달린다** — 타임아웃이 그 한 호출만 거절하고 핸들은 멀쩡했다.

   ⚠ 여기서 잠그는 것은 "죽였는가"가 아니라 **"확실히 죽였는가 + 다음이 새로 서는가"** 다.
   전자만 보면 `_handle = null` 로도 통과하는데, 그게 정확히 종전 상태였다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeWorker {
  terminated: boolean;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  postMessage: (req: { id: number; kind: string }) => void;
  terminate: () => void;
}

const workers: FakeWorker[] = [];
/** 다음 `open` 요청에 어떻게 답할까 — 'ok' | 'fail' | 'silent'(응답 없음 = 멎은 워커). */
let openBehavior: 'ok' | 'fail' | 'silent' = 'ok';

class W implements FakeWorker {
  terminated = false;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    workers.push(this);
  }
  postMessage(req: { id: number; kind: string }): void {
    if (openBehavior === 'silent') return; // 멎은 워커 — 아무 응답도 안 온다
    queueMicrotask(() => {
      if (req.kind === 'open') {
        this.onmessage?.({
          data:
            openBehavior === 'ok'
              ? { id: req.id, ok: true, kind: 'open', durable: true }
              : { id: req.id, ok: false, error: 'OPFS 없음' },
        });
      } else this.onmessage?.({ data: { id: req.id, ok: true, kind: 'exec' } });
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

async function freshModule() {
  vi.resetModules();
  return import('@/lib/db/browserDb');
}

beforeEach(() => {
  workers.length = 0;
  openBehavior = 'ok';
  vi.stubGlobal('Worker', W);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('폰 SQLite 워커 수명(H13)', () => {
  it('⚠ 응답이 없으면 워커를 **죽이고** 다음 호출이 새 워커를 세운다', async () => {
    vi.useFakeTimers();
    const { getBrowserDb } = await freshModule();

    openBehavior = 'silent'; // 열린 척도 못 하고 멎은 워커
    const p = getBrowserDb();
    await vi.advanceTimersByTimeAsync(31_000); // CALL_TIMEOUT_MS(30s) 경과
    expect(await p, '응답 없는 워커는 "DB 미가용"으로 다뤄야 한다').toBeNull();

    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminated, 'terminate 가 없으면 좀비가 OPFS 락을 계속 쥔다').toBe(true);

    // 핸들이 무효화됐으므로 다음 호출은 **새** 워커를 세운다(옛 것을 다시 쥐면 또 30초 매달린다).
    openBehavior = 'ok';
    vi.useRealTimers();
    expect(await getBrowserDb()).not.toBeNull();
    expect(workers).toHaveLength(2);
  });

  it('⚠ 워커가 통째로 죽으면(onerror) 죽이고 상태를 되돌린다', async () => {
    const { getBrowserDb, isDurable } = await freshModule();
    expect(await getBrowserDb()).not.toBeNull();
    expect(isDurable()).toBe(true);

    workers[0]!.onerror?.();
    expect(workers[0]!.terminated).toBe(true);
    expect(isDurable(), '새 워커가 OPFS 를 다시 잡기 전에 "내구성 있다"고 말하면 거짓말이다').toBe(false);

    expect(await getBrowserDb()).not.toBeNull();
    expect(workers).toHaveLength(2);
  });

  it('열지 못한 워커도 남기지 않는다 — 남기면 그대로 좀비다', async () => {
    const { getBrowserDb } = await freshModule();
    openBehavior = 'fail';
    expect(await getBrowserDb()).toBeNull();
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminated).toBe(true);
  });
});
