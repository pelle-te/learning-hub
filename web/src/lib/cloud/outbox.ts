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

   ## ⚠⚠ fence 만으로는 못 막는 벡터 — 수집도 같은 직렬화 단위여야 한다 (C4 · 2026-07-26 감사)

   위 논증은 *"스캔 도중에 스탬프를 받는 쓰기"*(> fence)만 다룬다. 그런데 **스탬프는 이미
   받았는데 아직 커밋되지 않은 쓰기**가 있다:

       ① flush 가 스탬프 S 를 발급(`sqlite.ts` 의 `writeRows`) → ② `await db.batch(...)` 진행 중
       → ③ 그 창에 `collectOutbox` 가 fence F(>S)를 발급하고 **별도 커넥션**으로 스캔
       → 아직 커밋 전이라 S 행이 안 보인다 → ④ 전송 성공 → `commitWatermark(F)`
       → 이제 **S ≤ W** 라 그 행은 `updated_at > W` 에 영원히 안 걸린다.

   조용하고 영구적이다(결정로그 C1 과 같은 계열, 방향만 반대). 쓰기 3종(flush·병합·docs)은
   전부 `runExclusive` 위인데 **수집만 그 밖이었다** — 그래서 아래 `collectOutbox` 는 fence
   발급과 스캔을 통째로 그 체인 안에서 돌린다. 그러면 ①②가 끝난 뒤에야 F 가 발급되므로
   위 인터리브 자체가 성립하지 않는다.

   ⚠ **원격 전송(`transport.push`)은 여전히 체인 밖이다**(`push.ts` 가 수집과 전송을 나눠
   부른다) — 설계 §5-2 의 "로컬만 기다린다"가 그대로 유지된다. 체인에 드는 것은 로컬 읽기뿐이라
   창 닫기 가드(`whenSettled`)가 기다려도 네트워크를 기다리지 않는다.

   ## `docs` 의 남은 갭 → **판정 완료**(2026-07-20)

   결론만: **지금은 실害가 없다 — 제품에 `docs` 삭제 경로가 아예 없기 때문이다.** 근거와
   "삭제를 추가할 때 지켜야 할 조건"은 `contract.ts` 의 `OUTBOX_TABLES` 주석이 소유한다
   (계약이 있는 곳에 규칙을 둔다).
============================================================ */
import { capBatch, OUTBOX_TABLES, tableCols, type OutboxBatch, type OutboxRow, type OutboxTomb } from './contract';
import { execDb, selectDb } from '../db/sqlite';
import { runExclusive } from '../db/write';
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
/**
 * 마지막으로 **완전히 성공한** 동기화 시각(epoch ms 문자열).
 *
 * ⚠⚠ **동기화 실패에 「언제부터」와 「몇 번째」가 없었다**(O008 · 2026-08-22 운영 축).
 * `syncController` 의 `_lastSync` 는 **모듈 지역 상태**라 `useSyncLedger` 가 스스로 적었듯
 * *"새로고침마다 null 로 돌아온다"*. 그래서 3주째 실패 중인 기기가 앱을 껐다 켜면 첫 시도
 * 실패 → 원장 `{at:null, failed:true}` → 문구 «동기화 실패 — 다음 시도에 다시 올려요» 다.
 * **그 한 문장이 「방금 한 번 실패」와 「3주 연속 실패」를 같은 픽셀로 그린다.**
 *
 * ⭐ **같은 앱이 같은 질문에 이미 답을 갖고 있었다**(R3 · 짝): 볼트 백업은 `_lastBackupAt` 을
 * 앱 스키마에 **영속**하고 `days >= 7` 을 `stale` 로 판정하며 「무엇을 잃나」까지 붙인다
 * (`Settings.tsx`). 동기화만 그 짝이 없었다 — 이 키가 그 짝이다.
 *
 * ⚠ 자리가 `sync_state` 인 것이 계약의 일부다: 기기 로컬이고 **내보내기·동기화 대상이 아니다**
 * (`client.ts:11` 이 그 배제가 «별도 테이블이라 구조적으로 보장된다»고 적은 그 자리).
 * 다른 기기의 성공 시각으로 이 기기의 침묵을 덮으면 이 값의 뜻이 통째로 사라진다.
 */
export const LAST_OK_KEY = 'cloud:lastOkAt';

