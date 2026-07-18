// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';
import { useApp } from '@/store/useApp';

/* items 탭이 React로 동작: 과목/챕터 추가가 store(앱상태)에 반영되는지.
   (Phase 6에서 레거시 globalThis.state 브리지 제거 — 단일 원천은 Zustand 스토어.) */
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

beforeEach(() => {
  useApp.getState().mutate((st) => {
    st.items = [];
  });
});
afterEach(() => cleanup());

test('items: React 탭으로 렌더되고 #page를 쓰지 않는다', async () => {
  renderApp('/items');
  // 계획 재개편 v3 — 탭 이름이 '학습 항목' → '과목'(뼈대 병합).
  await waitFor(() => expect(screen.getByRole('heading', { name: /^과목/ })).toBeInTheDocument());
  expect(document.getElementById('page')).toBeNull();
  expect(screen.getByText(/아직 과목이 없어요/)).toBeInTheDocument();
});

test('items: 과목 추가가 store(앱상태)에 반영된다', async () => {
  renderApp('/items');
  const addBtn = await screen.findByRole('button', { name: '+ 과목 추가' });
  fireEvent.click(addBtn);

  await waitFor(() => expect(screen.getByDisplayValue('새 과목')).toBeInTheDocument());
  expect(useApp.getState().state.items).toHaveLength(1);
});

test('items: 챕터 추가가 해당 과목에 들어간다', async () => {
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
  renderApp('/items');

  // 과목 줄을 눌러 펼친다.
  fireEvent.click(await screen.findByText('미적분'));
  const addCh = await screen.findByRole('button', { name: '+ 챕터 추가' });
  fireEvent.click(addCh);

  await waitFor(() => expect(useApp.getState().state.items[0].chapters).toHaveLength(1));
  expect(screen.getByDisplayValue('새 챕터')).toBeInTheDocument();
});
