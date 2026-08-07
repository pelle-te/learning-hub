/* ============================================================
   idleLedger.test.ts — 유휴 원장의 **상태 기계와 판정**(N-8 · W3).

   SQL 자체(기본키·인덱스·동기화 배제)는 `dbMigrations.test.ts` 가 실제 SQLite 로 잠근다.
   여기서 잠그는 것은 둘이다:
   ① **한 부재를 한 번만 센다** — 폴링은 구간을 못 보므로, 이게 틀리면 30분 자리 비움이
      폴링 횟수만큼(예: 30번) 세어져 표가 완전히 거짓이 된다.
   ② **판정이 "0"과 "안 쟀음"을 가른다** — 이 저장소가 `route_visits` 에서 이미 물린 형태다.
============================================================ */
import { describe, expect, it, beforeEach, vi } from 'vitest';

/* ⚠ SQLite 층을 대역으로 세운다(`visits.test.ts` 와 같은 이유) — vitest 에선
   `isSqlitePrimary()` 가 false 라 기록 경로가 통째로 조기 반환한다. */
const db = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('@/lib/db/sqlite', () => ({
  isSqlitePrimary: (): boolean => true,
  execDb: (_sql: string, args: unknown[]): Promise<void> => {
    db.calls.push(args);
    return Promise.resolve();
  },
  selectDb: (): Promise<unknown[]> => Promise.resolve([]),
}));

import { IDLE_MIN_SEC, idleVerdict, observeIdle, resetIdleSpell, type IdleRow } from '../src/lib/idleLedger';

beforeEach(() => {
  resetIdleSpell();
  db.calls.length = 0;
});

describe('상태 기계 — 한 부재는 한 번만 센다', () => {
  it('임계 아래에서는 아무것도 안 쓴다', async () => {
    expect(await observeIdle(10, '2026-08-07', 9)).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('임계를 넘는 **순간에만** 세고, 자라는 동안은 다시 안 센다', async () => {
    await observeIdle(IDLE_MIN_SEC, '2026-08-07', 9);
    await observeIdle(IDLE_MIN_SEC + 60, '2026-08-07', 9);
    await observeIdle(IDLE_MIN_SEC + 600, '2026-08-07', 10);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toEqual(['2026-08-07', 9, 1, 0, 1, 0]); // n=1 · sec 은 닫을 때
  });

  it('돌아오면 길이를 **넘은 시각의 칸**에 적는다(구간을 시작한 곳)', async () => {
    await observeIdle(IDLE_MIN_SEC, '2026-08-07', 23);
    await observeIdle(IDLE_MIN_SEC + 3600, '2026-08-08', 0); // 자정을 넘겨 자라는 중
    const len = await observeIdle(3, '2026-08-08', 0);
    expect(len).toBe(IDLE_MIN_SEC + 3600);
    // 두 번째 쓰기의 날짜·시각이 **시작한 쪽**이라야 `n` 과 `sec` 이 같은 구간을 말한다.
    expect(db.calls[1]).toEqual(['2026-08-07', 23, 0, IDLE_MIN_SEC + 3600, 0, IDLE_MIN_SEC + 3600]);
  });

  it('부재 없이 돌아오는 폴링은 무해하다 — 닫을 구간이 없으면 아무 일도 안 한다', async () => {
    expect(await observeIdle(0, '2026-08-07', 9)).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('구간이 끝난 뒤 다시 넘으면 **새 구간**이다', async () => {
    await observeIdle(IDLE_MIN_SEC, '2026-08-07', 9);
    await observeIdle(0, '2026-08-07', 9);
    await observeIdle(IDLE_MIN_SEC, '2026-08-07', 14);
    expect(db.calls.filter((a) => a[2] === 1)).toHaveLength(2);
  });
});

describe('판정 — 0 과 "안 쟀음"을 가른다', () => {
  const rows = (sec: number): IdleRow[] => [{ hour: 14, n: 1, sec }];

  it('표본이 모자라면 판정하지 않는다 — 0 을 "없다"로 읽으면 그게 순환이다', () => {
    const v = idleVerdict([], { days: 1, spells: 0 });
    expect(v.ok).toBe(false);
    expect(v.text).toContain('1일');
  });

  it('충분히 쟀는데 구간이 0 이면 **만들지 말라**고 말한다', () => {
    const v = idleVerdict([], { days: 5, spells: 0 });
    expect(v.ok).toBe(false);
    expect(v.text).toContain('트리거를 만들지 말 것');
  });

  it('짧게 자주면 트리거는 방해다 — 손을 멈춘 것과 자리를 뜬 것은 다르다', () => {
    const v = idleVerdict(rows(6 * 60), { days: 3, spells: 1 });
    expect(v.ok).toBe(false);
  });

  it('길게 드물면 설 자리가 있다', () => {
    const v = idleVerdict(rows(40 * 60), { days: 3, spells: 1 });
    expect(v.ok).toBe(true);
  });
});
