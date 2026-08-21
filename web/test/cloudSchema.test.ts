/* ============================================================
   cloudSchema.test.ts — 신뢰 경계 계약(C-2 · P0-3) + 배치 분할 규칙.

   여기서 잠그는 것은 **거부해야 할 것을 거부하는가**다. 다른 경계 테스트
   (`boundaryParse.test.ts`)와 **정책이 정반대**라는 점이 핵심이다 — 거기선 어긋난 산출물을
   경고만 하고 통과시키는 것이 계약이고, 여기선 **거부가 목적 그 자체**다.

   그리고 `capBatch` — 상한을 넣으면 반드시 따라와야 하는 분할 규칙이다. 스탬프 그룹
   한가운데를 자르면 나머지가 영영 안 올라간다(조용한 유실).
============================================================ */
import { describe, expect, it } from 'vitest';
import { OutboxBatchSchema, TableNameSchema, parseInboundBatch, parseOutboxBatch } from '@/lib/cloud/schema';
import { capBatch, MAX_BATCH_ITEMS, OUTBOX_TABLES, type OutboxRow, type OutboxTomb } from '@/lib/cloud/outbox';

/** 계약을 만족하는 최소 배치. 각 테스트가 여기서 한 군데만 망가뜨린다. */
const ok = () => ({
  since: 100,
  upto: 200,
  rows: [{ tbl: 'settings', key: ['k'], data: ['{"a":1}'], updatedAt: 150 }],
  tombstones: [{ tbl: 'records', k1: 'tasks', k2: 't1', deletedAt: 160 }],
});

const fails = (b: unknown): string => {
  const r = parseOutboxBatch(b);
  expect(r.ok, '거부돼야 하는데 통과했다').toBe(false);
  return r.ok ? '' : r.error;
};

describe('OutboxBatchSchema — 통과해야 하는 것', () => {
  it('정합한 배치는 통과한다', () => {
    const r = parseOutboxBatch(ok());
    expect(r.ok).toBe(true);
  });

  it('빈 배치도 정합하다(보낼 게 없는 상태)', () => {
    expect(parseOutboxBatch({ since: 5, upto: 5, rows: [], tombstones: [] }).ok).toBe(true);
  });

  it('records 는 데이터 열이 2개다(ord + value) — 테이블마다 길이가 다르다', () => {
    const b = { ...ok(), rows: [{ tbl: 'records', key: ['tasks', 'id1'], data: [3, '{}'], updatedAt: 150 }] };
    expect(parseOutboxBatch(b).ok).toBe(true);
  });
});

