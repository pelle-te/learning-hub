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
import * as z from 'zod/mini';
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

/** epoch ms. `z.int()` 가 `NaN`·`Infinity`·소수를, `lte` 가 거대 미래값을 함께 걸러낸다.
 *  ⚠ mini 에서는 제약이 **메서드가 아니라 체크 함수**다(`.nonnegative()` → `z.nonnegative()`) —
 *  의미는 같고 붙이는 방식만 다르다(H28). */
const Stamp = z.int().check(z.nonnegative(), z.lte(MAX_STAMP));

export const OutboxRowSchema = z
  .strictObject({
    tbl: TableNameSchema,
    key: z.array(z.string()),
    /* `unknown` 을 유지한다 — 열 값은 텍스트·정수가 섞이고(`records.ord` 는 INTEGER),
       값의 *타입*은 스키마가 아니라 **길이와 위치**가 계약이다. 아래에서 길이를 검사한다. */
    data: z.array(z.unknown()),
    updatedAt: Stamp,
  })
  .check((ctx) => {
    /* ⚠ `superRefine` 은 mini 에 없다(H28) — `check` 가 같은 자리다. 다만 시그니처가 다르다:
       값은 `ctx.value` 로 오고, 이슈는 `ctx.addIssue(...)` 가 아니라 `ctx.issues.push(...)` 다
       (`input` 을 함께 실어야 한다 — classic 이 자동으로 채워 주던 필드). */
    const r = ctx.value;
    const spec = SPEC.get(r.tbl);
    if (!spec) return; // enum 이 이미 걸렀다(방어적)
    if (r.key.length !== spec.keyLen) {
      ctx.issues.push({
        code: 'custom',
        path: ['key'],
        message: `${r.tbl}: 기본키 ${spec.keyLen}개여야 하는데 ${r.key.length}개`,
        input: ctx.value,
      });
    }
    const dataLen = spec.cols.length - spec.keyLen;
    if (r.data.length !== dataLen) {
      ctx.issues.push({
        code: 'custom',
        path: ['data'],
        message: `${r.tbl}: 데이터 열 ${dataLen}개여야 하는데 ${r.data.length}개`,
        input: ctx.value,
      });
    }
  });

export const OutboxTombSchema = z
  .strictObject({
    tbl: TableNameSchema,
    k1: z.string(),
    /** 단일키 테이블은 빈 문자열(db.rs v3 규약). */
    k2: z.string(),
    deletedAt: Stamp,
  })
  .check((ctx) => {
    const t = ctx.value;
    const spec = SPEC.get(t.tbl);
    if (spec && spec.keyLen === 1 && t.k2 !== '') {
      ctx.issues.push({
        code: 'custom',
        path: ['k2'],
        message: `${t.tbl}: 단일키 테이블인데 k2 가 비어 있지 않다`,
        input: ctx.value,
      });
    }
  });

