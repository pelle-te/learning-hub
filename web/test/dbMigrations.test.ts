/* ============================================================
   dbMigrations.test.ts — **스키마 이행**을 검증한다(C-2 · 설계서 §5-2).

   ## 왜 필요한가 — "구축"과 "이행"은 다른 명제다

   5-B 테스트는 스키마가 **처음부터 만들어지면** 맞는지를 본다. 그건 새 사용자에게만 해당한다.
   실제 사용자의 DB 는 v1 에서 시작해 v2·v3·v4 를 **차례로 겪는다**. `ALTER TABLE` 이 하나
   틀리면 그 경로에서만 깨지고, 새로 설치한 개발자는 영원히 못 본다.

   ⚠ **클라우드로 가면 잘못된 이행이 전 기기로 복제된다.** 그리고 §9-3b 이후 이 스키마는
   로컬 SQLite 와 D1 **양쪽의 원천**이라 값이 한 번 더 올라갔다.

   ## 왜 `db.rs` 를 파싱하는가

   DDL 의 단일 원천은 `src-tauri/src/db.rs` 다(프런트가 DDL 을 들면 배포본마다 갈린다).
   여기에 SQL 을 복사해 두면 **그 사본이 진짜 스키마와 갈리는** 바로 그 문제를 테스트가
   저지르게 된다 — 이 저장소가 `rows.ts` ↔ `rows.rs` 로 이미 두 번 물린 부류다.
   그래서 원본 파일에서 읽어 낸다. 파싱이 실패하면 **테스트가 실패한다**(조용히 건너뛰지 않는다).

   ⚠ 검증 엔진은 `node:sqlite` 다. 앱은 sqlx 로 돌지만 **DDL 문법과 인덱스 사용 여부는
   SQLite 엔진의 성질**이라 여기서 확인하는 것이 유효하다. sqlx 특유의 동작(커넥션 풀·
   `database is locked`)은 원래 트랙 B 가 실디스크로 잡는 몫이고 여기 범위가 아니다.
============================================================ */
import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB_RS = fileURLToPath(new URL('../../src-tauri/src/db.rs', import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL('../../src-tauri/migrations/', import.meta.url));

interface Mig {
  version: number;
  file: string;
  sql: string;
}

/**
 * `db.rs` 가 `include_str!` 로 가리키는 `.sql` 파일들을 **선언 순서대로** 읽는다.
 *
 * ⚠ 폴더를 직접 글롭하지 않고 **`db.rs` 를 거쳐 간다.** 파일이 있어도 `db.rs` 가 안 가리키면
 * 앱은 그걸 실행하지 않기 때문이다 — 글롭하면 "테스트는 통과하는데 앱은 적용 안 하는"
 * 마이그레이션이 생길 수 있다. 검사 대상은 폴더 내용이 아니라 **앱이 실제로 도는 목록**이다.
 *
 * ⚠ 파일을 **바이트 그대로** 읽는다(`utf8`, 가공 없음). 다듬으면 체크섬 핀이 무의미해진다.
 */
function migrations(): Mig[] {
  const src = readFileSync(DB_RS, 'utf8');
  const out: Mig[] = [];
  const re = /version:\s*(\d+),[\s\S]*?include_str!\("\.\.\/migrations\/([\w.]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const file = m[2]!;
    out.push({ version: Number(m[1]), file, sql: readFileSync(MIGRATIONS_DIR + file, 'utf8') });
  }
  return out.sort((a, b) => a.version - b.version);
}

/** 마이그레이션을 v1..upto 까지 순서대로 적용한 DB. */
function applyUpTo(upto: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const mig of migrations()) {
    if (mig.version > upto) break;
    db.exec(mig.sql);
  }
  return db;
}

const names = (db: DatabaseSync, type: 'table' | 'index'): string[] =>
  (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all(type) as { name: string }[]
  ).map((r) => r.name);

const cols = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);

let all: Mig[];
beforeEach(() => {
  all = migrations();
});

