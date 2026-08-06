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

  /* ⚠⚠ **열린 실시간 소켓까지 끊는가**(H15 · 2026-07-30 `/감사 근본`).

     종전 구현은 `revoked_at` 만 세우고 DO 에 아무것도 알리지 않았다. Hibernation 소켓은 무기한
     유지되므로 **폐기된 기기가 `poke` 를 영구히 계속 받았다** — 위 케이스가 잠근 "15분 유예"는
     이 채널에 아예 적용되지 않았다.

     ⚠ 이 케이스가 **두 쪽을 함께** 잠그는 것이 핵심이다: 태그 없이 `getWebSockets()` 전량을
     닫아도 "폐기된 소켓이 닫혔다"는 통과한다. 멀쩡한 기기가 살아 있는지를 같이 보지 않으면
     실시간 동기화를 통째로 끊는 구현이 녹색으로 지나간다. */
  it('⚠⚠ 폐기가 열린 실시간 소켓을 끊는다 — 그리고 **그 기기 것만**(H15)', async () => {
    const victim = await enroll('잃어버린폰');
    const admin = await enroll('PC');

    /* 실제 라우트 그대로 붙는다 — 토큰은 `Sec-WebSocket-Protocol`(P0-2: URL 아닌 헤더). */
    const open = async (access: string): Promise<WebSocket> => {
      const r = await SELF.fetch(`${BASE}/api/sync/live`, {
        headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': access },
      });
      expect(r.status, '실시간 소켓 업그레이드가 성립하지 않는다').toBe(101);
      const ws = r.webSocket;
      expect(ws, '101 인데 webSocket 이 없다 — 업그레이드 위임이 깨졌다').toBeTruthy();
      ws!.accept();
      return ws!;
    };

    const victimWs = await open(victim.access);
    const adminWs = await open(admin.access);

    const victimClosed = new Promise<number>((resolve) => {
      victimWs.addEventListener('close', (e) => resolve(e.code));
    });
    let adminClosed = false;
    adminWs.addEventListener('close', () => {
      adminClosed = true;
    });

    const rev = await SELF.fetch(`${BASE}/api/devices/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.access}` },
      body: JSON.stringify({ deviceId: victim.deviceId }),
    });
    expect(rev.status).toBe(200);
    const body = (await rev.json()) as { liveClosed?: number };
    expect(body.liveClosed, '폐기가 DO 에 알리지 않았다 — 소켓이 그대로 산다').toBe(1);

    expect(await victimClosed, '폐기 사유 코드(4003)로 닫히지 않았다').toBe(4003);
    expect(adminClosed, '멀쩡한 기기 소켓까지 끊었다 — 태그 없이 전량 close 한 구현이다').toBe(false);
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

/* ── 시계가 앞선 기기가 전 기기를 오염시키지 못한다(M1) ────────────────────────
   클라이언트 스탬프는 `max(Date.now(), 직전+1)` 이고 병합은 **받아온 값으로 래칫**한다. 그 둘이
   맞물리면 시계가 몇 년 앞선 기기 하나가 전 기기를 영구히 `직전+1` 체제로 밀어, `stamp.ts` 가
   약속한 "언젠가 벽시계로 복귀"가 깨진다. 서버는 권위 시계를 쥐고도 안 쓰고 있었다.
   ⚠ 이 성질은 **서버에서만** 잠글 수 있다 — 시계가 틀린 기기는 자기가 틀렸다는 걸 모른다. */
