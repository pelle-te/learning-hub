// @vitest-environment jsdom
/* ============================================================
   cloudOutbox.test.ts — 오프라인 큐(C-1)의 안전 계약.

   여기서 잠그는 것은 전부 **조용히 깨지는** 부류다 — 앱은 정상으로 보이고, 로컬 저장도
   실제로 되고, **다른 기기에만 안 나타난다**. 화면에 증상이 없으므로 테스트가 아니면 못 잡는다.

   ① **단조 타임스탬프** — 시계가 뒤로 점프해도 발급값이 줄지 않는다. 줄면 그 편집이
      `updated_at > watermark` 질의에 영영 안 걸린다(재계산 워터마크의 유일한 급소).
   ② **상한선(fence)** — 스캔 도중 들어온 쓰기를 워터마크가 삼키지 않는다.
   ③ **실패 시 워터마크 불변** — 전송이 실패하면 같은 배치가 다음에 다시 걸린다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/* 가짜 SQLite — 질의에서 테이블 이름만 뽑아 인메모리 배열로 답한다.
   실제 SQL 엔진을 흉내내지 않는 이유: 여기서 검증할 것은 SQL 문법이 아니라 **호출 순서와
   워터마크 전진 규칙**이다(SQL 층은 `write.ts` 의 되읽기 대조가 실디스크로 검증한다). */
type Row = Record<string, unknown>;
const tables = new Map<string, Row[]>();
let syncState = new Map<string, string>();
/** 각 테이블 스캔 직전에 불리는 훅 — 스캔 도중의 쓰기를 재현할 때 쓴다. */
let onScan: ((table: string) => void) | null = null;

const exec = vi.fn(async (q: string, args: unknown[] = []) => {
  if (/INSERT INTO sync_state/i.test(q)) {
    const [key, value] = args as [string, string];
    const prev = Number(syncState.get(key) ?? 0);
    syncState.set(key, String(Math.max(prev, Number(value)))); // ON CONFLICT … MAX 재현
  }
  return undefined;
});

const select = vi.fn(async (q: string, args: unknown[] = []) => {
  if (/FROM sync_state/i.test(q)) {
    const v = syncState.get(String(args[0]));
    return v == null ? [] : [{ value: v }];
  }
  if (/FROM \(/.test(q)) {
    // readMaxStamp 의 UNION ALL 질의
    let max = 0;
    for (const rows of tables.values())
      for (const r of rows) max = Math.max(max, Number(r['updated_at'] ?? 0), Number(r['deleted_at'] ?? 0));
    return [{ m: max }];
  }
  const table = /FROM (\w+)/.exec(q)?.[1] ?? '';
  onScan?.(table);
  const [from, fence] = args as [number, number];
  const col = table === 'tombstones' ? 'deleted_at' : 'updated_at';
  return (tables.get(table) ?? [])
    .filter((r) => Number(r[col]) > from && Number(r[col]) <= fence)
    .sort((a, b) => Number(a[col]) - Number(b[col]));
});

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => ({ execute: exec, select }) },
}));

import { collectOutbox, commitWatermark, readWatermark, batchSize, OUTBOX_TABLES } from '@/lib/cloud/outbox';
import { pushOutbox, backoffDelay, PermanentPushError, isPermanent, type CloudTransport } from '@/lib/cloud/push';
import { nextStamp, seedStamp, currentStamp, chunkedStamp, _resetStamp } from '@/lib/db/stamp';
import { runExclusive } from '@/lib/db/write';
import { MAX_BATCH_ITEMS } from '@/lib/cloud/contract';

const noSleep = async (): Promise<void> => undefined;

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  tables.clear();
  syncState = new Map();
  onScan = null;
  _resetStamp();
  exec.mockClear();
  select.mockClear();
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

/* ── ① 단조 타임스탬프 ───────────────────────────────────────── */

