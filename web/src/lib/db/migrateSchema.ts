/* ============================================================
   db/migrateSchema.ts — 폰 SQLite 의 **스키마 이행**(D001·D011 · 2026-08-21 데이터 축).

   워커 본문(`sqlite.worker.ts`)에서 갈라 나온 이유는 하나다: **테스트가 붙는 자리를
   만들려고.** 워커는 `self.onmessage` 와 `@sqlite.org/sqlite-wasm` 을 모듈 최상위에서
   잡으므로 노드에서 부를 수 없고, 그래서 이 저장소가 폰 마이그레이션을 **한 번도**
   실행해 본 적이 없었다(규율 11-2 의 웹 판 — 로직에서 런타임 핸들을 걷어내면 그 자리가
   곧 테스트 진입점이다).

   ## ⚠ 원자성 (D001)

   각 마이그레이션의 **DDL 과 `_migrations` 기록은 한 트랜잭션 안**이다. 종전엔 두 문장이
   맨몸으로 이어져 있어서, 그 사이에 탭이 죽으면(iOS 사파리가 백그라운드 탭을 죽인다)
   다음 실행이 같은 마이그레이션을 **재실행**했다 — 전 마이그레이션이 `CREATE TABLE`
   (`IF NOT EXISTS` 아님)이라 곧바로 `table … already exists` 로 `open()` 이 throw 하고,
   `isSqlitePrimary()` 는 폰에서 여전히 참이라 **그 브라우저의 로컬 저장이 영구 불능**이
   된다(사용자가 OPFS 를 지울 방법이 없다).

   관용구는 이 파일이 발명한 것이 아니다 — 워커의 `batch` 핸들러가 **20줄 아래에서**
   같은 BEGIN/COMMIT/ROLLBACK 을 쓰면서 «워커는 단일 커넥션이라 sqlx 풀의 BEGIN 잠금
   함정이 없다»는 근거까지 적어 뒀다. 덜 중요한 쓰기에는 원자성을 주고 스키마 이행에는
   안 주고 있었을 뿐이다.

   ## ⚠ 다운그레이드 (D011)

   데스크톱은 C2 가 세 겹으로 막는데(`db.rs` 의 `is_downgrade`) 폰의 이행은 모르는 미래
   버전을 **조용히 건너뛰었다.** Worker 롤백이나 옛 `web/dist` 재배포로 구버전 번들이
   신버전 DB 를 열면, 표 재작성형 마이그레이션이 이미 지나간 뒤라 옛 열 목록으로 쓰기가
   매번 실패한다 — 조용히, 화면은 정상인 채로. 그래서 여기서 **던진다**: 조용한 파손보다
   시끄러운 정지가 낫다(`killWorker` → DB 미가용 → 화면이 말한다).
   판정은 데스크톱과 **같은 술어**다 — 적용된 최대 버전 > 번들이 아는 최대 버전.
============================================================ */
import { MIGRATIONS } from './migrations';

/** `sqlite-wasm` 의 oo1 DB 중 이 모듈이 쓰는 만큼만. */
export interface MigrateDb {
  exec(opts: { sql: string; bind?: unknown[]; rowMode?: string; returnValue?: string }): unknown;
}

/** 다운그레이드 판정 — 값 둘만 보는 순수 술어(`db.rs::is_downgrade` 의 폰 판). */
export function isDowngrade(applied: number, bundled: number): boolean {
  return applied > bundled;
}

export function migrateSchema(
  d: MigrateDb,
  list: readonly { version: number; file: string; sql: string }[] = MIGRATIONS,
): void {
  d.exec({ sql: 'CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, file TEXT NOT NULL)' });
  const applied = (
    d.exec({ sql: 'SELECT version FROM _migrations', rowMode: 'object', returnValue: 'resultRows' }) as {
      version: number;
    }[]
  ).map((r) => r.version);
  const done = new Set(applied);

  const bundled = list.reduce((max, m) => (m.version > max ? m.version : max), 0);
  const top = applied.reduce((max, v) => (v > max ? v : max), 0);
  if (isDowngrade(top, bundled)) {
    throw new Error(
      `이 앱보다 새 버전의 데이터입니다(적용 v${top} > 번들 v${bundled}). ` +
        '옛 버전으로는 열지 않습니다 — 최신 버전에서 다시 여세요.',
    );
  }

  for (const m of list) {
    if (done.has(m.version)) continue;
    /* ⚠ DDL 과 기록이 **한 트랜잭션**이다 — 둘이 갈리면 재실행이 곧 영구 파손이다(머리주석). */
    d.exec({ sql: 'BEGIN' });
    try {
      d.exec({ sql: m.sql });
      d.exec({ sql: 'INSERT INTO _migrations (version, file) VALUES (?, ?)', bind: [m.version, m.file] });
      d.exec({ sql: 'COMMIT' });
    } catch (e) {
      try {
        d.exec({ sql: 'ROLLBACK' });
      } catch {
        /* 롤백 실패는 원 오류를 가리지 않게 삼킨다(`batch` 핸들러와 같은 관용구) */
      }
      throw e;
    }
  }
}
