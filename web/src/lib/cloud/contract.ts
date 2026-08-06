/* ============================================================
   cloud/contract.ts — 클라이언트와 서버가 **공유하는 순수 계약**(C-4).

   ## 왜 `outbox.ts` 에서 떼어냈나 — 컴파일러가 잡아 줬다

   원래 `OUTBOX_TABLES`·`OutboxBatch` 는 `outbox.ts` 에 있었고, Worker 가 `schema.ts` 를
   import 하면 그게 딸려왔다. 그런데 `outbox.ts` 는 **DB IO 를 한다**:

       cloud/schema.ts → cloud/outbox.ts → db/sqlite.ts → lib/tauri.ts → `window`

   Worker 에는 `window` 가 없다. `server/tsconfig.json` 의 import 화이트리스트가 이 사슬을
   **컴파일 타임에** 끊어 줬다 — 없었다면 타입은 통과하고 **런타임에 죽었을** 것이다.
   가장 나쁜 실패 모드라, 이 파일의 존재 이유가 곧 그 방어의 결과물이다.

   ## 규칙

   여기에는 **순수한 것만** 둔다 — 타입·상수·명세. IO 를 하는 것은 `outbox.ts` 가 갖는다.
   그래야 서버·클라이언트·테스트가 같은 계약을 보면서도 런타임 의존이 안 딸려온다.
============================================================ */
import { TABLES, type TableSpec } from '../db/rows';

/** 밀어올릴 행 하나. `key` 는 기본키 열 값, `data` 는 나머지 열 값(테이블 정의 순서). */
export interface OutboxRow {
  tbl: string;
  key: string[];
  data: unknown[];
  updatedAt: number;
}

/** 밀어올릴 삭제 하나. `k2` 는 단일키 테이블에서 빈 문자열(db.rs v3 규약). */
export interface OutboxTomb {
  tbl: string;
  k1: string;
  k2: string;
  deletedAt: number;
}

export interface OutboxBatch {
  /** 이 배치가 이어받은 워터마크(배타적 하한). */
  since: number;
  /** 이 배치의 상한선. 전송 성공 시 워터마크가 될 값. */
  upto: number;
  rows: OutboxRow[];
  /**
   * 삭제 표식. **정리(GC) 잡은 의도적으로 없다**(M3 · 2026-07-29 명시).
   *
   * 전 저장소에 `DELETE FROM tombstones` 는 **0건**이다 — 로컬에도 D1 에도. 즉 툼스톤은
   * 단조 증가한다. 그게 지금은 옳다:
   * · 툼스톤 한 건은 `(tbl,k1,k2,deleted_at)` 뿐이라 수십 바이트다.
   * · 1인·소수 기기 규모에서 삭제 이벤트는 수천 건 단위를 넘지 않는다.
   * · 무엇보다 **지우는 것이 위험하다** — 툼스톤이 사라진 뒤 그 삭제를 못 받은 기기가
   *   붙으면 지워진 행이 되살아난다(설계서 G2 가 금지한 바로 그것). 안전한 GC 는 "모든
   *   기기가 그 시점을 지났다"를 알아야 하는데, 이 앱엔 그걸 아는 층이 없다.
   *
   * ⚠ **그래서 이건 "안 만든 것"이 아니라 "만들지 않기로 한 것"이다.** 없는 이유가 어디에도
   * 안 적혀 있으면 다음 사람이 "빠뜨렸다"고 읽고 GC 를 넣는다 — 그 커밋이 곧 부활 사고다.
   * 착수 조건: 기기별 pull 워터마크를 서버가 알게 되는 날(그때만 안전한 하한이 생긴다).
   */
  tombstones: OutboxTomb[];
}

/** 배치에 실린 변경 건수(호출부가 "보낼 게 있나"를 묻는 표준 방법). */
export function batchSize(b: OutboxBatch): number {
  return b.rows.length + b.tombstones.length;
}

/**
 * 배치 하나에 담을 변경 건수 상한.
 *
 * VM 이었다면 없었을 제약이다. Workers 무료 플랜은 **요청당 CPU 10ms** 이고, 통상 인증·큰
 * 페이로드 파싱이 10~20ms 를 쓴다 — 전량 동기화를 한 요청에 담으면 검증에서 넘긴다.
 * D1 일일 행 쓰기 한도도 같은 방향으로 작은 배치를 요구한다.
 */
export const MAX_BATCH_ITEMS = 500;

/** `docs` 는 `rows.ts` 의 `TABLES` 밖이라 명시적으로 덧붙인다(아래 주석 참조). */
const DOCS_SPEC: TableSpec = { name: 'docs', cols: ['key', 'value'], keyLen: 1, sync: true };

