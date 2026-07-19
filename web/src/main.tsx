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
import { initAppStore } from '@/lib/db/boot';
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

/* 2단계-E — 스토어를 **마운트 전에** 준비한다.
   셸에선 SQLite 가 정본이라 읽기가 비동기인데, 하이드레이션 게이트(기본값으로 먼저 렌더 후 교체)를
   쓰면 "하이드레이션 전 쓰기가 기본값으로 실데이터를 덮는" 실패 모드가 새로 생긴다(0단계-E에서
   물린 부류). 마운트 전 await 는 그 창 자체를 없앤다.
   ⚠ `initAppStore()` 는 어떤 이유로도 throw 하지 않는다 — 실패하면 localStorage 폴백으로 뜬다.
   그래도 방어적으로 catch 한다: 여기서 던지면 앱이 영구 백지가 되고 ShellFallback 도 못 잡는다.
   `useApp` 은 이 시점 이후에 import 돼야 한다(모듈 평가 시점에 부팅값을 읽으므로 순서가 계약). */
void initAppStore()
  .catch(() => {})
  .then(async () => {
    const { default: App } = await import('@/app/App');
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
  });
