/* ============================================================
   artifactState.test.ts — 산출물 탭 상태 분류 SSOT(순수).
   reads·markets·mastery가 공유하는 loading/ready/error/empty 판정 계약을 잠근다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { classifyArtifact, isNotYetError, artifactErrorMessage } from '@/lib/artifactState';

describe('classifyArtifact', () => {
  it('데이터가 있으면 항상 ready(로딩/에러보다 우선)', () => {
    expect(classifyArtifact({ hasData: true, loading: true, query: { isError: true } })).toBe('ready');
  });

  it('명시 loading 우선', () => {
    expect(classifyArtifact({ hasData: false, loading: true, query: {} })).toBe('loading');
  });

  it('loading 미지정 시 query/ping 로딩으로 판정', () => {
    expect(classifyArtifact({ hasData: false, query: { isLoading: true } })).toBe('loading');
    expect(classifyArtifact({ hasData: false, query: {}, ping: { isLoading: true } })).toBe('loading');
  });

  it('온라인 + 진짜 실패(미생성 아님) → error', () => {
    expect(
      classifyArtifact({ hasData: false, query: { isError: true, error: new Error('HTTP 500') }, ping: { ok: true } }),
    ).toBe('error');
    // ping.isSuccess도 online으로 인정
    expect(
      classifyArtifact({
        hasData: false,
        query: { isError: true, error: new Error('boom') },
        ping: { isSuccess: true },
      }),
    ).toBe('error');
  });

  it('오프라인(ping 없음/false)에서의 에러는 empty(장애 오판 금지)', () => {
    expect(classifyArtifact({ hasData: false, query: { isError: true, error: new Error('HTTP 500') } })).toBe('empty');
  });

  it('온라인이어도 미생성 계열(404·찾지못했·TypeError)은 empty(셋업 안내)', () => {
    const online = { ok: true };
    expect(
      classifyArtifact({ hasData: false, query: { isError: true, error: new Error('HTTP 404') }, ping: online }),
    ).toBe('empty');
    expect(
      classifyArtifact({
        hasData: false,
        query: { isError: true, error: new Error('산출물을 찾지 못했습니다') },
        ping: online,
      }),
    ).toBe('empty');
    expect(
      classifyArtifact({
        hasData: false,
        query: { isError: true, error: new TypeError('fetch failed') },
        ping: online,
      }),
    ).toBe('empty');
  });

  it('에러 없고 데이터 없으면 empty', () => {
    expect(classifyArtifact({ hasData: false, query: {}, ping: { ok: true } })).toBe('empty');
  });
});

describe('isNotYetError / artifactErrorMessage', () => {
  it('isNotYetError: TypeError·404·찾지못했만 true', () => {
    expect(isNotYetError(new TypeError('x'))).toBe(true);
    expect(isNotYetError(new Error('HTTP 404'))).toBe(true);
    expect(isNotYetError(new Error('찾지 못했어요'))).toBe(true);
    expect(isNotYetError(new Error('HTTP 500'))).toBe(false);
    expect(isNotYetError(undefined)).toBe(false);
  });
  it('artifactErrorMessage: Error면 message, 아니면 undefined', () => {
    expect(artifactErrorMessage(new Error('보안'))).toBe('보안');
    expect(artifactErrorMessage('str')).toBeUndefined();
    expect(artifactErrorMessage(undefined)).toBeUndefined();
  });
});
