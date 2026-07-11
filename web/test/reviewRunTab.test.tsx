// @vitest-environment jsdom
/* ============================================================
   reviewRunTab.test.tsx — 복습 세션 러너(I-9) 컴포넌트 회귀.
   빈 큐 폴백 + 회상 카드 흐름(카드 렌더 → 전진 → 세션 완료 리캡).
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    st.summaries = {};
    st.cbms = [];
    st.items = [];
  });
});

test('review-run: 복습할 게 없으면 깨끗함 폴백', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.items = [];
    st.summaries = {};
    st.cbms = [];
    st.completions = {};
  });
  renderApp('/review-run');
  expect(await screen.findByText('복습할 게 없어요')).toBeInTheDocument();
});

test('review-run: 회상 카드 흐름 — 렌더 → 전진 → 세션 완료', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.items = [];
    st.cbms = [];
    st.completions = {};
    // 4일 전 요약 → pickRetrieval이 회상 카드 1장 생성(minAge 2일↑).
    st.summaries = { '2026-07-04': [{ id: 'r1', sid: 's1', name: '선형대수', s1: 'a', s2: 'b', s3: 'c' }] };
  });
  renderApp('/review-run');
  // 회상 카드가 뜬다.
  expect(await screen.findByText('회상')).toBeInTheDocument();
  // 전진 → 세션 완료 리캡.
  fireEvent.click(screen.getByText('다시 설명했어요'));
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
});
