/* ============================================================
   artifactState.test.ts — 산출물 탭 상태 분류 SSOT(순수).
   reads·markets·mastery가 공유하는 loading/ready/error/empty 판정 계약을 잠근다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { classifyArtifact, isNotYetError, artifactErrorCopy } from '@/lib/artifactState';

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

describe('isNotYetError / artifactErrorCopy', () => {
  it('isNotYetError: TypeError·404·찾지못했만 true', () => {
    expect(isNotYetError(new TypeError('x'))).toBe(true);
    expect(isNotYetError(new Error('HTTP 404'))).toBe(true);
    expect(isNotYetError(new Error('찾지 못했어요'))).toBe(true);
    expect(isNotYetError(new Error('HTTP 500'))).toBe(false);
    expect(isNotYetError(undefined)).toBe(false);
  });
  /* ⚠ `artifactErrorMessage`(원문 그대로) 케이스가 여기 있었다 — **그 함수가 은퇴했다**
     (U008 · 2026-08-21 ux 축). 화면 넷이 그 반환값을 `State.desc` 에 그대로 실어 사용자에게
     `HTTP 500`·`Error: Failed to fetch` 를 보여 주고 있었다. 대체물은 `artifactErrorCopy` 이고
     계약이 하나 늘었다: **번역 + 원문 병기**(사유를 버리지 않는다 · H23 의 교훈). */
  it('artifactErrorCopy: 사용자 문장으로 옮기되 원문을 괄호로 남긴다', () => {
    expect(artifactErrorCopy(new Error('HTTP 500'))).toMatch(/^백엔드가 응답하지 못했어요/);
    expect(artifactErrorCopy(new Error('HTTP 500'))).toContain('(HTTP 500)');
    expect(artifactErrorCopy(new Error('HTTP 404'))).toMatch(/^아직 만들어지지 않은/);
    expect(artifactErrorCopy(new Error('HTTP 403'))).toMatch(/^읽을 권한이 없어요/);
    expect(artifactErrorCopy(new TypeError('Failed to fetch'))).toMatch(/^백엔드에 닿지 못했어요/);
    // `Error:` 접두는 사용자 언어가 아니다 — 벗겨서 원문만 남긴다.
    expect(artifactErrorCopy('Error: 알 수 없음')).toContain('(알 수 없음)');
    // 사유를 못 얻으면 그 사실이 문장에 드러난다(없는 원인을 지어내지 않는다).
    expect(artifactErrorCopy(undefined)).toBe('읽는 중에 알 수 없는 문제가 생겼어요.');
  });
});
