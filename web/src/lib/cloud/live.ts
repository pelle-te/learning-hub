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

/** https→wss · http→ws(루프백 dev). */
function wsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, 'ws') + '/api/sync/live';
}

export interface LiveHandle {
  close: () => void;
}

const MAX_BACKOFF_MS = 30_000;
const PING_MS = 45_000; // 유휴 연결이 프록시에 끊기지 않게 keep-alive

/**
 * 실시간 poke 채널을 연다. `onPoke` 는 "변경 있음" 수신마다 호출된다(호출부가 pull 을 돌린다).
 * `close()` 로 완전히 끈다(재연결도 멈춘다).
 */
export function connectLive(cfg: CloudConfig, onPoke: () => void): LiveHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
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
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(retry, 5));
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
    } catch {
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
      retry = 0;
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