/**
 * 밀어올림·받아오기 대상 테이블 명세. **`rows.ts` 에서 파생**한다 — 손으로 다시 쓰면
 * 이 저장소가 이미 두 번 물린 divergence 를 세 번째로 사는 것이다.
 *
 * ⚠ `docs` 는 `TABLES` 에 없어 `diffRows` 가 손대지 않는다 → **툼스톤이 없다**. 대상에는
 * 넣는다 — 빼면 내 요약·독후감이 다른 기기에 아예 안 가고, 그게 더 큰 손해다.
 *
 * ## ⚠⚠ 판정 (2026-07-20 감사) — **지금은 실害가 없다. 삭제를 추가하면 생긴다**
 *
 * 설계서가 _"C-5(병합) 전에 정해야 한다"_ 고 적었는데 안 정한 채 C-5 가 지나갔다. 다시 보니
 * **정할 것이 없었다**: `db/docs.ts` 에는 `docGet`·`docSet` 뿐이고 **삭제 함수가 아예 없다.**
 * 제품에 삭제 경로가 없으므로 "전파되지 않는 삭제"는 **발생할 수 없다.** 쓰이지 않을 툼스톤
 * 경로를 미리 만드는 것은 갱신되지 않는 코드를 하나 더 만드는 일이다(C-2 가 `.strict()`
 * 수신 파생을 미룬 것과 같은 판단).
 *
 * ⚠ **그래서 조건이 규칙이 된다: `docs` 에 삭제를 추가하는 커밋은 툼스톤을 같이 넣어야 한다.**
 * 안 그러면 다른 기기에서 지운 독후감이 되살아난다 — G2 가 금지한 바로 그것이다.
 * (`rows.ts` 의 `TABLES` 에 편입하는 것이 가장 싼 경로다. 그러면 `diffRows` 가 자동으로 낸다.)
 */
export const OUTBOX_TABLES: TableSpec[] = [...TABLES.filter((t) => t.sync), DOCS_SPEC];

/** 테이블 이름 → 기본키 열 / 데이터 열. 서버의 SQL 생성이 이걸 쓴다(손코딩 금지). */
export function tableCols(spec: TableSpec): { key: string[]; data: string[] } {
  return { key: spec.cols.slice(0, spec.keyLen), data: spec.cols.slice(spec.keyLen) };
}

/* ============================================================
   병합 SQL — **한 벌**(H-15 · 2026-08-06 감사)

   ⚠⚠ 이 세 문장은 클라이언트(`cloud/merge.ts`)와 서버(`server/src/index.ts`)가 **글자 그대로
   같아야** 한다. 한쪽만 고치면 기기마다 병합 결과가 갈리고, 그건 이 프로젝트에서 가장 비싼
   종류의 버그다(재현이 기기 의존).

   그런데 실제로는 **사본이 셋**이었고 셋째가 `server/test/contract.test.ts` 안의 `upsertSql`
   이었다 — 즉 계약 테스트가 **자기가 만든 문자열**의 의미론을 검증하고 있었다. 그래서 서버의
   부활 가드가 `>=` → `>` 로 바뀌어도 그 테스트는 **녹색**이다. 그 파일 주석 스스로
   _"C-5 에서 SQL 생성을 순수 함수로 빼면 이 복제가 사라진다"_ 라 예약해 뒀고, 여기가 그 자리다.
   ⚠ 실제로 사본은 이미 갈라져 있었다: 테스트 사본의 툼스톤 DELETE 가 `updated_at < ?` 로, H3
   이 `<=` 로 통일한 **그 전 판**이었다(동점에서 삭제↔편집이 기기별로 반대로 판정되던 형태).

   동점 규칙(두 문장이 서로에게 기대는 지점):
   · 부활 가드는 `deleted_at >= updatedAt` — 같은 ms 면 **삭제 승**.
   · 툼스톤 DELETE 는 `updated_at <= deletedAt` — 같은 ms 면 **삭제 승**.
   방향이 엇갈리면 같은 ms 에 A 가 삭제·B 가 편집했을 때 A=삭제·B=존재로 **영구 분기**한다
   (양쪽 다 "동기화 완료"라 말한다 · H3 실사고).
============================================================ */

/**
 * 행 upsert — **행 단위 LWW + 툼스톤 부활 가드**.
 *
 * ⚠ `ON CONFLICT` 만으로는 안 된다: 행이 이미 지워졌으면 **충돌이 없어서** LWW 조건이 아예
 * 평가되지 않고 오래된 편집이 새 행으로 조용히 들어온다(설계서 G2 가 금지한 "삭제 부활").
 * 그래서 `INSERT … SELECT … WHERE NOT EXISTS(더 새 툼스톤)` 이다 — ① 행이 남아 있으면
 * ON CONFLICT 가 LWW 로 판정하고 ② 지워졌으면 이 WHERE 가 삽입 자체를 거부한다.
 *
 * 바인딩 순서: `[...key, ...data, updatedAt, tbl, k1, k2, updatedAt]`.
 */
