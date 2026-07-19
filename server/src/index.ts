/* ============================================================
   index.ts — 러닝허브 클라우드 백엔드(Cloudflare Workers + D1 · C-4).

   설계는 `web/docs/클라우드전환-설계.md` §9-3b, 절차는 `web/docs/cloudflare-런북.md` 가 SSOT.

   ## 이 서버가 하는 일은 하나다 — **정본을 쥔다**

   불변식 I7: 어느 시점에도 정본을 쓰는 주체는 하나다. 그 하나가 여기다. PC 와 폰은 각자
   로컬 사본을 두고 **행 단위 LWW** 로 밀어 올리고 받아 간다(§4).

   ## ⚠ 스키마를 여기서 다시 정의하지 않는다

   `OutboxBatchSchema` 는 `web/src/lib/cloud/schema.ts` 에서 **import** 한다. 서버가 TS 라
   가능한 일이고(§9-3b), 이게 Cloudflare 를 고른 실익 중 하나다. 사본을 만들면 이 저장소가
   `rows.ts` ↔ `rows.rs` 로 두 번 물린 divergence 를 세 번째로 사는 것이다.

   ## ⚠ CPU 10ms

   무료 플랜은 요청당 CPU 10ms 다. 그래서 ① 느린 KDF 를 못 쓰고(`auth.ts`) ② 배치에 상한이
   있으며(`MAX_BATCH_ITEMS`) ③ 큰 작업을 한 요청에 몰지 않는다.
============================================================ */
import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import {
  capBatch,
  MAX_BATCH_ITEMS,
  OUTBOX_TABLES,
  tableCols,
  type OutboxRow,
  type OutboxTomb,
} from '../../web/src/lib/cloud/contract';
import { OutboxBatchSchema } from '../../web/src/lib/cloud/schema';
import { ceilingOf, readPage } from './pull';
import { z } from 'zod';
import {
  ACCESS_TTL_SEC,
  ENROLL_TTL_SEC,
  bearerFrom,
  issueAccessToken,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  verifyAccessToken,
} from './auth';

interface Env {
  DB: D1Database;
  /** `wrangler secret put HUB_SIGNING_KEY`. 저장소에도 대시보드에도 값이 남지 않는다. */
  HUB_SIGNING_KEY: string;
  /** PC 가 등록 코드를 발급할 때 쓰는 관리 비밀. `wrangler secret put HUB_ADMIN_KEY`. */
  HUB_ADMIN_KEY: string;
  /**
   * CORS 허용목록(쉼표 구분). **평시에는 비워 둔다** — 아래 CORS 미들웨어 주석 참조.
   * 미설정이면 브라우저 교차 오리진은 전부 막힌다(닫힘이 기본값).
   */
  HUB_ALLOWED_ORIGINS?: string;
}

type Vars = { deviceId: string };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/* 동기화 대상 테이블의 열 구조 — **공유 계약에서 파생**한다(`cloud/contract.ts`).
   손으로 적으면 `rows.ts` ↔ `rows.rs` 로 두 번 물린 divergence 를 세 번째로 사는 것이다.
   열이 하나 늘면 여기도 자동으로 따라온다. */
const TABLE_COLS: Record<string, { key: string[]; data: string[] }> = Object.fromEntries(
  OUTBOX_TABLES.map((spec) => [spec.name, tableCols(spec)]),
);

const nowSec = (): number => Math.floor(Date.now() / 1000);

/* ⚠ **본문을 받는 라우트는 전부 zod 로 판정한다(P0-3).** 종전엔 `/api/sync/push` 하나만
   스키마를 돌고 나머지 셋은 손코딩 `typeof` 였다 — 설계서 §6 P0-3 은 "서버 측 입력 검증"을
   전역 요구로 적었는데 실제 적용은 4분의 1 이었다(2026-07-20 감사).

   `.strict()` 인 이유는 `cloud/schema.ts` 머리주석과 같다: 여기는 **신뢰 경계**라 모르는 필드는
   통과가 아니라 거부다. 길이 상한을 거는 이유는 값이 그대로 D1 에 들어가기 때문이다 —
   `name` 은 종전에도 `slice(0,64)` 로 잘랐지만, **자르는 것과 거부하는 것은 다르다**(자르면
   사용자가 자기가 뭘 보냈는지 모른 채 다른 값이 저장된다). */
const EnrollClaimSchema = z
  .object({
    code: z.string().min(1).max(256),
    name: z.string().max(64).optional(),
  })
  .strict();

