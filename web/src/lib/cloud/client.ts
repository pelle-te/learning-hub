/* ============================================================
   cloud/client.ts — 클라우드와 실제로 말하는 층(C-5).

   C-1 이 `CloudTransport` 인터페이스만 두고 구현을 비워 뒀다(서버가 없었으니까). 여기가 그
   구현이고, 더해서 **토큰 수명 관리**를 소유한다.

   ## 무엇을 어디에 두나

   | 무엇 | 어디 | 왜 |
   | --- | --- | --- |
   | 서버 URL·기기 id·리프레시 토큰 | **`sync_state` 테이블** | 기기 로컬이고 **내보내기·동기화 대상이 아니다**. 별도 테이블이라 그 배제가 구조적으로 보장된다(`db.rs` v4 주석) |
   | 액세스 토큰 | **메모리만** | 수명 15분. 디스크에 남길 이유가 없고, 남기면 유출면만 넓어진다 |

   ## ⚠ 401 은 한 번만 재시도한다

   액세스 토큰은 만료되므로 401 이 **정상 경로**다. 받으면 갱신하고 한 번 다시 친다.
   무한 재시도하지 않는 이유: 기기가 폐기됐으면 갱신도 401 이라 영원히 돈다. 두 번째 401 은
   **재시도 불가**로 접어 `PermanentPushError` 로 올린다 — 그래야 `push.ts` 의 백오프가
   하루 종일 헛치지 않는다(C-1 에서 그 방어를 넣은 이유 그대로).
============================================================ */
import { execDb, isSqlitePrimary, selectDb } from '../db/sqlite';
// ⚠ 부팅 경로 — `isTauri` 는 초소형 모듈에서, `cloudHttp` 는 셸 분기 안에서 동적으로(H7).
import { isTauri } from '../isTauri';
import { PermanentPushError, type CloudTransport } from './push';
import { PULL_MARK_KEY, WATERMARK_KEY } from './outbox';
// ⚠ 지연 import 로 바꾸지 말 것 — 근거는 `push.ts` 의 같은 import 위 주석(실측 0.3KB).
import { parseInboundBatch } from './schema';
import type { OutboxBatch } from './contract';

/* ── 전송 분기 ───────────────────────────────────────────────────

   ⚠ **셸에선 웹뷰가 직접 나가지 않는다.** C-3 의 CSP(`connect-src 'self' ipc:`)가 외부
   연결을 막기 때문이고, 이건 추측이 아니라 트랙 B 로 실측한 것이다:
   `violations: ["connect-src :: https://…"]`. CSP 를 푸는 대신 요청을 Rust 로 내렸다 —
   뉴스·Ollama·Anki 가 이미 그 규약이고, 그래서 "셸에서 외부로 나가는 연결이 하나도 없다"가
   유지된다(`src-tauri/src/cloud.rs` 머리주석).

   **폰(C-6)은 진짜 브라우저라 `fetch` 로 간다.** 그쪽엔 CSP 도 IPC 도 없다. 분기가 여기
   하나에만 있으므로 아래 요청 함수들은 어느 쪽에서 도는지 몰라도 된다 — `api.ts` 의 사상.  */

/** 전송 결과. `Response` 를 흉내 내지 않는다 — 필요한 두 가지만 들고 다닌다. */
interface Reply {
  status: number;
  ok: boolean;
  body: string;
}

async function send(url: string, method: string, headers: Record<string, string>, body?: string): Promise<Reply> {
  if (isTauri()) {
    const { cloudHttp } = await import('../tauri'); // 셸 전용 중계(CSP) — 폰은 이 청크를 안 받는다
    const r = await cloudHttp(url, method, headers, body);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, body: r.body };
  }
  const res = await fetch(url, { method, headers, body });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

/** 본문을 JSON 으로 읽는다. 실패하면 null — 호출부가 계약 위반으로 처리한다. */
function asJson(reply: Reply): unknown {
  try {
    return JSON.parse(reply.body);
  } catch {
    return null;
  }
}

