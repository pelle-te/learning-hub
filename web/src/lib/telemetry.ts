/* ============================================================
   telemetry.ts — 프로덕션 관측(2026-07-25 감사 · 클라이언트 절반).

   ## 이 파일이 메우는 구멍

   이 앱의 배포 **전** 검증은 여섯 겹이다(정적·유닛·컴포넌트·트랙A·트랙B·실 workerd 왕복).
   배포 **후** 관측은 0 이었다: `ErrorBoundary` 가 세 곳에 있었지만 **폴백 UI 만 그리고
   아무것도 기록하지 않았고**, `unhandledrejection` 핸들러는 아예 없었다. 즉 폰 브라우저나
   WebView2 안에서 앱이 죽으면 사용자가 말해 주기 전까지 아무도 몰랐다.

   래칫(커버리지·번들·복잡도)은 **아는 회귀**를 막는다. 이 파일은 **모르는 것**을 잡는다.

   ## 설계 원칙 넷 — 전부 "관측이 앱을 해치지 않는다"로 수렴한다

   ① **절대 throw 하지 않는다.** 오류 보고가 오류를 만들면 최악이다. 전 경로가 삼킨다.
   ② **폭주를 스스로 끊는다.** 렌더 루프 오류는 초당 수백 건이다 — 세션 상한(`MAX_PER_SESSION`)
      과 메시지 중복 제거를 둔다. 상한이 없으면 관측이 곧 자기 DoS 다.
   ③ **설정이 없으면 조용히 아무것도 안 한다.** 클라우드를 안 붙인 사용자에겐 보낼 곳이 없다.
      그 상태가 오류가 아니라 **정상**이다(이 앱은 클라우드 없이도 완결된다).
   ④ **개인정보를 싣지 않는다.** 앱 상태·입력값·전체 URL 을 보내지 않는다. 경로만 보내고
      문자열은 길이를 자른다(서버 스키마도 같은 상한을 독립적으로 건다 — 두 겹).

   ## ⚠ 전송은 `cloud/client.ts` 의 인증 경로를 타지 않는다

   텔레메트리는 **토큰이 생기기 전에도** 나가야 한다(부팅 실패가 가장 알고 싶은 종류다).
   그래서 인증 없는 `/api/log` 로 직접 보낸다. 서버가 그 라우트를 무인증으로 열어 둔 근거와
   그 대가(레이트 리밋·크기 상한·무저장)는 `server/src/index.ts` 가 소유한다.

   ⚠ 셸(Tauri)에서는 웹뷰가 직접 밖으로 못 나간다 — CSP `connect-src 'self' ipc:` 다.
   그래서 `cloud/client.ts` 와 **같은 분기**를 쓴다: `isTauri()` 면 Rust 중계(`cloudHttp`).
   이 규약을 어기면 셸에서 조용히 전부 실패한다(그리고 그 실패는 관측되지 않는다 — 관측
   장치의 실패는 정의상 관측되지 않으므로 여기서 규약을 지키는 것이 특히 중요하다).
============================================================ */
/* ⚠ 부팅 경로다 — `isTauri` 는 초소형 모듈에서, `cloudHttp` 는 **셸 분기 안에서 동적으로**
   가져온다(H7 · `lib/isTauri.ts` 머리주석). 이 파일은 `main.tsx` 가 첫 줄에서 부르므로
   여기서 `tauri.ts` 를 정적으로 물면 503줄이 두 엔트리의 초기 청크에 그대로 들어간다. */
import { isTauri } from './isTauri';

/** 한 세션에서 보낼 최대 건수. 넘으면 조용히 버린다(원칙 ②). */
const MAX_PER_SESSION = 20;

/** 어느 엔트리에서 왔나. `phone/main.tsx` 가 'phone' 으로 초기화한다. */
type AppKind = 'shell' | 'phone';

interface Event {
  kind: 'error' | 'vital';
  name: string;
  detail?: string;
  value?: number;
  route?: string;
  app?: AppKind;
  build?: string;
}

let baseUrl: string | null = null;
let appKind: AppKind = 'shell';
let sent = 0;
const seen = new Set<string>();

/**
 * 텔레메트리를 켠다. **호출 전에는 전 함수가 무동작**이다 — 그래야 테스트·스토리북·
 * 트랙 A 스냅샷이 네트워크를 건드리지 않는다(트랙 A 는 `serviceWorkers:'block'` 처럼
 * 외부 효과를 원천 차단하는 것이 규약이다).
 *
 * @param url 클라우드 베이스 URL. `readCloudConfig()` 의 `baseUrl` 을 그대로 넘긴다.
 */
export function initTelemetry(url: string | null, app: AppKind): void {
  appKind = app;
  /* ⚠ `http(s)` 만 받는다 — 여기 들어오는 값은 사용자가 설정 화면에 친 문자열이고,
     그대로 요청 대상이 된다. 스킴을 안 보면 `javascript:` 같은 것이 흘러든다. */
  if (!url || !(url.startsWith('https://') || url.startsWith('http://'))) {
    baseUrl = null;
    return;
  }
  /* ⚠ 끝 슬래시 제거를 **정규식으로 하지 않는다.** `/\/+$/` 는 백트래킹이 초선형이라
     `sonarjs/super-linear-regex` 가 error 로 막는다(그 규칙은 취향이 아니라 "입력이 커지면
     멈추는 버그"를 막는 것이라고 `eslint.config.js` 가 적어 뒀다). 여기 입력이 짧을 것
     같아도 예외를 파지 않는다 — 규칙의 값은 예외를 안 파는 데서 나온다. */
  let u = url;
  while (u.endsWith('/')) u = u.slice(0, -1);
  baseUrl = u;
}

