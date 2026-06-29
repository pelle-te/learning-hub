import { defineConfig, devices } from '@playwright/test';

/* Playwright — 비주얼 회귀 + 스모크(Phase 6 도입).
   `vite preview`(dist 서빙)를 webServer로 띄워 빌드물을 그대로 검사.
   /api 프록시는 dev 전용이라 preview엔 없음 → 외부 탭(control/mastery/integrations)은 우아한 폴백을 찍는다. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
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
