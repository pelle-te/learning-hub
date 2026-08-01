/* ============================================================
   cloud/push.ts — 아웃박스를 밀어올리는 **재시도·백오프 엔진**(C-1).

   ## 전송이 주입되는 이유

   서버는 아직 없다(C-4). 그런데 재시도·백오프·워터마크 전진은 **서버와 무관하게 지금
   설계하고 지금 테스트할 수 있는** 부분이고, C-4 이후에 얹으면 훨씬 비싸진다(설계서 §7 이
   C-1~C-3 을 앞에 둔 이유 그대로). 그래서 `CloudTransport` 인터페이스만 두고 구현은 C-5 가
   끼운다 — 테스트는 가짜 전송으로 전 경로를 돈다.

   ## ⚠ 이 함수는 `whenSettled()` 에 절대 엮이면 안 된다

   설계서 §5-2: `whenSettled()` 는 **로컬만** 기다려야 한다. 창 닫기 가드가 원격 전송까지
   기다리면 **네트워크가 죽었을 때 앱이 안 닫힌다**(1단계에서 다른 원인으로 이미 겪은 실패
   모드). 그래서 여기서 만드는 프라미스는 `db/write.ts` 의 `_inflight` 체인에 **넣지 않는다**.
   밀어올리기는 유실 시 다음 시도가 재개하지만(워터마크가 안 전진했으므로), 로컬 쓰기는
   유실이 곧 소실이라 성질이 다르다.

   ## 실패 시 워터마크를 전진시키지 않는 것이 안전 계약 전부다

   전송이 실패하면 워터마크는 그대로다 → 같은 행이 다음 배치에 다시 걸린다. 서버가 받았는데
   응답만 유실된 경우 **같은 행을 두 번 보내지만**, 행 단위 LWW 라 재적용이 무해하다(멱등).
   반대 방향(성공 확신 없이 전진)은 조용한 유실이라 복구가 없다.
============================================================ */
import { batchSize, collectOutboxScan, commitWatermark, type OutboxBatch } from './outbox';
/* ⚠ **동적 import 로 바꾸지 말 것 — 2026-07-29 에 재 봤고 이득이 0.3KB 였다.**
   "이 줄이 zod 18KB 를 초기 청크로 끈다"는 진단이 있었는데 실측은 달랐다: zod 는 이미
   `db/boot`·`db/rows`·`db/write`·폰 엔트리가 **영속 계층의 부팅 검증**(C-2 경계 파싱)으로
   물고 있다 — 첫 페인트에 정의상 필요하다. 그래서 여기를 지연시켜도 zod 는 그대로 남고
   `cloud/schema` 자기 정의분(≈0.3KB)만 옮겨간다. 지연을 얻으려면 부팅 검증을 손봐야 하고
   그건 번들 항목이 아니라 설계 결정이다. */
import { MAX_BATCH_ITEMS, type OutboxRow, type OutboxTomb } from './contract';
import { parseOutboxBatch } from './schema';

/* 한 요청의 바이트 상한. 서버 `MAX_BODY_BYTES` 가 1MB 라 여유를 두고 자른다 — 건수만 세면
   `settings` 처럼 **한 행 = 슬라이스 전체**인 표(실측 `settings.items` 17KB)에서 500건이 1MB 를
   넘겨 본문 거부로 떨어진다. 두 축 중 먼저 걸리는 쪽에서 자른다. */
const MAX_BATCH_BYTES = 700_000;

/**
 * 배치를 전송 가능한 조각으로 자른다(H2 · 2026-07-31 `/감사 근본`).
 *
 * ## ⚠ 왜 필요한가 — 계약 두 개가 정면으로 어긋나 있었다
 *
 * `capBatch`(`contract.ts`)는 **정확성 우선**이라 한 스탬프 그룹이 혼자 상한을 넘어도 통째로
 * 담고 `oversized:true` 로 알린다(안 그러면 `cut` 이 0 이 되어 빈 배치 + 워터마크 정지 = 영구
 * 교착). 그런데 `collectOutbox` 가 그 플래그를 버리고, `parseOutboxBatch` 는 `total > 상한` 을
 * **거부**한다 → `blocked`. 워터마크가 안 움직이므로 그 기기의 **모든 편집이 영원히 안 올라가고**
 * 다음 시도도 같은 배치를 만들어 자가복구 경로가 없다.
 *
 * 유일한 생산자는 `006_backfill_stamps.sql` 이다 — 7개 표의 레거시 행 전부에 `updated_at = 1`
 * **상수 하나**를 찍는다(= 단일 그룹). 실 DB 에 그 그룹이 실재한다(18행 — 상한 미만이라 이
 * 기기에선 아직 안 터졌다).
 *
 * ## 왜 마이그레이션이 아니라 청크인가
 *
 * 대안은 v10 으로 레거시 행을 재스탬프하는 것이었는데, 그건 **되돌리기 힘든 코어 변경**을 이미
 * 적용된 DB 에 하나 더 얹는다. 청크는 그럴 필요가 없다: fence 계약은 "모든 항목이 (since, upto]
 * 안에 있을 것"이라 **부분집합도 그대로 만족**하고, 워터마크는 마지막 조각이 성공한 뒤 **한 번만**
 * 전진한다. 중간에 실패하면 다음 시도가 그룹 전체를 다시 보내지만 **행 단위 LWW 라 재적용이
 * 무해하다**(이 파일 머리주석의 멱등 논거 그대로).
 */
