// @vitest-environment jsdom
/* ============================================================
   durability.test.ts — 저장소 내구성(0단계-E ①②).
   회귀 대상: `navigator.storage`를 한 번도 호출하지 않아 오리진이 best-effort 등급에 머물던 결함.
   전 경로가 **throw하지 않아야** 한다 — 부팅 경로라 여기서 던지면 앱이 안 뜬다.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureDurableStorage, isQuotaTight, fmtBytes, QUOTA_WARN_RATIO } from '@/lib/durability';

/** navigator.storage 스텁 — 부분 구현으로 미지원 메서드도 재현. */
function stubStorage(sm: Partial<StorageManager> | undefined) {
  Object.defineProperty(navigator, 'storage', { value: sm, configurable: true });
}

afterEach(() => vi.restoreAllMocks());

describe('ensureDurableStorage', () => {
  it('미지원 환경이면 전부 null(판단 불가) · throw 없음', async () => {
    stubStorage(undefined);
    expect(await ensureDurableStorage()).toEqual({ persisted: null, usage: null, quota: null, ratio: null });
  });

  it('영속 승격을 요청하고 비율을 계산한다', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({
      persisted: vi.fn().mockResolvedValue(false),
      persist,
      estimate: vi.fn().mockResolvedValue({ usage: 800, quota: 1000 }),
    });
    const r = await ensureDurableStorage();
    expect(persist).toHaveBeenCalledOnce();
    expect(r.persisted).toBe(true);
    expect(r.ratio).toBeCloseTo(0.8);
  });

  it('이미 영속이면 persist()를 재요청하지 않는다(권한 UI 반복 방지)', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist, estimate: vi.fn().mockResolvedValue({}) });
    expect((await ensureDurableStorage()).persisted).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('persist/estimate가 reject해도 throw하지 않는다', async () => {
    stubStorage({
      persisted: vi.fn().mockRejectedValue(new Error('denied')),
      persist: vi.fn().mockRejectedValue(new Error('denied')),
      estimate: vi.fn().mockRejectedValue(new Error('nope')),
    });
    expect(await ensureDurableStorage()).toEqual({ persisted: null, usage: null, quota: null, ratio: null });
  });

  it('quota 0은 비율을 만들지 않는다(Infinity/NaN 방지)', async () => {
    stubStorage({
      persisted: vi.fn().mockResolvedValue(true),
      estimate: vi.fn().mockResolvedValue({ usage: 5, quota: 0 }),
    });
    expect((await ensureDurableStorage()).ratio).toBeNull();
  });
});

describe('isQuotaTight', () => {
  const at = (ratio: number | null) => ({ persisted: true, usage: null, quota: null, ratio });
  it('임계 이상이면 경고', () => {
    expect(isQuotaTight(at(QUOTA_WARN_RATIO))).toBe(true);
    expect(isQuotaTight(at(0.95))).toBe(true);
  });
  it('임계 미만·판단 불가는 경고하지 않는다(오탐 금지)', () => {
    expect(isQuotaTight(at(0.79))).toBe(false);
    expect(isQuotaTight(at(null))).toBe(false);
  });
});

describe('fmtBytes', () => {
  it('단위를 올려 읽는다', () => {
    expect(fmtBytes(512)).toBe('512B');
    expect(fmtBytes(1536)).toBe('1.5KB');
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0MB');
  });
  it('비정상 입력은 —', () => {
    expect(fmtBytes(-1)).toBe('—');
    expect(fmtBytes(NaN)).toBe('—');
  });
});