describe('타임스탬프 발급기 — 로컬 단조', () => {
  it('연속 발급이 항상 증가한다', () => {
    const a = nextStamp();
    const b = nextStamp();
    const c = nextStamp();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('⚠ 시계가 뒤로 점프해도 발급값이 줄지 않는다 — 재계산 워터마크의 급소', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const before = nextStamp();
    expect(before).toBe(1_000_000);

    // 사용자가 시계를 1시간 되돌렸다(수동 변경·NTP 보정·듀얼부트).
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 - 3_600_000);
    const after = nextStamp();

    expect(after).toBeGreaterThan(before); // 벽시계가 아니라 직전+1 로 버틴다
  });

  it('시계가 회복되면 벽시계로 돌아온다 — 영구 드리프트를 남기지 않는다', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    nextStamp();
    vi.spyOn(Date, 'now').mockReturnValue(1_000); // 역행
    nextStamp();
    vi.spyOn(Date, 'now').mockReturnValue(9_999); // 회복
    expect(nextStamp()).toBe(9_999);
  });

  it('seedStamp 는 더 큰 값만 채택한다(재시작 후 DB 최대값 이어받기)', () => {
    seedStamp(500);
    seedStamp(100); // 더 작으면 무시
    expect(currentStamp()).toBe(500);
    vi.spyOn(Date, 'now').mockReturnValue(10); // 시계가 씨앗보다 한참 뒤
    expect(nextStamp()).toBe(501); // 이미 쓴 값을 재발급하지 않는다
  });

  it('seedStamp 는 쓰레기 입력을 무시한다', () => {
    seedStamp(null);
    seedStamp(undefined);
    seedStamp(Number.NaN);
    expect(currentStamp()).toBe(0);
  });
});

/* ── ② 아웃박스 수집 ────────────────────────────────────────── */

describe('아웃박스 — 밀어올림 대상 질의', () => {
  it('워터마크 이후 바뀐 행만 모은다', async () => {
    tables.set('settings', [
      { key: 'old', value: '{"a":1}', updated_at: 50 },
      { key: 'new', value: '{"a":2}', updated_at: 150 },
    ]);
    seedStamp(200);

    const batch = await collectOutbox(100);
    expect(batch).not.toBeNull();
    expect(batch!.rows).toHaveLength(1);
    expect(batch!.rows[0]).toMatchObject({ tbl: 'settings', key: ['new'], data: ['{"a":2}'], updatedAt: 150 });
  });

  it('기본키와 데이터 열을 테이블 정의대로 가른다(records 는 ord 도 데이터다)', async () => {
    tables.set('records', [{ slice: 'tasks', id: 't1', ord: 3, value: '{}', updated_at: 10 }]);
    seedStamp(100);

    const batch = await collectOutbox(0);
    expect(batch!.rows[0]).toMatchObject({ tbl: 'records', key: ['tasks', 't1'], data: [3, '{}'] });
  });

  it('툼스톤도 함께 모은다 — 없으면 삭제가 다른 기기에서 부활한다', async () => {
    tables.set('tombstones', [{ tbl: 'records', k1: 'tasks', k2: 't9', deleted_at: 120 }]);
    seedStamp(200);

    const batch = await collectOutbox(100);
    expect(batch!.tombstones).toEqual([{ tbl: 'records', k1: 'tasks', k2: 't9', deletedAt: 120 }]);
    expect(batchSize(batch!)).toBe(1);
  });

  it('docs 를 대상에 포함한다 — 빠지면 내 요약·독후감이 다른 기기에 아예 안 간다', () => {
    expect(OUTBOX_TABLES.map((t) => t.name)).toContain('docs');
  });

  it('meta·runtime_cache 는 대상이 아니다(파생값·로컬 캐시)', () => {
    const names = OUTBOX_TABLES.map((t) => t.name);
    expect(names).not.toContain('meta');
    expect(names).not.toContain('runtime_cache');
  });

  it('⚠ 스캔 도중 들어온 쓰기를 상한선이 잘라낸다 — 삼키면 조용한 유실', async () => {
    tables.set('settings', [{ key: 's', value: '{}', updated_at: 10 }]);
    tables.set('records', []);
    seedStamp(100);

    /* 첫 테이블(settings) 스캔 직후, 아직 안 읽은 records 에 새 편집이 들어온다.
       fence 가 없으면 이 행은 수집되지 않은 채 워터마크에 묻힌다. */
    let injected = 0;
    onScan = (t) => {
      if (t !== 'settings' || injected) return;
      injected = nextStamp(); // 스캔 시작 후 발급 → 반드시 fence 보다 크다
      tables.get('records')!.push({ slice: 'tasks', id: 'late', ord: 0, value: '{}', updated_at: injected });
    };

    const batch = await collectOutbox(0);
    onScan = null;

    expect(batch!.rows.map((r) => r.tbl)).toEqual(['settings']); // 늦게 온 행은 이번 배치에서 제외
    expect(injected).toBeGreaterThan(batch!.upto); // 워터마크 위에 남는다

    // 다음 배치가 반드시 줍는다 — 이것이 "과소 포함 없음"의 증명이다.
    const next = await collectOutbox(batch!.upto);
    expect(next!.rows.map((r) => r.key[1])).toEqual(['late']);
  });

  it('DB 미가용이면 부분 배치 대신 null — 불완전을 완전으로 착각시키지 않는다', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    expect(await collectOutbox(0)).toBeNull();
  });

  /* ⚠⚠ C4(2026-07-26 감사) — fence 가 **원리적으로 못 막는** 벡터.

     위 케이스는 *"스캔 도중에 스탬프를 받는 쓰기"*(> fence)다. 여기는 반대다: **스탬프는
     이미 받았는데 아직 커밋되지 않은 쓰기**. 수집이 쓰기와 같은 직렬화 단위 밖이면 그 창에
     끼어들어 빈 스캔을 하고, `commitWatermark(fence)` 가 그 행을 **워터마크 아래로 묻는다**
     (S ≤ W). 어떤 회차에도 다시 안 걸린다 — 무증상·영구.

     이 케이스가 재현하는 것은 `writeRows` 의 실제 모양이다: 스탬프를 먼저 발급하고
     `await db.batch(...)` 로 커밋한다. 그 사이를 `runExclusive` 가 잡고 있어야 한다. */
  it('⚠ 스탬프는 받았는데 커밋 전인 쓰기를 삼키지 않는다 — 수집도 같은 직렬화 단위', async () => {
    tables.set('settings', []);
    seedStamp(100);

    const stamp = nextStamp(); // ① 쓰기가 스탬프를 **먼저** 받는다
    let commit!: () => void;
    const committed = new Promise<void>((r) => (commit = r));
    const write = runExclusive(async () => {
      await committed; // ② 커밋이 끝날 때까지 체인을 쥐고 있다(= db.batch in-flight)
      tables.get('settings')!.push({ key: 'inflight', value: '{}', updated_at: stamp });
    });

    const collect = collectOutbox(0); // ③ 그 창에 수집이 들어온다
    setTimeout(commit, 20); // 커밋은 늦게 끝난다 — 직렬화가 없으면 스캔이 먼저 지나간다
    await write;
    const batch = await collect;

    expect(batch!.rows.map((r) => r.key[0])).toEqual(['inflight']); // 커밋 전이던 그 행이 실렸다
    expect(batch!.upto).toBeGreaterThanOrEqual(stamp); // 워터마크가 이 행을 넘어가지 않는다
  });
});

