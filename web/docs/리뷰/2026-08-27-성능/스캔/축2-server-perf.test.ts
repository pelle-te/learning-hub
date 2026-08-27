/* [SCAN 축2] 서버 왕복 수·지연 곡선 — 실 workerd + 실 D1. 리뷰용 임시 계측(커밋 대상 아님). */
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch(
    [
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
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
});

const BASE = 'https://hub.example';
const PUSH_MAX = 500; // contract.MAX_BATCH_ITEMS
const PULL_LIMIT = 200; // server DEFAULT_PULL_LIMIT

async function enroll(name: string) {
  const n = await SELF.fetch(`${BASE}/api/enroll/new`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.HUB_ADMIN_KEY}` },
  });
  const { code } = (await n.json()) as { code: string };
  const cl = await SELF.fetch(`${BASE}/api/enroll/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  });
  const { deviceId, refreshToken } = (await cl.json()) as { deviceId: string; refreshToken: string };
  const t = await SELF.fetch(`${BASE}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, refreshToken }),
  });
  const { accessToken } = (await t.json()) as { accessToken: string };
  return accessToken;
}

const body = (i: number) =>
  JSON.stringify({ id: 'x' + i, t: '제목 ' + i, note: '가나다라마바사아자차 '.repeat(5), n: i, d: [1, 2, 3, 4, 5] });

function mkRows(n: number, from: number) {
  const slices = ['events', 'tasks', 'questions', 'retrievals', 'backlog'];
  return Array.from({ length: n }, (_, j) => {
    const i = from + j;
    return { tbl: 'records', key: [slices[i % 5], 'id' + i], data: [i, body(i)], updatedAt: 1_700_000_000_000 + i };
  });
}

describe('[scan] 왕복 곡선', () => {
  for (const N of [500, 2000, 5000, 10000]) {
    it(`N=${N}`, async () => {
      const a = await enroll('A' + N);
      // ── push: 클라이언트가 MAX_BATCH_ITEMS 로 자르는 것을 그대로 흉내
      let pushRt = 0;
      const t0 = Date.now();
      for (let off = 0; off < N; off += PUSH_MAX) {
        const rows = mkRows(Math.min(PUSH_MAX, N - off), off);
        const r = await SELF.fetch(`${BASE}/api/sync/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a}` },
          body: JSON.stringify({
            since: 1_700_000_000_000 + off - 1,
            upto: 1_700_000_000_000 + off + rows.length,
            rows,
            tombstones: [],
          }),
        });
        expect(r.status).toBe(200);
        pushRt++;
      }
      const pushMs = Date.now() - t0;

      // ── pull: 두 번째 기기가 전량 받아오기(drainPull 그대로)
      const b = await enroll('B' + N);
      let since = 0,
        pullRt = 0,
        got = 0;
      const t1 = Date.now();
      for (let i = 0; i < 200; i++) {
        const r = await SELF.fetch(`${BASE}/api/sync/pull?since=${since}`, {
          headers: { Authorization: `Bearer ${b}` },
        });
        expect(r.status).toBe(200);
        const j = (await r.json()) as { rows: unknown[]; tombstones: unknown[]; upto: number };
        pullRt++;
        got += j.rows.length;
        since = j.upto;
        if (j.rows.length + j.tombstones.length === 0) break;
      }
      const pullMs = Date.now() - t1;

      // ── 같은 데이터를 limit=500(=MAX_BATCH_ITEMS)으로 다시 받아온다 — 왕복 수/회당 비용 비교
      const c = await enroll('C' + N);
      let since2 = 0,
        pullRt2 = 0,
        got2 = 0,
        bytes2 = 0,
        worst2 = 0;
      const t2 = Date.now();
      for (let i = 0; i < 200; i++) {
        const s0 = Date.now();
        const r = await SELF.fetch(`${BASE}/api/sync/pull?since=${since2}&limit=500`, {
          headers: { Authorization: `Bearer ${c}` },
        });
        const txt = await r.text();
        const dt = Date.now() - s0;
        if (dt > worst2) worst2 = dt;
        bytes2 = Math.max(bytes2, new TextEncoder().encode(txt).length);
        const j = JSON.parse(txt) as { rows: unknown[]; tombstones: unknown[]; upto: number };
        pullRt2++;
        got2 += j.rows.length;
        since2 = j.upto;
        if (j.rows.length + j.tombstones.length === 0) break;
      }
      const pullMs2 = Date.now() - t2;
      console.log(
        `L500|${N}|pull_rt=${pullRt2}|pull_ms=${pullMs2}|worst_rt_ms=${worst2}|max_body_bytes=${bytes2}|pulled=${got2}`,
      );
      expect(got2).toBe(N);
      console.log(
        `ROW|${N}|push_rt=${pushRt}|push_ms=${pushMs}|push_ms_per_rt=${(pushMs / pushRt).toFixed(1)}|pull_rt=${pullRt}|pull_ms=${pullMs}|pull_ms_per_rt=${(pullMs / pullRt).toFixed(1)}|pulled=${got}|pull_limit=${PULL_LIMIT}`,
      );
      expect(got).toBe(N);
    }, 300_000);
  }
});
