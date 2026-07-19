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
import { execDb, selectDb } from '../db/sqlite';
import { cloudHttp, isTauri } from '../tauri';
import { PermanentPushError, type CloudTransport } from './push';
import { OutboxBatchSchema } from './schema';
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
  if (!res.ok) throw new Error(`등록 실패(${res.status}) — 코드가 틀렸거나 만료됐습니다.`);
  const j = (asJson(res) ?? {}) as { deviceId?: unknown; refreshToken?: unknown };
  if (typeof j.deviceId !== 'string' || typeof j.refreshToken !== 'string') {
    throw new Error('등록 응답이 계약과 다릅니다.');
  }
  const cfg: CloudConfig = { baseUrl: base, deviceId: j.deviceId, refreshToken: j.refreshToken };
  await Promise.all([
    setKey(KEYS.baseUrl, cfg.baseUrl),
    setKey(KEYS.deviceId, cfg.deviceId),
    setKey(KEYS.refresh, cfg.refreshToken),
  ]);
  return cfg;
}

/** 이 기기의 클라우드 연결을 끊는다(자격증명 삭제). 서버 쪽 폐기는 별도다. */
export async function disconnectCloud(): Promise<void> {
  for (const k of Object.values(KEYS)) await execDb('DELETE FROM sync_state WHERE key = ?', [k]);
}

/* ── 토큰 ────────────────────────────────────────────────────── */

let _access: { token: string; expiresAt: number } | null = null;

/** 테스트 전용 — 메모리 토큰을 비운다. */
export function _resetToken(): void {
  _access = null;
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
  const parsed = OutboxBatchSchema.safeParse(asJson(res));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(루트)'}: ${i.message}`)
      .join(' · ');
    throw new Error(`서버 응답이 계약과 다릅니다 — ${issues}`);
  }
  return parsed.data as OutboxBatch;
}
