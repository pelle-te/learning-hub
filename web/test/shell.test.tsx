// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';

/* Phase 2 통합 스모크 — React 셸 + 레거시 어댑터가 실제로 맞물리는지(컴파일만이 아니라 런타임).
   '/today'로 들어가 (1) 레거시 render가 #page를 채우고 (2) React Nav가 그룹/탭을 그리며
   (3) 탭 전환이 라우터로 동작함을 jsdom에서 확인. */
function renderApp(initialPath = '/today') {
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

test('React 셸이 마운트되고 today(React화) 탭 + 나브 + 팔레트 버튼이 뜬다', async () => {
  renderApp('/today');

  // today는 Phase 3에서 React화 → 레거시 #page 대신 React 컨텐츠(대시보드 히어로).
  await waitFor(() => expect(screen.getByLabelText('오늘 대시보드')).toBeInTheDocument());

  // React Nav: 상위 그룹 탭(계획/자료/기록·분석/졸업)이 렌더된다.
  expect(screen.getByRole('tab', { name: /계획/ })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /자료/ })).toBeInTheDocument();

  // 헤더 ⌘K 버튼이 있다(팔레트 진입점).
  expect(screen.getByRole('button', { name: /명령 팔레트 열기/ })).toBeInTheDocument();
});

test('탭 전환: 숙달도 지도(Phase 5 React화) 탭은 #page를 쓰지 않는다', async () => {
  // Phase 5까지 전 탭 React화 — integrations·control·mastery도 React(TanStack Query).
  // 레거시 render(#page) 경로를 쓰는 등록 탭은 더 이상 없음(어댑터 mountTab은 폴백으로만 잔존).
  renderApp('/mastery');
  await waitFor(() => expect(screen.getByRole('heading', { name: /숙달도 지도/ })).toBeInTheDocument());
  expect(document.getElementById('page')).toBeNull();
});
