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
 * ⚠ `docs` 는 `TABLES` 에 없어 `diffRows` 가 손대지 않는다 → **툼스톤이 없다**
 * (`db/docs.ts:46-49` 의 미결 항목). 대상에는 넣는다 — 빼면 내 요약·독후감이 다른 기기에
 * 아예 안 가고, 그게 더 큰 손해다. 남는 한계는 "저작물 키 삭제가 전파되지 않는다" 하나이고
 * **C-5(병합) 전에 정해야 한다.**
 */
export const OUTBOX_TABLES: TableSpec[] = [...TABLES.filter((t) => t.sync), DOCS_SPEC];

/** 테이블 이름 → 기본키 열 / 데이터 열. 서버의 SQL 생성이 이걸 쓴다(손코딩 금지). */
export function tableCols(spec: TableSpec): { key: string[]; data: string[] } {
  return { key: spec.cols.slice(0, spec.keyLen), data: spec.cols.slice(spec.keyLen) };
}