describe('스탬프를 서버 시계로 클램프한다(M1)', () => {
  it('미래로 몇 년 앞선 스탬프는 now+유예로 잘린다', async () => {
    const { access } = await enroll();
    const future = Date.now() + 5 * 365 * 24 * 3600 * 1000; // 5년 뒤
    await push(access, { since: 0, upto: future, rows: [row('clk', '{"v":1}', future)], tombstones: [] });
    const r = await env.DB.prepare('SELECT updated_at AS u FROM settings WHERE key = ?')
      .bind('clk')
      .first<{ u: number }>();
    expect(r?.u, '미래 스탬프가 그대로 저장됐다 — 전 기기가 오염된다').toBeLessThan(Date.now() + 10 * 60 * 1000);
  });

  it('⚠ 과거 스탬프는 건드리지 않는다 — 올리면 남의 편집을 이기게 된다', async () => {
    const { access } = await enroll();
    const past = Date.now() - 24 * 3600 * 1000; // 하루 전(뒤처진 시계)
    await push(access, { since: 0, upto: past, rows: [row('old', '{"v":1}', past)], tombstones: [] });
    const r = await env.DB.prepare('SELECT updated_at AS u FROM settings WHERE key = ?')
      .bind('old')
      .first<{ u: number }>();
    expect(r?.u, '과거 스탬프를 올렸다 — 방어가 막으려던 것을 저지른다').toBe(past);
  });

  /* ⚠⚠ **파괴적인 문장에도 같은 클램프가 걸리는가**(M-7 · 2026-08-06 감사).

     종전엔 툼스톤 upsert 만 클램프하고 **짝인 행 DELETE 는 원시 스탬프**를 썼다. 두 문장은 한
     결정(= 이 삭제가 이 행을 이기는가)의 기록과 집행이므로, **다른 값을 보면 기록과 집행이 갈린다**:
     저장되는 툼스톤은 `now+유예`라 미래 행을 못 이기는데, DELETE 범위는 서기 2100 이라 그 행을
     지운다. 그러면 서버엔 행이 없고 다른 기기엔 남는다(그쪽은 클램프된 툼스톤에 진 적이 없다).

     ⚠ **평시엔 두 값이 같은 결과를 낸다** — 모든 행이 push 때 같은 클램프를 타서 천장을 넘을 수
     없기 때문이다. 그래서 이 케이스는 천장을 넘은 행을 **직접 심어** 만든다: 클램프(M1) 도입
     *이전*에 올라간 행이 실제로 그 모양이고, 앞으로 클램프를 우회하는 경로가 하나라도 생기면
     같은 모양이 된다. 즉 여기서 잠그는 것은 "오늘 재현되는 버그"가 아니라 **두 문장이 같은 값을
     본다는 불변식**이다 — 그 불변식이 없으면 위 소실이 조용히 성립한다. */
  it('⚠⚠ 툼스톤이 **이기지 못하는 행은 지우지도 못한다** — 기록과 집행이 같은 값을 본다', async () => {
    const { access } = await enroll();
    const future = Date.now() + 5 * 365 * 24 * 3600 * 1000; // 5년 뒤
    // ① 클램프 천장을 넘는 행(클램프 도입 이전에 올라간 것과 같은 모양) — 직접 심는다.
    await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)')
      .bind('legacy', '{"v":1}', future + 1000)
      .run();
    // ② 시계가 앞선 기기의 삭제. 저장될 툼스톤은 `now+유예`라 ①을 **이기지 못한다**.
    await push(access, {
      since: 0,
      upto: future,
      rows: [],
      tombstones: [{ tbl: 'settings', k1: 'legacy', k2: '', deletedAt: future }],
    });

    const r = await env.DB.prepare('SELECT COUNT(*) AS c FROM settings WHERE key = ?')
      .bind('legacy')
      .first<{ c: number }>();
    expect(r?.c, '이기지 못하는 툼스톤이 행을 지웠다 — 기록(클램프)과 집행(원시)이 갈렸다').toBe(1);
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

/* ============================================================
   ⚠⚠ H4(2026-07-31 `/감사 근본`) — **서버 스키마가 앱보다 낮을 때.**

   `009_summaries_identity.sql` 은 _"적용 전까지 서버는 옛 열 구성이라 push 가 **400** 을 받는다"_
   라 적어 뒀는데 사실이 아니었다: zod 는 통과하고(스키마 파일을 클라이언트와 **공유**하므로
   코드끼리는 늘 일치한다) D1 이 `no such column` 을 던지는데 그 문자열이 한도 정규식에 안 걸려
   **500** 으로 나갔다. 클라이언트는 5xx 를 *일시 오류*로 읽는 것이 옳은 규약이라(`push.ts`)
   **영구 백오프**를 돈다 — 배포 순서를 틀리면 그 자체가 조용한 정지다.

   ⚠ 이 상태는 **이 파일의 나머지가 원리적으로 못 만든다**: `beforeEach` 가 항상 전 마이그레이션을
   적용하므로 스큐가 재현되지 않는다. 그래서 여기서만 표를 잠깐 치우고 되돌린다(같은 테스트 안에서
   `finally` 로 복원 — 이름 변경이라 PK·인덱스까지 그대로 돌아온다).

   ⚠ SQL 문구는 D1/SQLite 가 소유하고 우리가 고정할 수 없다 → 문자열 휴리스틱이다. 그래서 판정이
   틀렸을 때의 방향을 안전한 쪽으로 잡는다: 못 알아보면 500(재시도 가능)이다.
============================================================ */
describe('⚠⚠ 스키마 스큐(서버 D1 이 앱보다 낮다)', () => {
  it('재시도 불가로 분류한다 — 500 이면 클라이언트가 영구 백오프를 돈다', async () => {
    const { access } = await enroll();
    await env.DB.prepare('ALTER TABLE summaries RENAME TO summaries_skew_tmp').run();
    try {
      const p = await push(access, {
        since: 0,
        upto: 100,
        rows: [{ tbl: 'summaries', key: ['s1', 'i1'], data: [0, '{}'], updatedAt: 100 }],
        tombstones: [],
      });
      expect(p.status, '5xx 로 나가면 "일시 오류"라 읽혀 하루 종일 헛친다').toBe(400);
      const body = (await p.json()) as { error?: string; permanent?: boolean; detail?: string };
      expect(body.permanent, '`permanent` 는 클라이언트가 읽는 계약이다').toBe(true);
      expect(body.detail, '할 일(마이그레이션 적용)을 말해야 한다').toMatch(/마이그레이션/);
      expect(JSON.stringify(body), '내부 SQL 을 흘리지 않는다').not.toMatch(/no such|SELECT|INSERT/i);
    } finally {
      await env.DB.prepare('ALTER TABLE summaries_skew_tmp RENAME TO summaries').run();
    }
  });
});