const TokenSchema = z
  .object({
    deviceId: z.string().min(1).max(128),
    refreshToken: z.string().min(1).max(512),
  })
  .strict();

const RevokeSchema = z.object({ deviceId: z.string().min(1).max(128) }).strict();

/** 본문을 스키마로 읽는다. 실패는 400 — 이유는 짧게만 돌려준다(내부 구조를 흘리지 않는다). */
async function readBody<T>(raw: unknown, schema: z.ZodType<T>): Promise<T | null> {
  const r = schema.safeParse(raw);
  return r.success ? r.data : null;
}

/* ⚠⚠ **평문을 거부한다(P0-1).** `*.workers.dev` 는 https 인증서가 자동으로 붙지만 **http 를
   막아 주지는 않는다** — 배포 후 실측했더니 `http://…/api/token` 이 그대로 응답했다(런북 §7-3
   이 "200 이 평문으로 오면 P0-1 위반"이라 적어 둔 바로 그 조건).

   데스크톱은 Rust 중계가 https 를 강제하므로 이미 안전하다(`cloud.rs`). 위험한 쪽은 **C-6 폰
   웹앱**이다 — 진짜 브라우저라 사용자가 주소에 `http://` 를 치면 리프레시 토큰이 평문으로
   나간다. 클라이언트 쪽 규율에만 기대면 언젠가 새므로 **서버가 거절**한다.

   리다이렉트가 아니라 **거부**인 이유: 3xx 는 POST 본문을 잃고 클라이언트마다 따라가는 방식이
   달라 조용히 반쯤 동작한다. 여기선 실패가 즉시 드러나는 편이 낫다.

   ⚠ 루프백은 예외다 — `wrangler dev` 가 http://localhost 로 돈다(`cloud.rs` 와 같은 판단). */
app.use('/api/*', async (c, next) => {
  const u = new URL(c.req.url);
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !loopback) {
    return c.json({ error: 'https required' }, 403);
  }
  await next();
});

/* ── CORS: **평시에 아무도 안 쓴다.** 그 사실이 이 블록의 요점이다(P1-6) ──────────

   설계서 §6 P1-6 이 axum 기본값을 두고 _"지금 유리하게 작동하지만 그건 의도가 아니라 우연"_
   이라 지적했다. 우연을 의도로 바꾸려면 **누가 교차 출처로 오는지 세어 보면 된다.** 셌다:

   | 호출자 | 어떻게 오나 | CORS 관여 |
   | --- | --- | --- |
   | **폰 웹앱(C-6)** | 같은 Workers 오리진에서 서빙된다(`wrangler.jsonc` 의 `assets`) | **없다 — 동일 출처** |
   | **데스크톱 Tauri 셸** | 웹뷰가 아니라 **Rust(`reqwest`)가 중계**한다 | **없다 — 브라우저가 아니라 `Origin` 이 없다** |

   ⚠ 데스크톱 쪽은 흔한 오해라 근거를 박아 둔다. `web/src/lib/cloud/client.ts:46-49` 의
   `send()` 가 `isTauri()` 면 `cloudHttp()`(IPC)로 내려가고, 그 끝이 `src-tauri/src/cloud.rs`
   다. C-3 의 CSP(`connect-src 'self' ipc:`)가 웹뷰 fetch 를 막기 때문에 그렇게 만들어졌고
   (C-5 에서 실측), 그 결과 **`tauri://localhost` 라는 Origin 헤더는 애초에 발생하지 않는다.**
   `cloud.rs` 머리주석도 _"CORS 가 데스크톱에선 통째로 사라진다"_ 고 같은 말을 적어 뒀다.

   ## 그래서 왜 안 지우나

   **닫힌 기본값을 유지하는 비용이 0 이고, 지우면 그 기본값이 사라지기 때문이다.** 이 블록을
   지우면 브라우저 CORS 정책이 대신 막아 주긴 하지만, 그건 다시 "우연히 안전"이다 —
   서버가 자기 입장을 안 밝힌 상태. 여기서는 서버가 **명시적으로** 말한다:
   허용목록이 비면(=평시) **어떤 교차 출처도 열지 않는다.**

   ⚠ `HUB_ALLOWED_ORIGINS` 는 **비워 두는 것이 정상 운영 상태**다. 값을 넣어야 할 상황은
   폰 웹앱을 다른 오리진에 따로 올리는 경우뿐이고, 그건 C-6 이 **일부러 택하지 않은** 구성이다
   (설계서 §9-1: 백엔드 둘·인증 두 벌을 상대하지 않는다). 와일드카드는 넣지 않는다 —
   허용목록이 비어 폰이 안 붙는 실패는 **즉시 드러나지만**, 와일드카드로 열린 채 도는 것은
   드러나지 않는다. */
