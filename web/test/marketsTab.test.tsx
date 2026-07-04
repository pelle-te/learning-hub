// @vitest-environment jsdom
/* ============================================================
   marketsTab.test.tsx — 증시 동향 탭. 오프라인 EmptyState · 지수 보드 렌더(▲▼+부호) ·
   온디맨드 AI 브리핑(스텁 서버) 다이얼로그.
============================================================ */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';

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

function jsonRes(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

const INDICES = [
  {
    symbol: '^KS11',
    name: '코스피',
    region: '한국',
    currency: 'KRW',
    price: 8088.34,
    prevClose: 7648.1,
    change: 440.24,
    changePct: 5.76,
    spark: [7600, 7700, 8088.34],
  },
  {
    symbol: '^GSPC',
    name: 'S&P 500',
    region: '미국',
    currency: 'USD',
    price: 7483.24,
    prevClose: 7500.5,
    change: -17.26,
    changePct: -0.23,
    spark: [7500.5, 7483.24],
  },
];
const NEWS = [
  {
    id: 'n1',
    source: '연합뉴스 경제',
    field: '국내증시',
    title: '반도체 강세에 코스피 급등',
    url: 'https://x/n1',
    published: 'Fri, 3 Jul 2026 20:57:52 +0900',
    summary: '외국인 매수세가 유입되며 지수가 3% 넘게 올랐다.',
  },
];

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('오프라인(serve.js OFF): 안내 EmptyState가 뜬다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/ping') return jsonRes({ ok: false }, false);
      return jsonRes({ ok: false, error: 'off' }, false);
    }),
  );
  renderApp('/markets');
  await waitFor(() => expect(screen.getByText('serve.js가 꺼져 있어요')).toBeInTheDocument());
});

test('지수 보드가 등락(▲▼+부호)과 뉴스를 렌더한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/ping') return jsonRes({ ok: true, server: 's', tools: ['markets-collect'], work: '/' });
      if (url === '/api/artifact/markets')
        return jsonRes({
          ok: true,
          data: { at: '2026-07-03T23:40:23', date: '2026-07-03', indices: INDICES, news: NEWS },
        });
      return jsonRes({ ok: false }, false);
    }),
  );
  renderApp('/markets');

  // 방향 aria-label(색 비의존) — 카드마다 고유
  await waitFor(() => expect(screen.getByLabelText(/코스피, 상승 5.76퍼센트/)).toBeInTheDocument());
  expect(screen.getByLabelText(/S&P 500, 하락 0.23퍼센트/)).toBeInTheDocument();
  // 부호 표기(카드·리드아웃 등 최소 1곳 이상)
  expect(screen.getAllByText(/\+5\.76%/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/−0\.23%/).length).toBeGreaterThan(0);
  // 뉴스
  expect(screen.getByText('반도체 강세에 코스피 급등')).toBeInTheDocument();
});

test('AI 브리핑 버튼 → 다이얼로그에 해설이 뜬다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/ping') return jsonRes({ ok: true, server: 's', tools: ['markets-collect'], work: '/' });
      if (url === '/api/artifact/markets')
        return jsonRes({
          ok: true,
          data: { at: '2026-07-03T23:40:23', date: '2026-07-03', indices: INDICES, news: NEWS },
        });
      if (url === '/api/markets/brief')
        return jsonRes({
          ok: true,
          brief: {
            overview: '반도체 강세가 지수를 끌어올렸다.',
            drivers: [{ title: '외국인 순매수', detail: '반도체 중심으로 매수세 유입.' }],
            watch: ['미 고용지표'],
            caveat: '지연·참고용 해설입니다.',
          },
        });
      return jsonRes({ ok: false }, false);
    }),
  );
  renderApp('/markets');
  await waitFor(() => expect(screen.getByLabelText(/코스피, 상승 5.76퍼센트/)).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /오늘 왜 움직였나/ }));

  await waitFor(() => expect(screen.getByText('반도체 강세가 지수를 끌어올렸다.')).toBeInTheDocument());
  expect(screen.getByRole('dialog', { name: /오늘의 증시 브리핑/ })).toBeInTheDocument(); // 공용 DetailDrawer(제목에 🤖 프리픽스)
  expect(screen.getByText('외국인 순매수')).toBeInTheDocument();
  expect(screen.getByText('미 고용지표')).toBeInTheDocument();
});
