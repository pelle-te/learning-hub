// @vitest-environment jsdom
/* ============================================================
   observations.test.ts — **백업의 범위**를 잠근다(2026-08-20 리뷰 m-17).

   ## 왜 이 파일이 필요한가

   `lib/observations.ts` 는 H-14 가 *"관측 원장이 어떤 백업에도 없어서 재설치·오리진 이동 때
   0 이 됐다"* 를 고치려고 만든 층인데, **그 재발을 잡는 검사가 하나도 없었다**(테스트 트리
   전량에서 import 0건). 이 모듈이 조용히 빈 값을 주면 `러닝허브_*.json` 에 원장이 안 실리고
   사용자는 "저장했어요" 토스트를 받는다 — 실패가 조용한 부류다.

   ⚠ **분모를 먼저 단언한다.** 빈 결과를 성공으로 읽으면 이 파일이 정확히 그 결함을 통과시킨다
   (이 저장소가 "녹색인데 아무것도 안 쟀다"로 반복해 물린 형태).
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/** 아주 작은 표 두 개짜리 가짜 DB — SQL 을 파싱하지 않고 **의도**만 흉내 낸다. */
const visits = new Map<string, { key: string; day: string; via: string; n: number }>();
const signals = new Map<string, Record<string, unknown>>();
const exec = vi.fn(async (sql: string, args: unknown[] = []) => {
  if (/INSERT INTO route_visits/.test(sql)) {
    const [key, day, via, n] = args as [string, string, string, number];
    const k = `${key}|${day}|${via}`;
    const cur = visits.get(k);
    // ⚠ 실 SQL 의 `MAX(n, excluded.n)` 를 그대로 흉내 낸다 — 이 케이스의 핵심 계약이다.
    visits.set(k, { key, day, via, n: Math.max(cur?.n ?? 0, n) });
    return undefined;
  }
  if (/INSERT INTO day_signals/.test(sql)) {
    const [ds, pending, overdue, backlog, ankiDue, dueSoon] = args as [string, number, number, number, number, number];
    signals.set(ds, { ds, pending, overdue, backlog, anki_due: ankiDue, due_soon: dueSoon });
    return undefined;
  }
  return undefined;
});
const select = vi.fn(async (q: string) => {
  if (/FROM route_visits/.test(q)) return [...visits.values()];
  if (/FROM day_signals/.test(q)) return [...signals.values()];
  return [];
});
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => ({ execute: exec, select }) },
}));

import { exportObservations, importObservations, OBSERVATIONS_FIELD } from '@/lib/observations';

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  visits.clear();
  signals.clear();
  exec.mockClear();
  select.mockClear();
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('백업 범위 — 관측 원장이 실제로 실린다', () => {
  it('내보내기 → 가져오기 왕복에서 방문·신호가 보존된다 (H-14 가 만든 층의 존재 이유)', async () => {
    visits.set('today|2026-08-01|rail', { key: 'today', day: '2026-08-01', via: 'rail', n: 3 });
    signals.set('2026-08-01', {
      ds: '2026-08-01',
      pending: 2,
      overdue: 1,
      backlog: 4,
      anki_due: 7,
      due_soon: 5,
    });

    const out = await exportObservations();
    // ⚠ 분모 먼저 — 빈 페이로드를 성공으로 읽으면 이 케이스가 결함을 통과시킨다.
    expect(out.visits.length, '방문 원장이 백업에서 빠졌다').toBeGreaterThan(0);
    expect(out.signals.length, '신호 원장이 백업에서 빠졌다').toBeGreaterThan(0);

    const wire = JSON.parse(JSON.stringify({ [OBSERVATIONS_FIELD]: out })) as Record<string, unknown>;
    visits.clear();
    signals.clear();

    const n = await importObservations(wire[OBSERVATIONS_FIELD]);
    expect(n).toBe(2);
    const back = await exportObservations();
    expect(back.visits).toEqual(out.visits);
    expect(back.signals).toEqual(out.signals);
  });

  it('방문 수는 **깎이지 않는다** — 오래된 백업이 지금 기기의 관측을 되돌리면 그건 복원이 아니다', async () => {
    visits.set('today|2026-08-01|rail', { key: 'today', day: '2026-08-01', via: 'rail', n: 9 });
    await importObservations({ visits: [{ key: 'today', day: '2026-08-01', via: 'rail', n: 2 }], signals: [] });
    expect(visits.get('today|2026-08-01|rail')?.n, 'MAX 가 아니라 덮어쓰면 게이트가 영영 안 열린다').toBe(9);
  });

  it('키가 없는 행은 건너뛰고 나머지는 복원한다 — 파일 한 줄이 이상해도 통째로 버리지 않는다', async () => {
    const n = await importObservations({
      visits: [
        { day: '2026-08-01', via: 'rail', n: 1 },
        { key: 'items', day: '2026-08-02', via: 'palette', n: 5 },
      ],
      signals: [{ pending: 1 }, { ds: '2026-08-02', pending: 1, overdue: 0, backlog: 0, anki_due: 0, due_soon: 0 }],
    });
    expect(n).toBe(2);
    expect(visits.size).toBe(1);
    expect(signals.size).toBe(1);
  });

  it('수가 아닌 값은 0 으로 굳는다 — 손상 파일이 NaN 을 원장에 심지 않는다', async () => {
    await importObservations({
      visits: [{ key: 'today', day: '2026-08-01', via: 'rail', n: 'many' }],
      signals: [],
    });
    expect(visits.get('today|2026-08-01|rail')?.n).toBe(0);
  });

  it('객체가 아닌 입력은 0건 — 구 백업엔 `_obs` 가 없고, 그때 가져오기는 조용한 no-op 이어야 한다', async () => {
    expect(await importObservations(undefined)).toBe(0);
    expect(await importObservations('nope')).toBe(0);
    expect(await importObservations([1, 2])).toBe(0);
    expect(exec).not.toHaveBeenCalled();
  });
});
