/* ============================================================
   contract.test.ts — 서버 동기화 계약을 **실제 SQL 로** 검증한다(C-4).

   ## 왜 SQL 을 진짜로 돌리는가

   여기서 잠그는 것들은 전부 **SQL 의 의미론에 달려 있다.** 타입도 zod 도 못 잡는다:

   · `ON CONFLICT … WHERE excluded.updated_at >` 가 LWW 를 실제로 구현하는가
   · **행이 이미 지워졌을 때** 그 가드가 발동하는가 ← ⚠ 여기서 실제 결함이 나왔다

   ## ⚠ 이 파일이 존재하는 이유가 된 결함

   처음 구현은 `INSERT … ON CONFLICT(key) DO UPDATE … WHERE excluded.updated_at > t.updated_at`
   였다. 행이 **남아 있을 때**는 맞게 돈다. 그런데 툼스톤이 행을 지운 뒤에는 **충돌 자체가
   없어서** WHERE 가 아예 평가되지 않고, 오래된 편집이 새 행으로 조용히 들어왔다.

   그게 설계서 G2 가 금지한 **"삭제가 부활한다"** 다 — 폰에서 지운 할일이 PC 동기화 때
   돌아오는 형태. 로컬 wrangler 로 실제 요청을 쏴 보고서야 드러났다("띄워보지 않으면 모른다").

   → 해법: `INSERT … SELECT … WHERE NOT EXISTS(더 새 툼스톤)`. 두 경로를 모두 막는다.
============================================================ */
import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { capBatch, MAX_BATCH_ITEMS, OUTBOX_TABLES, tableCols } from '../../web/src/lib/cloud/contract';
import { ceilingOf, readPage } from '../src/pull';

const MIG = fileURLToPath(new URL('../../src-tauri/migrations/', import.meta.url));

/** 서버가 쓰는 것과 **같은 스키마**로 DB 를 세운다(공유 마이그레이션 폴더). */
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIG)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(MIG + f, 'utf8'));
  }
  return db;
}

/* ⚠⚠ **이 파일은 자기가 만든 SQL 을 검증하고 있었다**(H-15 · 2026-08-06 감사).

   여기 `upsertSql` 이라는 **사본**이 있었다. 그래서 `server/src/index.ts` 의 부활 가드가
   `>=` → `>` 로 바뀌어도 이 테스트는 **녹색**이었다 — 즉 "계약 테스트"가 계약을 안 보고 있었다.
   그리고 실제로 이미 갈라져 있었다: 아래 `tomb` 의 DELETE 가 `updated_at < ?` 로, H3 이 `<=` 로
   통일한 **그 전 판**이었다(동점에서 삭제↔편집이 기기별로 반대 판정 → 영구 분기).

   옛 주석은 _"Worker 핸들러가 D1 바인딩에 묶여 노드에서 직접 부를 수 없다"_ 를 이유로 들었는데,
   묶여 있는 것은 **실행**이지 SQL **생성**이 아니었다. 생성을 순수 함수로 빼면(그 주석 자신이
   _"C-5 에서 …"_ 로 예약해 뒀다) 서버·클라이언트 병합·이 테스트가 한 문장을 공유한다. */
import { deleteRowSql, UPSERT_TOMBSTONE_SQL, upsertRowSql } from '../../web/src/lib/cloud/contract';

let db: DatabaseSync;
beforeEach(() => {
  db = freshDb();
});

/** settings 에 한 행 밀어올린다 — **서버가 쓰는 바로 그 문장**(사본 아님). */
const push = (key: string, value: string, at: number): void => {
  db.prepare(upsertRowSql('settings', ['key'], ['value'])).run(key, value, at, 'settings', key, '', at);
};
/** 툼스톤 + 그보다 오래된(동점 포함) 행 삭제 — 서버 push 의 툼스톤 경로와 **같은 문장**. */
const tomb = (key: string, at: number): void => {
  db.prepare(UPSERT_TOMBSTONE_SQL).run('settings', key, '', at);
  db.prepare(deleteRowSql('settings', ['key'])).run(key, at);
};
const read = (key: string): { value: string; updated_at: number } | undefined =>
  db.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get(key) as never;

describe('행 단위 LWW', () => {
  it('더 새 편집이 이긴다', () => {
    push('k', 'old', 100);
    push('k', 'new', 200);
    expect(read('k')?.value).toBe('new');
  });

  it('⚠ 늦게 도착한 옛 편집이 새 편집을 덮지 않는다(G2)', () => {
    push('k', 'new', 200);
    push('k', 'stale', 100); // 네트워크 지연으로 순서가 뒤집힌 경우
    expect(read('k')?.value).toBe('new');
  });

  it('같은 스탬프면 기존 값을 유지한다(> 이지 >= 가 아니다)', () => {
    push('k', 'first', 100);
    push('k', 'second', 100);
    expect(read('k')?.value).toBe('first');
  });

  it('재전송(같은 값·같은 스탬프)은 무해하다 — 멱등', () => {
    push('k', 'v', 100);
    push('k', 'v', 100);
    expect(read('k')?.value).toBe('v');
  });
});

