// @vitest-environment jsdom
/* ============================================================
   cloudClient.test.ts — 클라우드 전송·토큰 수명(C-5).

   여기서 잠그는 핵심은 **재시도 가능/불가의 분류**다. 잘못 분류하면 둘 중 하나가 난다:

   · 재시도 불가를 가능으로 → 백오프가 **하루 종일 헛친다**. 앱은 "동기화 중"으로 보이고
     사용자는 멈춘 걸 모른다(C-1 이 `PermanentPushError` 를 넣은 이유).
   · 재시도 가능을 불가로 → 잠깐의 네트워크 장애로 동기화가 **영구 중단**된다.

   그리고 401 은 이 시스템에서 **정상 경로**다(액세스 토큰이 15분마다 만료된다).
   갱신 후 한 번만 다시 치고, 그래도 401 이면 우리 쪽 문제가 아니므로 끊는다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const store = new Map<string, string>();
const exec = vi.fn(async (q: string, a: unknown[] = []) => {
  if (/INSERT INTO sync_state/.test(q)) store.set(String(a[0]), String(a[1]));
  if (/DELETE FROM sync_state/.test(q)) store.delete(String(a[0]));
  return undefined;
});
const select = vi.fn(async (_q: string, a: unknown[] = []) => {
  const v = store.get(String(a[0]));
  return v == null ? [] : [{ value: v }];
});
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => ({ execute: exec, select }) },
}));

import {
  enrollDevice,
  disconnectCloud,
  readCloudConfig,
  makeTransport,
  pullChanges,
  _resetToken,
  type CloudConfig,
} from '@/lib/cloud/client';
import { isPermanent } from '@/lib/cloud/push';

const CFG: CloudConfig = { baseUrl: 'https://hub.example', deviceId: 'dev1', refreshToken: 'ref1' };
const okBatch = { since: 0, upto: 100, rows: [], tombstones: [] };

/** 응답 큐 — 순서대로 하나씩 돌려준다. */
let queue: { status: number; body?: unknown }[] = [];
const fetchMock = vi.fn(async () => {
  const n = queue.shift() ?? { status: 200, body: {} };
  return {
    ok: n.status >= 200 && n.status < 300,
    status: n.status,
    json: async () => n.body ?? {},
  } as unknown as Response;
});

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  store.clear();
  queue = [];
  exec.mockClear();
  select.mockClear();
  fetchMock.mockClear();
  _resetToken();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('기기 등록', () => {
  it('성공하면 설정이 저장돼 다시 읽힌다', async () => {
    queue = [{ status: 200, body: { deviceId: 'd', refreshToken: 'r' } }];
    const cfg = await enrollDevice('https://hub.example/', 'CODE', '내 PC');
    expect(cfg.deviceId).toBe('d');
    expect(cfg.baseUrl, '끝 슬래시가 제거돼야 한다').toBe('https://hub.example');
    expect(await readCloudConfig()).toEqual({ baseUrl: 'https://hub.example', deviceId: 'd', refreshToken: 'r' });
  });

  it('끝 슬래시가 여러 개여도 정규화된다', async () => {
    queue = [{ status: 200, body: { deviceId: 'd', refreshToken: 'r' } }];
    const cfg = await enrollDevice('https://hub.example///', 'CODE', 'x');
    expect(cfg.baseUrl).toBe('https://hub.example');
  });

  it('코드가 틀리면(401) 던진다', async () => {
    queue = [{ status: 401 }];
    await expect(enrollDevice('https://hub.example', 'BAD', 'x')).rejects.toThrow(/등록 실패/);
  });

  it('응답이 계약과 다르면 던진다 — 저장해 두면 나중에 조용히 실패한다', async () => {
    queue = [{ status: 200, body: { deviceId: 'd' } }]; // refreshToken 누락
    await expect(enrollDevice('https://hub.example', 'C', 'x')).rejects.toThrow(/계약/);
    expect(await readCloudConfig(), '깨진 설정이 저장되면 안 된다').toBeNull();
  });

  it('설정이 일부만 있으면 null — "아직 연결 안 됨"으로 읽는다', async () => {
    store.set('cloud:baseUrl', 'https://x');
    expect(await readCloudConfig()).toBeNull();
  });

  it('연결을 끊으면 자격증명이 사라진다', async () => {
    queue = [{ status: 200, body: { deviceId: 'd', refreshToken: 'r' } }];
    await enrollDevice('https://hub.example', 'C', 'x');
    await disconnectCloud();
    expect(await readCloudConfig()).toBeNull();
  });
});

