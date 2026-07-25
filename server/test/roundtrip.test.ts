/* ============================================================
   roundtrip.test.ts — **실제 workerd + 실제 D1** 왕복(2026-07-20 신설).

   ## 이 파일이 책임지는 명제

   `contract.test.ts` 는 "SQL 이 의도대로 도는가"를 본다. 여기는 그 위층이다:

   · 라우팅·미들웨어 **순서**가 맞는가(인증이 실제로 막는가, CORS·no-store 가 붙는가)
   · 온보딩 → 토큰 → push → pull 이 **끝에서 끝까지** 이어지는가
   · **폐기가 실제로 접근을 끊는가**(C-4 가 열을 만들고 쓰는 경로를 안 만들었던 그 결함)
   · pull 이 잘린 소스를 앞지르지 않는가(감사가 잡은 조용한 유실)

   ⚠ 여기서 잡히는 부류는 전부 **정적 검사가 전량 녹색인 상태에서** 터진다. 그게 이 층의
   존재 이유다 — 설계서가 세 번 _"띄워보지 않으면 모른다"_ 고 적고도 만들지 않았던 층.

   ## ⚠ 여기가 **못** 보는 것: 정적 자산 라우팅(C-6) → `test/assets.test.ts`

   C-6 부터 같은 오리진에서 폰 웹앱(`web/dist`)이 함께 나간다. 그 라우팅(`/api/*` 우선 ·
   SPA 폴백)은 **이 파일에서 잴 수 없다** — `vitest-pool-workers` 0.18.6 의 `SELF` 는
   `miniflare.assets` 를 줘도 자산 라우터를 건너뛰고 사용자 워커로 곧장 들어간다(실측).
   그래서 `test/assets.test.ts` 가 Miniflare 를 직접 띄워 그 층을 맡는다. 근거와 실측 표는
   그 파일과 `wrangler.jsonc` 의 `assets` 주석에 있다.
============================================================ */
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const BASE = 'https://hub.example';

/** 등록 코드 발급 → 기기 등록 → 액세스 토큰. 실제 라우트를 그대로 탄다. */
async function enroll(name = '테스트폰'): Promise<{ deviceId: string; access: string }> {
  const newRes = await SELF.fetch(`${BASE}/api/enroll/new`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.HUB_ADMIN_KEY}` },
  });
  expect(newRes.status, '등록 코드 발급 실패').toBe(200);
  const { code } = (await newRes.json()) as { code: string };

  const claim = await SELF.fetch(`${BASE}/api/enroll/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  });
  expect(claim.status, '기기 등록 실패').toBe(200);
  const { deviceId, refreshToken } = (await claim.json()) as { deviceId: string; refreshToken: string };

  const tok = await SELF.fetch(`${BASE}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, refreshToken }),
  });
  expect(tok.status, '토큰 발급 실패').toBe(200);
  const { accessToken } = (await tok.json()) as { accessToken: string };
  return { deviceId, access: accessToken };
}

const push = (access: string, body: unknown) =>
  SELF.fetch(`${BASE}/api/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify(body),
  });

const pull = (access: string, since: number, limit?: number) =>
  SELF.fetch(`${BASE}/api/sync/pull?since=${since}${limit === undefined ? '' : `&limit=${limit}`}`, {
    headers: { Authorization: `Bearer ${access}` },
  });

const row = (key: string, value: string, at: number) => ({
  tbl: 'settings',
  key: [key],
  data: [value],
  updatedAt: at,
});

/* 공유 마이그레이션 폴더가 스키마의 단일 원천이다(`wrangler.jsonc` 의 `migrations_dir`,
   설정에서 `readD1Migrations` 로 읽는다). 테스트가 DDL 을 따로 들면 그 사본이 진짜 스키마와
   갈린다 — 이 저장소가 두 번 물린 부류.

   ⚠ **케이스마다 데이터를 비운다.** pool-workers 0.18 에는 `isolatedStorage` 옵션이 없어
   D1 이 파일 간·케이스 간 유지된다 — 처음 이 파일을 돌렸을 때 앞 케이스의 행이 흘러들어
   `upto` 가 29 로 나오는 **가짜 실패**가 났다. 격리를 런타임 옵션에 기대지 않고 여기서
   명시적으로 만든다(테스트가 서로에게 의존하면 실패 원인을 못 읽는다). */
