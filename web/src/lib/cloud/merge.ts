/* ============================================================
   cloud/merge.ts — 서버에서 받아온 변경을 **로컬 정본에 병합**한다(C-5).

   ## ⚠ 이 파일의 어려움은 SQL 이 아니라 **순서**다

   받아온 행을 로컬 SQLite 에 쓰는 것만으로는 부족하다. 이 앱에는 같은 데이터의 사본이
   **셋** 있고, 하나만 갱신하면 나머지가 그걸 되돌린다:

   ① SQLite(정본) ② `sqlite.ts` 의 `_last`(증분 diff 기준선) ③ zustand 의 메모리 상태

   `_last` 를 안 고치면 다음 저장의 diff 가 **낡은 기준선**과 비교돼 받아온 변경을 되돌리는
   문장을 만든다. 메모리를 안 고치면 다음 flush 가 낡은 메모리로 정본을 덮는다 —
   **0단계-E 에서 이미 물린 부류다**(*낡은 메모리가 복원본을 덮는다*). 그때 배운 교훈이
   `sync.ts` 의 `kind:'local'` 방송이었고, 여기가 그 교훈이 재현되는 자리다.

   그래서 계약이 이렇다: `applyPull()` 이 ①②를 하고 **③에 쓸 상태를 돌려준다.**
   호출부는 그걸 `loadState()` 에 넣는다. ②를 먼저 맞춰 두므로 `loadState` 안의 flush 는
   diff 가 비어 **아무것도 쓰지 않는다** — 받아온 행에 새 스탬프가 찍혀 서버로 되돌아가는
   에코가 그래서 안 생긴다.

   ## ⚠ 받아온 것도 신뢰하지 않는다

   서버 응답은 네트워크를 건너온다. `OutboxBatchSchema` 로 **똑같이 검증**한다 — 우리 서버라고
   믿고 넘기면 그건 `lib/tauri.ts` 의 비차단 정책을 신뢰 경계에 잘못 적용하는 것이다.
============================================================ */
import { execDb } from '../db/sqlite';
import { readRows, setDiffBaseline } from '../db/sqlite';
import { rowsToState } from '../db/rows';
import { seedStamp } from '../db/stamp';
import type { AppState } from '../types';
import { OUTBOX_TABLES, tableCols, type OutboxBatch } from './contract';

const SPEC = new Map(OUTBOX_TABLES.map((t) => [t.name, t]));

export interface MergeResult {
  /** 메모리에 실을 새 상태. 호출부가 `loadState()` 에 넣어야 완결된다. */
  state: AppState | null;
  /** 실제로 적용한 문장 수(0이면 받아올 게 없었다). */
  applied: number;
}

/**
 * 받아온 배치를 로컬 SQLite 에 병합한다. **행 단위 LWW + 툼스톤 가드**로 서버와 같은 규칙이다.
 *
 * ⚠ 서버(`server/src/index.ts`)와 **같은 SQL 모양**이어야 한다. 한쪽만 고치면 기기마다
 * 병합 결과가 갈린다 — 그게 이 프로젝트에서 가장 비싼 종류의 버그다(재현이 기기 의존).
 */
export async function applyPull(batch: OutboxBatch): Promise<MergeResult> {
  let applied = 0;

  for (const r of batch.rows) {
    const spec = SPEC.get(r.tbl);
    if (!spec) continue; // 스키마가 이미 걸렀어야 한다(방어적)
    const { key, data } = tableCols(spec);
    const names = [...key, ...data, 'updated_at'];
    const setters = [...data, 'updated_at'].map((c) => `${c} = excluded.${c}`).join(', ');
    const k1 = r.key[0] ?? '';
    const k2 = key.length === 2 ? (r.key[1] ?? '') : '';
    /* ⚠ 툼스톤 가드가 `ON CONFLICT` 만으로는 안 된다 — 행이 이미 지워졌으면 **충돌이 없어**
       LWW 조건이 평가되지 않고 오래된 편집이 부활한다. 서버에서 실측으로 잡은 결함이고
       (`server/test/contract.test.ts`), 로컬 병합도 같은 함정을 그대로 갖는다. */
    const ok = await execDb(
      `INSERT INTO ${spec.name} (${names.join(',')})
       SELECT ${names.map(() => '?').join(',')}
       WHERE NOT EXISTS (
         SELECT 1 FROM tombstones WHERE tbl = ? AND k1 = ? AND k2 = ? AND deleted_at >= ?
       )
       ON CONFLICT(${key.join(',')}) DO UPDATE SET ${setters}
       WHERE excluded.updated_at > ${spec.name}.updated_at`,
      [...r.key, ...r.data, r.updatedAt, r.tbl, k1, k2, r.updatedAt],
    );
    if (ok) applied++;
  }

  for (const t of batch.tombstones) {
    const okT = await execDb(
      `INSERT INTO tombstones (tbl,k1,k2,deleted_at) VALUES (?,?,?,?)
       ON CONFLICT(tbl,k1,k2) DO UPDATE SET deleted_at = excluded.deleted_at
       WHERE excluded.deleted_at > tombstones.deleted_at`,
      [t.tbl, t.k1, t.k2, t.deletedAt],
    );
    if (okT) applied++;
    const spec = SPEC.get(t.tbl);
    if (!spec) continue;
    const { key } = tableCols(spec);
    const where = key.map((k) => `${k} = ?`).join(' AND ');
    const keys = key.length === 2 ? [t.k1, t.k2] : [t.k1];
    await execDb(`DELETE FROM ${spec.name} WHERE ${where} AND updated_at < ?`, [...keys, t.deletedAt]);
  }

  if (!applied) return { state: null, applied: 0 };

  /* ⚠ **씨앗을 심는다.** 받아온 스탬프가 로컬 최대값보다 클 수 있다(다른 기기가 미래에 있는
     시계를 썼거나 단순히 더 최근이거나). 안 심으면 다음 로컬 편집이 그보다 작은 스탬프를 받아
     "이미 보낸 것"으로 묻힌다 — `db/stamp.ts` 가 막으려는 실패 모드 그대로다. */
  for (const r of batch.rows) seedStamp(r.updatedAt);
  for (const t of batch.tombstones) seedStamp(t.deletedAt);

  /* ⚠ **기준선을 먼저, 상태를 나중에.** 이 순서가 에코를 막는다(머리주석 참조).
     되읽은 행으로 기준선을 세워야 `loadState` 안의 flush 가 diff 를 비워 아무것도 안 쓴다. */
  const rows = await readRows();
  if (!rows) return { state: null, applied };
  setDiffBaseline(rows);
  return { state: rowsToState(rows), applied };
}