describe('토큰 수명', () => {
  it('한 번 받은 토큰을 재사용한다 — 매 요청마다 갱신하면 한도를 태운다', async () => {
    queue = [
      { status: 200, body: { accessToken: 'AT', expiresIn: 900 } },
      { status: 200, body: okBatch },
      { status: 200, body: okBatch },
    ];
    await pullChanges(CFG, 0);
    await pullChanges(CFG, 0);
    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('⚠ 리프레시가 거부되면(401) **재시도 불가**로 올린다 — 아니면 영원히 돈다', async () => {
    queue = [{ status: 401 }];
    const err = await pullChanges(CFG, 0).catch((e: unknown) => e);
    expect(isPermanent(err)).toBe(true);
  });

  it('401 을 받으면 갱신 후 한 번 다시 친다(만료는 정상 경로다)', async () => {
    queue = [
      { status: 200, body: { accessToken: 'OLD', expiresIn: 900 } },
      { status: 401 }, // 만료된 토큰으로 pull
      { status: 200, body: { accessToken: 'NEW', expiresIn: 900 } },
      { status: 200, body: okBatch },
    ];
    await expect(pullChanges(CFG, 0)).resolves.toEqual(okBatch);
  });

  it('⚠ 갱신한 토큰으로도 401 이면 끊는다 — 기기가 폐기된 경우다', async () => {
    queue = [
      { status: 200, body: { accessToken: 'A', expiresIn: 900 } },
      { status: 401 },
      { status: 200, body: { accessToken: 'B', expiresIn: 900 } },
      { status: 401 },
    ];
    const err = await pullChanges(CFG, 0).catch((e: unknown) => e);
    expect(isPermanent(err), '무한 재시도로 빠진다').toBe(true);
  });
});

describe('push 의 실패 분류', () => {
  const t = () => makeTransport(CFG);

  it('400(계약 위반)은 재시도 불가 — 같은 배치를 다시 보낼 뿐이다', async () => {
    queue = [
      { status: 200, body: { accessToken: 'A', expiresIn: 900 } },
      { status: 400, body: { detail: 'rows.0: 데이터 열 2개여야 하는데 1개' } },
    ];
    const err = await t()
      .push(okBatch)
      .catch((e: unknown) => e);
    expect(isPermanent(err)).toBe(true);
    expect(String(err)).toContain('데이터 열');
  });

  it('⚠ 5xx 는 재시도 **가능**이다 — 일시 장애까지 끊으면 안 된다', async () => {
    queue = [{ status: 200, body: { accessToken: 'A', expiresIn: 900 } }, { status: 503 }];
    const err = await t()
      .push(okBatch)
      .catch((e: unknown) => e);
    expect(isPermanent(err)).toBe(false);
  });

  it('성공하면 조용히 끝난다', async () => {
    queue = [
      { status: 200, body: { accessToken: 'A', expiresIn: 900 } },
      { status: 200, body: { ok: true } },
    ];
    await expect(t().push(okBatch)).resolves.toBeUndefined();
  });
});

describe('받아온 것도 검증한다', () => {
  it('서버 응답이 계약과 다르면 던진다 — "우리 서버니까"는 신뢰 근거가 아니다', async () => {
    queue = [
      { status: 200, body: { accessToken: 'A', expiresIn: 900 } },
      {
        status: 200,
        body: { since: 0, upto: 100, rows: [{ tbl: '모르는테이블', key: [], data: [], updatedAt: 1 }], tombstones: [] },
      },
    ];
    await expect(pullChanges(CFG, 0)).rejects.toThrow(/계약과 다릅니다/);
  });

  it('정합한 응답은 그대로 통과한다', async () => {
    queue = [
      { status: 200, body: { accessToken: 'A', expiresIn: 900 } },
      {
        status: 200,
        body: {
          since: 0,
          upto: 600,
          rows: [{ tbl: 'settings', key: ['k'], data: ['v'], updatedAt: 500 }],
          tombstones: [],
        },
      },
    ];
    const b = await pullChanges(CFG, 0);
    expect(b.rows).toHaveLength(1);
    expect(b.upto).toBe(600);
  });
});
