/* ============================================================
   cloud/schema.ts — **신뢰 경계의 계약**(C-2 · P0-3).

   ## 이 파일이 다른 경계와 정반대인 이유

   이 저장소에는 이미 경계 파싱 관용구가 있다 — `artifacts.ts:49` 의 **비차단 경고**:
   모양이 어긋나도 경고만 남기고 **원본을 그대로 돌려준다**. 산출물은 *우리가 만든* 파일이고
   거부하면 화면이 비므로, 거기선 그게 옳다(파싱은 **드리프트 탐지**가 목적이다).

   **여기서 그 패턴을 복제하면 안 된다.** `OutboxBatch` 는 네트워크를 건너오는 페이로드이고,
   클라우드는 **정의상 신뢰할 수 없는 입력을 받는다**(설계서 §6 P0-3). 거부가 부작용이 아니라
   **목적 그 자체**다. 그래서 여기는 `.strict()` + 차단이다.

   > 설계서 §6 이 지목한 현실: `AppStateSchema` 는 런타임에서 **한 번도 실행되지 않고**
   > (`schema.ts:116-117` 이 스스로 그렇게 적어 뒀다), 실제 방어는 손코딩 `validShape()`
   > **5줄**(`persistence.ts:193`)이며 배열 내부는 완전 무검증이다. 로컬에선 "내 파일만 연다"라
   > 수용 가능했지만 클라우드에선 아니다.

   ## 왜 명세에서 **파생**하는가

   테이블 목록·열 개수를 손으로 다시 적으면 이 저장소가 이미 두 번 물린 divergence 를 세 번째로
   사는 것이다(`rows.ts` ↔ `rows.rs` 쌍둥이). `OUTBOX_TABLES` 하나에서 파생시키면 테이블이
   늘어도 스키마가 **자동으로 따라온다**.

   ## 막는 것 (전부 조용히 파손되는 부류다)

   · `tbl` 이 자유 문자열 → 서버가 SQL 테이블명에 그대로 쓰면 **인젝션**이다.
   · `data` 길이 불일치 → **열이 밀린 채 upsert** 된다. 타입이 맞으면 SQL 은 성공하고,
     증상은 "왜 이 값이 저기 있지"로 한참 뒤에 나타난다.
   · `NaN`/`Infinity` 타임스탬프 → 워터마크 비교를 오염시켜 동기화가 멈추거나 폭주한다.
   · fence 계약 위반 → 클라이언트가 `since`~`upto` 밖의 행을 보내면 워터마크 전진이 거짓이 된다.
============================================================ */
import { z } from 'zod';
import { MAX_BATCH_ITEMS, OUTBOX_TABLES, type OutboxBatch } from './contract';

/** 테이블 이름 → 명세. 길이 검사가 이걸 참조한다. */
const SPEC = new Map(OUTBOX_TABLES.map((t) => [t.name, t]));

const TABLE_NAMES = OUTBOX_TABLES.map((t) => t.name) as [string, ...string[]];

/** 동기화 대상 테이블 이름만 허용한다 — 서버가 이 값을 테이블명으로 쓰기 때문이다. */
export const TableNameSchema = z.enum(TABLE_NAMES);

/** 스탬프 상한 — 서기 2100(epoch ms). 실제 스탬프는 이보다 한참 아래이고, 이 위는 전부
 *  손상·악의다. 상한이 없으면 `1e18` 같은 거대 유한값이 통과해(`.int()` 는 유한하기만 하면 OK),
 *  `merge.ts` 의 `seedStamp` 래칫이 발급기를 그 값으로 끌어올려 `nextStamp` 이 **영원히 `_last+1`**
 *  만 내게 된다(벽시계 복귀 불가 · H5). 스키마 머리주석의 "타임스탬프 오염 차단"을 완성한다. */
const MAX_STAMP = 4102444800000;

/** epoch ms. `.int()` 가 `NaN`·`Infinity`·소수를, `.lte` 가 거대 미래값을 함께 걸러낸다. */
const Stamp = z.number().int().nonnegative().lte(MAX_STAMP);

