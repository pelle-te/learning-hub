import { defineConfig } from '@playwright/test';

/* ============================================================
   트랙 B — Tauri 셸 스모크(플랫폼 개편 1단계).

   **트랙 A(`playwright.config.ts`)와 목적이 다르다.** A 는 `vite preview` 를 Chromium 으로 찍는
   비주얼 회귀고, 렌더러가 WebView2 가 아니라서 "셸에서도 동작한다"를 증명하지 못한다(설계 §4-1단계가
   지적한 순환 논증). B 는 **빌드된 exe 를 실제로 띄워** 그 안의 WebView2 를 검사한다.

   ⚠ **설계와 다른 구현을 골랐다.** 설계는 `tauri-driver`(WebDriver·WebdriverIO 스택)를 적었는데,
   실측해 보니 WebView2 가 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 환경변수를 존중해서
   `--remote-debugging-port` 로 CDP 를 연다 → **이미 있는 Playwright 로 진짜 WebView2 를 그대로
   운전할 수 있다.** tauri-driver + WebdriverIO + Edge WebDriver 세 개를 안 들이고 같은 커버리지를
   얻는다. 디버그 포트는 **이 하네스만** 켜므로 배포본에는 노출이 없다(코드 변경 0 · env 로만 제어).

   스냅샷을 찍지 않는다 — 픽셀 회귀는 트랙 A 의 몫이고, 여기서 또 찍으면 베이스라인이 두 벌이 된다.
   여기서 보는 건 **셸에서만 깨지는 것**: 창이 뜨는가 · 라우팅 · IPC 왕복 · 종료 시 flush.

   실행: `npm run e2e:shell` (사전 `npm run tauri:build` 필요 — exe 를 검사 대상으로 삼는다).
============================================================ */
export default defineConfig({
  testDir: './e2e-shell',
  // 셸 하나를 순차로 띄웠다 내렸다 한다 — 포트(8000·9222)와 single-instance 가 전역 자원이라 병렬 불가.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  /* 1회 재시도 — 트랙 A 와 같은 근거다(실제 회귀는 재시도해도 실패한다).
     ⚠ 근거가 추측이 아니라 실측이다: 4단계-F 게이트에서 **앱 기동 경합**이 한 번 관측됐다
     (직전 케이스가 Ollama 생성으로 프로세스를 오래 물고 있다 내려간 뒤, 다음 launch 가
     `tauri.localhost` 문서를 못 찾고 "백지" 로 실패 → 단독 재실행·전체 재실행 모두 통과).
     원인은 앱 종료와 다음 기동 사이의 전역 자원(포트 8000·9222 · single-instance) 반납 지연이고,
     테스트 대상의 결함이 아니다. 재시도를 켜되 **원인을 여기 적어 두어** 나중에 진짜 회귀를
     "또 그 플레이크"로 넘기지 않게 한다. */
  retries: 1,
  reporter: [['list']],
  // 앱 부팅(WebView2 + sidecar 헬스체크)이 있어 기본 30초로는 빠듯하다.
  timeout: 90_000,
  expect: { timeout: 15_000 },
});