/* ── ②-b C1: 최초 이관의 단일 스탬프 그룹 ────────────────────────

   실사용자(수개월치 데이터)의 **첫 클라우드 연결**이 무증상으로 영구 차단되던 결함.
   이관 쓰기(`diffRows(null, …)`)가 전 행에 **한 스탬프**를 찍으면 그 그룹이 `MAX_BATCH_ITEMS`
   를 넘고, `capBatch` 는 그룹을 못 쪼개 통째로 내보내는데(정확성 우선) 그 배치가 스키마 상한에
   걸려 `blocked` 가 된다 — 워터마크가 안 움직여 매 회차 재차단. `chunkedStamp` 가 이관 행을
   청크마다 갈라 그룹을 상한 아래로 유지하는 것이 처방이다. */
describe('C1 — 최초 이관 스탬프 분산', () => {
  it('chunkedStamp 는 청크마다 새 단조 스탬프를 낸다', () => {
    const alloc = chunkedStamp(3);
    const got = Array.from({ length: 7 }, () => alloc());
    // 같은 청크(3건) 안은 동일, 청크가 바뀌면 증가.
    expect(got[0]).toBe(got[1]);
    expect(got[1]).toBe(got[2]);
    expect(got[3]).toBeGreaterThan(got[2]);
    expect(got[3]).toBe(got[4]);
    expect(got[6]).toBeGreaterThan(got[3]);
    // 발급기 단조성도 이어진다 — 이후 일반 편집은 더 큰 스탬프를 받는다.
    expect(nextStamp()).toBeGreaterThan(got[6]!);
  });

  it('⚠ 단일 스탬프 그룹이 상한을 넘으면 push 가 blocked 된다 — 이관이 만들면 안 되는 형태', async () => {
    const n = MAX_BATCH_ITEMS + 100;
    tables.set(
      'completions',
      Array.from({ length: n }, (_, i) => ({ ds: '2026-01-01', k: `k${i}`, value: '{}', updated_at: 100 })),
    );
    seedStamp(10_000); // fence 가 100 보다 크게
    const t = { batches: [] as unknown[], push: async (b: unknown) => void (t.batches as unknown[]).push(b) };

    const res = await pushOutbox(t, { sleep: noSleep });
    expect(res.status).toBe('blocked'); // 스키마 상한에 걸린다 — 이 형태가 결함이었다
    expect(await readWatermark()).toBe(0); // 전진하지 못한다(영구 재차단)
  });

  it('청크 스탬프로 쓰면 상한 넘는 이관도 여러 배치로 전부 나간다(blocked 없음)', async () => {
    const n = MAX_BATCH_ITEMS * 2 + 200; // 1200 행
    const chunk = 400;
    tables.set(
      'completions',
      Array.from({ length: n }, (_, i) => ({
        ds: '2026-01-01',
        k: `k${i}`,
        value: '{}',
        updated_at: 100 + Math.floor(i / chunk), // chunkedStamp 가 이관에서 만드는 스탬프 분포
      })),
    );
    seedStamp(10_000);
    const t = { batches: [] as unknown[], push: async (b: unknown) => void (t.batches as unknown[]).push(b) };

    let sent = 0;
    for (let i = 0; i < 10; i++) {
      const res = await pushOutbox(t, { sleep: noSleep });
      expect(res.status).not.toBe('blocked');
      if (res.status === 'idle') break;
      expect(res.sent).toBeLessThanOrEqual(MAX_BATCH_ITEMS); // 어떤 배치도 상한을 안 넘는다
      sent += res.sent;
    }
    expect(sent).toBe(n); // 한 건도 빠지지 않고 전부 나갔다
  });
});