export const OutboxRowSchema = z
  .object({
    tbl: TableNameSchema,
    key: z.array(z.string()),
    /* `unknown` 을 유지한다 — 열 값은 텍스트·정수가 섞이고(`records.ord` 는 INTEGER),
       값의 *타입*은 스키마가 아니라 **길이와 위치**가 계약이다. 아래에서 길이를 검사한다. */
    data: z.array(z.unknown()),
    updatedAt: Stamp,
  })
  .strict()
  .superRefine((r, ctx) => {
    const spec = SPEC.get(r.tbl);
    if (!spec) return; // enum 이 이미 걸렀다(방어적)
    if (r.key.length !== spec.keyLen) {
      ctx.addIssue({
        code: 'custom',
        path: ['key'],
        message: `${r.tbl}: 기본키 ${spec.keyLen}개여야 하는데 ${r.key.length}개`,
      });
    }
    const dataLen = spec.cols.length - spec.keyLen;
    if (r.data.length !== dataLen) {
      ctx.addIssue({
        code: 'custom',
        path: ['data'],
        message: `${r.tbl}: 데이터 열 ${dataLen}개여야 하는데 ${r.data.length}개`,
      });
    }
  });

export const OutboxTombSchema = z
  .object({
    tbl: TableNameSchema,
    k1: z.string(),
    /** 단일키 테이블은 빈 문자열(db.rs v3 규약). */
    k2: z.string(),
    deletedAt: Stamp,
  })
  .strict()
  .superRefine((t, ctx) => {
    const spec = SPEC.get(t.tbl);
    if (spec && spec.keyLen === 1 && t.k2 !== '') {
      ctx.addIssue({ code: 'custom', path: ['k2'], message: `${t.tbl}: 단일키 테이블인데 k2 가 비어 있지 않다` });
    }
  });

export const OutboxBatchSchema = z
  .object({
    since: Stamp,
    upto: Stamp,
    rows: z.array(OutboxRowSchema),
    tombstones: z.array(OutboxTombSchema),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.upto < b.since) {
      ctx.addIssue({ code: 'custom', path: ['upto'], message: `upto(${b.upto}) 가 since(${b.since}) 보다 작다` });
    }
    /* ⚠ 상한은 **경고가 아니라 거부**다. 넘는 배치는 서버 CPU 한도에서 어차피 죽는데,
       거기서 죽으면 원인이 "타임아웃"으로 보여 진단이 어렵다. 여기서 이름 붙여 거부한다. */
    const total = b.rows.length + b.tombstones.length;
    if (total > MAX_BATCH_ITEMS) {
      ctx.addIssue({ code: 'custom', message: `배치가 상한을 넘었다: ${total} > ${MAX_BATCH_ITEMS}` });
    }
    /* fence 계약 — 모든 항목이 (since, upto] 안에 있어야 한다. 밖의 행이 섞이면 워터마크를
       upto 로 전진시키는 순간 그 행이 "보냈다"고 잘못 기록되거나, 반대로 영영 안 올라간다. */
    for (const [i, r] of b.rows.entries()) {
      if (r.updatedAt <= b.since || r.updatedAt > b.upto) {
        ctx.addIssue({
          code: 'custom',
          path: ['rows', i],
          message: `updatedAt ${r.updatedAt} 이 (${b.since}, ${b.upto}] 밖이다`,
        });
      }
    }
    for (const [i, t] of b.tombstones.entries()) {
      if (t.deletedAt <= b.since || t.deletedAt > b.upto) {
        ctx.addIssue({
          code: 'custom',
          path: ['tombstones', i],
          message: `deletedAt ${t.deletedAt} 이 (${b.since}, ${b.upto}] 밖이다`,
        });
      }
    }
  });

export type ParsedOutboxBatch = z.infer<typeof OutboxBatchSchema>;

/**
 * 신뢰할 수 없는 입력을 배치로 파싱한다. **실패는 거부다** — 원본을 돌려주지 않는다.
 *
 * 서버가 요청 본문에 쓰고, 클라이언트도 보내기 직전 자기 페이로드에 쓴다. 후자가 이상해
 * 보이지만 값이 크다: **깨진 배치를 만드는 버그를 유선에 나가기 전에** 잡고, 서버와
 * 클라이언트가 **같은 계약**을 본다는 것을 테스트가 보장하게 된다.
 */
export function parseOutboxBatch(input: unknown): { ok: true; batch: OutboxBatch } | { ok: false; error: string } {
  const r = OutboxBatchSchema.safeParse(input);
  if (r.success) return { ok: true, batch: r.data as OutboxBatch };
  // 상위 5개만 — 전량을 늘어놓으면 로그가 페이로드만큼 커진다(`artifacts.ts:52` 와 같은 판단).
  const issues = r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(루트)'}: ${i.message}`)
    .join(' · ');
  return { ok: false, error: issues };
}
