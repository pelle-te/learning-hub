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

/** 응답 큐 — 순서대로 하나씩 돌려준다. **두 전송이 공유한다**(아래). */
let queue: { status: number; body?: unknown }[] = [];

/* ⚠ 전송 경로가 둘이다(C-5 후속): 셸은 Rust 중계(`cloud_http`), 브라우저·폰은 `fetch`.
   큐를 공유시켜 **같은 케이스가 양쪽에서 그대로 돈다** — 한쪽만 검증하면 다른 쪽이 조용히
   갈린다. 실제로 이 분기가 생긴 계기가 "셸에서만 CSP 에 막히는" 결함이었다. */
let calls: { url: string; method: string }[] = [];
const next = () => queue.shift() ?? { status: 200, body: {} };

const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
  calls.push({ url: String(url), method: init?.method ?? 'GET' });
  const n = next();
  return {
    ok: n.status >= 200 && n.status < 300,
    status: n.status,
    text: async () => JSON.stringify(n.body ?? {}),
  } as unknown as Response;
});

/** Rust `cloud_http` 응답 — 본문은 **문자열**이다(파싱은 프런트가 소유한다). */
invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
  if (cmd !== 'cloud_http') return undefined;
  calls.push({ url: String(args.url), method: String(args.method) });
  const n = next();
  return { status: n.status, body: JSON.stringify(n.body ?? {}) };
});

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  store.clear();
  queue = [];
  calls = [];
  exec.mockClear();
  select.mockClear();
  fetchMock.mockClear();
  invoke.mockClear(); // ⚠ 호출 이력이 케이스 간 누적되면 "몇 번 불렸나" 단정이 전부 거짓이 된다

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
    const tokenCalls = calls.filter((c) => c.url.includes('/api/token'));
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
  /* ⚠⚠ **이 케이스의 계약이 2026-07-30 `/감사 근본`(H16)에서 갈렸다.**

     종전엔 _"모르는 테이블이 섞이면 던진다"_ 였다. 신뢰 경계 논리로는 맞지만 **수신 방향에선
     정반대 결과**를 낸다: 다음 릴리스에서 테이블이 하나 늘면 업데이트 안 한 기기가 배치를 통째로
     throw 하고 `pullMark` 가 전진하지 않아 **수신이 영구 정지**한다. 그리고 버전 스큐는 구조적이다
     (데스크톱 업데이터는 승인 대기 · 폰 SW 는 autoUpdate).

     새 계약: **모르는 것은 버리고 아는 것은 그대로 엄격하게 검사한다.** 그래서 두 쪽을 함께
     잠근다 — 아래 두 케이스가 각각 그 절반이다. 한쪽만 검사하면 "전부 통과시키는 파서"도 통과한다. */
  it('모르는 테이블은 **버리고** 나머지를 살린다 — 구버전 기기의 수신이 멈추지 않는다', async () => {
    queue = [
      { status: 200, body: { accessToken: 'A', expiresIn: 900 } },
      {
        status: 200,
        body: {
          since: 0,
          upto: 600,
          rows: [
            { tbl: '미래테이블', key: ['x'], data: ['v'], updatedAt: 100 },
            { tbl: 'settings', key: ['k'], data: ['v'], updatedAt: 500 },
          ],
          tombstones: [],
          // 서버가 봉투에 새 필드를 더해도 죽지 않아야 한다(`.strict()` 를 뺀 이유).
          진단메타: { 서버버전: 'x' },
        },
      },
    ];
    const batch = await pullChanges(CFG, 0);
    expect(batch.rows).toHaveLength(1);
    expect(batch.rows[0]!.tbl).toBe('settings');
    /* ⚠ `upto` 는 **그대로 전진한다.** 버린 것은 "우리가 쓸 수 없는 것"이고 다시 받아도 또 버린다 —
       전진시키지 않으면 그 구간을 영원히 되묻는다(H2/2026-07-24 가 고친 정체와 같은 형태). */
    expect(batch.upto).toBe(600);
  });

  /* ⚠⚠ **이 케이스는 D002(2026-08-21 데이터 축)에서 뒤집혔다.**

     옛 단정: *"아는 테이블의 내용이 계약과 다르면 **던진다** — 관용은 경계에만 있다."* 앞 절은
     지금도 옳지만(밀린 열이 upsert 되면 안 된다) **던지는 것이 처방이 아니었다**: 배치를 통째로
     거부하면 `commitPullMark` 에 도달하지 못해 그 기기의 **수신이 영구 정지**한다 — H16 이
     `tbl` 축에서 막으려던 바로 그 결말이 열 축으로 그대로 났다.

     가설이 아니다: 009 가 `summaries` 를 `(sid,ord)` → `(sid,id,ord)` 로 바꿨고, 그 마이그레이션이
     지시하는 배포 순서가 «D1 먼저, 앱 나중» 이다. 그 창이 정확히 이 경로다.

     새 계약은 `tbl` 축과 **같다**: 그 행만 버리고 · `upto` 는 전진하고 · 버린 건수는
     `dropped` 로 올라가 텔레메트리와 «업데이트가 필요할 수 있어요» 토스트가 된다(관측 없는
     관용은 침묵과 같다). 지켜야 할 것 — **밀린 열이 병합되지 않는다** — 은 그대로다. */
  it('⚠ 아는 테이블이라도 열 개수가 다르면 **그 행만** 버린다(D002) — 병합하지도, 배치를 죽이지도 않는다', async () => {
    queue = [
      { status: 200, body: { accessToken: 'A', expiresIn: 900 } },
      {
        status: 200,
        body: {
          since: 0,
          upto: 600,
          rows: [
            // settings 는 데이터 열이 1개인데 2개를 보냈다 → 열이 밀린 채 upsert 되는 부류.
            { tbl: 'settings', key: ['k'], data: ['v', '여분'], updatedAt: 500 },
            { tbl: 'settings', key: ['정상'], data: ['v'], updatedAt: 500 },
          ],
          tombstones: [],
        },
      },
    ];
    const batch = await pullChanges(CFG, 0);
    expect(
      batch.rows.map((r) => r.key[0]),
      '밀린 행이 병합되면 안 된다',
    ).toEqual(['정상']);
    expect(batch.upto, '전진하지 않으면 그 구간을 영원히 되묻는다').toBe(600);
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

/* ============================================================
   전송 경로 — 이 파일에서 가장 중요한 블록이다.

   C-5 는 처음에 웹뷰에서 생 `fetch` 로 워커를 불렀고, **셸에선 한 요청도 못 나갔다** —
   C-3 의 CSP(`connect-src 'self' ipc:`)가 막았기 때문이다. 트랙 A 는 Chromium 이라 CSP 가
   없고 트랙 B 는 클라우드 경로를 안 타서, 게이트가 전부 녹색인 채로 통과했다.

   그래서 여기서 잠그는 것은 **"어느 쪽에서 도느냐에 따라 나가는 문이 달라진다"** 이다.
   ⚠ 셸에서 `fetch` 가 한 번이라도 불리면 그건 CSP 에 막힌다는 뜻이다.
============================================================ */
describe('전송 경로 분기', () => {
  it('⚠ 셸에선 fetch 를 쓰지 않는다 — CSP 가 막는다(실측). Rust 중계로 나간다', async () => {
    queue = [{ status: 200, body: { deviceId: 'd', refreshToken: 'r' } }];
    await enrollDevice('https://hub.example', 'C', 'PC');

    expect(fetchMock, '셸에서 fetch 가 불렸다 — CSP 에 막혀 실사용에서 죽는다').not.toHaveBeenCalled();
    const relayed = invoke.mock.calls.filter((c) => c[0] === 'cloud_http');
    expect(relayed).toHaveLength(1);
    expect(String((relayed[0][1] as Record<string, unknown>).url)).toContain('/api/enroll/claim');
  });

  it('브라우저(폰·dev)에선 fetch 로 나간다 — 거긴 CSP 도 IPC 도 없다', async () => {
    // C-6 폰 웹앱이 도는 조건. 같은 client.ts 가 반대편 분기를 탄다.
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    queue = [{ status: 200, body: { deviceId: 'd', refreshToken: 'r' } }];
    await enrollDevice('https://hub.example', 'C', '폰');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.filter((c) => c[0] === 'cloud_http')).toHaveLength(0);
  });

  it('두 경로가 같은 결과를 낸다 — 분기가 의미를 바꾸면 안 된다', async () => {
    queue = [{ status: 200, body: { deviceId: 'd', refreshToken: 'r' } }];
    const viaShell = await enrollDevice('https://hub.example', 'C', 'x');

    store.clear();
    _resetToken();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    queue = [{ status: 200, body: { deviceId: 'd', refreshToken: 'r' } }];
    const viaBrowser = await enrollDevice('https://hub.example', 'C', 'x');

    expect(viaShell).toEqual(viaBrowser);
  });
});
