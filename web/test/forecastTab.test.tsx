// @vitest-environment jsdom
/* ============================================================
   forecastTab.test.tsx — 복습 부하 예보(ID-1) 컴포넌트 회귀.
   빈 상태 폴백 + 실제 App 셸에서 마운트되며 상단 리드아웃을 주입하는지(스모크).
   막대 차트의 '부하 형태' 렌더는 e2e 스냅샷(실 시드 데이터)이 소유한다(§15-4).
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
    st.items = [];
    st.completions = {};
    st.dayOverrides = {};
  });
});

test('forecast: 완료 챕터가 없으면 EmptyState로 폴백', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.items = [];
    st.completions = {};
  });
  renderApp('/forecast');
  // lazy 로드 → Suspense 해제까지 findBy로 대기.
  expect(await screen.findByText('다가오는 복습 파도가 아직 없어요')).toBeInTheDocument();
  // 상단 리드아웃(페이지 크롬)이 주입된다 — 실제 셸에 마운트됐다는 관측 가능한 증거.
  expect(screen.getByText('앞 14일 복습')).toBeInTheDocument();
});

/* N-9 가용선의 **개입** 경로는 e2e 시드로는 안 나온다 — 시드의 일과가 헐렁해 가용이 파도보다
   한참 크기 때문이다(그게 정상이다: 초과는 드물어야 한다). 그래서 초과가 실제로 렌더되는지는
   여기서 실 셸·실 스케줄러로 한 번 본다(§15-4 · 유닛만으론 "계산은 맞는데 화면에 없는" 부류를 못 잡는다). */
test('forecast: 가용을 넘는 날이 있으면 초과 스트립과 앞당길 후보가 뜬다', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.startDate = '2026-07-08';
    st.moduleLen = 120;
    st.items = [
      {
        id: 'p',
        name: '물리',
        source: '직접',
        mode: 'weekly',
        weeklyHours: 6,
        chapters: [{ id: 'c1', name: '역학', hours: 8 }],
      },
    ] as never;
    st.completions = { '2026-07-08': { 'p|new': { done: true, min: 120 } } } as never;
    st.dayOverrides = { '2026-07-09': 0.5 } as never; // 그날 가용 30분 = 복습 1블록
  });
  renderApp('/forecast');
  // 초과 스트립 — 날짜·부하·가용을 같은 단위로 말한다.
  const strip = await screen.findByRole('status', { name: '가용 초과' });
  expect(strip).toHaveTextContent('7/9');
  expect(strip).toHaveTextContent('복습 4블록');
  expect(strip).toHaveTextContent('가용 1블록');
  // 앞당길 후보 — +1일 앞엔 여유 날이 없으니 '오늘'로 떨어진다.
  expect(strip).toHaveTextContent('물리 역학 → 오늘');
  // 리드아웃도 초과를 결론으로 올린다(Anki 컨텍스트 자리를 대신).
  expect(screen.getByText('가용 초과')).toBeInTheDocument();
});