describe('⚠ OutboxBatchSchema — 거부해야 하는 것', () => {
  it('모르는 테이블 이름을 거부한다 — 서버가 이 값을 SQL 테이블명으로 쓴다(인젝션 경로)', () => {
    const b = { ...ok(), rows: [{ tbl: 'users; DROP TABLE settings', key: ['k'], data: ['x'], updatedAt: 150 }] };
    expect(fails(b)).toBeTruthy();
  });

  it('동기화 대상이 아닌 테이블도 거부한다(meta·runtime_cache)', () => {
    for (const tbl of ['meta', 'runtime_cache']) {
      expect(fails({ ...ok(), rows: [{ tbl, key: ['k'], data: ['x'], updatedAt: 150 }] })).toBeTruthy();
    }
  });

  it('⚠ 데이터 열 개수가 안 맞으면 거부한다 — 통과시키면 열이 밀린 채 upsert 된다', () => {
    const b = { ...ok(), rows: [{ tbl: 'records', key: ['tasks', 'id1'], data: ['{}'], updatedAt: 150 }] };
    expect(fails(b)).toContain('데이터 열');
  });

  it('기본키 개수가 안 맞으면 거부한다', () => {
    const b = { ...ok(), rows: [{ tbl: 'records', key: ['tasks'], data: [1, '{}'], updatedAt: 150 }] };
    expect(fails(b)).toContain('기본키');
  });

  it('NaN·Infinity 타임스탬프를 거부한다 — 워터마크 비교를 오염시킨다', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      const b = { ...ok(), rows: [{ tbl: 'settings', key: ['k'], data: ['x'], updatedAt: bad }] };
      expect(fails(b), `${bad} 가 통과했다`).toBeTruthy();
    }
  });

  it('모르는 필드를 거부한다(.strict()) — passthrough 면 서버가 안 보는 데이터를 받는다', () => {
    expect(fails({ ...ok(), 겉도는필드: 1 })).toBeTruthy();
    const b = { ...ok(), rows: [{ tbl: 'settings', key: ['k'], data: ['x'], updatedAt: 150, sneak: true }] };
    expect(fails(b)).toBeTruthy();
  });

  it('upto < since 를 거부한다', () => {
    expect(fails({ since: 200, upto: 100, rows: [], tombstones: [] })).toContain('작다');
  });

  it('⚠ fence 계약 — (since, upto] 밖의 행을 거부한다', () => {
    // since 와 정확히 같은 값은 "이미 보낸 것"이라 들어오면 안 된다(경계가 배타적)
    expect(fails({ ...ok(), rows: [{ tbl: 'settings', key: ['k'], data: ['x'], updatedAt: 100 }] })).toContain(
      '밖이다',
    );
    // upto 를 넘는 것도 안 된다 — 워터마크를 전진시키면 그 행이 거짓으로 "보냄" 처리된다
    expect(fails({ ...ok(), rows: [{ tbl: 'settings', key: ['k'], data: ['x'], updatedAt: 999 }] })).toContain(
      '밖이다',
    );
    // 툼스톤도 같은 규칙
    expect(fails({ ...ok(), tombstones: [{ tbl: 'settings', k1: 'a', k2: '', deletedAt: 5 }] })).toContain('밖이다');
  });

  it('단일키 테이블인데 k2 가 차 있으면 거부한다(db.rs v3 규약)', () => {
    const b = { ...ok(), tombstones: [{ tbl: 'settings', k1: 'a', k2: '엉뚱', deletedAt: 150 }] };
    expect(fails(b)).toContain('단일키');
  });

  it('배치 상한을 넘으면 거부한다 — 서버 CPU 한도에서 죽으면 "타임아웃"으로만 보인다', () => {
    const rows = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => ({
      tbl: 'settings',
      key: [`k${i}`],
      data: ['x'],
      updatedAt: 150,
    }));
    expect(fails({ since: 100, upto: 200, rows, tombstones: [] })).toContain('상한');
  });

  it('배열이 아닌 것·null 을 거부한다(throw 하지 않고)', () => {
    for (const junk of [null, undefined, 42, '문자열', [], { since: 1 }]) {
      expect(parseOutboxBatch(junk).ok, `${String(junk)} 가 통과했다`).toBe(false);
    }
  });
});

describe('스키마가 명세에서 파생된다 — 손으로 다시 적지 않는다', () => {
  it('허용 테이블 목록이 OUTBOX_TABLES 와 정확히 일치한다', () => {
    const allowed = OUTBOX_TABLES.map((t) => t.name).sort();
    for (const n of allowed) expect(TableNameSchema.safeParse(n).success, `${n} 이 거부됐다`).toBe(true);
    expect(TableNameSchema.safeParse('meta').success).toBe(false);
  });

  it('docs 가 포함된다 — 빠지면 내 요약·독후감이 다른 기기에 안 간다', () => {
    expect(TableNameSchema.safeParse('docs').success).toBe(true);
  });
});

/* ── capBatch — 상한과 분할 규칙 ───────────────────────────── */

const row = (stamp: number, i = 0): OutboxRow => ({
  tbl: 'settings',
  key: [`k${stamp}-${i}`],
  data: ['x'],
  updatedAt: stamp,
});
const tomb = (stamp: number): OutboxTomb => ({ tbl: 'settings', k1: `d${stamp}`, k2: '', deletedAt: stamp });

