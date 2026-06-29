// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';
import { useApp } from '@/store/useApp';

/* Phase 6 — 레거시 JS 런타임 제거 후 네이티브 셸(shell/*)이 동작하는지:
   네이티브 토스트·확인 모달·테마 토글·아이콘 나브. globalThis.state(레거시 브리지) 없음. */
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

beforeEach(() => {
  useApp.getState().mutate((st) => {
    st.theme = 'light';
    st.items = [];
  });
});
afterEach(() => cleanup());

test('레거시 globalThis.state 브리지가 제거됐다(단일 원천=Zustand)', () => {
  expect((globalThis as unknown as { state?: unknown }).state).toBeUndefined();
});

test('네이티브 나브: 그룹 탭 + 라인 아이콘(svg.ic)이 렌더된다', async () => {
  const { container } = renderApp('/today');
  await waitFor(() => expect(screen.getByRole('tab', { name: /계획/ })).toBeInTheDocument());
  expect(screen.getByRole('tab', { name: /기록·분석/ })).toBeInTheDocument();
  // 아이콘은 dangerouslySetInnerHTML로 주입한 인라인 svg.ic.
  expect(container.querySelectorAll('svg.ic').length).toBeGreaterThan(0);
});

test('테마 토글: <html data-theme> 순환 + 토스트', async () => {
  renderApp('/today');
  const btn = await screen.findByRole('button', { name: '테마 전환' });
  fireEvent.click(btn); // light → sepia
  await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('sepia'));
  expect(useApp.getState().state.theme).toBe('sepia');
  // 네이티브 토스트가 떴다.
  await waitFor(() => expect(screen.getByText(/테마:/)).toBeInTheDocument());
});

test('확인 모달: 전체 초기화 → 취소하면 데이터가 유지된다', async () => {
  useApp.getState().mutate((st) => {
    st.items = [
      {
        id: 'sx',
        source: '직접',
        name: '미적분',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
    ];
  });
  renderApp('/today');
  fireEvent.click(await screen.findByRole('button', { name: '⋯ 메뉴' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /전체 초기화/ }));
  // 네이티브 모달이 열린다.
  await screen.findByText(/모든 데이터를 지울까요/);
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  await waitFor(() => expect(screen.queryByText(/모든 데이터를 지울까요/)).not.toBeInTheDocument());
  // 취소 → 초기화 안 됨.
  expect(useApp.getState().state.items).toHaveLength(1);
});