/* ⚠⚠ **체크섬 핀** — 이 파일에서 가장 중요한 검사다.

   sqlx 마이그레이터는 적용한 마이그레이션의 **SHA-384 를 `_sqlx_migrations.checksum` 에
   저장하고 매 부팅에 대조**한다(실 DB 에서 확인). 텍스트가 **1바이트라도** 달라지면
   "이미 적용된 마이그레이션이 수정됐다"로 판정해 **DB 를 아예 열지 못한다** — 즉 앱이
   기존 사용자에게 죽는다.

   무서운 점은 **새 DB 에선 절대 재현되지 않는다**는 것이다. 개발자는 멀쩡히 돌아가는 걸
   보고 커밋하고, 터지는 건 데이터를 가진 사람뿐이다. 들여쓰기 한 칸·줄바꿈 CRLF 변환·
   주석 한 줄이면 충분하다.

   아래 값은 **실제 DB 에 저장된 체크섬**이다(2026-07-19 대조 확인). 이 테스트가 깨졌다면
   둘 중 하나다:
   ① 기존 마이그레이션 텍스트를 건드렸다 → **되돌려라.** 스키마를 바꾸려면 **새 버전을 추가**한다.
   ② 줄바꿈이 CRLF 로 변환됐다 → `.gitattributes` 의 `*.rs text eol=lf` 를 확인해라. */
const PINNED_CHECKSUMS: Record<number, string> = {
  1: '535af917e2ef9ca17a1c872f',
  2: 'f598f3f3bd83d6bf758ae56a',
  3: 'de83cf7ed0adad247f491ef6',
  4: '4499ebd2ce19b8897811af59',
};

describe('⚠⚠ 체크섬 핀 — 기존 마이그레이션은 불변이다', () => {
  it('적용된 마이그레이션의 SHA-384 가 실 DB 의 값과 일치한다', async () => {
    const { createHash } = await import('node:crypto');
    for (const m of all) {
      const pinned = PINNED_CHECKSUMS[m.version];
      if (!pinned) continue; // 새로 추가된 버전 — 아직 배포 전이라 핀이 없다
      const got = createHash('sha384').update(m.sql, 'utf8').digest('hex').slice(0, 24);
      expect(got, `v${m.version} 의 SQL 이 바뀌었다 — 기존 DB 가 안 열린다. 위 주석을 읽어라.`).toBe(pinned);
    }
  });

  it('줄바꿈이 LF 다 — CRLF 로 변환되면 위 체크섬이 전부 깨진다', () => {
    for (const m of all) expect(m.sql, `v${m.version} 에 CRLF 가 섞였다`).not.toContain('\r');
  });
});

