// @vitest-environment jsdom
/* ============================================================
   dbQueryContract.test.ts — **질의가 몇 개 나가고 무엇을 긁어 오는가**(C055 · 2026-08-22).

   ## 왜 이 층이 필요한가

   코드 축 1회차의 성능 결함 둘(`C041` 드레인마다 정본 전량 되읽기 · `C045` 첫-키 `IN` 이
   슬라이스 전량 인출로 퇴화)은 **둘 다 «리뷰가 찾을 때까지 몇 달»** 이었다. 이유가 같다:
   기존 검사층 어디도 «질의가 몇 개 나갔나 / 무엇을 긁어 왔나»를 보지 않는다. 타입·린트·
   유닛·시각·트랙 A/B 전부 **결과가 옳은가**만 본다 — 그리고 이 둘은 결과가 옳다.

   그래서 계량 대상을 바꾼다: 카운팅 `Db` 스텁 하나로 **질의 자체**를 단언한다.
   ⚠ 실 DB 는 오늘 총 24행이라 시간으로는 아무것도 안 보인다(측정으로 잡을 수 없는 부류다).
   보이는 것은 **모양**이다 — 그래서 시간이 아니라 SQL 을 잰다.

   ## 이 파일이 잠그는 계약 셋

   ① 복합키 표는 **키 열마다** `IN` 을 건다(첫 키만 걸면 `records`·`ds_map` 에서 슬라이스 전량).
   ② 표마다 질의 **하나** — 손댄 행 수에 비례해 질의가 늘지 않는다.
   ③ 안 손댄 표는 **아예 안 읽는다**(되읽기 대조는 행축이라는 H6 의 전제 그 자체).
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 나간 질의를 통째로 기록하는 가짜 정본. */
const 질의: { sql: string; binds: unknown[] }[] = [];
const select = vi.fn(async (sql: string, binds: unknown[] = []) => {
  질의.push({ sql, binds });
  return [];
});
const execute = vi.fn(async () => undefined);

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => ({ select, execute }) } }));
vi.mock('@/lib/isTauri', () => ({ isTauri: () => true }));
vi.mock('@/lib/tauri', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  dbUrl: async () => 'sqlite:test.db',
}));

const { readTouched } = await import('@/lib/db/sqlite');

/** `SELECT` 에서 `WHERE` 절만. */
const where = (sql: string): string => sql.slice(sql.indexOf('WHERE') + 6).trim();
const 표 = (sql: string): string => /FROM (\w+)/.exec(sql)![1]!;

beforeEach(() => {
  질의.length = 0;
  select.mockClear();
});

describe('readTouched — 질의 수 계약(C055)', () => {
  it('⚠⚠ 복합키 표는 **키 열마다** IN 을 건다 — 첫 키만 걸면 슬라이스 전량이 딸려 온다', async () => {
    /* `records.cols[0] = 'slice'` 는 카디널리티가 **9** 다. 첫 키만 걸면 한 행을 되읽으려고
       그 슬라이스 전량(`dayPlans` 120일치면 120행 106KB)을 400ms 마다 긁는다 — C045. */
    await readTouched([{ table: 'records', key: ['dayPlans', 'r1'] }]);
    expect(질의).toHaveLength(1);
    const w = where(질의[0]!.sql);
    expect(w, '첫 키만 걸렸다 — 슬라이스 전량 인출로 퇴화한다').toMatch(/slice IN \(\?\)/);
    expect(w, '둘째 키가 안 걸렸다').toMatch(/id IN \(\?\)/);
    expect(질의[0]!.binds).toEqual(['dayPlans', 'r1']);
  });

  it('단일키 표는 그대로 한 열만 건다 — 곱집합이 없는 곳에 없는 열을 만들지 않는다', async () => {
    await readTouched([{ table: 'settings', key: ['theme'] }]);
    expect(where(질의[0]!.sql)).toBe('key IN (?)');
    expect(질의[0]!.binds).toEqual(['theme']);
  });

  it('표마다 질의 하나 — 손댄 행이 늘어도 질의 수는 안 는다', async () => {
    await readTouched([
      { table: 'records', key: ['dayPlans', 'a'] },
      { table: 'records', key: ['dayPlans', 'b'] },
      { table: 'records', key: ['cbms', 'c'] },
      { table: 'settings', key: ['theme'] },
    ]);
    expect(질의, '행마다 질의가 나가면 flush 가 IPC 폭풍이 된다').toHaveLength(2);
    const rec = 질의.find((q) => 표(q.sql) === 'records')!;
    expect(new Set(rec.binds), '중복 키가 바인딩에 그대로 실렸다').toEqual(
      new Set(['dayPlans', 'cbms', 'a', 'b', 'c']),
    );
  });

  it('⚠ 안 손댄 표는 아예 안 읽는다 — 되읽기가 행축이라는 H6 의 전제 그 자체다', async () => {
    await readTouched([{ table: 'settings', key: ['theme'] }]);
    expect(
      질의.map((q) => 표(q.sql)),
      '8표 전량 읽기로 되돌아갔다(H6 이전 상태)',
    ).toEqual(['settings']);
  });

  it('손댄 것이 없으면 질의가 0이다', async () => {
    await readTouched([]);
    expect(질의).toHaveLength(0);
  });

  it('⚠ 바인딩 수가 손댄 키 수에 선형이다 — 곱집합이 바인딩까지 곱하지 않는다', async () => {
    const touched = Array.from({ length: 50 }, (_, i) => ({ table: 'records', key: ['dayPlans', `r${i}`] }));
    await readTouched(touched);
    /* 슬라이스 1 + id 50 = 51. 곱집합은 **행 선택**의 성질이지 바인딩의 성질이 아니다 —
       호출부 상한(`probes.length <= 400`)에서 최악 400+400=800 이고 `rows.ts` 여유선과 같다. */
    expect(질의[0]!.binds).toHaveLength(51);
  });
});
