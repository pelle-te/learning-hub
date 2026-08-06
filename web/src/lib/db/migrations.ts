/* ============================================================
   db/migrations.ts — 브라우저 SQLite 가 적용할 마이그레이션 목록(C-6a).

   ## ⚠ 이 파일은 SSOT 가 **아니다**

   DDL 의 단일 원천은 `src-tauri/src/db.rs` 이고, SQL 본문의 단일 원천은
   `src-tauri/migrations/*.sql` 이다. 여기는 그 파일들을 **번들에 싣기 위한 목록**일 뿐이다 —
   브라우저는 런타임에 `db.rs` 를 파싱할 수 없으므로(파일시스템이 없다) 순서를 한 번 적어야
   한다. 즉 이건 사본이 아니라 **인덱스**다: 본문은 여전히 한 곳에 있고 `?raw` 로 그대로 들어온다.

   그래도 **순서·구성은 갈릴 수 있다** — `db.rs` 에 007 이 추가됐는데 여기 안 넣으면 폰만
   옛 스키마로 돌고, 그건 조용히 틀린다. 이 저장소가 `rows.ts` ↔ `rows.rs` 로 두 번 물린
   부류라 관습에 맡기지 않는다: **`test/dbMigrations.test.ts` 가 이 배열을 `db.rs` 의
   `include_str!` 목록과 대조하고, 어긋나면 실패한다.**

   ⚠ 데스크톱(Tauri)은 이 파일을 쓰지 않는다 — `tauri-plugin-sql` 이 `db.rs` 의 목록을
   직접 적용한다. 여기는 폰 전용 경로다.
============================================================ */
import m001 from '../../../../src-tauri/migrations/001_initial.sql?raw';
import m002 from '../../../../src-tauri/migrations/002_user_docs.sql?raw';
import m003 from '../../../../src-tauri/migrations/003_sync.sql?raw';
import m004 from '../../../../src-tauri/migrations/004_outbox.sql?raw';
import m005 from '../../../../src-tauri/migrations/005_auth.sql?raw';
import m006 from '../../../../src-tauri/migrations/006_backfill_stamps.sql?raw';
import m007 from '../../../../src-tauri/migrations/007_route_visits.sql?raw';
import m008 from '../../../../src-tauri/migrations/008_day_signals.sql?raw';
import m009 from '../../../../src-tauri/migrations/009_summaries_identity.sql?raw';
import m010 from '../../../../src-tauri/migrations/010_route_hops.sql?raw';

export interface Migration {
  version: number;
  file: string;
  sql: string;
}

/** `db.rs` 의 선언 순서와 **정확히 같아야 한다**(테스트가 강제한다). */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, file: '001_initial.sql', sql: m001 },
  { version: 2, file: '002_user_docs.sql', sql: m002 },
  { version: 3, file: '003_sync.sql', sql: m003 },
  { version: 4, file: '004_outbox.sql', sql: m004 },
  { version: 5, file: '005_auth.sql', sql: m005 },
  { version: 6, file: '006_backfill_stamps.sql', sql: m006 },
  { version: 7, file: '007_route_visits.sql', sql: m007 },
  { version: 8, file: '008_day_signals.sql', sql: m008 },
  { version: 9, file: '009_summaries_identity.sql', sql: m009 },
  { version: 10, file: '010_route_hops.sql', sql: m010 },
];