export function chunkBatch(batch: OutboxBatch): OutboxBatch[] {
  const items: ({ kind: 'row'; v: OutboxRow } | { kind: 'tomb'; v: OutboxTomb })[] = [
    ...batch.rows.map((v) => ({ kind: 'row' as const, v })),
    ...batch.tombstones.map((v) => ({ kind: 'tomb' as const, v })),
  ];
  if (items.length <= MAX_BATCH_ITEMS) {
    const bytes = JSON.stringify(batch).length;
    if (bytes <= MAX_BATCH_BYTES) return [batch];
  }
  const out: OutboxBatch[] = [];
  let rows: OutboxRow[] = [];
  let tombs: OutboxTomb[] = [];
  let bytes = 0;
  const flush = (): void => {
    if (!rows.length && !tombs.length) return;
    out.push({ since: batch.since, upto: batch.upto, rows, tombstones: tombs });
    rows = [];
    tombs = [];
    bytes = 0;
  };
  for (const it of items) {
    const b = JSON.stringify(it.v).length;
    // 한 항목이 혼자 상한을 넘으면 자를 방법이 없다 — 그 항목만 담은 조각으로 보낸다(서버 판정에 맡긴다).
    if (rows.length + tombs.length >= MAX_BATCH_ITEMS || (bytes > 0 && bytes + b > MAX_BATCH_BYTES)) flush();
    if (it.kind === 'row') rows.push(it.v);
    else tombs.push(it.v);
    bytes += b;
  }
  flush();
  return out;
}

/** 배치 하나를 서버로 보낸다. 실패는 **throw** 로 알린다(반환값으로 삼키지 않는다). */
export interface CloudTransport {
  push(batch: OutboxBatch): Promise<void>;
}

/**
 * 전송이 **"재시도해도 소용없다"**고 알리는 방법.
 *
 * ⚠ 이 구분이 없으면 재시도가 **해로워진다**. 호스트를 Cloudflare 로 정하면서 VM 에는 없던
 * 축이 생겼다 — **일일 한도**(D1 행 쓰기·Worker 요청). 한도를 소진하면 서버가 계속 거부하는데,
 * 백오프 상한이 60초라 그 상태로 **하루 종일 1분마다 헛친다.** 나쁜 건 낭비가 아니라 침묵이다:
 * 앱은 "동기화 시도 중"으로 보이고 사용자는 멈춘 걸 모른다.
 *
 * 이 부류에 해당하는 것: 일일 한도 소진 · 인증 만료/폐기 · 페이로드 거부(스키마 불일치).
 * **네트워크 오류·5xx·타임아웃은 여기 해당하지 않는다** — 그건 재시도가 정확히 맞는 처방이다.
 */
export class PermanentPushError extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentPushError';
  }
}

/** 전송이 낸 오류가 재시도 불가인가. 클래스 상속에 기대지 않는다(번들 경계를 넘으면 깨진다). */
export function isPermanent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { permanent?: unknown }).permanent === true;
}

export type PushStatus =
  /** 보냈고 워터마크가 전진했다. */
  | 'pushed'
  /** 보낼 게 없었다(워터마크는 상한선까지 전진한다 — 아래 참조). */
  | 'idle'
  /** DB 를 못 읽었다(브라우저·미가용). 재시도 대상이 아니다. */
  | 'unavailable'
  /** 전 시도 실패. 워터마크는 그대로 — 다음 호출이 같은 배치를 다시 시도한다. */
  | 'failed'
  /** 재시도가 무의미하다고 서버가 알렸다(한도·인증·페이로드). **호출부가 사용자에게 알려야 한다.** */
  | 'blocked';

export interface PushResult {
  status: PushStatus;
  /** 보낸 변경 건수. */
  sent: number;
  /** 실제로 시도한 횟수(1 = 첫 시도에 성공). */
  attempts: number;
  /** `failed`·`blocked` 일 때 마지막 오류 메시지. */
  error?: string;
  /**
   * **이 배치 뒤에 아웃박스가 더 남았는가**(H4 · 2026-08-01).
   *
   * 종전 드레인 조건은 `sent >= MAX_BATCH_ITEMS` 였는데 `capBatch` 는 **스탬프 그룹 경계**에서
   * 자르므로 그 수가 상한과 같아지는 일이 거의 없다 → 드레인이 사실상 안 돌았다. 판정은
   * 스캔한 쪽만 할 수 있어서(`upto < fence`) 여기까지 실어 온다 — 근거는 `outbox.OutboxScan`.
   */
  more: boolean;
}