describe('⚠⚠ 삭제가 부활하지 않는다 — 이 파일이 만들어진 이유', () => {
  it('삭제보다 오래된 편집은 행을 되살리지 못한다', () => {
    push('k', 'v1', 500);
    tomb('k', 600);
    expect(read('k')).toBeUndefined();

    push('k', 'stale', 550); // ← 옛 구현은 여기서 부활시켰다(충돌이 없어 가드가 안 돈다)
    expect(read('k'), '삭제가 부활했다 — G2 위반').toBeUndefined();
  });

  it('동점이면 삭제가 이긴다 — 부활보다 삭제가 안전한 선택이다', () => {
    tomb('k', 600);
    push('k', 'same', 600);
    expect(read('k')).toBeUndefined();
  });

  it('삭제 이후의 편집은 **정당하게** 다시 만든다(재생성은 막지 않는다)', () => {
    push('k', 'v1', 500);
    tomb('k', 600);
    push('k', 'reborn', 700);
    expect(read('k')?.value).toBe('reborn');
  });

  it('툼스톤이 없는 키는 영향받지 않는다', () => {
    tomb('other', 600);
    push('k', 'v', 100);
    expect(read('k')?.value).toBe('v');
  });

  it('행이 남아 있는 채로 오래된 툼스톤이 와도 지워지지 않는다', () => {
    push('k', 'v', 700);
    tomb('k', 600); // 삭제가 편집보다 오래됨 → 지우면 안 된다
    expect(read('k')?.value).toBe('v');
  });

  /* ⚠⚠ **두 문장의 동점 규칙이 같은 방향인가**(H3 → H-15 · 2026-08-06 감사).

     위 "동점이면 삭제가 이긴다"는 **행이 없는 상태**에서 부활 가드만 본다. 그런데 동점 규칙은
     문장이 **둘**이고(부활 가드 `deleted_at >= updatedAt` · 툼스톤 DELETE `updated_at <= deletedAt`)
     엇갈리면 같은 ms 에 A=삭제·B=존재로 **영구 분기**한다 — 그게 H3 실사고다. 이 케이스가
     **행이 있는 상태**에서 DELETE 쪽 동점을 본다. 없어서 이 파일의 사본이 옛 `<` 판인 채로
     몇 달을 통과했다. */
  it('⚠⚠ 행이 **남아 있을 때도** 동점이면 삭제가 이긴다 — DELETE 가 `<` 면 여기서 갈린다', () => {
    push('k', 'v', 600);
    tomb('k', 600); // 같은 ms 에 한쪽은 편집, 다른 쪽은 삭제
    expect(read('k'), '두 동점 규칙의 방향이 엇갈리면 기기마다 다른 답이 남는다').toBeUndefined();
  });
});

describe('스키마가 계약과 맞는다', () => {
  it('동기화 대상 테이블이 전부 실재하고 updated_at 을 갖는다', () => {
    for (const spec of OUTBOX_TABLES) {
      const cols = (
        db.prepare(`PRAGMA table_info(${spec.name})`).all() as {
          name: string;
        }[]
      ).map((r) => r.name);
      expect(cols, `${spec.name} 없음`).toContain('updated_at');
      const { key, data } = tableCols(spec);
      for (const c of [...key, ...data]) expect(cols, `${spec.name}.${c} 없음`).toContain(c);
    }
  });

  it('인증 테이블이 실재한다(v5)', () => {
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(names).toContain('devices');
    expect(names).toContain('enroll_codes');
  });
});

/* ============================================================
   ⚠⚠ pull 페이지네이션 — 2026-07-20 감사가 잡은 **조용한 유실**

   종전 구현은 테이블마다 따로 LIMIT 을 걸고 `upto = max(전체 스탬프)` 를 돌려줬다. 잘린
   테이블의 남은 행이 워터마크 아래로 묻혀 **영영 전달되지 않았다** — C-1 이 fence 로 막은
   것과 같은 실패 모드의 수신 측 거울상이다. 아래가 그 시나리오를 그대로 재현한다.
============================================================ */

/** 한 테이블을 pull 규칙대로 읽는다(라우트가 하는 것과 같은 주입 형태). */
interface Rec {
  key: string;
  updatedAt: number;
}
async function pullTable(d: DatabaseSync, tbl: string, since: number, limit: number) {
  const map = (r: Record<string, unknown>): Rec => ({
    key: String(r['key']),
    updatedAt: Number(r['updated_at']),
  });
  return readPage<Rec>(
    (r) => r.updatedAt,
    async (n) =>
      (
        d
          .prepare(`SELECT key, updated_at FROM ${tbl} WHERE updated_at > ? ORDER BY updated_at LIMIT ?`)
          .all(since, n) as Record<string, unknown>[]
      ).map(map),
    async (stamp) =>
      (
        d.prepare(`SELECT key, updated_at FROM ${tbl} WHERE updated_at = ?`).all(stamp) as Record<string, unknown>[]
      ).map(map),
    limit,
  );
}

