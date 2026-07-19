/* ============================================================
   cloud/outbox.ts — **"마지막으로 보낸 뒤 바뀐 게 뭔가"** 하나만 대답하는 모듈(C-1).

   ## 별도 outbox 테이블이 없는 이유

   설계서 §7 의 정정: 오프라인 큐의 내용물은 **"의도"가 아니라 "행"**이다. 행 단위 LWW 로
   병합하기로 했으므로(§4) 서버에 보낼 것은 `updated_at` 이 찍힌 dirty 행이지 그걸 만든
   immer 레시피가 아니다. 그리고 5-D 가 심은 `updated_at` + 툼스톤이 **이미 아웃박스다**:

       밀어올릴 것 = updated_at > watermark 인 행 ∪ deleted_at > watermark 인 툼스톤

   로컬 SQLite 가 이미 내구성 있는 기록이라(앱이 죽어도 남는다) 워터마크 하나만 두면
   "아직 안 보낸 것"이 유도된다. `useApp` 의 `pending` 레시피 큐는 **원래 목적(탭 간 rebase)
   그대로 인메모리로 남긴다** — 여기서 대체하려는 대상이 아니다.

   ## ⚠ 상한선(fence) — 스캔 도중의 쓰기를 삼키지 않기 위한 장치

   워터마크를 "수집한 것들의 최대값"으로 잡으면 **조용한 유실**이 가능하다:

       ① `records` 스캔(비어 있음) → ② A 행 쓰기(stamp 101) → ③ `settings` 스캔(stamp 105 수집)
       → 워터마크 = 105. **A(101)는 수집되지도 않았는데 워터마크 아래로 묻혔다.**

   (①②③ 순서가 가능한 이유: 스캔은 테이블마다 별도 질의이고 그 사이에 400ms 디바운스
   flush 가 끼어들 수 있다.)

   그래서 스캔 **전에** `nextStamp()` 로 상한선을 하나 발급하고 `updated_at <= fence` 로
   자른다. 발급기가 단조라서(`db/stamp.ts`) 스캔 도중의 쓰기는 반드시 `> fence` 를 받아
   이번 배치에서 제외되고 **다음 배치에 걸린다**. 과다 포함은 안전하고(같은 값 재전송 =
   LWW 무해) 과소 포함만 위험한데, fence 는 정확히 그 비대칭에 맞춘 설계다.

   ## `docs` 의 남은 갭

   `docs` 는 `rows.ts` 의 `TABLES` 에 없어 `diffRows` 가 손대지 않는다 → **툼스톤이 없다**
   (`db/docs.ts:46-49` 가 적어 둔 미결 항목). 여기서는 밀어올림 **대상에는 넣는다**(안 넣으면
   내 요약·독후감이 다른 기기에 아예 안 간다 — 그게 더 큰 손해다). 남는 한계는 "저작물 키
   삭제가 전파되지 않는다" 하나이고, 저작물 삭제는 드물어 지금은 실害가 없다.
   ⚠ **C-5(병합) 전에 `TableSpec` 편입 또는 전용 삭제 경로를 정해야 한다.**
============================================================ */
import { TABLES, type TableSpec } from '../db/rows';
import { execDb, selectDb } from '../db/sqlite';
import { nextStamp } from '../db/stamp';

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
  tombstones: OutboxTomb[];
}

/** 배치에 실린 변경 건수(호출부가 "보낼 게 있나"를 묻는 표준 방법). */
export function batchSize(b: OutboxBatch): number {
  return b.rows.length + b.tombstones.length;
}

const WATERMARK_KEY = 'watermark';

/* 동기화 대상 테이블 명세를 **`rows.ts` 에서 파생**한다. 손으로 다시 쓰지 않는 이유:
   이 저장소는 "행 모양 이중 정의"에 이미 두 번 물렸고(rows.ts ↔ rows.rs 쌍둥이), 세 번째
   사본을 만들면 열 하나가 추가될 때 조용히 안 실려 나가는 필드가 생긴다.
   `TableSpec` 은 `cols`(전체 열)와 `keyLen`(앞쪽 몇 개가 키인가)을 이미 갖고 있어 그대로 쓴다. */
const DOCS_SPEC: TableSpec = { name: 'docs', cols: ['key', 'value'], keyLen: 1, sync: true };

/** 밀어올림 대상 테이블. `docs` 는 `TABLES` 밖이라 명시적으로 덧붙인다(위 머리주석 참조). */
export const OUTBOX_TABLES: TableSpec[] = [...TABLES.filter((t) => t.sync), DOCS_SPEC];

/** 현재 워터마크. 없거나 DB 미가용이면 0 = "아무것도 안 보냈다"(전량이 대상). */
export async function readWatermark(): Promise<number> {
  const rows = await selectDb<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [WATERMARK_KEY]);
  return Number(rows?.[0]?.value ?? 0) || 0;
}

/**
 * 전송 성공 후 워터마크를 전진시킨다.
 *
 * ⚠ **뒤로 가지 않는다.** 배치가 순서 없이 성공할 수 있고(재시도가 겹치면), 되돌아간
 * 워터마크는 이미 보낸 것을 다시 보낼 뿐 아니라 **전진 기록을 잃는다**. `MAX` 로 못박는다.
 */
export async function commitWatermark(upto: number): Promise<boolean> {
  return execDb(
    `INSERT INTO sync_state (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = MAX(CAST(value AS INTEGER), CAST(?2 AS INTEGER))`,
    [WATERMARK_KEY, String(upto)],
  );
}

/**
 * 마지막 워터마크 이후 바뀐 행·삭제를 모은다. DB 미가용(브라우저)이면 **null**.
 *
 * `since` 를 넘기면 그 값을 쓰고, 없으면 DB 의 워터마크를 읽는다(테스트·부분 재전송용).
 */
export async function collectOutbox(since?: number): Promise<OutboxBatch | null> {
  const from = since ?? (await readWatermark());
  // 상한선을 **스캔 전에** 발급한다 — 이유는 머리주석 "fence" 참조.
  const fence = nextStamp();

  const rows: OutboxRow[] = [];
  for (const spec of OUTBOX_TABLES) {
    const cols = spec.cols.join(', ');
    const got = await selectDb<Record<string, unknown>>(
      `SELECT ${cols}, updated_at FROM ${spec.name} WHERE updated_at > ? AND updated_at <= ? ORDER BY updated_at`,
      [from, fence],
    );
    if (got == null) return null; // DB 미가용 — 부분 배치를 만들지 않는다(불완전을 완전으로 착각시킨다)
    for (const r of got) {
      rows.push({
        tbl: spec.name,
        key: spec.cols.slice(0, spec.keyLen).map((c) => String(r[c] ?? '')),
        data: spec.cols.slice(spec.keyLen).map((c) => r[c]),
        updatedAt: Number(r['updated_at'] ?? 0),
      });
    }
  }

  const tombs = await selectDb<Record<string, unknown>>(
    'SELECT tbl, k1, k2, deleted_at FROM tombstones WHERE deleted_at > ? AND deleted_at <= ? ORDER BY deleted_at',
    [from, fence],
  );
  if (tombs == null) return null;

  return {
    since: from,
    upto: fence,
    rows,
    tombstones: tombs.map((t) => ({
      tbl: String(t['tbl'] ?? ''),
      k1: String(t['k1'] ?? ''),
      k2: String(t['k2'] ?? ''),
      deletedAt: Number(t['deleted_at'] ?? 0),
    })),
  };
}
