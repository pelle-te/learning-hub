// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';

/* Phase 5 — 서버/외부 탭(integrations·control·mastery)이 React+TanStack Query로 동작.
   jsdom엔 serve.js(/api)·AnkiConnect·FS Access가 없으므로 Query는 isError → 우아한 폴백 카드.
   모두 레거시 #page를 쓰지 않음(전 탭 React화 확인). */
function renderApp(initialPath: string) {
  // 각 테스트 격리: 새 QueryClient(캐시 공유 방지) · retry 없음(폴백 빠르게).
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

test('mastery: 지식상태가 없으면(/api 없음) 셋업 안내로 폴백하고 #page를 안 쓴다', async () => {
  renderApp('/mastery');
  await waitFor(() => expect(screen.getByRole('heading', { name: /숙달도 지도/ })).toBeInTheDocument());
  // /api/artifact/knowledge 실패 → 셋업 카드.
  await waitFor(() => expect(screen.getByText('아직 지식상태가 없어요')).toBeInTheDocument());
  expect(document.getElementById('page')).toBeNull();
});

test('control(탐구 수집): 검색 히어로가 뜨고 워크스페이스 미설정이면 오프라인 안내', async () => {
  renderApp('/control');
  // 옛 OPS 콘솔 폐기 → 탐구 수집 검색 탭(검색 히어로 + 최근 기록).
  await waitFor(() => expect(screen.getByRole('heading', { name: /무엇을 새로 알아볼까요/ })).toBeInTheDocument());
  expect(screen.getByLabelText('탐구 주제')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/워크스페이스가 설정되지 않았어요/)).toBeInTheDocument());
  expect(document.getElementById('page')).toBeNull();
});

test('integrations: 볼트·Anki 두 패널이 렌더된다(#page 미사용)', async () => {
  renderApp('/integrations');
  await waitFor(() => expect(screen.getByRole('heading', { name: '옵시디언 볼트 현황' })).toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Anki 현황' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /AnkiConnect 실시간 due/ })).toBeInTheDocument();
  expect(document.getElementById('page')).toBeNull();
});
