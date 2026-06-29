/* ============================================================
   api.test.ts — serve.js(/api) fetch 래퍼의 에러/성공 경로(Vitest).
   외부 의존(네트워크)이라 fetch를 stub해 HTTP 오류·네트워크 실패·POST 계약을 검증한다.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getArtifact, getPing, runTool } from '@/lib/api';

afterEach(() => vi.unstubAllGlobals());

/** 최소 Response 모사(ok·status·json만). */
function res(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}
function stubFetch(impl: (...a: unknown[]) => unknown) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('getJSON 계열 — 성공/HTTP오류/네트워크실패', () => {
  it('200이면 파싱된 JSON을 반환한다', async () => {
    stubFetch(async () => res({ ok: true, server: '러닝허브 제어판', tools: [], work: '/' }));
    await expect(getPing()).resolves.toMatchObject({ server: '러닝허브 제어판' });
  });
  it('비-2xx면 `HTTP {status}`로 throw한다', async () => {
    stubFetch(async () => res(null, { ok: false, status: 503 }));
    await expect(getPing()).rejects.toThrow('HTTP 503');
  });
  it('네트워크 실패(fetch reject)는 그대로 전파한다', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(getPing()).rejects.toThrow('ECONNREFUSED');
  });
  it('getArtifact는 이름을 URL 인코딩해 호출한다', async () => {
    const f = stubFetch(async () => res({ ok: true, data: {} }));
    await getArtifact('knowledge');
    expect(f).toHaveBeenCalledWith('/api/artifact/knowledge');
  });
});

describe('runTool — POST 계약 + 오류', () => {
  it('지정 도구로 JSON 본문을 POST하고 결과를 반환한다', async () => {
    const f = stubFetch(async () => res({ ok: true, out: 'done', code: 0 }));
    const r = await runTool('vault-health', { subject: '수학' });
    expect(r).toMatchObject({ ok: true, code: 0 });
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/run/vault-health');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ subject: '수학' });
  });
  it('본문 없이 호출하면 빈 객체를 보낸다', async () => {
    const f = stubFetch(async () => res({ ok: true, out: '', code: 0 }));
    await runTool('eval');
    const [, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({});
  });
  it('실패 응답(비-2xx)은 throw한다', async () => {
    stubFetch(async () => res(null, { ok: false, status: 500 }));
    await expect(runTool('eval')).rejects.toThrow('HTTP 500');
  });
});