/** `sync_state` 에 두는 기기 로컬 설정. 워터마크와 같은 테이블을 쓴다. */
export interface CloudConfig {
  baseUrl: string;
  deviceId: string;
  refreshToken: string;
}

const KEYS = { baseUrl: 'cloud:baseUrl', deviceId: 'cloud:deviceId', refresh: 'cloud:refreshToken' } as const;

async function getKey(key: string): Promise<string | null> {
  const r = await selectDb<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key]);
  return r?.[0]?.value ?? null;
}

async function setKey(key: string, value: string): Promise<boolean> {
  return execDb('INSERT INTO sync_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2', [
    key,
    value,
  ]);
}

/** 저장된 클라우드 설정. 하나라도 없으면 null = "아직 연결 안 됨". */
export async function readCloudConfig(): Promise<CloudConfig | null> {
  const [baseUrl, deviceId, refreshToken] = await Promise.all([
    getKey(KEYS.baseUrl),
    getKey(KEYS.deviceId),
    getKey(KEYS.refresh),
  ]);
  if (!baseUrl || !deviceId || !refreshToken) return null;
  return { baseUrl, deviceId, refreshToken };
}

/**
 * 업데이터가 볼 `latest.json` 주소(C3 · 2026-07-26 감사).
 *
 * **폰 웹앱과 같은 오리진의 정적 자산**이다(`web/public/updates/latest.json` → `web/dist` →
 * Workers assets). 왜 GitHub Releases 가 아닌지: 그 URL 은 저장소가 비공개라 **실측 404** 였고,
 * 업데이터는 토큰을 싣지 않아 모든 사용자에게 확인이 실패했다(`릴리스.md` 대안②).
 *
 * 미연결이면 `undefined` — 그땐 `tauri.conf.json` 의 기본 엔드포인트로 떨어진다(= 종전 거동).
 */
export function updateManifestUrl(cfg: CloudConfig | null): string | undefined {
  return cfg ? `${cfg.baseUrl}/updates/latest.json` : undefined;
}

/** 등록 코드로 이 기기를 클라우드에 붙인다. 성공하면 설정이 저장된다. */
export async function enrollDevice(baseUrl: string, code: string, name: string): Promise<CloudConfig> {
  // 끝 슬래시 제거. 정규식(`/\/+$/`)은 백트래킹 때문에 ReDoS 대상이라 쓰지 않는다(sonarjs).
  let base = baseUrl;
  while (base.endsWith('/')) base = base.slice(0, -1);
  const res = await send(
    `${base}/api/enroll/claim`,
    'POST',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ code, name }),
  );
  /* ⚠⚠ **상태코드마다 다른 처방을 준다(H23 · 2026-07-30 `/감사 근본`).**

     종전엔 전 상태코드가 _"코드가 틀렸거나 만료됐습니다"_ 였다. 그런데 `/api/enroll/*` 에는
     `rateGuard` 가 붙어 있어(`server/src/index.ts`) **429** 를 준다 → 오진의 처방("새 코드를
     받으세요")이 **리미터를 한 번 더 때린다**. 사용자는 코드를 계속 새로 받으며 점점 더 막힌다.

     이 저장소가 H17(D1 한도를 "재시도 가능"으로 오분류)에서 고친 것과 같은 부류다: 서버는
     사유를 정확히 말하고 있는데 클라이언트가 한 문장으로 뭉갰다. */
  if (!res.ok) {
    const why =
      res.status === 429
        ? '요청이 너무 잦아요 — 잠시 뒤 다시 시도해 주세요(새 코드를 받을 필요는 없어요).'
        : res.status >= 500
          ? '서버에 문제가 있어요 — 잠시 뒤 다시 시도해 주세요.'
          : '코드가 틀렸거나 만료됐습니다.';
    throw new Error(`등록 실패(${res.status}) — ${why}`);
  }
  const j = (asJson(res) ?? {}) as { deviceId?: unknown; refreshToken?: unknown };
  if (typeof j.deviceId !== 'string' || typeof j.refreshToken !== 'string') {
    throw new Error('등록 응답이 계약과 다릅니다.');
  }
  const cfg: CloudConfig = { baseUrl: base, deviceId: j.deviceId, refreshToken: j.refreshToken };
  /* ⚠ **세 자격증명 쓰기가 모두 성공해야 연결이다.** 종전엔 결과를 버렸는데(Promise.all 반환 무시),
     하나라도 실패하면 서버엔 기기가 이미 등록됐는데 로컬 config 는 찢어져 `readCloudConfig`(3키 전부
     필요)가 null 을 돌려준다 — 앱은 "미연결"로 보이고 사용자는 그 유령 기기를 보지도 폐기하지도 못한다.
     실패를 던져 호출부(`Connect`·`CloudCard`)가 재시도를 안내하게 한다. */
  const wrote = await Promise.all([
    setKey(KEYS.baseUrl, cfg.baseUrl),
    setKey(KEYS.deviceId, cfg.deviceId),
    setKey(KEYS.refresh, cfg.refreshToken),
  ]);
  /* ⚠ **SQLite 정본일 때만** 실패를 던진다. dev/트랙 A 브라우저(비-SQLite)는 `sync_state` 자체가
     없어 `setKey`(execDb)가 false 라도 정상 폴백이고, `readCloudConfig` 가 null 을 돌려주는 기존
     계약이 이미 "연결 안 됨"을 올바로 표현한다. 폰·셸(SQLite 정본)에선 false = 진짜 쓰기 실패다. */
  if (isSqlitePrimary() && wrote.some((ok) => !ok)) {
    throw new Error('연결 정보를 저장하지 못했습니다. 저장공간을 확인하고 다시 시도해 주세요.');
  }
  return cfg;
}

