/* ============================================================
   syncHub.ts — 실시간 poke 브로드캐스트용 Durable Object(Phase 2).

   ## 하는 일은 하나 — "변경 있음" 신호만 쏜다

   데이터는 여전히 기존 LWW push/pull 이 옮긴다(§4). 이 DO 는 **데이터를 만지지 않는다**.
   한 기기가 push 하면 Worker 가 이 DO 에 알리고(`/broadcast`), DO 는 붙어 있는 다른 기기의
   WebSocket 에 `poke` 한 글자만 보낸다 — 받은 기기는 즉시 pull 한다. 폴링(최대 5분)·포커스
   복귀를 기다리지 않는 실시간성이 여기서 온다.

   ## 사용자 1명이라 인스턴스도 하나

   `idFromName('hub')` 로 단일 인스턴스를 쓴다(모든 기기 소켓이 한 DO 에 모인다). 그래서 브로드
   캐스트가 곧 "내 다른 기기 전부"가 된다.

   ## WebSocket Hibernation

   `state.acceptWebSocket()` 로 받으면 연결이 유휴일 때 DO 가 잠들어도 소켓이 유지된다(요금·메모리
   절약). 그래서 `webSocketMessage`/`Close` 를 인스턴스 메서드로 둔다(런타임이 깨워 호출).

   ## 인증은 여기가 아니라 Worker 가 한다

   이 DO 로 오는 요청은 이미 `index.ts` 의 `/api/sync/live` 가 토큰을 검증(+폐기 확인)한 뒤
   위임한 것이다. DO 는 신뢰 경계 안쪽이라 인증을 다시 하지 않는다(경계는 한 곳).
============================================================ */

interface Env {
  DB: D1Database;
}

export class SyncHub implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Worker 가 push 뒤 부르는 내부 경로 — 붙어 있는 소켓 전부에 poke.
    if (url.pathname === '/broadcast') {
      let n = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send('poke');
          n++;
        } catch {
          // 죽은 소켓은 무시(런타임이 곧 close 를 부른다).
        }
      }
      return new Response(JSON.stringify({ poked: n }), { headers: { 'Content-Type': 'application/json' } });
    }

    /* 폐기된 기기의 소켓을 끊는다(H15 · 2026-07-30 `/감사 근본`).

       ⚠⚠ 종전엔 이 경로가 **없었다.** `/api/devices/revoke` 는 `revoked_at` 만 세우고 DO 에
       아무것도 알리지 않았고, Hibernation 소켓은 무기한 유지된다 → **폐기된 기기의 열린 소켓이
       영구히 산다.** 폐기 라우트는 액세스 토큰 15분 유예를 정직하게 적어 뒀는데(`index.ts`),
       이 채널은 그 15분도 아니라 무한이었다.

       실피해는 데이터가 아니라 **활동 메타데이터**다: 도난 기기가 "방금 다른 기기가 무언가
       바꿨다"를 계속 받는다(데이터는 못 받는다 — pull 은 액세스 토큰을 요구하고 `/api/token` 이
       폐기를 막는다). 그래도 폐기의 뜻은 "이 기기와의 관계를 끊는다"이므로 신호도 끊는다. */
    if (url.pathname === '/close') {
      const device = url.searchParams.get('device') ?? '';
      let n = 0;
      // 태그로 찾는다 — 아래 업그레이드에서 `acceptWebSocket(server, [deviceId])` 로 붙인 그 값이다.
      for (const ws of this.state.getWebSockets(device)) {
        try {
          ws.close(4003, 'device revoked');
          n++;
        } catch {
          // 이미 닫히는 중이면 무시.
        }
      }
      return new Response(JSON.stringify({ closed: n }), { headers: { 'Content-Type': 'application/json' } });
    }

    // WebSocket 업그레이드 — 기기가 붙는다.
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      /* ⚠ **기기 id 로 태그해 둔다(H15).** 태그가 없으면 나중에 "이 기기의 소켓만" 골라 닫을
         방법이 없다 — 종전 구현이 정확히 그 상태였다. Worker 가 이미 토큰을 검증했으므로
         (`/api/sync/live`) 이 헤더는 신뢰 경계 **안쪽** 값이다. */
      const device = req.headers.get('X-Device-Id') ?? '';
      this.state.acceptWebSocket(server, device ? [device] : []); // Hibernation 대상으로 등록
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('bad request', { status: 400 });
  }

  // 클라가 keep-alive 로 'ping' 을 보내면 'pong'. 그 외 메시지는 무시(데이터는 이 채널로 안 다닌다).
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'ping') {
      try {
        ws.send('pong');
      } catch {
        // 닫히는 중이면 무시.
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      // 이미 닫혔으면 무시.
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      // 무시.
    }
  }
}
