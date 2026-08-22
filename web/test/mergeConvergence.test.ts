/* ============================================================
   mergeConvergence.test.ts — **어떤 순서로 받아도 같은 상태에 닿는가**(C054 · 2026-08-22 코드 축).

   ## 무엇을 막나 — H3 이 실제로 물린 형태

   병합 SQL 셋은 동점(같은 ms)에서 서로에게 기대고 있다(`contract.ts` §동점 규칙):
   · 부활 가드 `deleted_at >= updatedAt` — 같은 ms 면 **삭제 승**
   · 툼스톤 DELETE `updated_at <= deletedAt` — 같은 ms 면 **삭제 승**
   방향이 한쪽만 뒤집히면 같은 ms 에 A 가 삭제·B 가 편집했을 때 **A=삭제 · B=존재**로 갈리고,
   그 뒤로 양쪽 다 "동기화 완료"라 말한다 — **영구 분기**이고 화면에 아무 증상이 없다.

   실제로 사본이 셋이었고 셋째(옛 `server/test/contract.test.ts` 의 `upsertSql`)가 `<` 로
   **이미 갈라져 있었다**. 즉 이 부류는 «언젠가 생길 수 있다»가 아니라 **한 번 일어난 일**이다.

   ## ⚠ 처방과 달라진 점 — `fast-check` 를 안 쓴다

   원장의 제안은 *"시드 고정 `fast-check` 100케이스"* 였다. 두 가지 이유로 바꿨다:
   ① **새 의존이 필요 없다.** 여기서 재는 상태 공간은 «연산 n개의 순열»이라 유한하고 작다 —
      랜덤 표본 100개보다 **전수 열거**가 강하다(그리고 축소(shrinking)가 필요 없다:
      반례가 곧 순열 하나다).
   ② 더 중요한 것은 **무엇을 실행하느냐**다. 모델을 TS 로 다시 쓰면 «내 모델이 내 모델과
      일치한다»를 증명하게 된다. 그래서 `contract.ts` 의 **진짜 SQL 문자열**을 Node 내장
      `node:sqlite` 에 그대로 먹인다 — 앱이 배포에서 도는 그 문장이다.

   ⚠ `node:sqlite` 는 Node 22+ 내장이다(`package.json` 의 `engines` 가 이미 `>=22`).
   plugin-sql/sqlx 가 아니라 SQLite 자체의 의미론을 재는 것이고, 동점 규칙은 SQL 수준의 성질이다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { UPSERT_TOMBSTONE_SQL, deleteRowSql, upsertRowSql } from '@/lib/cloud/contract';

/** 한 기기가 받는 연산 하나 — 행 쓰기 또는 삭제. */
type Op = { kind: 'row'; key: string; value: string; at: number } | { kind: 'del'; key: string; at: number };