app.use('/api/*', (c, next) => {
  const allowed = (c.env.HUB_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST'],
    maxAge: 600,
  })(c, next);
});

/* ⚠ 인증 관련 응답은 절대 캐시되면 안 된다(P1-6). Workers 는 기본 헤더를 안 붙이므로
   **명시하지 않으면 중간 캐시가 토큰을 들고 있을 수 있다.** API 응답 전부에 건다 — 이 API 는
   전부 개인 데이터라 캐시할 것이 하나도 없다.

   ⚠ **`/api/*` 로 좁힌 것이 C-6 에서 중요해졌다.** 같은 오리진에서 정적 자산도 나가는데,
   해시 붙은 번들에까지 `no-store` 가 붙으면 폰이 앱을 열 때마다 번들 전량을 다시 받는다
   (폰은 대개 셀룰러다). 실제로는 두 겹으로 안전하다: ① 이 미들웨어가 `/api/*` 에만 걸리고
   ② 자산은 **자산 워커가 전담**해 Hono 를 아예 거치지 않는다(`wrangler.jsonc` 의 `assets`).

   HTML 진입점은 반대로 캐시되면 안 되는데(옛 번들 고착), 그쪽은 자산 워커가
   `public, max-age=0, must-revalidate` 를 붙여 이미 재검증을 강제한다 — 실측했고
   `test/assets.test.ts` 가 그 **성질**을 잠근다. 자세한 판단 근거는 그 파일 주석. */
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

/* ⚠ **요청 크기 상한(P1-7).** 종전 상한은 `MAX_BATCH_ITEMS` 하나였는데, 그건 **본문을 전부
   읽고 JSON 파싱까지 끝낸 뒤** 도는 검사라 상한이라 부르기 어려웠다 — 100MB 본문도 일단
   파싱은 다 해 보고 나서 거절했다. CPU 10ms 예산에서 그건 그 자체로 자원 소모다.

   `Content-Length` 로 **파싱 전에** 끊는다. 헤더가 없거나 거짓일 수 있지만(청크 전송) 그건
   아래 스트림 계량이 받는다 — 두 겹인 이유는 헤더 하나에 기대는 방어는 방어가 아니어서다. */
const MAX_BODY_BYTES = 1024 * 1024; // 1MB — MAX_BATCH_ITEMS(500건) 를 넉넉히 담고도 남는다

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'OPTIONS') return next();
  const declared = Number(c.req.header('Content-Length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return c.json({ error: 'payload too large' }, 413);
  }
  const body = await c.req.raw.clone().arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return c.json({ error: 'payload too large' }, 413);
  return next();
});

/* ── 레이트 리밋(P1-7) ─────────────────────────────────────────

   ⚠⚠ **이것은 보조 방어이지 주 방어가 아니다 — 그 차이를 적어 둔다.**

   Workers 는 요청을 **여러 아이솔레이트**에 흩뿌리고 각 아이솔레이트는 자기 메모리만 본다.
   따라서 아래 카운터는 "한 아이솔레이트가 본 것"만 세고, **분산된 공격은 그대로 통과한다.**
   그럼에도 두는 이유는 실수·폭주 루프(클라이언트 버그로 초당 수십 번 치는 부류)를 싸게
   끊기 때문이고, 그건 실제로 이 앱에서 가장 그럴듯한 시나리오다.

   **진짜 방어는 Cloudflare WAF 레이트 리밋 규칙**(무료 플랜 1개)이고 그건 코드가 아니라
   대시보드 설정이다 — 런북 §7-5 에 절차를 적었다. D1 카운터로 만들지 않은 이유: 공격받는
   동안 카운터 쓰기가 **그 자체로 D1 일일 한도를 태운다**(막으려던 것을 방어가 대신 한다).

   무인증 라우트에만 건다. `/api/sync/*` 는 이미 토큰이 필요하고, 거기 걸면 정상 동기화가
   막힐 위험이 방어 이득보다 크다. */
const AUTH_RATE = { windowSec: 60, max: 20 };
const hits = new Map<string, { start: number; n: number }>();

function rateLimited(bucket: string, now: number): boolean {
  const cur = hits.get(bucket);
  if (!cur || now - cur.start >= AUTH_RATE.windowSec) {
    hits.set(bucket, { start: now, n: 1 });
    // 맵이 무한히 자라지 않게 — 아이솔레이트 수명이 짧아 이 정도면 충분하다.
    if (hits.size > 1000) for (const [k, v] of hits) if (now - v.start >= AUTH_RATE.windowSec) hits.delete(k);
    return false;
  }
  cur.n += 1;
  return cur.n > AUTH_RATE.max;
}