/* ── ③ 워터마크 ─────────────────────────────────────────────── */

describe('워터마크', () => {
  it('없으면 0 = 아무것도 안 보냈다(전량이 대상)', async () => {
    expect(await readWatermark()).toBe(0);
  });

  it('전진한 뒤 다시 읽힌다', async () => {
    await commitWatermark(777);
    expect(await readWatermark()).toBe(777);
  });

  it('⚠ 뒤로 가지 않는다 — 늦게 도착한 옛 배치가 전진 기록을 지우면 안 된다', async () => {
    await commitWatermark(900);
    await commitWatermark(300);
    expect(await readWatermark()).toBe(900);
  });
});

/* ── ④ 밀어올리기 · 재시도 ──────────────────────────────────── */

describe('밀어올리기 — 재시도와 워터마크 전진 순서', () => {
  const okTransport = (): CloudTransport & { batches: unknown[] } => {
    const batches: unknown[] = [];
    return { batches, push: async (b) => void batches.push(b) };
  };

  it('성공하면 워터마크가 전진한다', async () => {
    tables.set('settings', [{ key: 's', value: '{}', updated_at: 10 }]);
    seedStamp(100);
    const t = okTransport();

    const res = await pushOutbox(t, { sleep: noSleep });
    expect(res.status).toBe('pushed');
    expect(res.sent).toBe(1);
    expect(res.attempts).toBe(1);
    expect(await readWatermark()).toBeGreaterThanOrEqual(10);
  });

  it('한 번 보낸 것은 다시 안 보낸다', async () => {
    tables.set('settings', [{ key: 's', value: '{}', updated_at: 10 }]);
    seedStamp(100);
    const t = okTransport();

    await pushOutbox(t, { sleep: noSleep });
    const second = await pushOutbox(t, { sleep: noSleep });
    expect(second.status).toBe('idle');
    expect(t.batches).toHaveLength(1);
  });

  it('⚠ 전송이 실패하면 워터마크가 그대로다 — 같은 배치가 다음에 다시 걸린다', async () => {
    tables.set('settings', [{ key: 's', value: '{}', updated_at: 10 }]);
    seedStamp(100);
    const dead: CloudTransport = { push: async () => Promise.reject(new Error('오프라인')) };

    const res = await pushOutbox(dead, { sleep: noSleep, maxAttempts: 3 });
    expect(res.status).toBe('failed');
    expect(res.attempts).toBe(3);
    expect(res.error).toBe('오프라인');
    expect(await readWatermark()).toBe(0); // 전진하지 않았다

    // 인터넷이 돌아오면 같은 변경이 그대로 다시 잡힌다.
    const alive = okTransport();
    const retry = await pushOutbox(alive, { sleep: noSleep });
    expect(retry.status).toBe('pushed');
    expect(retry.sent).toBe(1);
  });

  it('중간에 성공하면 그 시점에 멈춘다', async () => {
    tables.set('settings', [{ key: 's', value: '{}', updated_at: 10 }]);
    seedStamp(100);
    let calls = 0;
    const flaky: CloudTransport = {
      push: async () => {
        if (++calls < 3) throw new Error('일시 장애');
      },
    };

    const res = await pushOutbox(flaky, { sleep: noSleep, maxAttempts: 5 });
    expect(res.status).toBe('pushed');
    expect(res.attempts).toBe(3);
  });

  it('보낼 게 없으면 전송을 부르지 않는다', async () => {
    seedStamp(100);
    const t = okTransport();
    const res = await pushOutbox(t, { sleep: noSleep });
    expect(res.status).toBe('idle');
    expect(t.batches).toHaveLength(0);
  });

  it('DB 미가용이면 재시도하지 않는다(네트워크 문제가 아니다)', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const t = okTransport();
    const res = await pushOutbox(t, { sleep: noSleep });
    expect(res.status).toBe('unavailable');
    expect(res.attempts).toBe(0);
  });

  it('⚠ 재시도 불가 실패는 즉시 끊는다 — 일일 한도에 걸린 채 하루 종일 헛치면 안 된다', async () => {
    tables.set('settings', [{ key: 's', value: '{}', updated_at: 10 }]);
    seedStamp(100);
    let calls = 0;
    const quotaExhausted: CloudTransport = {
      push: async () => {
        calls++;
        throw new PermanentPushError('D1 일일 행 쓰기 한도 소진');
      },
    };

    const res = await pushOutbox(quotaExhausted, { sleep: noSleep, maxAttempts: 5 });
    expect(res.status).toBe('blocked');
    expect(res.attempts).toBe(1); // 5번이 아니라 1번에 끊었다
    expect(calls).toBe(1);
    expect(res.error).toContain('한도');
    expect(await readWatermark()).toBe(0); // 실패한 배치라 전진하지 않는다
  });

  it('평범한 오류는 여전히 재시도한다 — 네트워크 장애까지 끊으면 안 된다', async () => {
    tables.set('settings', [{ key: 's', value: '{}', updated_at: 10 }]);
    seedStamp(100);
    const flaky: CloudTransport = { push: async () => Promise.reject(new Error('ECONNRESET')) };

    const res = await pushOutbox(flaky, { sleep: noSleep, maxAttempts: 3 });
    expect(res.status).toBe('failed');
    expect(res.attempts).toBe(3);
  });

  it('isPermanent 는 클래스 상속이 아니라 표식을 본다(번들 경계를 넘어도 살아남게)', () => {
    expect(isPermanent(new PermanentPushError('x'))).toBe(true);
    expect(isPermanent({ permanent: true })).toBe(true); // 구조만 맞으면 된다
    expect(isPermanent(new Error('x'))).toBe(false);
    expect(isPermanent(null)).toBe(false);
    expect(isPermanent('permanent')).toBe(false);
  });

  it('백오프가 지수로 늘고 상한에서 멈춘다', () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 8000, random: () => 0 };
    // 지터 절반 고정이라 random()=0 이면 raw/2 가 나온다.
    expect(backoffDelay(1, opts)).toBe(500);
    expect(backoffDelay(2, opts)).toBe(1000);
    expect(backoffDelay(3, opts)).toBe(2000);
    expect(backoffDelay(9, opts)).toBe(4000); // 상한 8000 의 절반
  });

  it('지터가 최소 대기를 보장한다 — 0 이 나오지 않는다', () => {
    const opts = { baseDelayMs: 1000, random: () => 0 };
    expect(backoffDelay(1, opts)).toBeGreaterThan(0);
    expect(backoffDelay(1, { baseDelayMs: 1000, random: () => 1 })).toBe(1000);
  });
});