describe('capBatch — 배치 분할', () => {
  it('상한 이하면 그대로 두고 워터마크는 fence 까지 간다', () => {
    const r = capBatch([row(10), row(20)], [], 999);
    expect(r.rows).toHaveLength(2);
    expect(r.upto).toBe(999);
    expect(r.oversized).toBe(false);
  });

  it('상한을 넘으면 앞부분만 담고 upto 를 거기 맞춘다', () => {
    const rows = [row(10), row(20), row(30), row(40)];
    const r = capBatch(rows, [], 999, 2);
    expect(r.rows.map((x) => x.updatedAt)).toEqual([10, 20]);
    expect(r.upto).toBe(20); // fence(999) 가 아니라 실제로 담은 마지막 스탬프
  });

  it('⚠ 스탬프 그룹을 절대 쪼개지 않는다 — 쪼개면 나머지가 영영 안 올라간다', () => {
    // 스탬프 10 이 3건. 상한이 2라도 10을 반만 담아선 안 된다.
    const rows = [row(10, 1), row(10, 2), row(10, 3), row(20)];
    const r = capBatch(rows, [], 999, 2);
    // 첫 그룹이 혼자 상한을 넘으므로 통째로 담는다(상한보다 정확성이 우선)
    expect(r.rows.map((x) => x.updatedAt)).toEqual([10, 10, 10]);
    expect(r.upto).toBe(10);
    expect(r.oversized).toBe(true);
    // 잘린 나머지는 다음 배치에서 반드시 잡힌다
    expect(rows.filter((x) => x.updatedAt > r.upto)).toHaveLength(1);
  });

  it('⚠ 첫 그룹이 상한을 넘어도 빈 배치를 만들지 않는다 — 빈 배치는 영구 교착이다', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(50, i));
    const r = capBatch(rows, [], 999, 3);
    expect(r.rows).toHaveLength(10);
    expect(r.upto).toBe(50);
    expect(r.oversized).toBe(true);
  });

  it('행과 툼스톤이 스탬프 공간을 공유한다 — 같은 flush 가 둘 다 낸다', () => {
    // 스탬프 10 에 행 2 + 툼스톤 2 = 4건. 상한 3이면 그룹째 담긴다.
    const r = capBatch([row(10, 1), row(10, 2), row(20)], [tomb(10), tomb(10)], 999, 3);
    expect(r.rows.map((x) => x.updatedAt)).toEqual([10, 10]);
    expect(r.tombstones).toHaveLength(2);
    expect(r.upto).toBe(10); // 20 은 다음 배치로
  });

  it('여러 그룹을 상한까지 채운다', () => {
    const rows = [row(10, 1), row(10, 2), row(20, 1), row(20, 2), row(30)];
    const r = capBatch(rows, [], 999, 4);
    expect(r.rows.map((x) => x.updatedAt)).toEqual([10, 10, 20, 20]);
    expect(r.upto).toBe(20);
    expect(r.oversized).toBe(false);
  });

  it('잘린 배치도 스키마를 통과한다 — 상한과 계약이 서로 어긋나면 안 된다', () => {
    const rows = Array.from({ length: MAX_BATCH_ITEMS + 50 }, (_, i) => row(i + 1, i));
    const r = capBatch(rows, [], 99999);
    const parsed = parseOutboxBatch({ since: 0, upto: r.upto, rows: r.rows, tombstones: r.tombstones });
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
  });
});

describe('스키마와 아웃박스가 같은 계약을 본다', () => {
  it('OutboxBatchSchema 가 통과시킨 것은 OutboxBatch 타입으로 쓸 수 있다', () => {
    const r = OutboxBatchSchema.safeParse(ok());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.rows[0]!.tbl).toBe('settings');
      expect(r.data.upto).toBe(200);
    }
  });
});