describe('마이그레이션 — 파싱 자체', () => {
  it('db.rs 에서 마이그레이션을 읽어낸다(못 읽으면 이 파일 전체가 무의미하다)', () => {
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it('버전이 1부터 빠짐없이 이어진다 — 건너뛴 번호는 sqlx 가 조용히 무시한다', () => {
    expect(all.map((m) => m.version)).toEqual(all.map((_, i) => i + 1));
  });
});

describe('⚠ v1 → 최신 순차 이행', () => {
  it('전 버전이 순서대로 적용된다', () => {
    const db = applyUpTo(Number.MAX_SAFE_INTEGER);
    expect(names(db, 'table')).toContain('settings');
    db.close();
  });

  it('각 중간 버전에서도 DB 가 성립한다(어디서 멈춰도 깨지지 않는다)', () => {
    for (const m of all) {
      const db = applyUpTo(m.version);
      expect(names(db, 'table').length).toBeGreaterThan(0);
      db.close();
    }
  });
});

describe('v3 — 동기화 가능한 데이터 모델', () => {
  it('sync 대상 7테이블에 updated_at 이 붙는다', () => {
    const db = applyUpTo(3);
    for (const t of ['settings', 'completions', 'ds_map', 'records', 'summaries', 'week_alloc', 'docs']) {
      expect(cols(db, t), `${t} 에 updated_at 이 없다`).toContain('updated_at');
    }
    db.close();
  });

  it('동기화 대상이 아닌 두 테이블에는 붙지 않는다(파생값·로컬 캐시)', () => {
    const db = applyUpTo(3);
    expect(cols(db, 'meta')).not.toContain('updated_at');
    expect(cols(db, 'runtime_cache')).not.toContain('updated_at');
    db.close();
  });

  it('기존 행은 updated_at = 0 으로 이행된다 — "아주 오래된 것"이라 첫 동기화에서 상대가 이긴다', () => {
    const db = applyUpTo(2);
    db.exec(`INSERT INTO settings (key, value) VALUES ('before', '{"a":1}')`);
    // v2 상태에서 쓴 행이 v3 이행 후에도 값을 유지하고 updated_at 만 0 으로 채워지는가
    db.exec(all.find((m) => m.version === 3)!.sql);
    const row = db.prepare(`SELECT value, updated_at FROM settings WHERE key = 'before'`).get() as {
      value: string;
      updated_at: number;
    };
    expect(row.value).toBe('{"a":1}'); // ⚠ 이행이 데이터를 버리지 않는다
    expect(row.updated_at).toBe(0);
    db.close();
  });

  it('툼스톤 기본키가 (tbl,k1,k2) 이고 k2 는 기본값이 빈 문자열이다', () => {
    const db = applyUpTo(3);
    db.exec(`INSERT INTO tombstones (tbl,k1,deleted_at) VALUES ('settings','x',5)`);
    const t = db.prepare(`SELECT k2 FROM tombstones`).get() as { k2: string };
    expect(t.k2).toBe('');
    // 같은 키 재삽입이 중복이 아니라 갱신이어야 한다(diffRows 가 INSERT OR REPLACE 를 쓴다)
    db.exec(`INSERT OR REPLACE INTO tombstones (tbl,k1,k2,deleted_at) VALUES ('settings','x','',9)`);
    expect((db.prepare(`SELECT COUNT(*) c FROM tombstones`).get() as { c: number }).c).toBe(1);
    db.close();
  });
});

describe('v4 — 오프라인 큐가 물어볼 질문', () => {
  it('sync 7테이블에 updated_at 인덱스가 생긴다', () => {
    const db = applyUpTo(4);
    const idx = names(db, 'index');
    for (const t of ['settings', 'completions', 'ds_map', 'records', 'summaries', 'week_alloc', 'docs']) {
      expect(idx, `${t} 인덱스 누락`).toContain(`idx_${t}_updated`);
    }
    db.close();
  });

  it('⚠ 아웃박스 질의가 실제로 인덱스를 탄다 — 인덱스가 있어도 안 타면 의미가 없다', () => {
    const db = applyUpTo(4);
    for (const t of ['settings', 'completions', 'ds_map', 'records', 'summaries', 'week_alloc', 'docs']) {
      const plan = db
        .prepare(`EXPLAIN QUERY PLAN SELECT * FROM ${t} WHERE updated_at > ? AND updated_at <= ?`)
        .all(0, 1) as { detail: string }[];
      const detail = plan.map((p) => p.detail).join(' ');
      expect(detail, `${t}: ${detail}`).toContain(`idx_${t}_updated`);
      expect(detail, `${t} 가 풀스캔이다`).not.toMatch(/SCAN \w+(?! USING)/);
    }
    db.close();
  });

  it('sync_state 가 별도 테이블이다 — settings 에 얹으면 rows 매퍼가 청소한다', () => {
    const db = applyUpTo(4);
    expect(names(db, 'table')).toContain('sync_state');
    db.close();
  });

  it('⚠ 워터마크 upsert 가 뒤로 가지 않는다(ON CONFLICT … MAX)', () => {
    const db = applyUpTo(4);
    const up = `INSERT INTO sync_state (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = MAX(CAST(value AS INTEGER), CAST(excluded.value AS INTEGER))`;
    db.prepare(up).run('watermark', '900');
    db.prepare(up).run('watermark', '300');
    expect((db.prepare(`SELECT value FROM sync_state WHERE key='watermark'`).get() as { value: string }).value).toBe(
      '900',
    );
    db.close();
  });
});