const DDL = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`,
  `CREATE TABLE tombstones (tbl TEXT, k1 TEXT, k2 TEXT, deleted_at INTEGER, PRIMARY KEY (tbl,k1,k2))`,
];

/** 연산들을 **그 순서대로** 한 기기에 적용하고 최종 상태를 돌려준다. `applyPull` 과 같은 문장·같은 순서. */
function apply(ops: Op[]): string {
  const db = new DatabaseSync(':memory:');
  for (const d of DDL) db.exec(d);
  const upsert = db.prepare(upsertRowSql('settings', ['key'], ['value']));
  const tomb = db.prepare(UPSERT_TOMBSTONE_SQL);
  const del = db.prepare(deleteRowSql('settings', ['key']));
  for (const op of ops) {
    if (op.kind === 'row') {
      upsert.run(op.key, op.value, op.at, 'settings', op.key, '', op.at);
    } else {
      /* ⚠ `applyPull` 의 순서 그대로 — 툼스톤 upsert 먼저, 그다음 오래된 행 DELETE. */
      tomb.run('settings', op.key, '', op.at);
      del.run(op.key, op.at);
    }
  }
  const rows = db.prepare(`SELECT key, value, updated_at FROM settings ORDER BY key`).all();
  const tombs = db.prepare(`SELECT k1, deleted_at FROM tombstones ORDER BY k1`).all();
  db.close();
  return JSON.stringify({ rows, tombs });
}

/** 전수 순열. n! 이라 n ≤ 6 에서만 쓴다(6! = 720). */
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i++) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) out.push([xs[i]!, ...p]);
  }
  return out;
}

/** 모든 순열이 같은 최종 상태에 닿는가. 아니면 갈린 순열 둘을 보여 준다. */
function 수렴하는가(ops: Op[]): { ok: true } | { ok: false; a: Op[]; b: Op[]; sa: string; sb: string } {
  const perms = permutations(ops);
  const base = apply(perms[0]!);
  for (const p of perms.slice(1)) {
    const got = apply(p);
    if (got !== base) return { ok: false, a: perms[0]!, b: p, sa: base, sb: got };
  }
  return { ok: true };
}

const 요약 = (r: { a: Op[]; b: Op[]; sa: string; sb: string }): string =>
  `순서 A=${JSON.stringify(r.a)} → ${r.sa}\n순서 B=${JSON.stringify(r.b)} → ${r.sb}`;

describe('병합 수렴 — 받는 순서가 최종 상태를 바꾸지 않는다(C054)', () => {
  it('⚠⚠ **동점**(같은 ms)에 삭제와 편집이 겹쳐도 수렴한다 — H3 이 실제로 물린 그 형태', () => {
    const r = 수렴하는가([
      { kind: 'del', key: 'a', at: 100 },
      { kind: 'row', key: 'a', value: 'B가쓴것', at: 100 },
    ]);
    expect(r.ok, r.ok ? '' : `동점에서 순서가 결과를 바꾼다 — 두 기기가 영구 분기한다\n${요약(r)}`).toBe(true);
  });

  it('동점 규칙이 **삭제 승**이다 — 방향이 뒤집히면 위 케이스가 우연히 통과할 수도 있다', () => {
    const s = JSON.parse(
      apply([
        { kind: 'row', key: 'a', value: 'x', at: 100 },
        { kind: 'del', key: 'a', at: 100 },
      ]),
    );
    expect(s.rows, '같은 ms 에서 편집이 이겼다 — contract.ts 의 두 문장이 엇갈렸는가').toEqual([]);
  });

  it('편집이 삭제보다 **새로우면** 되살아난다 — 부활 가드가 과하게 넓지 않다', () => {
    const s = JSON.parse(
      apply([
        { kind: 'del', key: 'a', at: 100 },
        { kind: 'row', key: 'a', value: 'x', at: 101 },
      ]),
    );
    expect(
      s.rows.map((r: { value: string }) => r.value),
      'G2 가 금지한 것은 **오래된** 편집의 부활이다',
    ).toEqual(['x']);
  });

  it('삭제·편집·재편집이 섞인 6연산의 **전수 순열**(720가지)이 한 상태로 수렴한다', () => {
    const r = 수렴하는가([
      { kind: 'row', key: 'a', value: 'a1', at: 100 },
      { kind: 'del', key: 'a', at: 100 }, // 동점
      { kind: 'row', key: 'a', value: 'a2', at: 102 },
      { kind: 'row', key: 'b', value: 'b1', at: 101 },
      { kind: 'del', key: 'b', at: 103 },
      { kind: 'row', key: 'b', value: 'b0', at: 99 }, // 삭제보다 **오래된** 편집(부활 시도)
    ]);
    expect(r.ok, r.ok ? '' : `인터리브가 최종 상태를 바꾼다\n${요약(r)}`).toBe(true);
  });

  it('⚠ 여러 키가 서로를 오염시키지 않는다 — 툼스톤 키(tbl,k1,k2)가 좁은가', () => {
    const r = 수렴하는가([
      { kind: 'del', key: 'a', at: 100 },
      { kind: 'row', key: 'b', value: 'b', at: 100 },
      { kind: 'row', key: 'a', value: 'a', at: 99 },
      { kind: 'del', key: 'b', at: 101 },
    ]);
    expect(r.ok, r.ok ? '' : `키가 섞였다\n${요약(r)}`).toBe(true);
  });

  it('⚠ 이 테스트가 실제로 갈림을 잡을 수 있다 — 동점 규칙 한쪽을 뒤집어 확인한다', () => {
    /* 부활 가드만 `>` 로 (= 동점에서 편집 승) 되돌린 판. 툼스톤 DELETE 는 `<=`(삭제 승) 그대로다.
       `contract.ts` 가 경고한 "방향이 엇갈리면" 상태를 손으로 재현해 **검출력**을 증명한다. */
    const 갈린upsert = upsertRowSql('settings', ['key'], ['value']).replace('deleted_at >= ?', 'deleted_at > ?');
    const run = (ops: Op[]): string => {
      const db = new DatabaseSync(':memory:');
      for (const d of DDL) db.exec(d);
      const up = db.prepare(갈린upsert);
      const tomb = db.prepare(UPSERT_TOMBSTONE_SQL);
      const del = db.prepare(deleteRowSql('settings', ['key']));
      for (const op of ops) {
        if (op.kind === 'row') up.run(op.key, op.value, op.at, 'settings', op.key, '', op.at);
        else {
          tomb.run('settings', op.key, '', op.at);
          del.run(op.key, op.at);
        }
      }
      const rows = db.prepare(`SELECT key, value FROM settings ORDER BY key`).all();
      db.close();
      return JSON.stringify(rows);
    };
    const A = run([
      { kind: 'del', key: 'a', at: 100 },
      { kind: 'row', key: 'a', value: 'x', at: 100 },
    ]);
    const B = run([
      { kind: 'row', key: 'a', value: 'x', at: 100 },
      { kind: 'del', key: 'a', at: 100 },
    ]);
    expect(A, '한쪽을 뒤집었는데도 같다면 이 테스트는 아무것도 못 잡는다').not.toBe(B);
  });
});
