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
import { OUTBOX_TABLES, tableCols } from '../../web/src/lib/cloud/contract';

const MIG = fileURLToPath(new URL('../../src-tauri/migrations/', import.meta.url));

/** 서버가 쓰는 것과 **같은 스키마**로 DB 를 세운다(공유 마이그레이션 폴더). */
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(MIG + f, 'utf8'));
  }
  return db;
}

/* ⚠ 아래 두 SQL 은 `server/src/index.ts` 의 push 핸들러와 **같은 모양**이어야 한다.
   지금 문자열이 복제돼 있는 것은 Worker 핸들러가 D1 바인딩에 묶여 있어 노드에서 직접 부를 수
   없기 때문이다. 이 테스트의 값은 "SQL 의미론이 의도대로인가"에 있고, 핸들러와의 정합은
   로컬 wrangler 요청으로 따로 확인했다. C-5 에서 SQL 생성을 순수 함수로 빼면 이 복제가 사라진다. */
function upsertSql(tbl: string, key: string[], data: string[]): string {
  const names = [...key, ...data, 'updated_at'];
  const setters = [...data, 'updated_at'].map((c) => `${c} = excluded.${c}`).join(', ');
  return `INSERT INTO ${tbl} (${names.join(',')})
          SELECT ${names.map(() => '?').join(',')}
          WHERE NOT EXISTS (
            SELECT 1 FROM tombstones WHERE tbl = ? AND k1 = ? AND k2 = ? AND deleted_at >= ?
          )
          ON CONFLICT(${key.join(',')}) DO UPDATE SET ${setters}
          WHERE excluded.updated_at > ${tbl}.updated_at`;
}

let db: DatabaseSync;
beforeEach(() => {
  db = freshDb();
});

/** settings 에 한 행 밀어올린다(서버 push 와 같은 문장). */
const push = (key: string, value: string, at: number): void => {
  db.prepare(upsertSql('settings', ['key'], ['value'])).run(key, value, at, 'settings', key, '', at);
};
/** 툼스톤 + 그보다 오래된 행 삭제(서버 push 의 툼스톤 경로와 같은 문장). */
const tomb = (key: string, at: number): void => {
  db.prepare(
    `INSERT INTO tombstones (tbl,k1,k2,deleted_at) VALUES (?,?,?,?)
     ON CONFLICT(tbl,k1,k2) DO UPDATE SET deleted_at = excluded.deleted_at
     WHERE excluded.deleted_at > tombstones.deleted_at`,
  ).run('settings', key, '', at);
  db.prepare('DELETE FROM settings WHERE key = ? AND updated_at < ?').run(key, at);
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
});

describe('스키마가 계약과 맞는다', () => {
  it('동기화 대상 테이블이 전부 실재하고 updated_at 을 갖는다', () => {
    for (const spec of OUTBOX_TABLES) {
      const cols = (db.prepare(`PRAGMA table_info(${spec.name})`).all() as { name: string }[]).map((r) => r.name);
      expect(cols, `${spec.name} 없음`).toContain('updated_at');
      const { key, data } = tableCols(spec);
      for (const c of [...key, ...data]) expect(cols, `${spec.name}.${c} 없음`).toContain(c);
    }
  });

  it('인증 테이블이 실재한다(v5)', () => {
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toContain('devices');
    expect(names).toContain('enroll_codes');
  });
});
