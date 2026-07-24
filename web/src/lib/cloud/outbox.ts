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

   ## `docs` 의 남은 갭 → **판정 완료**(2026-07-20)

   결론만: **지금은 실害가 없다 — 제품에 `docs` 삭제 경로가 아예 없기 때문이다.** 근거와
   "삭제를 추가할 때 지켜야 할 조건"은 `contract.ts` 의 `OUTBOX_TABLES` 주석이 소유한다
   (계약이 있는 곳에 규칙을 둔다).
============================================================ */
import { capBatch, OUTBOX_TABLES, tableCols, type OutboxBatch, type OutboxRow, type OutboxTomb } from './contract';
import { execDb, selectDb } from '../db/sqlite';
import { nextStamp } from '../db/stamp';

/* ⚠ 계약(타입·테이블 명세·상한)은 **`contract.ts` 가 소유한다.** 여기서 다시 정의하지
   않고 재수출만 한다 — 이 파일은 DB IO 를 하므로 서버가 import 할 수 없고, 계약이 여기 있으면
   서버가 딸려오는 런타임 의존 때문에 공유가 불가능해진다(`contract.ts` 머리주석 참조). */
export {
  batchSize,
  capBatch,
  MAX_BATCH_ITEMS,
  OUTBOX_TABLES,
  tableCols,
  type OutboxBatch,
  type OutboxRow,
  type OutboxTomb,
} from './contract';

/* 기기 로컬 동기화 진행 키 — 둘 다 `sync_state` 에 있고 **내보내기·동기화 대상이 아니다**.
   여기 함께 두는 이유: 연결 해제(`client.ts`)가 자격증명과 함께 이 둘을 지워야 하는데(H2),
   `PULL_MARK_KEY` 를 `run.ts` 가 들면 `client.ts ↔ run.ts` 순환 import 가 된다. 이 모듈은
   `client.ts`·`run.ts` 어느 쪽도 import 하지 않아 순환이 없다. */
export const WATERMARK_KEY = 'watermark';
/** 받기 전용 워터마크("어디까지 받았나"). 발급/커밋은 `run.ts` 가, 삭제는 `client.ts` 가 한다. */
export const PULL_MARK_KEY = 'cloud:pullMark';

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
 *
 * ⚠ 상한을 넘으면 **스탬프 경계에서 잘라** 앞부분만 담는다(`capBatch`). 나머지는 워터마크가
 * 전진한 뒤 다음 호출이 가져간다 — 즉 큰 동기화는 여러 배치로 나뉘어 **자연히 재개**된다.
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
    /* 키/데이터 열 가르기는 **공유 계약이 소유한다**(`contract.ts`) — 서버의 SQL 생성이
       같은 함수를 쓰므로, 여기서 인라인으로 다시 자르면 둘이 갈릴 수 있다. */
    const { key, data } = tableCols(spec);
    for (const r of got) {
      rows.push({
        tbl: spec.name,
        key: key.map((c) => String(r[c] ?? '')),
        data: data.map((c) => r[c]),
        updatedAt: Number(r['updated_at'] ?? 0),
      });
    }
  }

  const tombs = await selectDb<Record<string, unknown>>(
    'SELECT tbl, k1, k2, deleted_at FROM tombstones WHERE deleted_at > ? AND deleted_at <= ? ORDER BY deleted_at',
    [from, fence],
  );
  if (tombs == null) return null;

  const tombstones: OutboxTomb[] = tombs.map((t) => ({
    tbl: String(t['tbl'] ?? ''),
    k1: String(t['k1'] ?? ''),
    k2: String(t['k2'] ?? ''),
    deletedAt: Number(t['deleted_at'] ?? 0),
  }));

  const capped = capBatch(rows, tombstones, fence);
  return { since: from, upto: capped.upto, rows: capped.rows, tombstones: capped.tombstones };
}
