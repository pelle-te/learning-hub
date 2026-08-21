/* ============================================================
   phoneMigrate.test.ts — 폰 스키마 이행의 **원자성과 다운그레이드**(D001·D011 · 2026-08-21).

   이 파일 전까지 폰 마이그레이션은 **한 번도 실행된 적이 없었다.** `dbMigrations.test.ts`
   는 `MIGRATIONS` 배열이 `db.rs` 와 같은지만 대조하고(목록 검사), 실제로 그것을 순서대로
   적용하는 코드는 워커 안에 있어 노드에서 부를 수 없었다. 그래서 검사되던 명제는
   "폰이 같은 SQL 을 안다"였고, "폰이 그 SQL 을 **안전하게** 적용한다"는 아니었다.

   ⚠ 여기서 잠그는 실패는 **재실행**이다. 전 마이그레이션이 `CREATE TABLE`(`IF NOT EXISTS`
   아님)이라, DDL 은 돌고 `_migrations` 기록만 못 한 상태로 끊기면 다음 실행이 곧바로
   `already exists` 로 죽는다 — 그리고 폰엔 OPFS 를 지울 사용자 경로가 없다.

   엔진은 `node:sqlite` 다(`dbMigrations.test.ts` 와 같은 근거: DDL 문법과 트랜잭션
   의미론은 SQLite 엔진의 성질이라 wasm 이 아니어도 유효하다).
============================================================ */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrateSchema, isDowngrade, type MigrateDb } from '@/lib/db/migrateSchema';
import { MIGRATIONS } from '@/lib/db/migrations';

/** `sqlite-wasm` 의 oo1 `exec` 를 `node:sqlite` 위에 흉내 낸다(이 모듈이 쓰는 만큼만). */
function adapt(db: DatabaseSync, onExec?: (sql: string) => void): MigrateDb {
  return {
    exec(o) {
      onExec?.(o.sql);
      if (o.returnValue === 'resultRows') return db.prepare(o.sql).all(...((o.bind ?? []) as never[]));
      if (o.bind?.length) {
        db.prepare(o.sql).run(...(o.bind as never[]));
        return undefined;
      }
      db.exec(o.sql);
      return undefined;
    },
  };
}

const versions = (db: DatabaseSync): number[] =>
  (db.prepare('SELECT version FROM _migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version);

describe('폰 스키마 이행 — 원자성(D001)', () => {
  it('전 버전이 적용되고 _migrations 에 빠짐없이 기록된다', () => {
    const db = new DatabaseSync(':memory:');
    migrateSchema(adapt(db));
    expect(versions(db)).toEqual(MIGRATIONS.map((m) => m.version));
    db.close();
  });

  it('⚠⚠ 중간에 죽어도 절반 적용이 남지 않는다 — 다음 실행이 이어서 끝낸다', () => {
    const db = new DatabaseSync(':memory:');
    /* DDL 은 돌고 `_migrations` 기록만 못 한 채 죽는 상황. 비원자였다면 다음 실행이 같은
       마이그레이션을 재실행해 `table route_visits already exists` 로 죽는다(실측).

       ⚠ 리뷰(D005 아님 · D001)가 든 예 **009 로는 재현되지 않는다** — 그 파일이 마지막에
       `summaries_v9` 를 `summaries` 로 rename 해서 우연히 재실행 가능하기 때문이다.
       재현되는 것은 `CREATE TABLE` 로 **끝나는** 007·008·010·011 쪽이다. 결함의 부류는
       같고 예만 틀렸다. */
    const target = MIGRATIONS.find((m) => m.version === 7)!;
    let armed = false;
    expect(() =>
      migrateSchema(
        adapt(db, (sql) => {
          if (sql === target.sql) armed = true;
          else if (armed && sql.startsWith('INSERT INTO _migrations')) throw new Error('탭이 죽었다');
        }),
      ),
    ).toThrow('탭이 죽었다');

    expect(versions(db), '롤백됐으므로 007 은 기록되지 않는다').toEqual([1, 2, 3, 4, 5, 6]);

    // 재개 — 007 이 재실행돼도 already exists 로 죽지 않는다(앞 시도가 통째로 롤백됐으므로).
    migrateSchema(adapt(db));
    expect(versions(db)).toEqual(MIGRATIONS.map((m) => m.version));
    db.close();
  });

  it('이미 끝난 DB 에 다시 돌려도 아무것도 안 한다(멱등)', () => {
    const db = new DatabaseSync(':memory:');
    migrateSchema(adapt(db));
    const seen: string[] = [];
    migrateSchema(adapt(db, (s) => seen.push(s)));
    expect(seen.filter((s) => s.startsWith('BEGIN'))).toHaveLength(0);
    db.close();
  });
});

describe('폰 다운그레이드 가드(D011) — 데스크톱 C2 와 같은 술어', () => {
  it('적용 > 번들이면 던진다 — 조용히 건너뛰지 않는다', () => {
    const db = new DatabaseSync(':memory:');
    migrateSchema(adapt(db));
    // Worker 롤백 / 옛 dist 재배포: DB 는 v12 를 겪었는데 이 번들은 v11 까지만 안다.
    db.exec(`INSERT INTO _migrations (version, file) VALUES (99, '099_future.sql')`);
    expect(() => migrateSchema(adapt(db))).toThrow(/새 버전의 데이터/);
    db.close();
  });

  it('술어 자체', () => {
    expect(isDowngrade(12, 11)).toBe(true);
    expect(isDowngrade(11, 11)).toBe(false);
    expect(isDowngrade(0, 11)).toBe(false);
  });
});
