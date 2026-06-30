import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// serve.js(:8000)가 백엔드 /api. Vite는 :5173에서 React 셸을 띄우고 /api는 프록시(동일출처처럼).
// Phase 6: vite-plugin-pwa 정식화 — 셸 precache + 자동 업데이트(stale 캐시 해소). /api는 캐시 제외(NetworkOnly).
// dev에선 SW 비활성(HMR 간섭 회피) — 프로덕션 빌드에서만 SW 생성/등록.
export default defineConfig({
  plugins: [
    // React Compiler(React 19) — 컴포넌트를 빌드타임에 자동 메모이제이션.
    // 수동 memo/useMemo/useCallback 없이도 불필요한 리렌더를 제거(프레임워크 최대 활용).
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
    VitePWA({
      // ⚠ 서비스워커 은퇴(selfDestroying) — 이 앱은 localhost + serve.js /api 백엔드가 떠 있어야만 동작하는
      //    도구라 오프라인 PWA의 이득이 사실상 0인데, SW precache가 빌드 후에도 옛 번들을 물어 "안 바뀐다"
      //    마찰만 매일 줬다(수동 unregister 강요). selfDestroying SW를 배포하면 다음 로드 때 기존 등록을
      //    스스로 해제+캐시 청소하고 사라진다 → 그 뒤론 일반 새로고침만으로 즉시 반영. PWA 복구는 이 한 줄 제거.
      selfDestroying: true,
      registerType: 'autoUpdate', // 새 빌드 감지 시 SW 자동 교체(현 stale 캐시 문제 해소)
      injectRegister: 'auto', // index.html에 SW 등록 코드 주입
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html', // 딥링크 새로고침 → SPA 진입점
        navigateFallbackDenylist: [/^\/api/], // API는 폴백 금지
        runtimeCaching: [
          { urlPattern: /\/api\//, handler: 'NetworkOnly' }, // 서버/외부 데이터는 캐시 안 함(설계도 §6)
        ],
      },
      manifest: {
        name: '러닝 허브',
        short_name: '러닝허브',
        description: '졸업까지 한눈에 · 볼트/Anki 현황을 스케줄로 · 일과 빈 시간 자동 계산',
        theme_color: '#050506',
        background_color: '#050506',
        display: 'standalone',
        start_url: '/',
        lang: 'ko',
        categories: ['education', 'productivity'],
        // SVG 단일 아이콘(any+maskable) — 벡터라 모든 사이즈 대응(설치형 앱 아이콘).
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false }, // dev 서버에선 SW 등록 안 함
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  build: {
    // vendor 청크 분할 — 자주 안 바뀌는 의존성을 별도 파일로 빼 브라우저 캐시 적중률↑.
    // 옛 단일 365KB index.js → react 코어(안정)·라우팅/상태/스키마(vendor)·앱 코드로 3분할.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
});