export function upsertRowSql(tbl: string, key: string[], data: string[]): string {
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

/** 툼스톤 upsert(더 새 삭제만 이긴다). 바인딩: `[tbl, k1, k2, deletedAt]`. */
export const UPSERT_TOMBSTONE_SQL = `INSERT INTO tombstones (tbl,k1,k2,deleted_at) VALUES (?,?,?,?)
       ON CONFLICT(tbl,k1,k2) DO UPDATE SET deleted_at = excluded.deleted_at
       WHERE excluded.deleted_at > tombstones.deleted_at`;

/** 툼스톤보다 오래된(또는 동점인) 행을 지운다. 바인딩: `[...keys, deletedAt]`. 동점 규칙은 위 절. */
export function deleteRowSql(tbl: string, key: string[]): string {
  return `DELETE FROM ${tbl} WHERE ${key.map((k) => `${k} = ?`).join(' AND ')} AND updated_at <= ?`;
}

/**
 * 배치를 상한 이하로 자르고 그에 맞는 워터마크를 정한다.
 *
 * ## ⚠ 스탬프 경계에서만 자른다 — 여기가 이 함수의 존재 이유다
 *
 * 순진하게 "앞에서 N개"로 자르면 **조용한 유실**이 난다. `diffRows` 는 한 번의 flush 가 만든
 * 행·툼스톤 **전부에 같은 스탬프**를 찍는다. 그 그룹 한가운데를 자르고 `upto` 를 그 스탬프로
 * 잡으면, 빠진 나머지는 `updated_at > since` 에서 **같은 값이라 제외**되어 영영 안 올라간다.
 *
 * 그래서 자를 수 있는 곳은 **스탬프가 바뀌는 지점**뿐이다. 행과 툼스톤이 스탬프 공간을
 * 공유하므로(같은 flush 가 둘 다 낸다) **합쳐서** 그룹을 센다.
 *
 * ⚠ **한 그룹이 혼자 상한을 넘으면 그 그룹은 통째로 보낸다.** 상한을 지키려다 그룹을 쪼개면
 * 위의 유실이 나기 때문이다 — **정확성이 상한보다 우선**이고, 상한은 성능 장치이지 안전
 * 장치가 아니다. 이 경우를 호출부가 알 수 있도록 `oversized` 로 알린다.
 *
 * ⚠ **`outbox.ts` 가 아니라 여기 있는 이유**(2026-07-20 이동): 원래 `outbox.ts` 에 있었는데
 * 그 파일은 DB IO 를 해서 **서버가 import 할 수 없다.** 그래서 서버의 pull 은 같은 규칙을
 * 손으로 다시 쓸 뻔했고, 그건 이 저장소가 이미 두 번 물린 divergence 다. 이 함수는 순수하니
 * 계약 층이 갖는 것이 맞다 — **push 와 pull 이 같은 자르기 규칙을 쓴다**는 것이 요점이다.
 */
export function capBatch(
  rows: OutboxRow[],
  tombstones: OutboxTomb[],
  fence: number,
  max: number = MAX_BATCH_ITEMS,
): { rows: OutboxRow[]; tombstones: OutboxTomb[]; upto: number; oversized: boolean } {
  if (rows.length + tombstones.length <= max) return { rows, tombstones, upto: fence, oversized: false };

  // 스탬프별 건수(행·툼스톤 합산) → 오름차순으로 누적하며 상한을 넘기 직전까지만 취한다.
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.updatedAt, (counts.get(r.updatedAt) ?? 0) + 1);
  for (const t of tombstones) counts.set(t.deletedAt, (counts.get(t.deletedAt) ?? 0) + 1);

  const stamps = [...counts.keys()].sort((a, b) => a - b);
  let taken = 0;
  let cut = 0; // 포함할 마지막 스탬프
  for (const s of stamps) {
    const n = counts.get(s)!;
    if (taken > 0 && taken + n > max) break; // 이 그룹부터는 다음 배치로
    taken += n;
    cut = s;
  }
  /* `taken > 0` 가드가 첫 그룹을 보호한다 — 첫 그룹이 혼자 상한을 넘어도 통째로 취한다.
     안 그러면 cut 이 0 이 되어 빈 배치가 나오고, 그 상태로 워터마크가 안 움직여 **영구 교착**이다. */

  return {
    rows: rows.filter((r) => r.updatedAt <= cut),
    tombstones: tombstones.filter((t) => t.deletedAt <= cut),
    upto: cut,
    oversized: taken > max,
  };
}