const rateGuard: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  if (rateLimited(`${ip}:${new URL(c.req.url).pathname}`, nowSec())) {
    return c.json({ error: 'too many requests' }, 429);
  }
  await next();
};

app.use('/api/enroll/*', rateGuard);
app.use('/api/token', rateGuard);

/** 헬스체크 — 인증 없이 열려 있는 유일한 GET. 비밀도 데이터도 노출하지 않는다. */
app.get('/api/health', (c) => c.json({ ok: true }));

/* ── 온보딩: PC 가 코드를 발급 → 폰이 제출 ───────────────────── */

/**
 * PC(Tauri 앱)가 1회용 등록 코드를 발급받는다. 관리 비밀로 보호한다.
 *
 * ⚠ 이 엔드포인트가 이 서버에서 **가장 민감**하다 — 코드 하나면 새 기기가 등록된다.
 * 그래서 액세스 토큰이 아니라 별도 관리 비밀을 요구하고, 상수시간으로 비교한다.
 */
app.post('/api/enroll/new', async (c) => {
  const key = bearerFrom(c.req.raw);
  if (!key || !c.env.HUB_ADMIN_KEY || !timingSafeEqual(key, c.env.HUB_ADMIN_KEY)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const code = randomToken(12); // 사람이 옮겨 칠 수 있는 길이(96비트)
  const t = nowSec();
  await c.env.DB.prepare('INSERT INTO enroll_codes (code_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(code), t, t + ENROLL_TTL_SEC)
    .run();
  return c.json({ code, expiresIn: ENROLL_TTL_SEC });
});

/** 폰이 등록 코드를 제출해 기기로 등록된다. 성공하면 **리프레시 토큰**을 받는다. */
app.post('/api/enroll/claim', async (c) => {
  const body = await readBody(await c.req.json().catch(() => null), EnrollClaimSchema);
  if (!body) return c.json({ error: 'bad request' }, 400);
  const name = body.name?.trim() ? body.name.trim() : '이름 없는 기기';

  const t = nowSec();
  const hash = await sha256Hex(body.code);
  /* ⚠ **한 번 쓰면 끝**이어야 한다. `used_at IS NULL` 을 UPDATE 의 조건에 넣어 원자적으로
     소비한다 — SELECT 후 UPDATE 로 나누면 두 요청이 같은 코드를 동시에 쓸 수 있다. */
  const consumed = await c.env.DB.prepare(
    'UPDATE enroll_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?',
  )
    .bind(t, hash, t)
    .run();
  if (!consumed.meta.changes) return c.json({ error: 'invalid or expired code' }, 401);

  const deviceId = randomToken(16);
  const refresh = randomToken(32);
  await c.env.DB.prepare(
    'INSERT INTO devices (id, name, refresh_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(deviceId, name, await sha256Hex(refresh), t, t)
    .run();
  return c.json({ deviceId, refreshToken: refresh });
});

/** 리프레시 토큰 → 짧은 수명 액세스 토큰. 폐기된 기기는 여기서 막힌다. */
app.post('/api/token', async (c) => {
  const body = await readBody(await c.req.json().catch(() => null), TokenSchema);
  if (!body) return c.json({ error: 'bad request' }, 400);
  const row = await c.env.DB.prepare('SELECT refresh_hash, revoked_at FROM devices WHERE id = ?')
    .bind(body.deviceId)
    .first<{ refresh_hash: string; revoked_at: number | null }>();
  const given = await sha256Hex(body.refreshToken);
  // ⚠ 기기가 없어도 같은 응답을 준다 — 존재 여부를 흘리지 않는다.
  if (!row || row.revoked_at !== null || !timingSafeEqual(row.refresh_hash, given)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const t = nowSec();
  await c.env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(t, body.deviceId).run();
  return c.json({
    accessToken: await issueAccessToken(c.env.HUB_SIGNING_KEY, body.deviceId, t),
    expiresIn: ACCESS_TTL_SEC,
  });
});

/* ── 인증 미들웨어 ───────────────────────────────────────────── */

/* ⚠ **폐기된 기기는 여기서도 막아야 한다.** 액세스 토큰은 무상태 서명이라 폐기 사실을
   모른다 — `/api/token` 에서만 막으면 이미 발급된 토큰이 만료(15분)까지 살아 있다.
   민감한 라우트(동기화·기기 관리)에서 **매 요청 폐기 여부를 확인**해 그 창을 닫는다.

   D1 조회가 한 번 늘지만, 폐기의 실효성이 "15분 뒤"가 아니라 "즉시"가 된다. 폐기가 필요한
   순간은 기기를 도난당한 순간이고, 그때 15분은 짧지 않다. */
const requireDevice: MiddlewareHandler<{
  Bindings: Env;
  Variables: Vars;
}> = async (c, next) => {
  const token = bearerFrom(c.req.raw);
  const deviceId = token ? await verifyAccessToken(c.env.HUB_SIGNING_KEY, token, nowSec()) : null;
  if (!deviceId) return c.json({ error: 'unauthorized' }, 401);

  const row = await c.env.DB.prepare('SELECT revoked_at FROM devices WHERE id = ?')
    .bind(deviceId)
    .first<{ revoked_at: number | null }>();
  if (!row || row.revoked_at !== null) return c.json({ error: 'unauthorized' }, 401);

  c.set('deviceId', deviceId);
  await next();
};

app.use('/api/sync/*', requireDevice);
app.use('/api/devices', requireDevice);
app.use('/api/devices/*', requireDevice);

/* ── 기기 관리(P0-2 폐기 · P1-4 주체) ─────────────────────────────

   ⚠⚠ **이 두 라우트가 없던 것이 C-4 의 실질 결함이었다**(2026-07-20 감사). `revoked_at` 열은
   005 에서 만들어져 `/api/token` 이 **읽고 있었는데, 그 값을 쓰는 코드가 어디에도 없었다.**
   즉 폐기는 스키마와 검사만 있고 **실행 경로가 없는** 상태였다 — 설계서 §6 P0-2 가 "수명·회전·
   폐기"라 적고 런북이 폐기를 구현된 기능처럼 서술했지만, 폰을 잃었을 때 실제로 할 수 있는
   일은 **D1 에 손으로 SQL 을 치는 것**뿐이었다.

   ## 왜 액세스 토큰으로 인증하나(관리 비밀이 아니라)

   폐기가 필요한 순간은 **기기를 잃은 순간**이고, 그때 사용자가 손에 쥔 것은 남은 기기다.
   관리 비밀(`HUB_ADMIN_KEY`)만 받으면 그 비밀을 어딘가에서 꺼내 와야 하는데, 급할 때
   그 경로가 있으리라 가정하면 안 된다. 그래서 **등록된 기기면 누구나** 다른 기기를 끊을 수
   있게 한다.

   ⚠ 도난당한 폰이 PC 를 끊을 수 있다는 뜻이기도 하다 — **의도적으로 수용한다.** 그 폰은
   이미 데이터 전량을 읽고 쓸 수 있어서 끊기는 것은 권한 상승이 아니라 불편이고, PC 는
   관리 비밀로 재등록할 수 있다. 반대로 폐기를 어렵게 만들면 **실제 위협에 대응할 수단이
   사라진다** — 이쪽 손실이 훨씬 크다.

   ## 회전(rotation)은 **하지 않는다** — 결정과 근거

   설계서 P0-2 는 "수명·회전·폐기"를 함께 적었지만 회전은 넣지 않는다. 리프레시 회전의 이득은
   *탈취 탐지*인데, 대가는 **응답 유실 시 잠금**이다(서버는 회전했는데 클라이언트가 새 토큰을
   못 받으면 그 기기는 영구 로그아웃되고, 복구 경로는 관리 비밀로 재등록이다). 유예 창으로
   완화할 수 있지만 그러면 탐지력이 그만큼 준다.

   **이 앱에서 회전이 사는 값이 작다**: 사용자 1명·기기 2대이고, 리프레시 토큰은 192비트
   난수라 추측이 불가능하며, 유출 시나리오는 "기기 자체를 잃음"이 사실상 전부인데 그건
   **폐기가 정확히 처방**한다. 짧은 액세스 수명(15분) + 폐기 조합이 회전 없이도 실효 대응을
   준다. → 문서를 코드에 맞춘다(설계서 §6 P0-2 정정). 넣지 않은 것을 넣었다고 적어 두는 편이
   훨씬 위험하다. */

interface DeviceRow {
  id: string;
  name: string;
  created_at: number;
  last_seen_at: number;
  revoked_at: number | null;
}

/** 등록된 기기 목록. 비밀(해시 포함)은 **한 글자도 내보내지 않는다.** */
app.get('/api/devices', async (c) => {
  const r = await c.env.DB.prepare(
    'SELECT id, name, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at',
  ).all<DeviceRow>();
  return c.json({
    self: c.get('deviceId'),
    devices: r.results.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      revokedAt: d.revoked_at,
    })),
  });
});

/**
 * 기기를 폐기한다. 되돌릴 수 없다 — 그 기기는 재등록해야 한다.
 *
 * ⚠ 이미 발급된 액세스 토큰은 **무상태 서명**이라 즉시 죽지 않는다. 최대 `ACCESS_TTL_SEC`
 * (15분) 남는다. 그게 액세스 수명을 짧게 잡은 이유이고(`auth.ts` 머리주석), 무상태의 대가를
 * 여기서 정직하게 적어 둔다 — "즉시 차단"이라 말하면 거짓이다.
 */
app.post('/api/devices/revoke', async (c) => {
  const body = await readBody(await c.req.json().catch(() => null), RevokeSchema);
  if (!body) return c.json({ error: 'bad request' }, 400);

  const r = await c.env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(nowSec(), body.deviceId)
    .run();
  if (!r.meta.changes) return c.json({ error: 'unknown or already revoked device' }, 404);
  return c.json({
    ok: true,
    revoked: body.deviceId,
    accessTokenGraceSec: ACCESS_TTL_SEC,
  });
});

/* ── 동기화 ──────────────────────────────────────────────────── */

/**
 * 아웃박스 배치를 받아 정본에 반영한다.
 *
 * ⚠ **행 단위 LWW.** `updated_at` 이 더 큰 쪽이 이긴다 — 그래서 `WHERE excluded.updated_at >`
 * 조건이 붙는다. 이게 없으면 늦게 도착한 옛 편집이 새 편집을 덮는다(G2 위반).
 */
app.post('/api/sync/push', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = OutboxBatchSchema.safeParse(raw);
  if (!parsed.success) {
    /* ⚠ 신뢰 경계이므로 **거부**다(P0-3). 이유는 돌려주되 상위 5개만 —
       전량을 뱉으면 오류 응답이 페이로드만큼 커진다. */
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join(' · ');
    return c.json({ error: 'invalid batch', detail: issues }, 400);
  }
  const batch = parsed.data;

  const stmts: D1PreparedStatement[] = [];
  for (const r of batch.rows) {
    const cols = TABLE_COLS[r.tbl]!;
    const names = [...cols.key, ...cols.data, 'updated_at'];
    const setters = [...cols.data, 'updated_at'].map((cn) => `${cn} = excluded.${cn}`).join(', ');
    const k1 = r.key[0] ?? '';
    const k2 = cols.key.length === 2 ? (r.key[1] ?? '') : '';
    /* ⚠⚠ **툼스톤 가드가 `ON CONFLICT` 만으로는 안 된다** — 실측으로 잡은 결함이다.
       행이 이미 삭제됐으면 INSERT 에 **충돌이 없어서** `WHERE excluded.updated_at > …` 가
       아예 발동하지 않고, 오래된 편집이 새 행으로 조용히 들어온다. 그게 설계서 G2 가
       금지한 **"삭제가 부활한다"** 그 자체다(폰에서 지운 할일이 PC 동기화 때 돌아오는 형태).

       그래서 `INSERT … SELECT … WHERE NOT EXISTS(더 새 툼스톤)` 으로 바꾼다. 두 경로를
       모두 막는다: ① 행이 남아 있으면 ON CONFLICT 가 LWW 로 판정하고 ② 지워졌으면
       이 WHERE 가 삽입 자체를 거부한다.
       `>=` 인 이유: 같은 스탬프면 삭제가 이긴다(동점에서 부활보다 삭제가 안전한 선택이다). */
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO ${r.tbl} (${names.join(',')})
         SELECT ${names.map(() => '?').join(',')}
         WHERE NOT EXISTS (
           SELECT 1 FROM tombstones WHERE tbl = ? AND k1 = ? AND k2 = ? AND deleted_at >= ?
         )
         ON CONFLICT(${cols.key.join(',')}) DO UPDATE SET ${setters}
         WHERE excluded.updated_at > ${r.tbl}.updated_at`,
      ).bind(...r.key, ...r.data, r.updatedAt, r.tbl, k1, k2, r.updatedAt),
    );
  }
  for (const t of batch.tombstones) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO tombstones (tbl,k1,k2,deleted_at) VALUES (?,?,?,?)
         ON CONFLICT(tbl,k1,k2) DO UPDATE SET deleted_at = excluded.deleted_at
         WHERE excluded.deleted_at > tombstones.deleted_at`,
      ).bind(t.tbl, t.k1, t.k2, t.deletedAt),
    );
    /* 툼스톤보다 오래된 행은 지운다. 부활 방지의 실행부이고, `diffRows` 가 클라이언트에서
       일부러 미룬 정리(rows.ts 주석)를 정본이 대신 하는 지점이다. */
    const cols = TABLE_COLS[t.tbl];
    if (cols) {
      const where = cols.key.map((k) => `${k} = ?`).join(' AND ');
      const keys = cols.key.length === 2 ? [t.k1, t.k2] : [t.k1];
      stmts.push(c.env.DB.prepare(`DELETE FROM ${t.tbl} WHERE ${where} AND updated_at < ?`).bind(...keys, t.deletedAt));
    }
  }

  if (stmts.length) await c.env.DB.batch(stmts);
  // P2-9 접근 로그(주체 포함). 건수만 — 값은 개인 데이터라 로그에 넣지 않는다.
  console.log(
    JSON.stringify({
      ev: 'push',
      dev: c.get('deviceId'),
      upto: batch.upto,
      n: batch.rows.length + batch.tombstones.length,
    }),
  );
  return c.json({ ok: true, applied: stmts.length, upto: batch.upto });
});

