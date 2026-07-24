/* ============================================================
   db/sqlite.worker.ts — 폰의 SQLite 를 **워커에서** 돌린다(C-6a).

   ## 왜 워커인가 (메인 스레드가 아니라)

   OPFS 영속화의 두 경로 중 하나를 골라야 한다:

   | VFS | 영속 | COOP/COEP 헤더 | 메인 스레드 |
   | --- | --- | --- | --- |
   | `opfs` | ✅ | **필요**(SharedArrayBuffer) | ✗ |
   | `opfs-sahpool` | ✅ | 불필요 | ⚠ 브라우저마다 다르다 |

   `opfs-sahpool` 을 고른 이유는 **COOP/COEP 를 안 켜도 되기 때문**이다 — 그 헤더를 켜면
   교차 출처 리소스가 전부 막히고, 정적 자산 서빙(C-6b)에 제약이 하나 더 붙는다.
   그리고 **워커에서** 도는 이유는 `createSyncAccessHandle()` 이 사양상 워커 컨텍스트에서만
   보장되기 때문이다. 메인 스레드에서도 되는 브라우저가 있지만 그건 **브라우저 구현 사정**이라
   폰(사파리 포함)을 상대로 기댈 근거가 못 된다. 워커면 그 변수가 사라진다.

   ## ⚠ 영속에 실패하면 침묵하지 않는다

   OPFS 를 못 잡으면 `:memory:` 로 내려가는데, 그건 **새로고침 한 번에 오프라인 캐시가
   증발한다**는 뜻이다. 그래서 `open` 응답이 `durable` 을 돌려주고 화면이 그 사실을 말할 수
   있게 한다(규율: "정본을 쥔 층은 침묵하지 않는다"). 조용한 인메모리 폴백은
   "저장되는 것처럼 보이면서 아무것도 안 쓰는" 2단계-E 의 실패를 그대로 재현한다.

   ## 마이그레이션

   `migrations.ts` 의 목록을 순서대로 적용하고 `_migrations` 에 기록한다. sqlx 의
   `_sqlx_migrations` 와 **이름을 달리한 것이 의도**다 — 체크섬 의미론(SHA-384 대조)이
   다른데 같은 테이블을 쓰면 한쪽이 다른 쪽 기록을 잘못 해석한다.
============================================================ */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { MIGRATIONS } from './migrations';

/** 워커 ↔ 메인 프로토콜. `Response` 를 흉내 내지 않는다(`cloud/client.ts` 의 `Reply` 사상). */
export type DbRequest =
  | { id: number; kind: 'open' }
  | { id: number; kind: 'exec'; sql: string; bind: unknown[] }
  | { id: number; kind: 'select'; sql: string; bind: unknown[] }
  /* 여러 문장을 **한 왕복**으로. 폰에선 `exec` 한 번이 postMessage 왕복 하나라, 첫 전량
     동기화(pull 200건)나 큰 flush 가 N 번 순차 왕복이 됐다 — 그걸 1 번으로 접는다(H-1). */
  | { id: number; kind: 'batch'; stmts: { sql: string; bind: unknown[] }[] };

export type DbResponse =
  | { id: number; ok: true; kind: 'open'; durable: boolean }
  | { id: number; ok: true; kind: 'exec' }
  | { id: number; ok: true; kind: 'select'; rows: unknown[] }
  | { id: number; ok: true; kind: 'batch' }
  | { id: number; ok: false; error: string };

interface Oo1Db {
  exec(opts: { sql: string; bind?: unknown[]; rowMode?: string; returnValue?: string }): unknown;
}

let db: Oo1Db | null = null;

async function open(): Promise<boolean> {
  const sqlite3 = await sqlite3InitModule();
  let durable = false;
  try {
    const pool = await (
      sqlite3 as unknown as {
        installOpfsSAHPoolVfs(o: { name: string }): Promise<{ OpfsSAHPoolDb: new (p: string) => Oo1Db }>;
      }
    ).installOpfsSAHPoolVfs({ name: 'learning-hub' });
    db = new pool.OpfsSAHPoolDb('/learning-hub.db');
    durable = true;
  } catch (e) {
    // ⚠ 삼키지 않는다 — 호출부가 `durable:false` 를 받아 사용자에게 말한다(머리주석 참조).
    console.error('[db/worker] OPFS 를 쓸 수 없어 인메모리로 내려갑니다. 새로고침하면 캐시가 사라집니다.', e);
    db = new (sqlite3 as unknown as { oo1: { DB: new (p: string, f: string) => Oo1Db } }).oo1.DB(':memory:', 'ct');
  }
  migrate(db);
  return durable;
}

function migrate(d: Oo1Db): void {
  d.exec({ sql: 'CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, file TEXT NOT NULL)' });
  const done = new Set(
    (
      d.exec({ sql: 'SELECT version FROM _migrations', rowMode: 'object', returnValue: 'resultRows' }) as {
        version: number;
      }[]
    ).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    d.exec({ sql: m.sql });
    d.exec({ sql: 'INSERT INTO _migrations (version, file) VALUES (?, ?)', bind: [m.version, m.file] });
  }
}

self.onmessage = async (ev: MessageEvent<DbRequest>) => {
  const req = ev.data;
  const reply = (r: DbResponse): void => self.postMessage(r);
  try {
    if (req.kind === 'open') {
      const durable = await open();
      reply({ id: req.id, ok: true, kind: 'open', durable });
      return;
    }
    if (!db) throw new Error('DB 가 아직 열리지 않았습니다.');
    if (req.kind === 'select') {
      const rows = db.exec({ sql: req.sql, bind: req.bind, rowMode: 'object', returnValue: 'resultRows' }) as unknown[];
      reply({ id: req.id, ok: true, kind: 'select', rows });
      return;
    }
    if (req.kind === 'batch') {
      /* ⚠ 트랜잭션으로 감싼다 — 워커는 **단일 커넥션**이라 sqlx 풀의 `BEGIN` 잠금 함정
         (`sqlite.ts` 주석)이 없다. 그래서 폰에선 배치가 **원자적**이다: 병합 도중 실패하면
         통째로 롤백돼 부분 병합이 원리적으로 생기지 않는다(데스크톱은 풀 제약상 순차 비원자). */
      db.exec({ sql: 'BEGIN' });
      try {
        for (const s of req.stmts) db.exec({ sql: s.sql, bind: s.bind });
        db.exec({ sql: 'COMMIT' });
      } catch (e) {
        try {
          db.exec({ sql: 'ROLLBACK' });
        } catch {
          /* 롤백 실패는 원 오류를 가리지 않게 삼킨다 */
        }
        throw e;
      }
      reply({ id: req.id, ok: true, kind: 'batch' });
      return;
    }
    db.exec({ sql: req.sql, bind: req.bind });
    reply({ id: req.id, ok: true, kind: 'exec' });
  } catch (e) {
    reply({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
