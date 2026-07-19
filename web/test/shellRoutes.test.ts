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
class FakeChannel {
  onmessage?: (m: unknown) => void;
}
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: FakeChannel }));

import {
  cancelResearch,
  coachSummary,
  embedTexts,
  getArtifact,
  listResearchJobs,
  lookupVocab,
  marketsBrief,
  previewFromJsonStream,
  runTool,
  startResearch,
} from '@/lib/api';
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

describe('탐구 잡 — 셸(Rust 커맨드) 경로 · 4단계-D', () => {
  it('시작 성공은 {ok:true, job} 봉투로 되싼다', async () => {
    enterShell();
    const job = {
      id: 'r1',
      topic: '위상수학',
      scope: '',
      status: 'running',
      code: null,
      startedAt: 1,
      endedAt: null,
      out: '',
    };
    invoke.mockResolvedValue(job);

    const r = await startResearch('위상수학');

    expect(invoke).toHaveBeenCalledWith('research_start', { topic: '위상수학', scope: null });
    expect(r).toEqual({ ok: true, job });
  });

  /* 이 두 케이스가 4-D 의 진짜 위험이다. Rust 는 실패를 reject 로 주는데 소비처(Control)는
     `ok`/`error` 로 분기한다 — 되싸기를 빠뜨리면 캡 초과가 **처리되지 않은 rejection** 이 되어
     "시작 버튼을 눌렀는데 아무 반응이 없다"가 된다(에러 토스트조차 안 뜬다). */
  it('캡 초과는 throw 가 아니라 {ok:false, error} 로 온다', async () => {
    enterShell();
    invoke.mockRejectedValue('이미 수집 중인 탐구가 많아요 — 잠시 후 다시.');

    const r = await startResearch('주제');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('이미 수집 중인');
  });

  it('중단 실패도 봉투로 온다(이미 끝난 잡)', async () => {
    enterShell();
    invoke.mockRejectedValue('이미 끝난 잡이에요.');
    await expect(cancelResearch('r1')).resolves.toMatchObject({ ok: false });
  });

  it('목록 조회 실패는 빈 목록으로 접는다(잡 없음과 같은 화면)', async () => {
    enterShell();
    invoke.mockRejectedValue('boom');
    await expect(listResearchJobs()).resolves.toEqual({ ok: false, jobs: [] });
  });

  it('셸이 아니면 기존 /api 를 탄다', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, jobs: [] }) }));
    vi.stubGlobal('fetch', f);
    await listResearchJobs();
    expect(f).toHaveBeenCalledWith('/api/research/jobs');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('Ollama — 셸(Rust 커맨드 + Channel) 경로 · 4단계-E', () => {
  /** Rust 가 Channel 로 증분을 밀어 넣는 것을 흉내낸다. */
  function streamDeltas(chunks: string[], final: unknown) {
    invoke.mockImplementation(async (cmd: string, args: { onDelta?: { onmessage?: (m: unknown) => void } }) => {
      if (cmd !== 'ollama_run') return undefined;
      for (const d of chunks) args.onDelta?.onmessage?.({ d });
      return final;
    });
  }

  it('델타는 증분으로 오지만 onDelta 에는 누적으로 전달된다', async () => {
    enterShell();
    streamDeltas(['{"sco', 're": 8', '0}'], { ok: true, feedback: { score: 80 } });

    const seen: string[] = [];
    const r = await coachSummary('원문', '내 요약', 'ko', { onDelta: (acc) => seen.push(acc) });

    /* ⚠ 이게 4-E 의 핵심 계약이다. Rust 는 증분만 보내는데 `StreamOpts.onDelta` 의 계약은
       **누적 원문**이다(previewFromJsonStream 이 누적을 전제로 값만 뽑는다). 여기서 누적을
       안 하면 미리보기가 매번 조각 하나만 보고 깜빡인다 — 에러 없이 UX 만 망가지는 부류. */
    expect(seen).toEqual(['{"sco', '{"score": 8', '{"score": 80}']);
    expect(r).toMatchObject({ ok: true, feedback: { score: 80 } });
  });

  it('누적본이 previewFromJsonStream 과 그대로 맞물린다', async () => {
    enterShell();
    streamDeltas(['{"overview": "오늘 시', '장은 상승"}'], { ok: true, brief: {} });

    let last = '';
    await marketsBrief([], [], { onDelta: (acc) => (last = acc) });

    expect(previewFromJsonStream(last)).toBe('오늘 시장은 상승');
  });

  it('스트리밍을 안 쓰는 어휘 조회는 onDelta 없이 부른다(단발 경로)', async () => {
    enterShell();
    invoke.mockResolvedValue({ ok: true, vocab: { meaning: '사과' } });

    await lookupVocab('apple', '문맥', 'ko');

    const args = invoke.mock.calls[0]![1] as { kind: string; onDelta?: unknown };
    expect(args.kind).toBe('reads/vocab');
    expect(args.onDelta, '단발 경로인데 채널이 붙었다 — Rust 가 스트림 모드로 돈다').toBeUndefined();
  });

  it('실패는 throw 가 아니라 봉투로 온다(소비처가 .ok 로 분기한다)', async () => {
    enterShell();
    invoke.mockResolvedValue({ ok: false, error: 'AI가 이미 처리 중이에요 — 잠시 후 다시.' });
    await expect(coachSummary('a', 'b', 'ko')).resolves.toMatchObject({ ok: false });
  });

  it('취소 신호는 ollama_cancel 을 같은 requestId 로 부른다', async () => {
    enterShell();
    const ctrl = new AbortController();
    let capturedId = '';
    invoke.mockImplementation(async (cmd: string, args: { requestId?: string }) => {
      if (cmd === 'ollama_run') {
        capturedId = args.requestId ?? '';
        ctrl.abort(); // 생성 도중 사용자가 중단
        return { ok: false, error: '사용자가 중단했어요.' };
      }
      return undefined;
    });

    await marketsBrief([], [], { signal: ctrl.signal });

    const cancel = invoke.mock.calls.find(([c]) => c === 'ollama_cancel');
    expect(cancel, '취소가 Rust 까지 안 갔다 — 생성이 계속 돈다').toBeTruthy();
    expect((cancel![1] as { requestId: string }).requestId).toBe(capturedId);
  });

  it('임베딩은 텍스트 배열만 넘긴다', async () => {
    enterShell();
    invoke.mockResolvedValue({ ok: true, vectors: [[0.1]] });
    await embedTexts(['가', '나']);
    expect(invoke).toHaveBeenCalledWith('ollama_embed', { texts: ['가', '나'] });
  });

  it('셸이 아니면 기존 /api 를 탄다', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', f);
    await lookupVocab('apple', 'ctx', 'ko');
    expect(f.mock.calls[0]![0]).toBe('/api/reads/vocab');
    expect(invoke).not.toHaveBeenCalled();
  });
});