/** 테스트용 초기화. 세션 카운터·중복 제거 상태까지 되돌린다. */
export function _resetTelemetry(): void {
  baseUrl = null;
  sent = 0;
  seen.clear();
}

function post(ev: Event): void {
  if (!baseUrl || sent >= MAX_PER_SESSION) return;
  /* 중복 제거 — 같은 오류가 반복되는 것은 **정보가 아니다**(첫 건이 이미 말했다).
     지표(vital)는 이름당 한 번만 의미가 있으므로 같은 키로 자연히 걸린다. */
  const key = `${ev.kind}:${ev.name}:${ev.route ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent += 1;

  const body = JSON.stringify({ ...ev, app: appKind });
  const url = `${baseUrl}/api/log`;
  try {
    if (isTauri()) {
      // 셸 전용 경로라 여기서 지연 로드한다(H7) — 폰·브라우저는 이 청크를 아예 안 받는다.
      void import('./tauri')
        .then((m) => m.cloudHttp(url, 'POST', { 'Content-Type': 'application/json' }, body))
        .catch(() => {});
      return;
    }
    /* `sendBeacon` 을 먼저 시도한다 — 페이지가 언로드되는 중에도 나간다. 오류 보고는
       정확히 그 순간(탭이 닫히거나 크래시로 이동할 때) 나가야 하는 경우가 많다.
       실패하면(크기 초과·미지원) `keepalive` fetch 로 폴백한다. */
    const beacon = navigator.sendBeacon?.bind(navigator);
    if (beacon && beacon(url, new Blob([body], { type: 'application/json' }))) return;
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 원칙 ① — 어떤 이유로도 던지지 않는다. */
  }
}

/** 전체 URL 이 아니라 **경로만**. 쿼리스트링에 값이 실릴 수 있다(원칙 ④). */
function currentRoute(): string {
  try {
    return location.pathname.slice(0, 200);
  } catch {
    return '';
  }
}

/** 문자열 상한 — 서버 스키마와 **같은 값**을 클라이언트에서도 건다(두 겹 · 원칙 ④). */
const cut = (s: unknown, n: number): string => (typeof s === 'string' ? s.slice(0, n) : String(s).slice(0, n));

/**
 * 오류 1건 보고. `ErrorBoundary` 의 `onError` 와 전역 핸들러가 부른다.
 *
 * ⚠ `error` 는 무엇이든 올 수 있다(문자열·객체·null). `instanceof Error` 를 가정하지 않는다 —
 * 프라미스 거부는 아무 값이나 실을 수 있고, 여기서 던지면 원칙 ① 위반이다.
 */
export function reportError(error: unknown, context?: string): void {
  const err = error as { message?: unknown; stack?: unknown } | null;
  const name = cut(err?.message ?? error ?? 'unknown', 200);
  const stack = err?.stack ? cut(err.stack, 2000) : undefined;
  post({
    kind: 'error',
    name,
    detail: context ? `[${context}] ${stack ?? ''}`.slice(0, 2000) : stack,
    route: currentRoute(),
  });
}

/**
 * 전역 오류 훅 설치 — `ErrorBoundary` 가 **못 잡는** 것들을 받는다.
 *
 * ⚠ 리액트 바깥에서 나는 오류가 이 앱에는 실제로 있다: 스토어 초기화(`initAppStore`)는
 * 렌더 밖이고(`lib/utils.ts:84` 가 같은 사실을 적어 뒀다), SQLite 워커·동기화 루프·
 * 타이머도 전부 경계 밖이다. 그쪽이 조용히 죽는 것이 지금까지 가장 안 보이던 층이다.
 */
export function installGlobalErrorHooks(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window.error'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandledrejection'));
}

/**
 * Core Web Vitals 수집. **번들 예산은 바이트를 재지 체감을 못 잰다** — LCP/INP/CLS 는
 * 실제 기기·회선에서만 나온다. 특히 폰(셀룰러)과 캔버스 시뮬레이션(graph)·타임박스 DnD
 * 같은 INP 가 깨지기 쉬운 코드가 이 앱에 실재한다.
 *
 * ⚠ 동적 import 다 — 텔레메트리를 안 켠 사용자(클라우드 미연결)에게는 이 청크가
 * **아예 내려가지 않는다.** 관측 장치가 초기 로드 예산을 먹으면 본말전도다.
 */
export function collectWebVitals(): void {
  if (!baseUrl) return;
  void import('web-vitals')
    .then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
      const send = (m: { name: string; value: number }): void =>
        post({ kind: 'vital', name: m.name, value: Math.round(m.value * 1000) / 1000, route: currentRoute() });
      onCLS(send);
      onINP(send);
      onLCP(send);
      onFCP(send);
      onTTFB(send);
    })
    .catch(() => {});
}
