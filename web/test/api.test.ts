/* ============================================================
   api.test.ts — serve.js(/api) fetch 래퍼의 에러/성공 경로(Vitest).
   외부 의존(네트워크)이라 fetch를 stub해 HTTP 오류·네트워크 실패·POST 계약을 검증한다.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getArtifact, getPing, runTool, reviewCoach, previewFromJsonStream } from '@/lib/api';

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

/* ⚠ 옛 '탐구 수집 잡 API' 4케이스가 P10 W4 에서 사라졌다(2026-08-07) — `research.rs` 와 함께.
   스트리밍 케이스의 대역은 `coachSummary` → **`reviewCoach`** 로 갈았다: 지키려던 것은 특정
   기능이 아니라 **`postStream` 의 NDJSON 계약**이고, 그건 남은 AI 경로 하나로도 그대로 물어진다. */

describe('previewFromJsonStream — 스트리밍 미리보기(값만, 키 제외)', () => {
  it('완성된 문자열 값만 이어붙인다(키·미완성 리터럴 제외)', () => {
    expect(previewFromJsonStream('{"overview": "시장이 올랐다", "drivers": ["반도체 강세", "환율 안')).toBe(
      '시장이 올랐다 · 반도체 강세',
    );
  });
  it('빈 입력·값 없음이면 빈 문자열', () => {
    expect(previewFromJsonStream('')).toBe('');
    expect(previewFromJsonStream('{"score": 87')).toBe('');
  });
  it('이스케이프를 해석한다', () => {
    expect(previewFromJsonStream('{"comment": "잘했어요\\n다음도"')).toBe('잘했어요\n다음도');
  });
});

describe('postStream — NDJSON 스트리밍/단발 JSON 폴백', () => {
  function ndjsonRes(lines: string[]) {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        lines.forEach((l) => c.enqueue(enc.encode(l + '\n')));
        c.close();
      },
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/x-ndjson; charset=utf-8' },
      body,
    } as unknown as Response;
  }
  it('델타를 누적해 onDelta로 주고 마지막 done 줄을 결과로 반환한다', async () => {
    stubFetch(async () =>
      ndjsonRes(['{"d":"{\\"sc"}', '{"d":"ore\\": 90}"}', '{"done":true,"ok":true,"coach":{"headline":"좋다"}}']),
    );
    const deltas: string[] = [];
    const r = await reviewCoach(['사실'], [], { onDelta: (t) => deltas.push(t) });
    expect(r).toMatchObject({ ok: true, coach: { headline: '좋다' } });
    expect(deltas.at(-1)).toBe('{"score": 90}');
  });
  it('스트림이 아닌 단발 JSON(가드 폴백)도 같은 자리로 수렴한다', async () => {
    stubFetch(async () => res({ ok: false, error: '허용되지 않은 출처' }));
    const r = await reviewCoach(['사실'], []);
    expect(r).toMatchObject({ ok: false, error: '허용되지 않은 출처' });
  });
  it('결과 없이 끝난 스트림은 throw한다', async () => {
    stubFetch(async () => ndjsonRes(['{"d":"x"}']));
    await expect(reviewCoach(['사실'], [])).rejects.toThrow('스트림이 결과 없이 끝났어요');
  });
});
