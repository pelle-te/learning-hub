import { defineConfig, devices } from '@playwright/test';

/* Playwright — 비주얼 회귀 + 스모크(Phase 6 도입).
   `vite preview`(dist 서빙)를 webServer로 띄워 빌드물을 그대로 검사.
   /api 프록시는 dev 전용이라 preview엔 없음 → 외부 탭(control/mastery/integrations)은 우아한 폴백을 찍는다. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 비주얼 스냅샷은 16-워커 병렬 부하에서 안정화 타이밍 flaky가 드물게 난다(로컬 전용).
  // 1회 재시도로 흡수 — 실제 회귀는 재시도해도 실패하므로 안전.
  retries: 1,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // PWA 서비스워커가 이전 빌드의 프리캐시(옛 청크)를 서빙해 스냅샷이 stale해지는 것을 차단 —
    // 비주얼 회귀는 항상 갓 빌드된 dist를 본다(메모리의 PWA stale 캐시 함정 해소).
    serviceWorkers: 'block',
    // 비주얼 회귀 결정성 — prefers-reduced-motion으로 진입/카운트업/틸트 등 모션을 끄고
    // 항상 '최종 정지 상태'를 캡처(rAF 카운트업이 프레임마다 다른 숫자를 찍는 flaky 차단).
    reducedMotion: 'reduce',
    // WebGL 렌더러 고정 — 헤드리스가 부하에 따라 하드웨어 GPU ↔ SwiftShader를 오가면
    // AmbientCanvas(fbm 셰이더) 픽셀이 달라지거나 컨텍스트 생성이 간헐 실패(배경 통짜 diff flaky).
    // GPU를 꺼서 항상 소프트웨어 렌더러 = 결정적 출력.
    launchOptions: { args: ['--disable-gpu'] },
  },
  // 비주얼 회귀: 폰트 렌더링 미세차 허용(0.2%) — 의미있는 레이아웃 변화만 잡는다.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