/* ============================================================
   ⚠⚠ **수신 관용**(H16 · D002) — 이 방향은 정책이 정반대다.

   위 케이스들은 «거부가 목적»이지만 `parseInboundBatch`(pull)는 그러면 안 된다: 배치를
   통째로 거부하면 `pullMark` 가 전진하지 않고, 그 기기의 **수신이 영구 정지**한다(화면은
   `failed` 토스트 한 줄이고 «다음 시도에 다시»라고 말한다 — 거짓이다).

   ⚠ 이 함수엔 테스트가 **한 건도 없었다**(2026-08-21 실측). H16 이 만든 관용은 `tbl` 축만
   덮었고, D002 가 발견한 것은 **열 개수 축이 비어 있다**는 것이다 — 그리고 그 축은 가설이
   아니라 009(`summaries` 를 `(sid,ord)` → `(sid,id,ord)`)로 이미 한 번 지나갔다.
============================================================ */
describe('parseInboundBatch — 관용은 경계에만, 내용엔 없다', () => {
  const 봉투 = (rows: unknown[], tombstones: unknown[] = []) => ({ since: 100, upto: 200, rows, tombstones });
  const 정상 = { tbl: 'settings', key: ['k'], data: ['{"a":1}'], updatedAt: 150 };

  it('모르는 테이블은 버리고 나머지를 살린다(H16)', () => {
    const r = parseInboundBatch(봉투([정상, { tbl: '미래표', key: ['x'], data: ['y'], updatedAt: 150 }]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropped).toBe(1);
    expect(r.batch.rows).toHaveLength(1);
    expect(r.batch.upto, '버린 구간을 되묻지 않는다 — upto 는 전진한다').toBe(200);
  });

  it('⚠⚠ 아는 테이블인데 **열 개수가 다르면** 그 행만 버린다(D002)', () => {
    // 009 이전 구성의 `summaries` 를 신버전 서버가 보내온 형태(열이 하나 늘었다).
    const 신형 = { tbl: 'summaries', key: ['sid', 'id1'], data: [0, '{}'], updatedAt: 150 };
    const 구형 = { tbl: 'summaries', key: ['sid'], data: [0, '{}'], updatedAt: 150 };
    const r = parseInboundBatch(봉투([정상, 구형]));
    expect(r.ok, '종전엔 배치 전량이 거부돼 수신이 영구 정지했다').toBe(true);
    if (!r.ok) return;
    expect(r.dropped).toBe(1);
    expect(r.batch.rows).toEqual([정상]);
    // 반대로 계약에 맞는 행은 그대로 통과한다(관용이 내용까지 느슨해지지 않았다).
    const r2 = parseInboundBatch(봉투([신형]));
    expect(r2.ok && r2.dropped).toBe(0);
  });

  it('기본키 개수가 다른 행도 같은 축이다 — 버리되 배치는 살린다', () => {
    const r = parseInboundBatch(봉투([정상, { tbl: 'settings', key: ['a', 'b'], data: ['{}'], updatedAt: 150 }]));
    expect(r.ok && r.dropped).toBe(1);
  });

  it('⚠ 살아남은 항목의 검사는 한 글자도 느슨해지지 않는다 — 이상한 스탬프는 여전히 거부', () => {
    const r = parseInboundBatch(봉투([{ tbl: 'settings', key: ['k'], data: ['{}'], updatedAt: -1 }]));
    expect(r.ok, '관용은 *경계*에만 있고 *내용*엔 없다').toBe(false);
  });

  it('툼스톤은 열 구성이 고정이라 tbl 만 본다 — k2 규약은 엄격 스키마가 지킨다', () => {
    const ok1 = parseInboundBatch(봉투([], [{ tbl: 'records', k1: 'tasks', k2: 't1', deletedAt: 160 }]));
    expect(ok1.ok).toBe(true);
    const bad = parseInboundBatch(봉투([], [{ tbl: 'settings', k1: 'k', k2: '있으면안됨', deletedAt: 160 }]));
    expect(bad.ok, '단일키 표의 k2 는 빈 문자열이어야 한다(db.rs v3)').toBe(false);
  });
});
