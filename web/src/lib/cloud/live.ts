/* ============================================================
   cloud/live.ts — 실시간 poke 채널(Phase 2 · 점진적 향상).

   서버 `SyncHub` DO 와 WebSocket 으로 붙어 "변경 있음"(`poke`)만 받는다. 받으면 호출부가 pull 한다
   — 데이터는 이 채널로 안 다닌다. 폴링(최대 5분)·포커스 복귀를 기다리지 않는 실시간성이 목적.

   ## ⚠ 붙지 못해도 무해하다

   연결 실패·끊김은 지수 백오프로 재시도하되, **못 붙어도 앱은 기존 이벤트/폴링 동기화로 그대로
   돈다**(syncController). 그래서 실패를 조용히 삼킨다 — 실시간은 최신성의 *향상*이지 정확성의
   전제가 아니다. (데스크톱 Tauri 웹뷰는 CSP `connect-src 'self' ipc:` 로 이 WS 가 막히므로,
   syncController 가 **폰에서만** 이걸 켠다.)

   ## 인증

   브라우저 WebSocket 은 Authorization 헤더를 못 싣는다 → 액세스 토큰을 **서브프로토콜**로 싣는다
   (`new WebSocket(url, [token])`). 서버가 검증(+폐기 확인)하고 그 프로토콜을 되돌려준다(§P0-2 연장).
============================================================ */
import { currentAccessToken, type CloudConfig } from './client';
import { isPermanent } from './push';

/** https→wss · http→ws(루프백 dev). */
function wsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, 'ws') + '/api/sync/live';
}

export interface LiveHandle {
  close: () => void;
}

const MAX_BACKOFF_MS = 30_000;
/* ⚠⚠ **오래 못 붙으면 천장을 올린다**(H24 · 2026-07-30 `/감사 근본`).
   H18 이 *영구* 실패(기기 폐기 등)를 갈라 멈추게 했지만, **일시 실패는 30초 상한으로 영원히**
   돈다 — 서버가 며칠 내려가 있거나 네트워크가 오래 막힌 상황에서 기기당 하루 ≈2,880회다.
   일시 실패라도 20회(≈9분)를 넘겨 못 붙었다면 그건 "잠깐"이 아니므로 5분 간격으로 내려앉는다.
   ⚠ 포기가 아니다 — 계속 재시도하되 빈도만 낮춘다. 실시간은 정확성의 전제가 아니고(머리주석)
   그동안에도 폴링·포커스 동기화가 돈다. */
const LONG_OUTAGE_AFTER = 20;
const LONG_BACKOFF_MS = 5 * 60_000;
/** 백오프 지터 폭(±%). 0 이면 두 기기가 **같은 초에** 재연결한다 — 복구 순간이 가장 약한 순간이다. */
const JITTER = 0.25;
const PING_MS = 45_000; // 유휴 연결이 프록시에 끊기지 않게 keep-alive
/** 이만큼 **유지된** 연결만 "붙었다"로 본다(H18) — 아래 `onopen` 주석 참조. */
const STABLE_MS = 30_000;

/**
 * 실시간 poke 채널을 연다. `onPoke` 는 "변경 있음" 수신마다 호출된다(호출부가 pull 을 돌린다).
 * `close()` 로 완전히 끈다(재연결도 멈춘다).
 *
 * `onDead` 는 **재시도가 무의미해졌을 때 1회** 불린다(기기 폐기·인증 영구 거부). 호출부가
 * 사용자에게 알린다 — 이 상태는 사람이 조치해야 풀리기 때문이다(H18).
 */
export function connectLive(cfg: CloudConfig, onPoke: () => void, onDead?: (reason: string) => void): LiveHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  /** 마지막 연결이 성립한 시각(0 = 연결 없음). 백오프 리셋 판정용(H18). */
  let openedAt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const stopPing = (): void => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer) return;
    const ceiling = retry >= LONG_OUTAGE_AFTER ? LONG_BACKOFF_MS : MAX_BACKOFF_MS;
    const base = Math.min(ceiling, 1000 * 2 ** Math.min(retry, 5));
    /* 지터 — 같은 계정의 두 기기가 복구 순간에 **동시에** 몰려들지 않게 흩는다. 단일 사용자라
       군집이 크진 않지만, 몰리는 시점이 하필 서버가 막 살아난 순간이라는 것이 요점이다. */
    const delay = Math.round(base * (1 - JITTER + Math.random() * 2 * JITTER));
    retry += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void open();
    }, delay);
  };

  const open = async (): Promise<void> => {
    if (closed) return;
    let token: string;
    try {
      token = await currentAccessToken(cfg);
    } catch (e) {
      /* ⚠⚠ **영구 실패를 일시 실패와 가르지 않으면 재연결이 해로워진다(H18 · 2026-07-26 감사).**
         종전엔 전부 `scheduleReconnect()` 였다 — 기기가 폐기된 폰을 하루 방치하면 `/api/token`
         을 **≈2,880회** 치면서(30초 상한) 화면에는 아무것도 안 뜬다. 무료 한도를 직격하고,
         정작 사용자는 조치가 필요하다는 사실을 모른다. 영구 실패면 멈추고 **한 번 말한다**. */
      if (isPermanent(e)) {
        closed = true;
        stopPing();
        onDead?.(e instanceof Error ? e.message : '실시간 연결이 거부되었습니다.');
        return;
      }
      scheduleReconnect(); // 토큰 실패(오프라인 등) — 나중에 다시
      return;
    }
    if (closed) return;
    try {
      ws = new WebSocket(wsUrl(cfg.baseUrl), [token]);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = (): void => {
      /* ⚠ **여기서 백오프를 리셋하지 않는다(H18).** 서버가 붙자마자 끊는 상태(플래핑)에서
         `retry = 0` 은 백오프를 통째로 무력화해 초당 재연결이 된다. "붙었다"의 근거는 연결
         **성립**이 아니라 **유지**다 — 아래 `onclose` 가 `STABLE_MS` 이상 살아 있었을 때만 리셋한다. */
      openedAt = Date.now();
      stopPing();
      pingTimer = setInterval(() => {
        try {
          ws?.send('ping');
        } catch {
          // 닫히는 중이면 무시.
        }
      }, PING_MS);
    };
    ws.onmessage = (e: MessageEvent): void => {
      if (e.data === 'poke') onPoke();
    };
    ws.onclose = (): void => {
      stopPing();
      // 충분히 유지된 연결이었으면 그때만 백오프를 처음으로 되돌린다(H18).
      if (openedAt && Date.now() - openedAt >= STABLE_MS) retry = 0;
      openedAt = 0;
      ws = null;
      scheduleReconnect();
    };
    // onerror 는 따로 두지 않는다 — 브라우저가 error 뒤 close 를 이어 쏘고, 재연결은 onclose 가 잡는다.
  };

  void open();

  return {
    close(): void {
      closed = true;
      stopPing();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        ws?.close();
      } catch {
        // 이미 닫혔으면 무시.
      }
      ws = null;
    },
  };
}
