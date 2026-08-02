/* ============================================================
   cloudLive.test.ts — 실시간 poke 채널의 **전송이 둘, 정책은 하나**(Q-28 · 2026-08-02).

   여기서 잠그는 것은 정책 값(백오프 초·지터)이 아니라 **전송을 갈아도 정책이 같은 자리에서
   같은 판정을 한다**는 계약이다. 값은 실사고 둘(H18·H24)이 정했고 그건 `live.ts` 가 소유한다 —
   여기서 다시 단언하면 값이 두 벌이 되어 이 파일이 그 조정의 걸림돌이 된다.

   ⚠ 셸 경로에서 특히 잠그는 것 하나: **구독이 열기보다 먼저**다. `cloud_live_open` 은 즉시
   돌아오고 결과가 이벤트로 오므로, 순서가 뒤집히면 붙자마자 끊긴 연결의 `close` 를 놓쳐
   **재연결이 영영 안 걸린다**(조용한 실패 — 화면 어디에도 안 나타난다).
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 셸 IPC 를 통째로 세운다 — 실제 invoke 는 이 테스트의 대상이 아니다(트랙 B 의 몫). */
const shell = vi.hoisted(() => ({
  isTauri: false,
  calls: [] as string[],
  emit: null as null | ((ev: { kind: 'open' | 'poke' } | { kind: 'close'; reason: string }) => void),
}));

vi.mock('@/lib/tauri', () => ({
  isTauri: () => shell.isTauri,
  shellLiveOpen: (url: string, token: string, pingMs: number) => {
    shell.calls.push(`open:${url}:${token}:${pingMs}`);
    return Promise.resolve();
  },
  shellLiveClose: () => {
    shell.calls.push('close');
    return Promise.resolve();
  },
  onShellLive: (cb: (ev: { kind: 'open' | 'poke' } | { kind: 'close'; reason: string }) => void) => {
    shell.calls.push('listen');
    shell.emit = cb;
    return Promise.resolve(() => {
      shell.calls.push('unlisten');
      shell.emit = null;
    });
  },
}));

vi.mock('@/lib/cloud/client', () => ({
  currentAccessToken: () => Promise.resolve('tok'),
}));

const { connectLive } = await import('@/lib/cloud/live');

const CFG = { baseUrl: 'https://hub.example.dev', deviceId: 'd', deviceSecret: 's' } as never;

beforeEach(() => {
  shell.isTauri = false;
  shell.calls = [];
  shell.emit = null;
});
afterEach(() => vi.useRealTimers());

describe('connectLive — 셸 전송(Q-28)', () => {
  it('구독을 먼저 걸고 나서 소켓을 연다 — 순서가 뒤집히면 첫 close 를 놓친다', async () => {
    shell.isTauri = true;
    const h = connectLive(CFG, () => {});
    await tick();
    expect(shell.calls[0]).toBe('listen');
    expect(shell.calls[1]).toBe('open:wss://hub.example.dev/api/sync/live:tok:45000');
    h.close();
  });

  it('poke 이벤트가 호출부의 onPoke 로 온다', async () => {
    shell.isTauri = true;
    let poked = 0;
    const h = connectLive(CFG, () => void (poked += 1));
    await tick();
    shell.emit?.({ kind: 'open' });
    shell.emit?.({ kind: 'poke' });
    shell.emit?.({ kind: 'poke' });
    expect(poked).toBe(2);
    h.close();
  });

  it('close() 뒤에는 구독을 풀고 Rust 소켓도 닫는다 — 이후 이벤트는 없다', async () => {
    shell.isTauri = true;
    let poked = 0;
    const h = connectLive(CFG, () => void (poked += 1));
    await tick();
    h.close();
    expect(shell.calls).toContain('unlisten');
    expect(shell.calls).toContain('close');
    expect(poked).toBe(0);
  });

  it('끊기면 재연결한다 — 정책이 전송을 모른 채 도는지 본다', async () => {
    vi.useFakeTimers();
    shell.isTauri = true;
    const h = connectLive(CFG, () => {});
    await vi.advanceTimersByTimeAsync(0);
    shell.emit?.({ kind: 'open' });
    shell.emit?.({ kind: 'close', reason: '서버가 연결을 닫았어요' });
    const before = shell.calls.filter((c) => c.startsWith('open:')).length;
    // 첫 백오프는 1초 ±지터 — 넉넉히 넘긴다(값 자체는 여기서 단언하지 않는다).
    await vi.advanceTimersByTimeAsync(3000);
    expect(shell.calls.filter((c) => c.startsWith('open:')).length).toBe(before + 1);
    h.close();
  });
});

describe('connectLive — 브라우저 전송', () => {
  it('셸이 아니면 IPC 를 한 번도 안 탄다(폰·dev 는 WebSocket 그대로)', async () => {
    shell.isTauri = false;
    class FakeWS {
      onopen: (() => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onclose: (() => void) | null = null;
      close = vi.fn();
      send = vi.fn();
    }
    const made: FakeWS[] = [];
    vi.stubGlobal(
      'WebSocket',
      class extends FakeWS {
        constructor() {
          super();
          made.push(this);
        }
      },
    );
    let poked = 0;
    const h = connectLive(CFG, () => void (poked += 1));
    await tick();
    expect(shell.calls).toEqual([]);
    expect(made).toHaveLength(1);
    made[0]?.onopen?.();
    made[0]?.onmessage?.({ data: 'poke' } as MessageEvent);
    expect(poked).toBe(1);
    h.close();
    expect(made[0]?.close).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