const seed = (d: DatabaseSync, tbl: string, entries: [string, number][]): void => {
  for (const [k, at] of entries) {
    d.prepare(`INSERT INTO ${tbl} (key, value, updated_at) VALUES (?, '{}', ?)`).run(k, at);
  }
};

describe('⚠⚠ pull 페이지네이션 — 잘린 소스가 워터마크를 앞지르지 않는다', () => {
  it('한 소스가 잘리면 upto 가 그 소스의 완전 지점까지만 올라간다', async () => {
    // settings: 스탬프 10·20·30 (3건) — limit 2 라 잘린다
    seed(db, 'settings', [
      ['a', 10],
      ['b', 20],
      ['c', 30],
    ]);
    // docs: 스탬프 5000 하나 — 안 잘린다
    seed(db, 'docs', [['z', 5000]]);

    const s = await pullTable(db, 'settings', 0, 2);
    const u = await pullTable(db, 'docs', 0, 2);

    expect(s.cap, 'settings 는 잘렸으니 상한이 있어야 한다').toBe(29); // 버려지는 첫 행(30) - 1
    expect(u.cap, 'docs 는 안 잘렸다').toBeNull();

    const stamps = [...s.items, ...u.items].map((r) => r.updatedAt);
    const upto = ceilingOf(
      [s.cap, u.cap].filter((x): x is number => x !== null),
      stamps,
      0,
    );

    /* ⚠ 옛 구현이라면 여기서 5000 이 나왔고, settings 의 'c'(30) 가 영영 묻혔다. */
    expect(upto, 'upto 가 잘린 소스를 앞질렀다 — c(30) 가 영영 유실된다').toBe(29);

    // 다음 라운드가 실제로 남은 것을 가져오는지 — 유실이 없다는 것의 실증.
    const next = await pullTable(db, 'settings', upto, 2);
    expect(next.items.map((r) => r.key)).toContain('c');
  });

  it('아무 소스도 안 잘리면 받은 것의 최대값까지 전진한다', async () => {
    seed(db, 'settings', [
      ['a', 10],
      ['b', 20],
    ]);
    const s = await pullTable(db, 'settings', 0, 10);
    expect(s.cap).toBeNull();
    expect(
      ceilingOf(
        [],
        s.items.map((r) => r.updatedAt),
        0,
      ),
    ).toBe(20);
  });

  it('받을 게 없으면 since 그대로다 — 전진할 근거가 없다', async () => {
    const s = await pullTable(db, 'settings', 77, 10);
    expect(s.items).toHaveLength(0);
    expect(ceilingOf([], [], 77)).toBe(77);
  });

  it('⚠ 스탬프 그룹을 절대 쪼개지 않는다 — 쪼개면 나머지가 영영 제외된다', async () => {
    // 같은 flush 가 만든 3건(스탬프 100) + 이후 1건
    seed(db, 'settings', [
      ['a', 100],
      ['b', 100],
      ['c', 100],
      ['d', 200],
    ]);
    const s = await pullTable(db, 'settings', 0, 2); // limit 2 < 그룹 크기 3

    /* 첫 그룹이 혼자 상한을 넘는다 → 통째로 준다. 여기서 2건만 주고 upto=100 을 잡으면
       남은 1건은 `updated_at > 100` 이 거짓이라 **영영 안 온다.** */
    expect(s.items.map((r) => r.key).sort()).toEqual(['a', 'b', 'c']);
    expect(s.cap).toBe(100);
  });

  it('⚠ 진행이 0 이 되지 않는다 — since 와 같은 upto 는 영구 교착이다', async () => {
    seed(db, 'settings', [
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ]);
    const s = await pullTable(db, 'settings', 0, 1);
    const upto = ceilingOf(
      s.cap !== null ? [s.cap] : [],
      s.items.map((r) => r.updatedAt),
      0,
    );
    expect(upto, 'upto 가 since 와 같으면 클라이언트가 같은 구간을 영원히 다시 묻는다').toBeGreaterThan(0);
  });

  it('⚠ 전체 건수가 클라이언트 상한을 넘지 않는다 — 넘으면 첫 전량 동기화가 교착한다', async () => {
    /* 소스가 8개인데 limit 이 소스마다 걸리므로 합계가 MAX_BATCH_ITEMS 를 넘을 수 있다.
       그러면 클라이언트의 OutboxBatchSchema 가 자기 응답을 거절해 영원히 못 받는다. */
    const rows = Array.from({ length: MAX_BATCH_ITEMS + 50 }, (_, i) => ({
      tbl: 'settings',
      key: [`k${i}`],
      data: ['{}'],
      updatedAt: i + 1,
    }));
    const capped = capBatch(rows, [], rows.length);
    expect(capped.rows.length + capped.tombstones.length).toBeLessThanOrEqual(MAX_BATCH_ITEMS);
    expect(capped.upto, '자른 뒤 upto 도 함께 내려와야 한다').toBeLessThan(rows.length);
  });
});
