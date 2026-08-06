/* ============================================================
   cloud/live.ts — 실시간 poke 채널(Phase 2 · 점진적 향상).

   서버 `SyncHub` DO 와 WebSocket 으로 붙어 "변경 있음"(`poke`)만 받는다. 받으면 호출부가 pull 한다
   — 데이터는 이 채널로 안 다닌다. 폴링(최대 5분)·포커스 복귀를 기다리지 않는 실시간성이 목적.

   ## ⚠ 붙지 못해도 무해하다

   연결 실패·끊김은 지수 백오프로 재시도하되, **못 붙어도 앱은 기존 이벤트/폴링 동기화로 그대로
   돈다**(syncController). 그래서 실패를 조용히 삼킨다 — 실시간은 최신성의 *향상*이지 정확성의
   전제가 아니다.

   ## ⚠⚠ 전송이 둘, 정책은 하나 (Q-28 · 2026-08-02)

   데스크톱 웹뷰는 CSP `connect-src 'self' ipc:` 라 브라우저 `WebSocket` 이 **원리적으로 못 나간다**
   → 종전엔 실시간이 폰에만 켜져 있었고 PC 는 다른 기기의 편집을 창 복귀까지 못 봤다. 소켓을 Rust 로
   내려 그 구간을 덮는데(`src-tauri/src/live.rs`), **갈리는 것은 전송뿐이다**:

   - 아래 `MAX_BACKOFF_MS`·`LONG_OUTAGE_AFTER`·`JITTER`·`STABLE_MS`·`isPermanent` 는 실사고 둘
     (H18 · H24)이 다듬은 값이라 **한 벌로 남는다.** 전송별로 복제하면 폰과 PC 가 서로 다르게
     재시도하고, 다음 사고 때 어느 쪽 값이 물렸는지 알 수 없게 된다.
   - 그래서 이 파일이 아는 전송의 형태는 `LiveTransport` **하나**다 — 열면 `onOpen`/`onPoke`/
     `onClose` 를 부르고 `close()` 로 끝난다. 그 세 콜백이 정확히 위 정책이 필요로 하는 관측이다.
   - ⚠ 셸 전송에서 "못 붙었다"와 "붙었다 끊겼다"는 **같은 `onClose`** 로 온다(Rust 가 그렇게 보낸다).
     둘을 가르는 것은 `onOpen` 을 봤는가이고, 그건 이 파일이 이미 하던 판정이다(`openedAt`).

   ## 인증

   브라우저 WebSocket 은 Authorization 헤더를 못 싣는다 → 액세스 토큰을 **서브프로토콜**로 싣는다
   (`new WebSocket(url, [token])`). 서버가 검증(+폐기 확인)하고 그 프로토콜을 되돌려준다(§P0-2 연장).
   ⚠ 셸 전송도 **같은 형태**로 싣는다(헤더로 바꾸면 서버 검증 경로가 둘이 된다 — `live.rs` 머리주석).
============================================================ */
import { currentAccessToken, type CloudConfig } from './client';
import { isPermanent } from './push';
import { isTauri, onShellLive, shellLiveClose, shellLiveOpen } from '@/lib/tauri';

/** https→wss · http→ws(루프백 dev). */
function wsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, 'ws') + '/api/sync/live';
}

export interface LiveHandle {
  close: () => void;
}

/* ── 전송 계층 ────────────────────────────────────────────────────────────────────────────
   ⚠ 이 세 콜백이 **정책이 필요로 하는 관측의 전부**다. 늘리고 싶어지면 그건 정책이 전송으로
   새고 있다는 신호다(예: "재시도 몇 번째인가"는 여기 오면 안 된다 — 아래가 세고 있다). */
interface LiveHooks {
  onOpen: () => void;
  onPoke: () => void;
  /** 못 붙었든 붙었다 끊겼든 **정확히 한 번**. 둘을 가르는 것은 `onOpen` 을 봤는가다. */
  onClose: () => void;
}
interface LiveSocket {
  /** 끊는다. 이 뒤로 훅은 **안 불린다**(재연결 판단은 정책이 이미 내렸다). */
  close: () => void;
}
type LiveTransport = (url: string, token: string, h: LiveHooks) => LiveSocket;

/** 브라우저 `WebSocket`(폰·dev). keep-alive 타이머가 여기 있는 이유는 아래 `PING_MS` 주석. */
const browserTransport: LiveTransport = (url, token, h) => {
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let done = false;
  const stopPing = (): void => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  };
  const finish = (): void => {
    if (done) return;
    done = true;
    stopPing();
    h.onClose();
  };
  try {
    ws = new WebSocket(url, [token]);
  } catch {
    /* 생성 자체가 던지는 경우(잘못된 URL 등) — 정책이 `onClose` 하나로 다루게 **비동기로** 알린다.
       동기로 부르면 호출부가 아직 `socket` 을 대입하기 전이라 재연결이 자기 자신을 덮어쓴다. */
    queueMicrotask(finish);
    return { close: () => void (done = true) };
  }
  ws.onopen = (): void => {
    pingTimer = setInterval(() => {
      try {
        ws?.send('ping');
      } catch {
        // 닫히는 중이면 무시.
      }
    }, PING_MS);
    h.onOpen();
  };
  ws.onmessage = (e: MessageEvent): void => {
    if (e.data === 'poke') h.onPoke();
  };
  ws.onclose = finish;
  // onerror 는 따로 두지 않는다 — 브라우저가 error 뒤 close 를 이어 쏘고, 재연결은 onclose 가 잡는다.
  return {
    close(): void {
      done = true;
      stopPing();
      try {
        ws?.close();
      } catch {
        // 이미 닫혔으면 무시.
      }
      ws = null;
    },
  };
};