const RESET_TABLES = [
  'settings',
  'completions',
  'ds_map',
  'records',
  'summaries',
  'week_alloc',
  'docs',
  'tombstones',
  'devices',
  'enroll_codes',
];

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch(RESET_TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe('온보딩 → 동기화 왕복', () => {
  it('등록한 기기가 밀어올린 것을 그대로 받아온다', async () => {
    const { access } = await enroll();

    const p = await push(access, { since: 0, upto: 100, rows: [row('a', '{"v":1}', 100)], tombstones: [] });
    expect(p.status).toBe(200);

    const got = await pull(access, 0);
    expect(got.status).toBe(200);
    const batch = (await got.json()) as { upto: number; rows: { key: string[]; data: unknown[] }[] };
    expect(batch.rows.map((r) => r.key[0])).toContain('a');
    expect(batch.upto).toBe(100);
  });

  it('⚠ 인증 없이는 동기화가 막힌다', async () => {
    expect((await SELF.fetch(`${BASE}/api/sync/pull?since=0`)).status).toBe(401);
    const p = await SELF.fetch(`${BASE}/api/sync/push`, { method: 'POST', body: '{}' });
    expect(p.status).toBe(401);
  });

  it('⚠ 인증 응답에 no-store 가 붙는다(P1-6) — 중간 캐시가 토큰을 들면 안 된다', async () => {
    const r = await SELF.fetch(`${BASE}/api/health`);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('⚠⚠ 기기 폐기가 실제로 접근을 끊는다(P0-2)', () => {
  it('폐기된 기기는 이미 들고 있던 액세스 토큰으로도 못 들어온다', async () => {
    const victim = await enroll('잃어버린폰');
    const admin = await enroll('PC');

    // 폐기 전에는 된다.
    expect((await pull(victim.access, 0)).status).toBe(200);

    const rev = await SELF.fetch(`${BASE}/api/devices/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.access}` },
      body: JSON.stringify({ deviceId: victim.deviceId }),
    });
    expect(rev.status).toBe(200);

    /* ⚠ 여기가 핵심이다. 액세스 토큰은 **무상태 서명**이라 그 자체로는 폐기를 모른다.
       `requireDevice` 가 매 요청 DB 를 보지 않으면 최대 15분간 계속 통과한다. */
    expect((await pull(victim.access, 0)).status, '폐기됐는데 기존 토큰이 아직 통한다').toBe(401);
    expect((await pull(admin.access, 0)).status, '멀쩡한 기기까지 끊겼다').toBe(200);
  });

  it('기기 목록이 비밀을 노출하지 않는다', async () => {
    const { access } = await enroll();
    const r = await SELF.fetch(`${BASE}/api/devices`, { headers: { Authorization: `Bearer ${access}` } });
    const body = await r.text();
    expect(body).not.toContain('refresh');
    expect(body).not.toMatch(/[0-9a-f]{64}/); // sha256 hex 가 새어 나오지 않는다
  });
});

describe('⚠⚠ pull 이 잘린 소스를 앞지르지 않는다', () => {
  it('limit 으로 잘려도 어떤 행도 유실되지 않는다 — 반복 pull 로 전량이 온다', async () => {
    const { access } = await enroll();

    // 스탬프가 전부 다른 12건 — limit 을 작게 주면 여러 번에 걸쳐 와야 한다.
    const rows = Array.from({ length: 12 }, (_, i) => row(`k${i}`, `{"i":${i}}`, (i + 1) * 10));
    expect((await push(access, { since: 0, upto: 120, rows, tombstones: [] })).status).toBe(200);

    const seen = new Set<string>();
    let since = 0;
    for (let round = 0; round < 20; round++) {
      const r = await pull(access, since, 3);
      expect(r.status).toBe(200);
      const b = (await r.json()) as { upto: number; rows: { key: string[] }[] };
      for (const x of b.rows) seen.add(x.key[0]!);
      if (b.upto === since) break; // 더 진행할 것이 없다
      since = b.upto;
      if (seen.size === 12) break;
    }

    /* 옛 구현이라면 잘린 테이블의 나머지가 워터마크 아래로 묻혀 여기서 12 미만이 나온다. */
    expect(seen.size, 'pull 이 행을 삼켰다 — 워터마크가 잘린 소스를 앞질렀다').toBe(12);
  });

  it('⚠ 진행이 멈추지 않는다 — 같은 구간을 영원히 다시 묻지 않는다', async () => {
    const { access } = await enroll();
    // 같은 스탬프 5건(한 flush 가 만든 그룹) — limit 2 로 잘라도 통째로 와야 한다.
    const rows = Array.from({ length: 5 }, (_, i) => row(`g${i}`, '{}', 500));
    expect((await push(access, { since: 0, upto: 500, rows, tombstones: [] })).status).toBe(200);

    const r = await pull(access, 0, 2);
    const b = (await r.json()) as { upto: number; rows: unknown[] };
    expect(b.rows, '스탬프 그룹을 쪼갰다 — 나머지는 영영 안 온다').toHaveLength(5);
    expect(b.upto, 'upto 가 since 와 같으면 영구 교착이다').toBeGreaterThan(0);
  });
});

describe('입력 검증(P0-3)·상한(P1-7)', () => {
  it('알 수 없는 필드가 섞인 배치를 거부한다(.strict)', async () => {
    const { access } = await enroll();
    const p = await push(access, { since: 0, upto: 100, rows: [], tombstones: [], sneaky: 1 });
    expect(p.status).toBe(400);
  });

  it('알 수 없는 테이블 이름을 거부한다 — 테이블명 인젝션 경로', async () => {
    const { access } = await enroll();
    const p = await push(access, {
      since: 0,
      upto: 100,
      rows: [{ tbl: 'devices', key: ['x'], data: ['y'], updatedAt: 100 }],
      tombstones: [],
    });
    expect(p.status).toBe(400);
  });

  it('⚠ limit=abc 가 NaN 으로 흘러들지 않는다', async () => {
    const { access } = await enroll();
    const r = await SELF.fetch(`${BASE}/api/sync/pull?since=0&limit=abc`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    expect(r.status).toBe(400);
  });

  it('본문 크기 상한이 파싱 전에 끊는다', async () => {
    const { access } = await enroll();
    const huge = 'x'.repeat(2 * 1024 * 1024);
    const r = await SELF.fetch(`${BASE}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
      body: JSON.stringify({ pad: huge }),
    });
    expect(r.status).toBe(413);
  });
});

describe('삭제가 부활하지 않는다 — 실제 라우트에서(G2)', () => {
  it('툼스톤 이후 도착한 옛 편집이 행을 되살리지 못한다', async () => {
    const { access } = await enroll();
    await push(access, { since: 0, upto: 500, rows: [row('k', '{"v":1}', 500)], tombstones: [] });
    await push(access, {
      since: 500,
      upto: 600,
      rows: [],
      tombstones: [{ tbl: 'settings', k1: 'k', k2: '', deletedAt: 600 }],
    });
    // 늦게 도착한 옛 편집(550) — 부활하면 G2 위반.
    await push(access, { since: 500, upto: 560, rows: [row('k', '{"v":0}', 550)], tombstones: [] });

    const r = await env.DB.prepare('SELECT COUNT(*) AS c FROM settings WHERE key = ?').bind('k').first<{ c: number }>();
    expect(r?.c, '삭제가 부활했다 — G2 위반').toBe(0);
  });
});

/* ── 관측 라우트(2026-07-25) ────────────────────────────────────────────────
   ⚠ 이 라우트는 **무인증**이다. 그 결정이 옳으려면 두 성질이 실물에서 성립해야 한다:
   ① 토큰 없이 받아 준다(오류는 인증 전에도 나고, 그게 가장 알고 싶은 종류다)
   ② 그런데도 **아무것도 저장하지 않는다**(공격이 곧 D1 쿼터 소진이 되지 않게).
   ②는 정적 검사로 증명할 수 없고 실 D1 위에서만 보인다 — 그래서 여기 있다. */
describe('클라이언트 텔레메트리(/api/log)', () => {
  it('인증 없이 받아 준다 — 오류는 토큰이 생기기 전에도 난다', async () => {
    const r = await SELF.fetch(`${BASE}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'error', name: 'boom', app: 'phone', route: '/today' }),
    });
    expect(r.status).toBe(204);
  });

  it('⚠ 스키마가 깨져도 204 다 — 400 을 주면 오류 보고가 오류를 낳는 고리가 된다', async () => {
    const bad = await SELF.fetch(`${BASE}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: '없는종류', name: 'x' }),
    });
    expect(bad.status).toBe(204);

    const notJson = await SELF.fetch(`${BASE}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'JSON 아님',
    });
    expect(notJson.status).toBe(204);
  });

  it('⚠ 모르는 필드는 거부한다(.strict) — 신뢰 경계의 규약', async () => {
    // strict 위반도 위 이유로 204 지만, **저장은 물론 로그 형식도 오염되지 않아야 한다**.
    const r = await SELF.fetch(`${BASE}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'error', name: 'x', 몰래: '주입' }),
    });
    expect(r.status).toBe(204);
  });

  it('⚠⚠ D1 에 아무것도 쓰지 않는다 — 폭주가 쿼터를 태우지 않게', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM settings').first<{ c: number }>();
    for (let i = 0; i < 5; i++) {
      await SELF.fetch(`${BASE}/api/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'vital', name: 'LCP', value: 1234.5 }),
      });
    }
    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM settings').first<{ c: number }>();
    expect(after?.c, '텔레메트리가 D1 에 썼다 — 설계 위반').toBe(before?.c);
  });

  it('본문 크기 상한이 이 라우트에도 걸린다', async () => {
    const r = await SELF.fetch(`${BASE}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'error', name: 'x', detail: 'ㄱ'.repeat(2 * 1024 * 1024) }),
    });
    expect(r.status).toBe(413);
  });
});

/* ── 레이트 리밋(2026-07-25) ────────────────────────────────────────────────
   ⚠ 이 동작은 **지금까지 테스트가 없었다.** 무인증 라우트의 유일한 남용 방어인데도
   "돌 것이다"에 맡겨져 있었다. 2026-07-25 에 주 방어를 `ratelimits` 바인딩으로 옮기면서
   같이 잠근다 — 바꾼 것에 테스트가 없으면 바꾼 줄도 모른다.

   ⚠ **버킷을 헤더로 격리한다.** 카운터 키는 `${CF-Connecting-IP}:${경로}` 이고 in-memory
   맵은 아이솔레이트 수명 동안 산다. 헤더를 안 주면 전 테스트가 `unknown:…` 버킷을 공유해
   이 테스트가 앞뒤 테스트를 429 로 죽인다(그리고 그 실패는 원인이 안 보인다). 전용 IP 를
   주면 이 테스트만의 버킷이 생겨 순서에 의존하지 않는다.

   ⚠ 테스트 환경에는 `AUTH_LIMITER` 바인딩이 없다 → 여기서 검증되는 것은 **in-memory 폴백**
   이다. 그게 정확히 폴백을 남겨 둔 이유(로컬·테스트에서 방어가 사라지지 않게)이고,
   바인딩 경로는 배포 환경에서만 존재하므로 여기서 잴 수 없다. */
describe('무인증 라우트 레이트 리밋', () => {
  it('창(60초) 안에서 상한(20)을 넘으면 429 · 넘기 전엔 통과한다', async () => {
    const ip = '203.0.113.9'; // 이 테스트 전용 버킷(TEST-NET-3 · 실제로 안 쓰이는 대역)
    const hit = () =>
      SELF.fetch(`${BASE}/api/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify({ kind: 'error', name: 'flood' }),
      });

    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await hit()).status);

    expect(codes.slice(0, 20), '상한 안쪽은 전부 통과해야 한다').toEqual(Array(20).fill(204));
    expect(codes.slice(20), '상한을 넘으면 429 여야 한다').toEqual(Array(5).fill(429));
  });

  it('⚠ 버킷은 IP 별로 갈린다 — 한 사람이 다른 사람을 막지 못한다', async () => {
    const flood = '203.0.113.10';
    for (let i = 0; i < 25; i++) {
      await SELF.fetch(`${BASE}/api/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': flood },
        body: JSON.stringify({ kind: 'error', name: 'flood' }),
      });
    }
    const other = await SELF.fetch(`${BASE}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.11' },
      body: JSON.stringify({ kind: 'error', name: 'innocent' }),
    });
    expect(other.status, '무관한 IP 가 함께 막혔다').toBe(204);
  });
});