/* ⚠⚠ **`upto` 를 "받은 것의 최대값"으로 잡으면 행이 조용히 사라진다** — 2026-07-20 감사가
   잡은 결함이고, 이 파일에서 가장 미묘한 부분이라 길게 적는다.

   종전 구현은 테이블마다 **따로** `LIMIT` 을 걸고 `upto = max(전체 스탬프)` 를 돌려줬다.
   그러면 이런 일이 난다:

       A 테이블이 200개에서 잘림(마지막 스탬프 200) · B 테이블은 5000 까지 다 반환
       → upto = 5000 → 클라이언트가 pullMark = 5000 을 커밋
       → A 의 201~5000 은 다음 질의 `updated_at > 5000` 에 **영영 안 걸린다**

   이건 C-1 이 fence 로 막은 것과 **완전히 같은 실패 모드**(수집 안 된 것이 워터마크 아래로
   묻힌다)인데, 방향만 반대(받기)다. 설계서가 _"과다 포함은 LWW 라 무해하고 과소 포함만
   위험하다"_ 는 비대칭을 적어 뒀는데 그 규율이 수신 측에는 적용돼 있지 않았다.

   **고침**: 잘린 소스가 하나라도 있으면 `upto` 를 **모든 소스가 완전한 지점까지만** 올린다.
   각 소스는 `limit + 1` 개를 읽어 잘렸는지 보고, 잘렸으면 "이 값까지는 확실히 완전하다"를
   돌려준다. 전역 `upto` 는 그 값들의 **최솟값**이다.

   ⚠ **스탬프 그룹을 쪼개면 안 된다**(capBatch 와 같은 이유). 같은 flush 가 만든 행들은 스탬프가
   같아서, 그룹 한가운데를 자르고 `upto` 를 그 스탬프로 잡으면 나머지가 `> upto` 가 아니라
   `= upto` 라 영영 제외된다. 그래서 잘린 소스의 안전 상한은 **버려지는 첫 행의 스탬프 - 1** 이다.

   ⚠ 그룹 하나가 혼자 `limit` 을 넘으면 **그 그룹은 통째로 준다** — 안 그러면 안전 상한이
   `since` 와 같아져 진행이 0 이 되고 **영구 교착**이다. `capBatch` 의 `taken > 0` 가드와
   같은 판단이고, 근거도 같다: 정확성이 상한보다 우선이다. */

