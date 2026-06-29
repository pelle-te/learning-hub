import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

// 토큰 레이어(tokens.css)를 전역 스타일보다 먼저 — 테마 CSS 변수 단일 원천(설계도 §2).
// 전역 디자인 시스템(.card/.kpi/.tl/.nav…)은 styles/global/(theme·base·components·features)로 분해.
import '@/styles/tokens.css';
import '@/styles/global/index.css';

import { queryClient } from '@/app/queryClient';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';
import ds from '@/styles/ds.module.css';

function ShellFallback() {
  return (
    <div className="wrap">
      <div className={ds.card}>
        <h2>앱을 시작하지 못했어요</h2>
        <p className={`${ds.muted} ${ds.tiny}`}>새로고침하거나 ⋯ 메뉴 → 데이터 내보내기로 백업 후 점검하세요.</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={ShellFallback}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
