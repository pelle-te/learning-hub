import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* telemetry — 관측 장치의 계약을 잠근다(2026-07-25).

   ⚠ 이 모듈은 **실패해도 앱을 해치지 않는 것**이 유일한 절대 요구다. 그래서 테스트의 절반이
   "던지지 않는가"·"보내지 않는가"이고, 그건 기능 테스트가 아니라 **안전 테스트**다.
   관측 장치가 앱을 죽이면 그건 관측이 아니라 새 결함이다.

   ⚠ `lib/tauri` 를 목업한다 — `isTauri()` 가 브라우저 경로를 타게 해야 `sendBeacon`/`fetch`
   를 관측할 수 있다(셸 경로는 IPC 라 여기서 잴 것이 없다). */
vi.mock('@/lib/tauri', () => ({
  isTauri: () => false,
  cloudHttp: vi.fn(),
}));

const load = async () => await import('@/lib/telemetry');

describe('telemetry', () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.stubGlobal('location', { pathname: '/today' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('초기화 전에는 아무것도 보내지 않는다', async () => {
    const t = await load();
    t.reportError(new Error('boom'));
    expect(beacon).not.toHaveBeenCalled();
  });

  it('클라우드 미연결(null)이면 무동작 — 보낼 곳이 없는 것은 오류가 아니다', async () => {
    const t = await load();
    t.initTelemetry(null, 'shell');
    t.reportError(new Error('boom'));
    expect(beacon).not.toHaveBeenCalled();
  });

  it('초기화 후에는 /api/log 로 보낸다', async () => {
    const t = await load();
    t.initTelemetry('https://hub.example.com', 'shell');
    t.reportError(new Error('boom'));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]![0]).toBe('https://hub.example.com/api/log');
  });

  it('baseUrl 끝 슬래시를 정규화한다(// 이중 슬래시 방지)', async () => {
    const t = await load();
    t.initTelemetry('https://hub.example.com///', 'phone');
    t.reportError(new Error('boom'));
    expect(beacon.mock.calls[0]![0]).toBe('https://hub.example.com/api/log');
  });

  it('http/https 가 아닌 baseUrl 은 거부한다', async () => {
    const t = await load();
    t.initTelemetry('javascript:alert(1)', 'shell');
    t.reportError(new Error('boom'));
    expect(beacon).not.toHaveBeenCalled();
  });

  it('같은 오류는 한 번만 보낸다 — 반복은 정보가 아니다', async () => {
    const t = await load();
    t.initTelemetry('https://h.example', 'shell');
    for (let i = 0; i < 50; i++) t.reportError(new Error('같은 오류'));
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('세션 상한(20건)을 넘으면 버린다 — 폭주가 자기 DoS 가 되지 않게', async () => {
    const t = await load();
    t.initTelemetry('https://h.example', 'shell');
    for (let i = 0; i < 100; i++) t.reportError(new Error(`서로 다른 오류 ${i}`));
    expect(beacon).toHaveBeenCalledTimes(20);
  });

  it('Error 가 아닌 값(문자열·null·객체)에도 던지지 않는다', async () => {
    const t = await load();
    t.initTelemetry('https://h.example', 'shell');
    expect(() => t.reportError('문자열 거부')).not.toThrow();
    expect(() => t.reportError(null)).not.toThrow();
    expect(() => t.reportError({ 이상한: '객체' })).not.toThrow();
    expect(() => t.reportError(undefined)).not.toThrow();
  });

  it('sendBeacon 이 던져도 앱으로 새지 않는다', async () => {
    const t = await load();
    t.initTelemetry('https://h.example', 'shell');
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('beacon 폭발');
      },
    });
    expect(() => t.reportError(new Error('boom'))).not.toThrow();
  });

  it('sendBeacon 이 없으면 keepalive fetch 로 폴백한다', async () => {
    const t = await load();
    vi.stubGlobal('navigator', {});
    t.initTelemetry('https://h.example', 'shell');
    t.reportError(new Error('boom'));
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![1]).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('sendBeacon 이 false 를 돌려주면(큐 거부) fetch 로 폴백한다', async () => {
    const t = await load();
    vi.stubGlobal('navigator', { sendBeacon: () => false });
    t.initTelemetry('https://h.example', 'shell');
    t.reportError(new Error('boom'));
    expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('전체 URL 이 아니라 경로만 싣는다 — 쿼리에 값이 실릴 수 있다', async () => {
    const t = await load();
    vi.stubGlobal('location', { pathname: '/items', search: '?secret=abc' });
    t.initTelemetry('https://h.example', 'shell');
    t.reportError(new Error('boom'));
    const body = JSON.parse(await (beacon.mock.calls[0]![1] as Blob).text());
    expect(body.route).toBe('/items');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('메시지·스택 길이를 자른다(서버 스키마 상한과 같은 값)', async () => {
    const t = await load();
    t.initTelemetry('https://h.example', 'shell');
    const e = new Error('가'.repeat(5000));
    e.stack = '나'.repeat(9000);
    t.reportError(e);
    const body = JSON.parse(await (beacon.mock.calls[0]![1] as Blob).text());
    expect(body.name.length).toBeLessThanOrEqual(200);
    expect(body.detail.length).toBeLessThanOrEqual(2000);
  });

  it('app 종류(shell/phone)를 실어 어느 엔트리인지 구분되게 한다', async () => {
    const t = await load();
    t.initTelemetry('https://h.example', 'phone');
    t.reportError(new Error('boom'));
    const body = JSON.parse(await (beacon.mock.calls[0]![1] as Blob).text());
    expect(body.app).toBe('phone');
    expect(body.kind).toBe('error');
  });

  it('_resetTelemetry 가 세션 카운터·중복제거까지 되돌린다', async () => {
    const t = await load();
    t.initTelemetry('https://h.example', 'shell');
    t.reportError(new Error('같은 것'));
    expect(beacon).toHaveBeenCalledTimes(1);
    t._resetTelemetry();
    t.initTelemetry('https://h.example', 'shell');
    t.reportError(new Error('같은 것'));
    expect(beacon).toHaveBeenCalledTimes(2);
  });
});
