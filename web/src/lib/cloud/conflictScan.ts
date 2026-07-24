/* ============================================================
   cloud/conflictScan.ts — 병합 **직전** 로컬 상태를 읽어 충돌을 스캔한다(IO 층).

   `conflicts.ts` 는 순수 판정만 한다(시계·DB 모름). 이 파일이 그 판정에 필요한 두 입력 —
   ① 들어온 키들의 **현재 로컬 값**(병합 전) ② detectedAt(시계) — 을 채운다.

   ## ⚠ merge.ts 를 건드리지 않는다

   `run.ts` 가 `applyPull(incoming)` **전에** 이걸 부른다. 그 시점 로컬 SQLite 는 아직 병합-전
   이라, 여기서 읽은 값이 곧 "덮이기 직전의 로컬 값"이다. 병합의 LWW SQL(불변식)은 그대로 두고
   관찰만 얹는 것 — 델리킷한 병합 순서에 손대지 않는 이유다(`sync-core-audit`).
============================================================ */
import { selectDb } from '../db/sqlite';
import { OUTBOX_TABLES, tableCols, type OutboxBatch, type OutboxRow } from './contract';
import { detectConflicts, snapKey, type ConflictShadow, type LocalSnapshot } from './conflicts';

const SPEC = new Map(OUTBOX_TABLES.map((t) => [t.name, t]));

/**
 * 받아온 배치가 LWW 로 조용히 덮을 **동시 편집**을 스캔해 그림자로 돌려준다.
 * 부작용 없음(읽기 전용). 실패(널 결과)는 빈 배열로 흡수한다 — 관측 기능이 병합을 막으면 안 된다.
 */
export async function scanConflicts(batch: OutboxBatch, pullMark: number): Promise<ConflictShadow[]> {
  if (!batch.rows.length) return [];

  // 들어온 행을 테이블별로 모아 현재 로컬 행을 한 테이블당 한 번의 SELECT 로 읽는다.
  const byTable = new Map<string, OutboxRow[]>();
  for (const r of batch.rows) {
    const arr = byTable.get(r.tbl);
    if (arr) arr.push(r);
    else byTable.set(r.tbl, [r]);
  }

  const local: LocalSnapshot = new Map();
  for (const [tbl, rows] of byTable) {
    const spec = SPEC.get(tbl);
    if (!spec) continue; // 스키마가 이미 걸렀어야 한다(방어적)
    const { key, data } = tableCols(spec);
    const sel = [...key, ...data, 'updated_at'].join(',');
    /* 1열 키는 그대로, 2열 키는 첫 열로 좁히고 아래에서 완전키로 매칭한다(같은 k1 을 공유하는
       소수 행을 함께 읽는 정도라 비용이 작다). 테이블·열 이름은 우리 계약(OUTBOX_TABLES)에서
       오므로 병합 SQL 과 같은 방식으로 직접 끼운다(사용자 입력 아님). */
    const k1s = [...new Set(rows.map((r) => r.key[0] ?? ''))];
    const placeholders = k1s.map(() => '?').join(',');
    const res = await selectDb<Record<string, unknown>>(
      `SELECT ${sel} FROM ${tbl} WHERE ${key[0]} IN (${placeholders})`,
      k1s,
    );
    if (!res) continue;
    for (const row of res) {
      const kvals = key.map((c) => String(row[c] ?? ''));
      local.set(snapKey(tbl, kvals), {
        data: data.map((c) => row[c]),
        updatedAt: Number(row['updated_at'] ?? 0),
      });
    }
  }

  return detectConflicts(batch, local, pullMark, Date.now());
}
