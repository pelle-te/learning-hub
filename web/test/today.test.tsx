// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';
import { useApp } from '@/store/useApp';
import { iso } from '@/lib/utils';

/* Phase 3 — today 탭이 React로 동작: 파생(useSchedule) 카드가 뜨고,
   일일 의식(ritual) 토글이 앱상태에 반영되는지. */
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
    st.rituals = {};
  });
});
afterEach(() => cleanup());

test('today: React 카드(대시보드 히어로·오늘의 흐름)가 뜨고 #page를 쓰지 않는다', async () => {
  renderApp('/today');
  await waitFor(() => expect(screen.getByLabelText('오늘 대시보드')).toBeInTheDocument());
  // 단일 초점 히어로 — kicker(지금/다음/오늘 할 일·오늘 학습) + 보조 '이번 주' 지표(히어로로 스코프).
  const hero = screen.getByLabelText('오늘 대시보드');
  expect(within(hero).getByText(/^(지금 할 일|다음 할 일|오늘 할 일|오늘 학습)$/)).toBeInTheDocument();
  expect(within(hero).getByText('이번 주')).toBeInTheDocument();
  // 흐름 레일 헤딩(블록 체크리스트를 흡수한 now-중심 타임라인).
  expect(screen.getByRole('heading', { name: /^오늘의 흐름/ })).toBeInTheDocument();
  expect(document.getElementById('page')).toBeNull();
});

test('today: 아침 계획 의식 토글이 store.rituals에 기록된다', async () => {
  renderApp('/today');
  // 의식·블록 상세는 단일 화면 대시보드의 "＋ 블록 상세 · 일일 의식" 패널 안에 있음 — 먼저 연다.
  fireEvent.click(await screen.findByRole('button', { name: /일일 의식/ }));
  const cb = await screen.findByRole('checkbox', { name: /아침 계획/ });
  fireEvent.click(cb);

  const ds = iso(new Date());
  await waitFor(() => expect(useApp.getState().state.rituals?.[ds]?.plan).toBe(true));
});
