// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';

/* Phase 3 — 첫 React화 탭(degreeReq)이 레거시 render 대신 진짜 React 컴포넌트로 뜨는지.
   레지스트리 분기 + lazy/Suspense + 공용 컴포넌트가 실제로 맞물리는지 런타임 확인. */
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

test('degreeReq는 React 컴포넌트로 렌더된다(레거시 #page 미사용)', async () => {
  renderApp('/degreeReq');

  // lazy 로드 후 React 컨텐츠가 뜬다.
  await waitFor(() => expect(screen.getByText('전자공학과 졸업요건 정리')).toBeInTheDocument());

  // 데이터 일부(섹션 제목·KPI 라벨·재수강 그룹)가 보인다.
  expect(screen.getByText('1 · 졸업요건 총괄')).toBeInTheDocument();
  expect(screen.getByText('남은 졸업학점')).toBeInTheDocument();
  expect(screen.getByText('전공필수')).toBeInTheDocument();

  // 이 탭은 레거시 innerHTML(#page) 경로를 쓰지 않는다.
  expect(document.getElementById('page')).toBeNull();
});