const DEFAULT_PULL_LIMIT = 200;

/**
 * 워터마크 이후 바뀐 것을 돌려준다(폰·PC 가 받아 갈 것).
 *
 * ⚠ **페이지네이션이 선택이 아니다** — CPU·응답 크기 한도가 있어 전량을 한 번에 줄 수 없다.
 * 다음 호출은 받은 `upto` 를 `since` 로 준다. 큰 동기화는 여러 번에 걸쳐 **자연히 재개**된다.
 */
app.get('/api/sync/pull', async (c) => {
  const since = Number(c.req.query('since') ?? 0);
  if (!Number.isInteger(since) || since < 0) return c.json({ error: 'bad since' }, 400);

  /* ⚠ `Number('abc')` 는 `NaN` 이고 `Math.min/max` 는 NaN 을 그대로 통과시킨다 —
     종전 구현은 그 NaN 을 `LIMIT ?` 에 바인딩했다. 먼저 정수인지 본다. */
  const rawLimit = c.req.query('limit');
  const wanted = rawLimit === undefined ? DEFAULT_PULL_LIMIT : Number(rawLimit);
  if (!Number.isInteger(wanted) || wanted < 1) return c.json({ error: 'bad limit' }, 400);
  const limit = Math.min(wanted, MAX_BATCH_ITEMS);

  const caps: number[] = [];
  const rows: OutboxRow[] = [];

  for (const [tbl, cols] of Object.entries(TABLE_COLS)) {
    const sel = [...cols.key, ...cols.data, 'updated_at'].join(',');
    const toRow = (x: Record<string, unknown>): OutboxRow => ({
      tbl,
      key: cols.key.map((k) => String(x[k] ?? '')),
      data: cols.data.map((d) => x[d]),
      updatedAt: Number(x['updated_at'] ?? 0),
    });
    const page = await readPage<OutboxRow>(
      (r) => r.updatedAt,
      async (n) =>
        (
          await c.env.DB.prepare(`SELECT ${sel} FROM ${tbl} WHERE updated_at > ? ORDER BY updated_at LIMIT ?`)
            .bind(since, n)
            .all<Record<string, unknown>>()
        ).results.map(toRow),
      async (stamp) =>
        (
          await c.env.DB.prepare(`SELECT ${sel} FROM ${tbl} WHERE updated_at = ?`)
            .bind(stamp)
            .all<Record<string, unknown>>()
        ).results.map(toRow),
      limit,
    );
    rows.push(...page.items);
    if (page.cap !== null) caps.push(page.cap);
  }

  const toTomb = (t: Record<string, unknown>): OutboxTomb => ({
    tbl: String(t['tbl'] ?? ''),
    k1: String(t['k1'] ?? ''),
    k2: String(t['k2'] ?? ''),
    deletedAt: Number(t['deleted_at'] ?? 0),
  });
  const tombPage = await readPage<OutboxTomb>(
    (t) => t.deletedAt,
    async (n) =>
      (
        await c.env.DB.prepare(
          'SELECT tbl,k1,k2,deleted_at FROM tombstones WHERE deleted_at > ? ORDER BY deleted_at LIMIT ?',
        )
          .bind(since, n)
          .all<Record<string, unknown>>()
      ).results.map(toTomb),
    async (stamp) =>
      (
        await c.env.DB.prepare('SELECT tbl,k1,k2,deleted_at FROM tombstones WHERE deleted_at = ?')
          .bind(stamp)
          .all<Record<string, unknown>>()
      ).results.map(toTomb),
    limit,
  );
  const tombstones = [...tombPage.items];
  if (tombPage.cap !== null) caps.push(tombPage.cap);

  /* 잘린 소스가 있으면 **가장 보수적인 상한**을 쓴다. 없으면 받은 것의 최대값으로 전진한다
     (그때는 전부 완전하므로 안전하다). 아무것도 없으면 `since` 그대로 — 전진할 근거가 없다. */
  const stamps = [...rows.map((r) => r.updatedAt), ...tombstones.map((t) => t.deletedAt)];
  const ceiling = ceilingOf(caps, stamps, since);

  /* ⚠ 전체 건수 상한을 **여기서** 다시 건다. `limit` 은 소스마다 걸리므로 8테이블 + 툼스톤이면
     합계가 `MAX_BATCH_ITEMS` 를 넘을 수 있고, 그러면 **클라이언트가 자기 스키마로 거절**해
     첫 전량 동기화가 영구 교착이다(push 쪽에서 `capBatch` 가 막은 것과 정확히 같은 함정).
     같은 함수를 쓴다 — push 와 pull 이 다른 규칙으로 자르면 언젠가 갈린다. */
  const capped = capBatch(
    rows.filter((r) => r.updatedAt <= ceiling),
    tombstones.filter((t) => t.deletedAt <= ceiling),
    ceiling,
  );

  /* P2-9 접근 로그 — `observability` 가 콘솔을 수집한다. 주체(P1-4)를 실제로 **기록**하는
     지점이 여기다. 값이 아니라 건수만 남긴다(로그에 개인 데이터를 넣지 않는다). */
  console.log(
    JSON.stringify({
      ev: 'pull',
      dev: c.get('deviceId'),
      since,
      upto: capped.upto,
      n: capped.rows.length + capped.tombstones.length,
    }),
  );

  return c.json({
    since,
    upto: capped.upto,
    rows: capped.rows,
    tombstones: capped.tombstones,
  });
});

export default app;