/** 셸(데스크톱) — 소켓은 Rust 가 쥐고 우리는 이벤트만 듣는다(파일 머리주석 §전송이 둘). */
const shellTransport: LiveTransport = (url, token, h) => {
  let un: (() => void) | null = null;
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    un?.();
    un = null;
    h.onClose();
  };
  void (async () => {
    try {
      /* ⚠ **구독이 먼저다.** `cloud_live_open` 은 즉시 돌아오고 결과가 이벤트로 오므로, 순서가
         뒤집히면 붙자마자 끊긴 연결의 `close` 를 놓쳐 **재연결이 영영 안 걸린다**. */
      un = await onShellLive((ev) => {
        if (done) return;
        if (ev.kind === 'open') h.onOpen();
        else if (ev.kind === 'poke') h.onPoke();
        else finish();
      });
      if (done) {
        un(); // 구독하는 사이에 호출부가 껐다
        un = null;
        return;
      }
      await shellLiveOpen(url, token, PING_MS);
    } catch {
      // 커맨드 거부(허용되지 않은 주소 등) — 열기 실패도 정책엔 `onClose` 하나다.
      finish();
    }
  })();
  return {
    close(): void {
      if (done) return;
      done = true;
      un?.();
      un = null;
      void shellLiveClose();
    },
  };
};

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
 * 재연결 지연의 **지터 전 기준값**(ms). 순수 — `push.ts` 의 `backoffDelay` 와 같은 자리다.
 *
 * ⚠⚠ **지수 클램프가 긴 천장보다 낮으면 그 천장은 도달 불가다**(H-10 · 2026-08-06 감사).
 * 종전 지수는 `Math.min(retry, 5)` 라 최대 `1000 × 2⁵ = 32초` 였다 — 즉 `ceiling` 이
 * `LONG_BACKOFF_MS`(5분)로 바뀌어도 `Math.min` 이 항상 32초를 골라, **H24 가 넣은 장기 장애
 * 완화가 한 번도 발동한 적이 없다.** 두 상수가 서로를 모르고 각자 맞아 보이는 형태였고,
 * 계산이 클로저 안에 묻혀 있어 어떤 테스트도 그 정합을 볼 수 없었다(그래서 여기로 뺐다).
 *
 * → 지수는 긴 천장을 **넘길 수 있을 만큼** 열어 두고(`2⁹ = 512초 > 5분`) 실제 상한은 `ceiling`
 *   이 정한다. 짧은 구간(retry < `LONG_OUTAGE_AFTER`)은 `MAX_BACKOFF_MS` 가 그대로 잘라 거동 불변.
 */
export function liveBackoffBase(retry: number): number {
  const ceiling = retry >= LONG_OUTAGE_AFTER ? LONG_BACKOFF_MS : MAX_BACKOFF_MS;
  return Math.min(ceiling, 1000 * 2 ** Math.min(retry, 9));
}

/**
 * 실시간 poke 채널을 연다. `onPoke` 는 "변경 있음" 수신마다 호출된다(호출부가 pull 을 돌린다).
 * `close()` 로 완전히 끈다(재연결도 멈춘다).
 *
 * `onDead` 는 **재시도가 무의미해졌을 때 1회** 불린다(기기 폐기·인증 영구 거부). 호출부가
 * 사용자에게 알린다 — 이 상태는 사람이 조치해야 풀리기 때문이다(H18).
 */
export function connectLive(cfg: CloudConfig, onPoke: () => void, onDead?: (reason: string) => void): LiveHandle {
  /* 전송 선택은 **여기 한 곳**이다 — 아래 정책 코드는 어느 쪽인지 알지 않는다. */
  const transport: LiveTransport = isTauri() ? shellTransport : browserTransport;
  let socket: LiveSocket | null = null;
  let closed = false;
  let retry = 0;
  /** 마지막 연결이 성립한 시각(0 = 연결 없음). 백오프 리셋 판정용(H18). */
  let openedAt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer) return;
    const base = liveBackoffBase(retry);
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
        onDead?.(e instanceof Error ? e.message : '실시간 연결이 거부되었습니다.');
        return;
      }
      scheduleReconnect(); // 토큰 실패(오프라인 등) — 나중에 다시
      return;
    }
    if (closed) return;
    socket = transport(wsUrl(cfg.baseUrl), token, {
      onOpen: (): void => {
        /* ⚠ **여기서 백오프를 리셋하지 않는다(H18).** 서버가 붙자마자 끊는 상태(플래핑)에서
           `retry = 0` 은 백오프를 통째로 무력화해 초당 재연결이 된다. "붙었다"의 근거는 연결
           **성립**이 아니라 **유지**다 — 아래 `onClose` 가 `STABLE_MS` 이상 살아 있었을 때만 리셋한다. */
        openedAt = Date.now();
      },
      onPoke,
      onClose: (): void => {
        // 충분히 유지된 연결이었으면 그때만 백오프를 처음으로 되돌린다(H18).
        if (openedAt && Date.now() - openedAt >= STABLE_MS) retry = 0;
        openedAt = 0;
        socket = null;
        scheduleReconnect();
      },
    });
  };

  void open();

  return {
    close(): void {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
      socket = null;
    },
  };
}
