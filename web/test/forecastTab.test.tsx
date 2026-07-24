// @vitest-environment jsdom
/* ============================================================
   forecastTab.test.tsx — 복습 부하 예보(ID-1) 컴포넌트 회귀.
   빈 상태 폴백 + 실제 App 셸에서 마운트되며 상단 리드아웃을 주입하는지(스모크).
   막대 차트의 '부하 형태' 렌더는 e2e 스냅샷(실 시드 데이터)이 소유한다(§15-4).
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';
import { useApp } from '@/store/useApp';

function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useApp.getState().mutate((st) => {
    delete st._today;
    st.items = [];
    st.completions = {};
  });
});

test('forecast: 완료 챕터가 없으면 EmptyState로 폴백', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.items = [];
    st.completions = {};
  });
  renderApp('/forecast');
  // lazy 로드 → Suspense 해제까지 findBy로 대기.
  expect(await screen.findByText('다가오는 복습 파도가 아직 없어요')).toBeInTheDocument();
  // 상단 리드아웃(페이지 크롬)이 주입된다 — 실제 셸에 마운트됐다는 관측 가능한 증거.
  expect(screen.getByText('앞 14일 복습')).toBeInTheDocument();
});
