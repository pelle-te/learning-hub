import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest 전용 설정(플러그인 없음 → vite.config.ts의 react/pwa 플러그인 타입과 분리).
// 순수 lib 로직은 node 환경(기본). 컴포넌트 테스트(RTL·.test.tsx)는 파일 상단
// `// @vitest-environment jsdom` 프라그마로 jsdom에서 돈다. JSX는 esbuild automatic 변환.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // 앱 소스만 계측(엔트리·타입선언·CSS모듈 제외 → 분모 왜곡 방지).
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.d.ts', 'src/vite-env.d.ts'],
      reporter: ['text-summary', 'html'],
      // 게이트: 현재값 바로 아래로 고정 — 통과는 보장하되 하락은 막는 래칫.
      // func는 51(E-6 등 확장이 신규 UI 클로저를 다수 더해 분모가 커진 뒤 baseline). 테스트 늘리면 상향.
      thresholds: { lines: 69, statements: 69, branches: 72, functions: 51 },
    },
  },
});