export const OutboxBatchSchema = z
  .strictObject({
    since: Stamp,
    upto: Stamp,
    rows: z.array(OutboxRowSchema),
    tombstones: z.array(OutboxTombSchema),
  })
  .check((ctx) => {
    const b = ctx.value;
    if (b.upto < b.since) {
      ctx.issues.push({
        code: 'custom',
        path: ['upto'],
        message: `upto(${b.upto}) 가 since(${b.since}) 보다 작다`,
        input: ctx.value,
      });
    }
    /* ⚠ 상한은 **경고가 아니라 거부**다. 넘는 배치는 서버 CPU 한도에서 어차피 죽는데,
       거기서 죽으면 원인이 "타임아웃"으로 보여 진단이 어렵다. 여기서 이름 붙여 거부한다. */
    const total = b.rows.length + b.tombstones.length;
    if (total > MAX_BATCH_ITEMS) {
      ctx.issues.push({
        code: 'custom',
        message: `배치가 상한을 넘었다: ${total} > ${MAX_BATCH_ITEMS}`,
        input: ctx.value,
      });
    }
    /* fence 계약 — 모든 항목이 (since, upto] 안에 있어야 한다. 밖의 행이 섞이면 워터마크를
       upto 로 전진시키는 순간 그 행이 "보냈다"고 잘못 기록되거나, 반대로 영영 안 올라간다. */
    for (const [i, r] of b.rows.entries()) {
      if (r.updatedAt <= b.since || r.updatedAt > b.upto) {
        ctx.issues.push({
          code: 'custom',
          path: ['rows', i],
          message: `updatedAt ${r.updatedAt} 이 (${b.since}, ${b.upto}] 밖이다`,
          input: ctx.value,
        });
      }
    }
    for (const [i, t] of b.tombstones.entries()) {
      if (t.deletedAt <= b.since || t.deletedAt > b.upto) {
        ctx.issues.push({
          code: 'custom',
          path: ['tombstones', i],
          message: `deletedAt ${t.deletedAt} 이 (${b.since}, ${b.upto}] 밖이다`,
          input: ctx.value,
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
/* ============================================================
   ⚠⚠ **수신은 관용, 송신은 엄격**(H16 · 2026-07-30 `/감사 근본`).

   위 `OutboxBatchSchema` 는 `z.enum(TABLE_NAMES)` + `.strict()` 다. 그건 **서버가 받는 쪽**에선
   옳다(신뢰 경계 · 서버가 `tbl` 을 테이블명으로 쓴다). 그런데 클라이언트의 **pull** 도 같은
   스키마를 쓰고 있었고, 거기서는 정반대 결과를 낸다:

     다음 릴리스에서 `TABLES` 에 테이블이 하나 늘면 → 서버 pull 응답에 그 `tbl` 이 섞인다 →
     **아직 업데이트 안 한 데스크톱**이 배치를 통째로 throw → `pullMark` 가 전진하지 않는다 →
     **그 기기의 수신이 영구 정지**한다(표시는 `failed` 토스트 한 줄).

   버전 스큐는 우연이 아니라 **구조적**이다: 데스크톱 업데이터는 사용자 승인을 기다리고 폰 SW 는
   `autoUpdate` 다. 즉 두 기기가 서로 다른 스키마를 아는 창이 정상적으로 존재한다.

   지금은 무증상이고 **다음 스키마 추가가 방아쇠**다 — 그래서 지금 10줄이 나중에 "구버전 기기가
   조용히 죽는" 사고보다 싸다.

   ## 관용의 범위를 좁게 못박는다

   · 모르는 `tbl` 행/툼스톤은 **버린다**(경고와 함께). 우리가 모르는 테이블에 병합할 방법이 없다.
   · `upto` 는 **그대로 전진시킨다** — 버린 것은 "우리가 쓸 수 없는 것"이고, 다시 받아도 또 버린다.
     전진시키지 않으면 그 구간을 영원히 되묻는다(H2/2026-07-24 가 고친 정체와 같은 형태).
   · 그 외 검사는 **한 글자도 느슨해지지 않는다**: 살아남은 항목에 원래의 엄격 스키마를 그대로
     적용한다(스탬프 상한·열 개수·k2 규약·fence·배치 상한). 관용은 *경계*에만 있고 *내용*엔 없다.
   ============================================================ */
export function parseInboundBatch(
  input: unknown,
): { ok: true; batch: OutboxBatch; dropped: number } | { ok: false; error: string } {
  const env = z
    .object({
      since: Stamp,
      upto: Stamp,
      rows: z._default(z.array(z.unknown()), []),
      tombstones: z._default(z.array(z.unknown()), []),
    })
    /* ⚠ `.strict()` 를 쓰지 않는다 — 서버가 배치 객체에 **새 필드**를 더해도(진단용 메타 등)
       구버전 클라이언트가 죽지 않아야 한다. 모르는 필드는 여기서 조용히 사라진다. */
    .safeParse(input);
  if (!env.success) return { ok: false, error: `서버 응답 봉투가 계약과 다릅니다 — ${issueLine(env.error)}` };

  const known = (v: unknown): boolean => {
    const t = (v as { tbl?: unknown } | null)?.tbl;
    return typeof t === 'string' && SPEC.has(t);
  };
  const rows = env.data.rows.filter(known);
  const tombstones = env.data.tombstones.filter(known);
  const dropped = env.data.rows.length - rows.length + (env.data.tombstones.length - tombstones.length);

  // 살아남은 것에는 **원래의 엄격 스키마**를 그대로 적용한다.
  const strict = OutboxBatchSchema.safeParse({ since: env.data.since, upto: env.data.upto, rows, tombstones });
  if (!strict.success) return { ok: false, error: `서버 응답이 계약과 다릅니다 — ${issueLine(strict.error)}` };
  return { ok: true, batch: strict.data as OutboxBatch, dropped };
}

/** zod 이슈를 한 줄로 — 상위 5개만(전량은 로그가 페이로드만큼 커진다). */
function issueLine(e: z.core.$ZodError): string {
  return e.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(루트)'}: ${i.message}`)
    .join(' · ');
}

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