/**
 * 이 기기의 클라우드 연결을 끊는다.
 *
 * ⚠ **서버 폐기를 먼저 시도하고, 그다음 로컬 자격증명을 지운다.** 순서가 반대면 서버에
 * 폐기를 요청할 자격증명이 이미 없다. 서버 폐기가 실패해도 **로컬 삭제는 진행한다** —
 * "끊기"를 눌렀는데 인터넷이 없다고 안 끊기면 사용자가 할 수 있는 일이 없어진다.
 * 대신 실패 사실을 돌려줘서 화면이 "서버에서도 끊으려면 다시 시도하세요"라고 말할 수 있게 한다.
 *
 * ⚠ **워터마크 둘도 함께 지운다(H2).** 종전엔 자격증명 3키만 지워서 `watermark`·`cloud:pullMark`
 * 가 남았다. 그 상태로 다른 백엔드에 재연결하거나 서버 D1 이 리셋되면(무료 티어 이빅션·마이그
 * 레이션 재생성), `collectOutbox` 의 `updated_at > 워터마크` 가 **기존 데이터 전량을 제외**해
 * 새 서버가 내 데이터를 영영 못 받는다 — 앱은 "연결됨·최신"이라 말한다(v6 백필이 고친 조용한
 * 유실과 같은 계열, 방향만 재연결 축). 0 부터 다시 push/pull 은 LWW 멱등이라 안전하다.
 */
export async function disconnectCloud(): Promise<{ serverRevoked: boolean }> {
  let serverRevoked = false;
  try {
    const cfg = await readCloudConfig();
    if (cfg) {
      await revokeDevice(cfg, cfg.deviceId);
      serverRevoked = true;
    }
  } catch {
    // 네트워크·인증 실패 — 아래 로컬 삭제는 그대로 진행한다(위 주석 참조).
  }
  for (const k of [...Object.values(KEYS), WATERMARK_KEY, PULL_MARK_KEY])
    await execDb('DELETE FROM sync_state WHERE key = ?', [k]);
  _access = null;
  return { serverRevoked };
}

