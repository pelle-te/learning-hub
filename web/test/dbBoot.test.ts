// @vitest-environment jsdom
/* ============================================================
   dbBoot.test.ts — 부팅 읽기 경로 + localStorage → SQLite 1회 이관(2단계-E).

   이 파일이 잠그는 건 성능이 아니라 **데이터 보존**이다. 빈 DB 를 "새 사용자"로 읽으면
   기존 셸 사용자의 정본(아직 localStorage 에 있다)이 통째로 사라진다. 그리고 실패 경로가
   전부 "localStorage 폴백"으로 수렴해야 한다 — 부팅 실패는 이 앱에서 가장 나쁜 결과다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock 은 파일 최상단으로 호이스팅되므로 팩토리가 참조할 값도 함께 호이스팅해야 한다.
const { readRows, writeRows, isDbAvailable, setDiffBaseline } = vi.hoisted(() => ({
  readRows: vi.fn(),
  writeRows: vi.fn(),
  isDbAvailable: vi.fn(),
  setDiffBaseline: vi.fn(),
}));
vi.mock('@/lib/db/sqlite', () => ({
  readRows,
  writeRows,
  isDbAvailable,
  setDiffBaseline,
  getDb: vi.fn(),
  // 4단계-J — 저작물 저장소(db/docs.ts)가 쓰는 통로. 모킹에서 빠지면 initDocs 가 터지는데,
  // 그 실패가 AppState 프리로드까지 끌고 내려가면 안 된다(boot.ts 가 자체 try 로 끊는다).
  selectDb: vi.fn(async () => null),
  execDb: vi.fn(async () => true),
}));

import { initAppStore, preloadedState, didMigrate, resetBootState } from '@/lib/db/boot';
import { stateToRows } from '@/lib/db/rows';
import { defaults, persist } from '@/lib/persistence';
import { storage } from '@/lib/kv';
import type { AppState } from '@/lib/types';

/** 활동 흔적이 있는 상태 — 어느 경로가 채택됐는지 marker 로 판별. */
const marked = (m: string): AppState => {
  const s = defaults() as AppState & { completions: Record<string, unknown> };
  s.completions[m] = { 'a|new': { done: true, min: 60 } };
  return s;
};
const markerOf = (s: AppState | null): string | undefined =>
  s ? Object.keys((s as unknown as { completions: Record<string, unknown> }).completions)[0] : undefined;

const asTauri = (on: boolean): void => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
};

beforeEach(() => {
  localStorage.clear();
  resetBootState();
  readRows.mockReset();
  writeRows.mockReset().mockResolvedValue(true);
  isDbAvailable.mockReset().mockResolvedValue(true);
  asTauri(true);
});

describe('initAppStore — 부팅 경로 선택', () => {
  it('브라우저(비-Tauri)에선 아무것도 안 한다 — dev·트랙 A 가 계속 살아야 한다', async () => {
    asTauri(false);
    await initAppStore();
    expect(preloadedState()).toBeNull();
    expect(isDbAvailable).not.toHaveBeenCalled();
  });

  it('DB 에 데이터가 있으면 그게 정본이다', async () => {
    readRows.mockResolvedValue(stateToRows(marked('2026-05-01')));
    await initAppStore();
    expect(markerOf(preloadedState())).toBe('2026-05-01');
    expect(didMigrate()).toBe(false);
    expect(writeRows).not.toHaveBeenCalled(); // 이미 있는데 덮어쓰지 않는다
  });
});

describe('⚠ 빈 DB = "새 사용자"가 아니라 "아직 이관 안 됨"', () => {
  it('localStorage 정본을 읽어 SQLite 로 옮긴다(기존 셸 사용자 데이터 보존)', async () => {
    persist(storage, marked('2026-06-02')); // 기존 사용자의 정본
    readRows.mockResolvedValue(null); // 빈 DB
    await initAppStore();

    expect(didMigrate()).toBe(true);
    expect(markerOf(preloadedState())).toBe('2026-06-02');
    // 실제로 SQL 로 옮겼는가 — 옮기지 않으면 다음 부팅에 또 빈 DB 다.
    expect(writeRows).toHaveBeenCalledTimes(1);
    const written = writeRows.mock.calls[0]![0] as ReturnType<typeof stateToRows>;
    expect(written.completions.some((r) => r.ds === '2026-06-02')).toBe(true);
  });

  it('저장된 게 아무것도 없으면 기본값을 옮긴다(진짜 새 사용자)', async () => {
    readRows.mockResolvedValue(null);
    await initAppStore();
    expect(didMigrate()).toBe(true);
    expect(preloadedState()).not.toBeNull();
    expect(markerOf(preloadedState())).toBeUndefined();
  });
});

describe('실패는 전부 localStorage 폴백으로 수렴한다', () => {
  it('DB 미가용이면 폴백', async () => {
    isDbAvailable.mockResolvedValue(false);
    await initAppStore();
    expect(preloadedState()).toBeNull();
  });

  it('이관 쓰기가 실패하면 폴백(정본은 아직 localStorage 에 있다)', async () => {
    persist(storage, marked('2026-06-03'));
    readRows.mockResolvedValue(null);
    writeRows.mockResolvedValue(false);
    await initAppStore();
    expect(preloadedState()).toBeNull(); // 옮기지 못했으니 정본을 옮겼다고 주장하지 않는다
    expect(didMigrate()).toBe(false);
  });

  it('읽기가 throw 해도 앱은 뜬다(부팅 실패가 가장 나쁜 결과)', async () => {
    readRows.mockRejectedValue(new Error('디스크 오류'));
    await expect(initAppStore()).resolves.toBeUndefined();
    expect(preloadedState()).toBeNull();
  });
});
