// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';
import TooltipHost from '@/components/Tooltip';
import { paletteCommands, recordRecent } from '@/shell';
import { useApp } from '@/store/useApp';

/* Phase 8 — 신규 기능 회귀 고정:
   - 오늘 대시보드 히어로(주간 달성률 링 + 마감 임박 스트립)
   - 명령 팔레트 최근 명령 LRU(최근 실행이 위로) */
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
    (st as { _today?: string })._today = '2026-06-29';
    st.items = [
      {
        id: 'm',
        source: '직접',
        name: '미적분',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '2026-07-05',
        chapters: [],
      },
    ];
  });
});
afterEach(() => cleanup());

test('오늘 히어로: 대시보드 + 주간 달성률 링 + 마감 임박 과목', async () => {
  renderApp('/today');
  await waitFor(() => expect(screen.getByLabelText('오늘 대시보드')).toBeInTheDocument());
  // 주간 달성률 링(aria-label)
  expect(screen.getByLabelText(/이번 주 달성률/)).toBeInTheDocument();
  // 마감 임박 스트립 + D-6 과목(히어로 섹션 내부로 스코프 — 미적분은 다른 카드에도 나옴)
  const hero = screen.getByLabelText('오늘 대시보드');
  expect(within(hero).getByText(/마감 임박/)).toBeInTheDocument();
  expect(within(hero).getByText('미적분')).toBeInTheDocument();
  expect(within(hero).getByText('D-6')).toBeInTheDocument();
});

test('전역 툴팁: data-tip 요소에 hover하면 role=tooltip이 뜨고 mouseout에 사라진다', () => {
  render(
    <>
      <div data-tip="유효숙달 80%" aria-label="유효숙달 80%">
        셀
      </div>
      <TooltipHost />
    </>,
  );
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.mouseOver(screen.getByText('셀'));
  expect(screen.getByRole('tooltip')).toHaveTextContent('유효숙달 80%');
  fireEvent.mouseOut(screen.getByText('셀'));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('팔레트 최근 명령: 실행한 명령이 목록 맨 위로', () => {
  recordRecent('act:reset');
  const cmds = paletteCommands();
  expect(cmds[0].id).toBe('act:reset');
  // 다른 명령 실행 시 그게 1위, 직전 것이 2위
  recordRecent('act:export');
  const after = paletteCommands();
  expect(after[0].id).toBe('act:export');
  expect(after[1].id).toBe('act:reset');
});