/* ── 기기 관리(P0-2 폐기) ───────────────────────────────────────

   ⚠ C-4 는 `revoked_at` 열과 그 검사를 만들어 놓고 **쓰는 경로를 안 만들었다.** 그래서 폰을
   잃었을 때 실제로 할 수 있는 일이 D1 에 손으로 SQL 을 치는 것뿐이었다(2026-07-20 감사).
   여기가 그 경로다. */

export interface CloudDevice {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

/** 등록된 기기 목록. `self` 는 지금 이 기기의 id. */
export async function listDevices(cfg: CloudConfig): Promise<{ self: string; devices: CloudDevice[] }> {
  const res = await authed(cfg, '/api/devices');
  if (!res.ok) throw new Error(`기기 목록을 못 받았어요(${res.status})`);
  const j = (asJson(res) ?? {}) as { self?: unknown; devices?: unknown };
  if (typeof j.self !== 'string' || !Array.isArray(j.devices)) throw new Error('기기 목록 응답이 계약과 다릅니다.');
  return { self: j.self, devices: j.devices as CloudDevice[] };
}

/**
 * 기기를 폐기한다. **되돌릴 수 없다** — 그 기기는 등록 코드로 다시 연결해야 한다.
 *
 * ⚠ 이미 발급된 액세스 토큰은 서명 기반이라 서버가 매 요청 폐기 여부를 확인해서 끊는다
 * (`requireDevice`). 즉 실효는 즉시다 — 다만 그건 **서버 구현에 의존하는 성질**이라
 * 여기 적어 둔다.
 */
export async function revokeDevice(cfg: CloudConfig, deviceId: string): Promise<void> {
  const res = await authed(cfg, '/api/devices/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  });
  if (!res.ok) throw new Error(`기기 폐기 실패(${res.status})`);
}

/* ── 토큰 ────────────────────────────────────────────────────── */

let _access: { token: string; expiresAt: number } | null = null;

/** 테스트 전용 — 메모리 토큰을 비운다. */
export function _resetToken(): void {
  _access = null;
}

/** 실시간 WS 가 서브프로토콜로 실을 액세스 토큰(Phase 2). 캐시·갱신은 내부 `accessToken` 이 처리. */
export function currentAccessToken(cfg: CloudConfig): Promise<string> {
  return accessToken(cfg);
}

async function accessToken(cfg: CloudConfig, force = false): Promise<string> {
  // 만료 30초 전부터 갱신한다 — 요청이 날아가는 중에 만료되는 창을 없앤다.
  if (!force && _access && _access.expiresAt - 30_000 > Date.now()) return _access.token;
  const res = await send(
    `${cfg.baseUrl}/api/token`,
    'POST',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ deviceId: cfg.deviceId, refreshToken: cfg.refreshToken }),
  );
  if (res.status === 401) {
    _access = null;
    /* 기기가 폐기됐거나 리프레시가 무효다. **재시도가 무의미하다** — 사용자가 다시 등록해야
       한다. 재시도 가능 오류로 올리면 백오프가 영원히 돈다(C-1 `PermanentPushError` 참조). */
    throw new PermanentPushError('기기 인증이 만료·폐기되었습니다. 클라우드에 다시 연결해야 합니다.');
  }
  if (!res.ok) throw new Error(`토큰 갱신 실패(${res.status})`);
  const j = (asJson(res) ?? {}) as { accessToken?: unknown; expiresIn?: unknown };
  if (typeof j.accessToken !== 'string') throw new Error('토큰 응답이 계약과 다릅니다.');
  const ttl = typeof j.expiresIn === 'number' ? j.expiresIn : 900;
  _access = { token: j.accessToken, expiresAt: Date.now() + ttl * 1000 };
  return _access.token;
}

