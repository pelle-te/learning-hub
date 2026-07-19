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
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { OUTBOX_TABLES, tableCols } from '../../web/src/lib/cloud/contract';
import { OutboxBatchSchema } from '../../web/src/lib/cloud/schema';
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
  /** 폰 웹앱 오리진(CORS 허용목록). 쉼표 구분. 미설정이면 브라우저 교차 오리진은 전부 막힌다. */
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

/* ⚠ CORS 를 **명시**한다(P1-6). 설계서가 axum 기본값을 두고 "지금 유리하게 작동하지만 그건
   의도가 아니라 우연"이라 지적했다 — Workers 도 같다. 허용목록이 비면 아무 오리진도 안 연다
   (와일드카드로 여는 것보다 폰 앱이 안 붙는 편이 안전하다. 후자는 즉시 드러난다). */
app.use('/api/*', (c, next) => {
  const allowed = (c.env.HUB_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST'],
    maxAge: 600,
  })(c, next);
});

/* ⚠ 인증 관련 응답은 절대 캐시되면 안 된다(P1-6). Workers 는 기본 헤더를 안 붙이므로
   **명시하지 않으면 중간 캐시가 토큰을 들고 있을 수 있다.** 전 응답에 건다 — 이 API 는
   전부 개인 데이터라 캐시할 것이 하나도 없다. */
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

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
  const body = (await c.req.json().catch(() => null)) as { code?: unknown; name?: unknown } | null;
  if (!body || typeof body.code !== 'string') return c.json({ error: 'bad request' }, 400);
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : '이름 없는 기기';

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
  const body = (await c.req.json().catch(() => null)) as { deviceId?: unknown; refreshToken?: unknown } | null;
  if (!body || typeof body.deviceId !== 'string' || typeof body.refreshToken !== 'string') {
    return c.json({ error: 'bad request' }, 400);
  }
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

app.use('/api/sync/*', async (c, next) => {
  const token = bearerFrom(c.req.raw);
  const deviceId = token ? await verifyAccessToken(c.env.HUB_SIGNING_KEY, token, nowSec()) : null;
  if (!deviceId) return c.json({ error: 'unauthorized' }, 401);
  c.set('deviceId', deviceId);
  await next();
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
  return c.json({ ok: true, applied: stmts.length, upto: batch.upto });
});

/**
 * 워터마크 이후 바뀐 것을 돌려준다(폰이 받아 갈 것).
 *
 * ⚠ **페이지네이션이 선택이 아니다** — CPU·응답 크기 한도가 있어 전량을 한 번에 줄 수 없다.
 * `limit` 을 넘겨 나눠 받고, 다음 호출은 받은 `upto` 를 `since` 로 준다.
 */
app.get('/api/sync/pull', async (c) => {
  const since = Number(c.req.query('since') ?? 0);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200), 1), 500);
  if (!Number.isInteger(since) || since < 0) return c.json({ error: 'bad since' }, 400);

  const rows: unknown[] = [];
  for (const [tbl, cols] of Object.entries(TABLE_COLS)) {
    const sel = [...cols.key, ...cols.data, 'updated_at'].join(',');
    const r = await c.env.DB.prepare(
      `SELECT ${sel} FROM ${tbl} WHERE updated_at > ? ORDER BY updated_at LIMIT ?`,
    )
      .bind(since, limit)
      .all<Record<string, unknown>>();
    for (const x of r.results) {
      rows.push({
        tbl,
        key: cols.key.map((k) => String(x[k] ?? '')),
        data: cols.data.map((d) => x[d]),
        updatedAt: Number(x['updated_at'] ?? 0),
      });
    }
  }
  const tombs = await c.env.DB.prepare(
    'SELECT tbl,k1,k2,deleted_at FROM tombstones WHERE deleted_at > ? ORDER BY deleted_at LIMIT ?',
  )
    .bind(since, limit)
    .all<Record<string, unknown>>();

  const stamps = [
    ...rows.map((r) => (r as { updatedAt: number }).updatedAt),
    ...tombs.results.map((t) => Number(t['deleted_at'] ?? 0)),
  ];
  return c.json({
    since,
    upto: stamps.length ? Math.max(...stamps) : since,
    rows,
    tombstones: tombs.results.map((t) => ({
      tbl: String(t['tbl'] ?? ''),
      k1: String(t['k1'] ?? ''),
      k2: String(t['k2'] ?? ''),
      deletedAt: Number(t['deleted_at'] ?? 0),
    })),
  });
});

export default app;
