// @vitest-environment jsdom
/* ============================================================
   localStore.test.ts — localStorage JSON 헬퍼(ST-12). 파싱 실패·저장 불가는 조용히 흡수.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readJSON, writeJSON } from '@/lib/localStore';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('readJSON', () => {
  it('없는 키는 fallback', () => {
    expect(readJSON('nope', [])).toEqual([]);
    expect(readJSON('nope', { a: 1 })).toEqual({ a: 1 });
  });
  it('저장된 JSON을 파싱해 반환(왕복)', () => {
    writeJSON('k', [{ topic: 'x', ok: true }]);
    expect(readJSON('k', [])).toEqual([{ topic: 'x', ok: true }]);
  });
  it('깨진 JSON은 throw 대신 fallback', () => {
    localStorage.setItem('bad', '{깨진');
    expect(readJSON('bad', 42)).toBe(42);
  });
});

describe('writeJSON', () => {
  it('직렬화해 저장', () => {
    writeJSON('k', { n: 3 });
    expect(JSON.parse(localStorage.getItem('k')!)).toEqual({ n: 3 });
  });
  it('저장 불가(setItem throw)여도 조용히 무시', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeJSON('k', { n: 1 })).not.toThrow();
  });
});