/** 인증 붙여 요청하고, 401 이면 **한 번만** 갱신 후 재시도한다. */
async function authed(
  cfg: CloudConfig,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  const withToken = async (tok: string): Promise<Reply> =>
    send(
      `${cfg.baseUrl}${path}`,
      init.method ?? 'GET',
      { ...(init.headers ?? {}), Authorization: `Bearer ${tok}` },
      init.body,
    );

  let res = await withToken(await accessToken(cfg));
  if (res.status === 401) {
    // 액세스 토큰 만료는 정상 경로다. 갱신해서 한 번 다시 친다.
    res = await withToken(await accessToken(cfg, true));
    if (res.status === 401) {
      // 갱신한 토큰으로도 401 → 우리 쪽 문제가 아니다. 재시도해도 같다.
      throw new PermanentPushError('인증이 거부되었습니다(기기가 폐기되었을 수 있습니다).');
    }
  }
  return res;
}

/* ── 전송 구현 ───────────────────────────────────────────────── */

/** C-1 이 비워 둔 `CloudTransport` 의 실제 구현. `pushOutbox(makeTransport(cfg))` 로 쓴다. */
export function makeTransport(cfg: CloudConfig): CloudTransport {
  return {
    async push(batch: OutboxBatch): Promise<void> {
      const res = await authed(cfg, '/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (res.status === 400) {
        /* 서버가 계약 위반이라고 판정했다. **재시도해도 같은 결과**다 — 같은 배치를 다시
           만들어 보낼 뿐이다. 즉시 끊어야 백오프가 헛돌지 않는다. */
        const j = (asJson(res) ?? {}) as { detail?: string };
        throw new PermanentPushError(`서버가 배치를 거부했습니다: ${j.detail ?? '(사유 없음)'}`);
      }
      /* ⚠ 한도 소진(H17) — **상태코드만으로 판정하지 않는다.** 429 는 레이트 리밋(잠깐 뒤
         다시 되는 것)도 쓰므로, 서버가 붙인 `permanent` 표식이 있을 때만 끊는다. 그 표식의
         소유자는 `server/src/index.ts` 의 `app.onError` 다. */
      if (res.status === 429) {
        const j = (asJson(res) ?? {}) as { detail?: string; permanent?: boolean };
        if (j.permanent) throw new PermanentPushError(j.detail ?? '서버가 한도 소진을 알렸습니다.');
      }
      if (!res.ok) throw new Error(`push 실패(${res.status})`); // 5xx·네트워크 → 재시도 대상
    },
  };
}

/**
 * 서버에서 `since` 이후 변경을 받아온다.
 *
 * ⚠ **받아온 것도 검증한다.** 네트워크를 건너온 데이터이고, "우리 서버니까"는 신뢰 경계에서
 * 통하는 근거가 아니다(`cloud/schema.ts` 머리주석).
 */
export async function pullChanges(cfg: CloudConfig, since: number, limit = 200): Promise<OutboxBatch> {
  const res = await authed(cfg, `/api/sync/pull?since=${since}&limit=${limit}`);
  if (!res.ok) throw new Error(`pull 실패(${res.status})`);
  /* ⚠ **수신은 관용 파서를 쓴다(H16).** 엄격 스키마를 그대로 쓰면 다음 릴리스에서 테이블이
     하나 늘 때 **업데이트 안 한 기기의 수신이 영구 정지**한다(버전 스큐는 구조적이다 — 데스크톱
     업데이터는 승인 대기, 폰 SW 는 autoUpdate). 근거·관용의 범위는 `schema.ts` 의 H16 절이 SSOT. */
  const parsed = parseInboundBatch(asJson(res));
  if (!parsed.ok) throw new Error(parsed.error);
  if (parsed.dropped > 0) {
    /* 조용히 버리지 않는다 — 이 앱이 모르는 테이블이 서버에 있다는 것은 **업데이트가 필요하다**는
       신호이고, 그건 사용자가 알아야 하는 사실이다(관측 없는 관용은 침묵과 같다). */
    console.warn(
      `[cloud] pull: 이 버전이 모르는 항목 ${parsed.dropped}건을 건너뜁니다 — 앱 업데이트가 필요할 수 있어요.`,
    );
  }
  return parsed.batch;
}