/** 마지막 성공 시각. 없으면 null = **「한 번도 성공한 적 없다」와 「모른다」를 함께** 뜻한다. */
export async function readLastOk(): Promise<number | null> {
  const rows = await selectDb<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [LAST_OK_KEY]);
  const n = Number(rows?.[0]?.value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 성공 시각을 적는다.
 *
 * ⚠ 워터마크와 같은 이유로 **뒤로 가지 않는다**(`MAX`). 시계가 뒤로 튀거나(수동 변경·NTP)
 * 늦게 도착한 결과가 앞선 성공을 덮으면 «며칠째»가 갑자기 늘어나 거짓 경보가 된다.
 */
export async function commitLastOk(at: number): Promise<boolean> {
  return execDb(
    `INSERT INTO sync_state (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = MAX(CAST(value AS INTEGER), CAST(?2 AS INTEGER))`,
    [LAST_OK_KEY, String(at)],
  );
}

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

/* ============================================================
   에코 억제(H31-② · 2026-07-30 `/감사 근본`)

   ## 무엇이 실제로 일어나고 있었나 (측정 결과 — 추정 아님)

   병합은 받아온 행을 **원격 스탬프 그대로** 쓴다(LWW 판정이 그 값에 걸려 있으므로 그래야
   한다). 그런데 아웃박스는 `updated_at > watermark` 로 훑으므로, 방금 받은 행이 **다음 회차에
   그대로 되돌아 올라간다.** 서버 LWW(`excluded.updated_at > t.updated_at`)가 동점을 무시해
   데이터는 안 상하지만, 초기 대량 동기화에서 **받은 만큼을 그대로 다시 올린다.**

   ## 왜 워터마크를 밀지 않는가 (검토하고 **버린** 길)

   "pull 뒤 워터마크를 `upto` 까지 전진"이 한 줄이지만 **안전하지 않다.** push 가 막히거나
   실패한 회차에는 아직 안 올라간 로컬 편집이 `upto` 아래에 있을 수 있고, 그걸 건너뛰면
   그건 조용한 유실이다 — 이 저장소가 워터마크로 두 번 물린 바로 그 형태다.

   ## 그래서 **정확히 그 행만** 건너뛴다

   병합이 쓴 `(tbl,k1,k2) → updatedAt` 를 메모리에 적어 두고, 스캔이 **키와 스탬프가 둘 다
   정확히 일치**하는 행만 건너뛴다. 로컬 편집이 같은 값을 받을 수 없다는 것이 안전 논거다:
   `nextStamp()` 는 단조 증가이고 `applyPull` 이 원격 스탬프로 `seedStamp` 하므로, 그 뒤의
   어떤 로컬 편집도 **반드시 더 큰** 스탬프를 받는다(`db/stamp.ts`).

   ⚠ **실패 안전(fail-open)** 이다 — 앱을 다시 켜면 표가 비어 종전처럼 한 번 에코할 뿐이다.
   즉 이 장치가 없어져도 정확성은 그대로이고, 있으면 유선만 아낀다. 관측·최적화가 정확성의
   전제가 되면 안 된다는 규율(§9-4)과 같은 방향.
============================================================ */

/** `tbl|k1|k2` → 그 행이 병합으로 받은 스탬프. 워터마크가 지나가면 스스로 정리된다. */
const _merged = new Map<string, number>();
/** 폭주 방지 — 넘으면 통째로 버린다(정확성이 아니라 절약 장치이므로 버려도 안전하다). */
const MERGED_CAP = 50_000;

const mergedKey = (tbl: string, key: string[]): string => `${tbl}|${key[0] ?? ''}|${key[1] ?? ''}`;
/* 툼스톤은 **같은 표 이름의 행과 키가 겹치므로** 이름공간을 가른다(D024). 안 가르면 «그 행을
   받았다»가 «그 행의 삭제를 받았다»를 지우고, 반대도 마찬가지다 — 둘은 다른 사실이다. */
const TOMB_NS = 'tomb#';

/**
 * 병합이 방금 받은 **툼스톤**을 적어 둔다(D024 · 2026-08-22).
 *
 * ⚠⚠ **위 머리주석의 논거가 행에만 적용돼 있었다.** 툼스톤은 `noteMergedRows` 의 대상이 아니라
 * 받은 삭제가 다음 스캔에서 **그대로 되올라갔다** — 행에 대해 «초기 대량 동기화에서 받은 만큼을
 * 그대로 다시 올린다» 고 적어 둔 그 상태가 삭제 축에는 남아 있었다. 안전 논거도 **같다**:
 * 키(`tbl,k1,k2`)와 `deletedAt` 이 **둘 다 정확히 일치**할 때만 건너뛰고, `applyPull` 이
 * 원격 스탬프로 `seedStamp` 하므로 그 뒤의 로컬 삭제는 반드시 더 큰 값을 받는다.
 * ⚠ 같은 실패 안전(fail-open)이다 — 표가 비면 종전처럼 한 번 에코할 뿐 정확성은 그대로다.
 */
export function noteMergedTombs(tombs: readonly { tbl: string; k1: string; k2: string; deletedAt: number }[]): void {
  if (_merged.size + tombs.length > MERGED_CAP) _merged.clear();
  for (const t of tombs) _merged.set(mergedKey(TOMB_NS + t.tbl, [t.k1, t.k2]), t.deletedAt);
}

/** 병합이 방금 쓴 행들을 적어 둔다(`merge.ts` 가 부른다). 같은 키는 마지막 스탬프가 이긴다. */
export function noteMergedRows(rows: readonly { tbl: string; key: string[]; updatedAt: number }[]): void {
  if (_merged.size + rows.length > MERGED_CAP) _merged.clear();
  for (const r of rows) _merged.set(mergedKey(r.tbl, r.key), r.updatedAt);
}

/**
 * 표를 비운다.
 *
 * ⚠⚠ **연결 해제가 이걸 안 불렀다**(H-5 · 2026-08-06 감사). 이 표는 "이 행은 방금 *서버에서*
 * 받은 것이니 되올리지 않는다"는 뜻인데, `disconnectCloud()` 는 워터마크 둘까지 지우면서
 * 이 메모리 표는 그대로 뒀다. 그래서 **끊었다가 다른 백엔드에 재등록하면** 그 행들이
 * `updated_at > 0` 스캔에는 걸리는데 여기서 정확히 걸러져 **영영 안 올라간다** — 앱은
 * "연결됨·최신"이라 말한다. 워터마크 삭제(H2)가 고친 것과 **같은 계열의 조용한 유실**이고,
 * 그때 이 표가 아직 없어서 함께 못 고쳐진 것이다.
 *
 * ⚠ 그전까지 이름이 `_resetMergedEcho`(테스트 전용)였다 — *프로덕션 호출부가 없다*는 표시가
 * 곧 이 결함의 모양이었다. 이제 `disconnectCloud` 가 부른다.
 */
export function resetMergedEcho(): void {
  _merged.clear();
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
  return (await collectOutboxScan(since))?.batch ?? null;
}

/** 스캔 1회의 결과 — 배치와 **뒤에 더 있는가**. */
export interface OutboxScan {
  batch: OutboxBatch;
  /**
   * `capBatch` 가 상한에서 잘랐는가 = **이 배치 뒤에 아직 아웃박스가 남았다.**
   *
   * ⚠⚠ 이걸 밖으로 내는 이유(H4 · 2026-08-01): `push.ts` 의 드레인 루프가 종전엔
   * `res.sent >= MAX_BATCH_ITEMS` 로 "가득 찼나"를 판정했는데, `capBatch` 는 **스탬프 그룹
   * 경계**에서 자르므로 그 조건이 **거의 항상 거짓**이다(상한 500에 400건 그룹이면 `sent=400`).
   * 즉 드레인이 사실상 한 번도 안 돌았고, 5,348행을 비우는 데 **사용자 트리거 14회**가 필요했다.
   * 잘렸는지는 스캔한 쪽만 안다(`upto < fence`) — 그래서 여기서 실어 보낸다.
   */
  more: boolean;
}

/** `collectOutbox` + **뒤에 더 있는가**. 드레인 루프(`push.drainPush`)만 이걸 쓴다. */
export async function collectOutboxScan(since?: number): Promise<OutboxScan | null> {
  /* ⚠ **쓰기와 같은 직렬화 단위에서 돈다(C4).** fence 발급과 스캔 사이가 아니라, *스탬프는
     발급됐는데 아직 커밋 전인 쓰기* 가 문제였다 — 머리주석의 C4 절이 SSOT. 전송은 여전히
     이 체인 밖이다(호출부 `push.ts` 가 수집과 전송을 나눠 부른다). */
  return runExclusive(() => scanOutbox(since));
}

async function scanOutbox(since?: number): Promise<OutboxScan | null> {
  const from = since ?? (await readWatermark());
  // 상한선을 **스캔 전에** 발급한다 — 이유는 머리주석 "fence" 참조.
  const fence = nextStamp();

  /* ⚠ **표별 질의를 병렬로 낸다**(M-18 · 2026-08-06 감사). 종전엔 `for` 안에서 하나씩 await 해
     표 7개 + 툼스톤 = **순차 IPC 8왕복**이었다. 편집 디바운스(1.2초)마다 도는 경로라 폰(워커
     +OPFS)에서는 왕복 비용이 특히 크고, 이 질의들은 **서로를 안 본다**(같은 `from`·`fence` 를
     쓰는 독립 SELECT). 순서 의존이 없으므로 동시에 내도 결과가 같다 —
     ⚠ `runExclusive` 안이라는 사실은 그대로다: 직렬화 단위는 *쓰기와의 배타*이지 이 안의
       읽기끼리가 아니다(C4 가 요구한 것은 fence 발급과 스캔이 한 임계구역에 있는 것). */
  const [표들, tombs] = await Promise.all([
    Promise.all(
      OUTBOX_TABLES.map((spec) =>
        selectDb<Record<string, unknown>>(
          `SELECT ${spec.cols.join(', ')}, updated_at FROM ${spec.name} WHERE updated_at > ? AND updated_at <= ? ORDER BY updated_at`,
          [from, fence],
        ),
      ),
    ),
    selectDb<Record<string, unknown>>(
      'SELECT tbl, k1, k2, deleted_at FROM tombstones WHERE deleted_at > ? AND deleted_at <= ? ORDER BY deleted_at',
      [from, fence],
    ),
  ]);

  const rows: OutboxRow[] = [];
  for (const [i, spec] of OUTBOX_TABLES.entries()) {
    const got = 표들[i];
    if (got == null) return null; // DB 미가용 — 부분 배치를 만들지 않는다(불완전을 완전으로 착각시킨다)
    /* 키/데이터 열 가르기는 **공유 계약이 소유한다**(`contract.ts`) — 서버의 SQL 생성이
       같은 함수를 쓰므로, 여기서 인라인으로 다시 자르면 둘이 갈릴 수 있다. */
    const { key, data } = tableCols(spec);
    for (const r of got) {
      const k = key.map((c) => String(r[c] ?? ''));
      const updatedAt = Number(r['updated_at'] ?? 0);
      /* 방금 병합으로 받은 바로 그 행이면 되돌려 보내지 않는다(H31-② · 위 머리주석).
       **키와 스탬프가 둘 다 정확히 일치**할 때만이라, 로컬 편집이 걸릴 수 없다. */
      if (_merged.get(mergedKey(spec.name, k)) === updatedAt) continue;
      rows.push({ tbl: spec.name, key: k, data: data.map((c) => r[c]), updatedAt });
    }
  }

  if (tombs == null) return null;

  /* ⚠ 행과 **같은 규칙**으로 에코를 막는다(D024) — 키와 `deletedAt` 이 둘 다 정확히 일치하는
     것만 건너뛴다. 로컬 삭제가 걸릴 수 없는 이유는 `noteMergedTombs` 주석이 소유한다. */
  const tombstones: OutboxTomb[] = tombs
    .map((t) => ({
      tbl: String(t['tbl'] ?? ''),
      k1: String(t['k1'] ?? ''),
      k2: String(t['k2'] ?? ''),
      deletedAt: Number(t['deleted_at'] ?? 0),
    }))
    .filter((t) => _merged.get(mergedKey(TOMB_NS + t.tbl, [t.k1, t.k2])) !== t.deletedAt);

  const capped = capBatch(rows, tombstones, fence);
  return {
    batch: { since: from, upto: capped.upto, rows: capped.rows, tombstones: capped.tombstones },
    /* 잘렸으면 상한선이 fence 보다 **앞**에서 멈춘다 — 그게 "뒤에 더 있다"의 관측 가능한 형태다.
       ⚠ `oversized`(한 그룹이 혼자 상한 초과)는 여기 안 넣는다: 그건 잘린 게 아니라 통째로
       담은 것이라 다음 회차가 이어받을 것이 없다(`capBatch` 의 `taken > 0` 가드 참조). */
    more: capped.upto < fence,
  };
}
