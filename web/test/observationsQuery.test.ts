/* ============================================================
   observationsQuery.test.ts — **관측이 결정을 바꾸는 자리**(I031 · 2026-08-22 발상 축).

   원장은 넷인데 읽는 곳이 「살아 있음을 보여 주는 화면」 하나뿐이었다 — 행동을 바꾸는 곳이 0.
   이 층이 하는 일은 답을 내는 것이 아니라 **「지금 답해도 되는가」**를 말하는 것이다.

   ⚠ 여기서 잠그는 것은 그 구분 셋이다:
   ① **못 쟀다**(원장 없음) ≠ **부족하다**(표본 미달) ≠ **답이 나왔다**
   ② 문턱을 새로 짓지 않는다 — `visits.SAMPLE_MIN` 을 그대로 쓴다(사본이 갈리면 조용하다)
   ③ ⚠⚠ **0이 곧 답인 질문이 있다**: 왕복쌍 0은 «두 페인을 만들 이유가 없다»는 **결론**이지
      표본 부족이 아니다. 그걸 「부족」이라 말하면 그 질문은 영원히 안 닫힌다
============================================================ */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ available: true, rows: {} as Record<string, unknown[]> }));
vi.mock('@/lib/db/sqlite', () => ({
  isDbAvailable: (): Promise<boolean> => Promise.resolve(db.available),
  isSqlitePrimary: (): boolean => true,
  execDb: (): Promise<boolean> => Promise.resolve(true),
  selectDb: (sql: string): Promise<unknown[]> => {
    for (const k of Object.keys(db.rows)) if (sql.includes(k)) return Promise.resolve(db.rows[k]);
    return Promise.resolve([]);
  },
}));

import { observationsReady } from '@/lib/observationsQuery';

const TODAY = '2026-08-22';

beforeEach(() => {
  db.available = true;
  db.rows = {};
});

describe('observationsReady — 못 쟀다 / 부족하다 / 답이 나왔다', () => {
  it('⚠⚠ 원장이 없으면 `unavailable` 이다 — 「부족」이 아니다', async () => {
    db.available = false;
    const a = await observationsReady('tab-retire', TODAY);
    expect(a).toMatchObject({ ready: false, unavailable: true });
    expect(a.why).toContain('없습니다');
  });

  it('표본 미달이면 판정 불가 — 「이 수치로 탭을 지우지 마세요」', async () => {
    db.rows = { route_visits: [{ d: 2, t: 5 }] };
    const a = await observationsReady('tab-retire', TODAY);
    expect(a.ready).toBe(false);
    expect(a.unavailable).toBe(false);
    expect(a.why).toContain('지우지 마세요');
  });

  it('문턱을 충족하면 판정 가능 — 문턱은 `visits.SAMPLE_MIN` 그대로다', async () => {
    db.rows = { route_visits: [{ d: 12, t: 60 }] };
    expect((await observationsReady('tab-retire', TODAY)).ready).toBe(true);
  });

  it('⚠⚠ 왕복쌍 0은 **답**이다 — 「두 페인은 만들 이유가 없다」(표본 부족이 아니다)', async () => {
    const a = await observationsReady('two-pane', TODAY);
    expect(a.ready).toBe(true);
    expect(a.why).toContain('만들 이유가 없습니다');
  });

  it('왕복이 실재하면 그것도 답이다', async () => {
    db.rows = {
      route_hops: [
        { from_key: 'today', to_key: 'plan', n: 5 },
        { from_key: 'plan', to_key: 'today', n: 4 },
      ],
    };
    const a = await observationsReady('two-pane', TODAY);
    expect(a.ready).toBe(true);
    expect(a.why).toContain('두 페인');
  });

  it('시각 분포가 없으면 못 쟀다 · 한 시간대뿐이면 아직 못 가른다', async () => {
    expect((await observationsReady('day-phase', TODAY)).unavailable).toBe(true);
    db.rows = { route_hops: [{ hour: 9, n: 40 }] };
    const a = await observationsReady('day-phase', TODAY);
    expect(a).toMatchObject({ ready: false, unavailable: false });
  });

  it('시간대가 흩어져 있으면 하루의 국면이 상수가 아니다', async () => {
    db.rows = {
      route_hops: [
        { hour: 8, n: 3 },
        { hour: 14, n: 4 },
        { hour: 22, n: 5 },
      ],
    };
    expect((await observationsReady('day-phase', TODAY)).ready).toBe(true);
  });

  it('⚠ 유휴 판정은 `idleVerdict` 가 소유한다 — 이 층이 문장을 새로 짓지 않는다', async () => {
    db.rows = { idle_spells: [{ d: 1, n: 0, sec: 0 }] };
    const a = await observationsReady('idle-trigger', TODAY);
    expect(a.ready).toBe(false);
    expect(a.why).toContain('판정하지 말 것');
  });
});
