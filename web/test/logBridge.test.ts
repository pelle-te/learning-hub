/* ============================================================
   logBridge.test.ts — **프런트 실패가 디스크로 가는 다리**(O007 · 2026-08-22 운영 축).

   이 다리가 없던 동안 `console.error` **38곳/15파일**이 릴리스에서 증발했다 — Rust 는 파일
   싱크를 갖고 있었고 프런트만 거기 닿는 길이 셋 다 없었다. 여기서 잠그는 것은 그 다리의
   **성질 넷**이고, 넷 다 «관측이 관측 대상을 해치지 않는다»는 규율의 구체형이다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ⚠ 모의의 시그니처를 명시한다(V068) — 없으면 `mock.calls` 가 `[][]` 라 인자를 못 읽는다. */
const error = vi.fn(async (..._a: unknown[]) => {});
const warn = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@tauri-apps/plugin-log', () => ({ error, warn }));

const 원본 = { error: console.error, warn: console.warn, log: console.log };

beforeEach(() => {
  vi.resetModules();
  error.mockClear();
  warn.mockClear();
  console.error = vi.fn();
  console.warn = vi.fn();
  console.log = vi.fn();
});
afterEach(() => {
  Object.assign(console, 원본);
  delete (globalThis as Record<string, unknown>).window;
});

/** 셸인 척한다 — `isTauri()` 는 `typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window`. */
const 셸 = (): void => {
  (globalThis as unknown as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} };
};

describe('bridgeConsole — 프런트 실패가 파일 싱크에 닿는다(O007)', () => {
  it('⭐ `console.error` 가 원본 **과** 파일 싱크 양쪽으로 간다', async () => {
    셸();
    const { bridgeConsole } = await import('@/lib/log');
    await bridgeConsole();
    console.error('[db] SQLite 연결 실패');
    expect(error, '파일 싱크에 안 갔다 — 릴리스에서 이 줄은 증발한다').toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain('SQLite 연결 실패');
  });

  it('⚠⚠ 브라우저(dev·트랙 A·폰)에서는 아무것도 안 건다 — 그 커맨드가 없다', async () => {
    // window 없음 = isTauri() false
    const { bridgeConsole } = await import('@/lib/log');
    const 전 = console.error;
    await bridgeConsole();
    expect(console.error, '브라우저에서 콘솔을 감쌌다').toBe(전);
    console.error('x');
    expect(error).not.toHaveBeenCalled();
  });

  it('⚠ 두 번 불러도 겹겹이 감싸지 않는다 — 부팅 경로가 여러 번 불릴 수 있다', async () => {
    셸();
    const { bridgeConsole } = await import('@/lib/log');
    await bridgeConsole();
    await bridgeConsole();
    console.warn('한 번');
    expect(warn, '두 겹으로 감싸이면 같은 줄이 로그에 두 번 남는다').toHaveBeenCalledTimes(1);
  });

  it('⚠⚠ `Error` 는 **스택째** 간다 — `String(e)` 로 접으면 진단의 본체가 사라진다', async () => {
    셸();
    const { bridgeConsole } = await import('@/lib/log');
    await bridgeConsole();
    const e = new Error('디스크 오류');
    console.error('[db] 부팅 읽기 실패', e);
    const 줄 = error.mock.calls[0]![0] as string;
    expect(줄).toContain('디스크 오류');
    expect(줄, '스택이 없으면 「어디서 났나」를 못 읽는다').toMatch(/at |Error: 디스크 오류/);
  });

  it('⚠ 객체는 `[object Object]` 가 아니라 JSON 으로 — 그 줄은 있으나 마나가 되면 안 된다', async () => {
    셸();
    const { bridgeConsole } = await import('@/lib/log');
    await bridgeConsole();
    console.error('상태', { tbl: 'docs', n: 3 });
    expect(error.mock.calls[0]![0]).toContain('{"tbl":"docs","n":3}');
  });

  it('⚠⚠ 싱크가 던져도 앱이 안 죽고 콘솔 출력도 안 사라진다 — 관측이 관측 대상을 해치지 않는다', async () => {
    셸();
    error.mockRejectedValueOnce(new Error('IPC 끊김'));
    const { bridgeConsole } = await import('@/lib/log');
    await bridgeConsole();
    expect(() => console.error('여전히 보여야 한다')).not.toThrow();
    expect(console.error).toBeTypeOf('function');
  });

  it('⚠ `log`·`info` 는 안 건다 — 릴리스 필터가 Warn 이라 어차피 버려지고, 걸면 디스크가 잡음이 된다', async () => {
    셸();
    const 전 = console.log;
    const { bridgeConsole } = await import('@/lib/log');
    await bridgeConsole();
    expect(console.log).toBe(전);
  });
});
