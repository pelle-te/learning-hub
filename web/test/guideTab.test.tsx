// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';

/* 안내(guide) 탭 — 정적 매뉴얼. serve.js 무관하게 항상 렌더(순수 참조)임을 확인.
   레지스트리 분기 + lazy/Suspense + 세 축 섹션이 뜨는지 본다. */
function renderApp(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

test('안내 탭: 히어로 + 세 축 섹션 + 도구 표를 정적으로 렌더(serve.js 무관)', async () => {
  renderApp('/guide');
  await waitFor(() => expect(screen.getByText('이 시스템이 할 수 있는 것 · 하는 법')).toBeInTheDocument());
  // 세 축 섹션 제목(전공 학습·수집·목표).
  expect(screen.getByText(/전공 학습 — 교재를 노트로/)).toBeInTheDocument();
  expect(screen.getByText(/수집·발견 — 자료 축/)).toBeInTheDocument();
  expect(screen.getByText(/목표·연관성/)).toBeInTheDocument();
  // 실제 트리거·도구 근거가 박혀 있는지(정확성).
  expect(screen.getByText(/"\(과목\) \(챕터\) 돌려줘"/)).toBeInTheDocument();
  expect(screen.getByText('허브 도구 (제어판)')).toBeInTheDocument();
});
