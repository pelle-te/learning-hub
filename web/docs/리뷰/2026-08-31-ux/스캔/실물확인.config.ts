/* 2026-08-31 ux 축 회차의 실물 확인 전용 설정 — 기본 설정을 그대로 쓰되 testDir 만 여기로.
   ⛔ 게이트 밖. 근거는 같은 폴더의 `실물확인.spec.ts` 머리주석. */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: './_출력',
  use: {
    ...devices['Desktop Chrome'],
    viewport: process.env.SHIPWIN ? { width: 1440, height: 900 } : { width: 1440, height: 2200 },
    baseURL: 'http://localhost:4173',
    reducedMotion: 'reduce',
    launchOptions: { args: ['--disable-gpu'] },
  },
  webServer: {
    command: 'npm run preview -- --strictPort --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 60_000,
    cwd: process.cwd(),
  },
});