export interface PushOptions {
  /** 최대 시도 횟수(첫 시도 포함). 기본 5. */
  maxAttempts?: number;
  /** 첫 재시도 대기(ms). 기본 1000. 이후 2배씩. */
  baseDelayMs?: number;
  /** 대기 상한(ms). 기본 60초 — 오래 끊긴 뒤 복귀했을 때 1분마다 재시도한다. */
  maxDelayMs?: number;
  /** 테스트 주입점. 기본은 실제 타이머. */
  sleep?: (ms: number) => Promise<void>;
  /** 테스트 주입점(지터). 기본 `Math.random`. */
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 지수 백오프 + 지터. 지터가 있는 이유는 무리 동기화(thundering herd)가 아니라 —
 * 기기가 몇 대 없다 — **서버가 잠깐 죽었을 때 모든 재시도가 같은 순간에 몰리는 것**을 피하기
 * 위해서다. 전량 지터(0~delay)가 아니라 절반 고정 + 절반 무작위로 최소 대기를 보장한다.
 */
export function backoffDelay(attempt: number, opts: PushOptions = {}): number {
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 60_000;
  const random = opts.random ?? Math.random;
  const raw = Math.min(base * 2 ** (attempt - 1), max);
  return Math.round(raw / 2 + (raw / 2) * random());
}

/**
 * 아웃박스를 한 번 밀어올린다(내부적으로 재시도까지 포함).
 *
 * 호출부는 이 함수를 주기적으로/온라인 복귀 시 부르면 된다 — **상태를 들고 있지 않으므로**
 * 언제 불러도 안전하고, 보낼 게 없으면 싸게 끝난다.
 */
export async function pushOutbox(transport: CloudTransport, opts: PushOptions = {}): Promise<PushResult> {
  const scan = await collectOutboxScan();
  if (!scan) return { status: 'unavailable', sent: 0, attempts: 0, more: false };
  const { batch, more } = scan;

  const size = batchSize(batch);
  if (size === 0) {
    /* 보낼 게 없어도 워터마크는 상한선까지 전진시킨다. 안 하면 매번 같은 구간을 다시 스캔하고,
       무엇보다 `updated_at <= fence` 의 fence 가 계속 커지는데 하한이 안 움직여 **질의 범위가
       무한히 넓어진다**(인덱스가 있어도 범위 스캔이 커진다). 빈 배치의 전진은 유실 위험이 없다 —
       그 구간에 보낼 것이 실제로 없었기 때문이다. */
    await commitWatermark(batch.upto);
    return { status: 'idle', sent: 0, attempts: 0, more };
  }

  /* ⚠ 한 스탬프 그룹이 혼자 상한을 넘을 수 있다(H2) — `chunkBatch` 주석이 그 계약을 소유한다.
     대개 조각은 하나이고, 그때는 아래 루프가 종전과 글자 그대로 같은 일을 한다. */
  const chunks = chunkBatch(batch);

  /* ⚠ **보내기 전에 자기 페이로드를 검증한다**(C-2). 서버가 어차피 검증하는데 왜 여기서도
     하냐면 — 깨진 배치는 재시도해도 계속 깨져 있다. 서버까지 갔다 오면 그 왕복이 5번 반복되고
     원인은 "서버가 400 을 준다"로만 보인다. 여기서 걸면 **어느 행의 무엇이 틀렸는지**가 나온다.
     그리고 서버와 클라이언트가 같은 스키마를 본다는 것을 테스트가 보장하게 된다.
     ⚠ 검증 단위는 **조각**이다 — 상한 검사가 그 단위로만 의미를 갖기 때문이다(위 주석). */
  for (const c of chunks) {
    const checked = parseOutboxBatch(c);
    if (!checked.ok) {
      return { status: 'blocked', sent: 0, attempts: 0, more, error: `배치가 계약을 위반한다 — ${checked.error}` };
    }
  }

  const maxAttempts = opts.maxAttempts ?? 5;
  const sleep = opts.sleep ?? defaultSleep;
  let lastError = '';
  let attempts = 0;

  for (const c of chunks) {
    let ok = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts += 1;
      try {
        await transport.push(c);
        ok = true;
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        /* 재시도가 무의미한 실패는 **즉시** 끊는다 — 여기서 계속 돌면 하루 종일 헛치면서
           사용자에겐 정상으로 보인다(`PermanentPushError` 주석 참조). 워터마크는 실패한
           배치이므로 당연히 전진시키지 않는다. */
        if (isPermanent(e)) return { status: 'blocked', sent: 0, attempts, more, error: lastError };
        if (attempt < maxAttempts) await sleep(backoffDelay(attempt, opts));
      }
    }
    /* 조각 하나라도 못 보냈으면 워터마크를 건드리지 않고 끝낸다 — 다음 호출이 **그룹 전체**를
       다시 만든다. 앞 조각을 두 번 보내지만 행 단위 LWW 라 재적용이 무해하다(머리주석의 멱등). */
    if (!ok) return { status: 'failed', sent: 0, attempts, more, error: lastError };
  }

  /* ⚠ **전 조각 성공 뒤에만** 워터마크가 전진한다. 이 순서가 이 파일의 안전 계약 전부다. */
  await commitWatermark(batch.upto);
  return { status: 'pushed', sent: size, attempts, more };
}
