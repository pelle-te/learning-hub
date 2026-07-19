// @vitest-environment jsdom
/* ============================================================
   shellRoutes.test.ts — 4단계에서 Rust 로 옮긴 라우트의 **전송 분기와 계약 유지**.

   4단계는 라우트를 하나씩 Rust 로 옮긴다. 옮기는 것 자체는 Rust 테스트(`artifact.rs`)가 잠그고,
   여기서 잠그는 건 그보다 조용히 깨지는 쪽이다 — **전송이 바뀌어도 소비처가 보는 것은 같은가.**

   구체적으로 `artifactState.ts` 는 '미생성(empty · 수집 안내)'과 '진짜 실패(error · 에러 패널)'를
   에러 메시지로 가른다(`isNotYetError`). HTTP 시절엔 `HTTP 404` 문자열이 그 키였는데 IPC 엔
   상태코드가 없다. 번역을 빠뜨리면 **미생성이 에러 패널로 승격돼 10개 탭이 빨갛게 뜬다** —
   컴파일도 되고 타입도 맞는 종류의 파손이라 테스트가 아니면 안 잡힌다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { getArtifact, runTool } from '@/lib/api';
import { isNotYetError } from '@/lib/artifactState';

/** 셸 안에서 도는 척한다 — `isTauri()` 가 보는 것은 이 전역 하나뿐. */
function enterShell() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

beforeEach(() => {
  invoke.mockReset();
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('getArtifact — 셸(Rust 커맨드) 경로', () => {
  it('invoke 로 읽고 fetch 는 치지 않는다', async () => {
    enterShell();
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    invoke.mockResolvedValue({ ok: true, data: { a: 1 } });

    const r = await getArtifact('knowledge');

    expect(invoke).toHaveBeenCalledWith('artifact_read', { name: 'knowledge' });
    expect(f).not.toHaveBeenCalled();
    expect(r.data).toEqual({ a: 1 });
  });

  it('파싱 실패 원문(raw)도 그대로 넘어온다', async () => {
    enterShell();
    invoke.mockResolvedValue({ ok: true, raw: '깨진 내용{{' });
    await expect(getArtifact('reads')).resolves.toMatchObject({ ok: true, raw: '깨진 내용{{' });
  });

  it("NOT_FOUND 는 'HTTP 404' 로 번역돼 '미생성'으로 분류된다", async () => {
    enterShell();
    // invoke 는 Error 가 아니라 **문자열**로 reject 한다 — 정규화 없이 .message 를 읽으면 undefined 다.
    invoke.mockRejectedValue('NOT_FOUND 아직 생성 안 됨(도구를 먼저 실행)');

    const err = await getArtifact('curriculum').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('HTTP 404');
    // 이 줄이 계약의 본체다 — 소비처가 이걸 보고 에러 패널 대신 셋업 안내를 띄운다.
    expect(isNotYetError(err)).toBe(true);
  });

  it('그 밖의 실패는 미생성으로 삼키지 않고 그대로 올린다', async () => {
    enterShell();
    invoke.mockRejectedValue('디스크 읽기 실패');

    const err = await getArtifact('ledger').catch((e: unknown) => e);

    expect((err as Error).message).toBe('디스크 읽기 실패');
    expect(isNotYetError(err)).toBe(false); // 진짜 실패는 에러 패널로 가야 한다
  });
});

describe('getArtifact — 브라우저 폴백', () => {
  it('셸이 아니면 기존 /api 를 탄다', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: {} }) }));
    vi.stubGlobal('fetch', f);

    await getArtifact('goals');

    expect(f).toHaveBeenCalledWith('/api/artifact/goals');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('runTool — 셸(Rust 커맨드) 경로 · 4단계-C', () => {
  it('invoke 로 실행하고 subject 를 넘긴다', async () => {
    enterShell();
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    invoke.mockResolvedValue({ ok: true, out: '완료', code: 0, label: '발견 후보 승격' });

    const r = await runTool('discovery-promote', { subject: '개념::미적분' });

    expect(invoke).toHaveBeenCalledWith('run_tool', {
      tool: 'discovery-promote',
      subject: '개념::미적분',
    });
    expect(f).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, code: 0 });
  });

  it('subject 가 없으면 null 로 넘긴다(Rust Option<String>)', async () => {
    enterShell();
    invoke.mockResolvedValue({ ok: true, out: '', code: 0, label: '챕터 원장 재빌드' });
    await runTool('ledger-build');
    expect(invoke).toHaveBeenCalledWith('run_tool', { tool: 'ledger-build', subject: null });
  });

  it('실패한 도구도 throw 가 아니라 ok:false 로 온다(소비처가 out 을 토스트에 쓴다)', async () => {
    enterShell();
    invoke.mockResolvedValue({ ok: false, out: '파이썬 오류', code: 1, label: '볼트 건강검진' });
    await expect(runTool('vault-health')).resolves.toMatchObject({ ok: false, code: 1 });
  });

  it('셸이 아니면 기존 /api 를 탄다', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, out: '', code: 0 }) }));
    vi.stubGlobal('fetch', f);
    await runTool('vault-stats');
    expect(f.mock.calls[0]![0]).toBe('/api/run/vault-stats');
    expect(invoke).not.toHaveBeenCalled();
  });
});
