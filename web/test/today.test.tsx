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

/* ⚠ **과목을 심는 것이 계약이다(H14 · 2026-07-26 감사).** 종전엔 `defaults()`(items: []) 위에서
   렌더했는데, 그 상태의 실제 화면은 **콜드 스타트 온보딩**이다 — 즉 이 테스트들은 사용자가
   그 상태에서 볼 수 없는 대시보드를 검사하고 있었다(스크림 뒤에 조건 없이 살아 있었기 때문에
   가능했고, 그 '뒤에 살아 있음'이 곧 H14 의 결함이었다: Tab 이 새고 SR 이 둘을 섞어 읽었다).
   대시보드를 검사하려면 대시보드가 뜨는 상태를 만들어야 한다. */
beforeEach(() => {
  useApp.getState().mutate((st) => {
    st.rituals = {};
    if (!st.items.some((i) => i.name)) {
      st.items.push({ id: 'seed', name: '테스트 과목', mode: 'weekly', weeklyHours: 5, chapters: [] } as never);
    }
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

test('today: ID-5 오늘의 모양 — 완료·요약 있으면 셧다운 회고 한 줄이 뜬다', async () => {
  const ds = iso(new Date());
  useApp.getState().mutate((st) => {
    st.completions = { [ds]: { 'm|new': { done: true, min: 60 }, 'p|new': { done: true, min: 30 } } };
    st.summaries = { [ds]: [{ id: 'a', sid: 'm', name: '미적분', s1: 'x', s2: 'y', s3: '극한의 정의를 다시 정리' }] };
  });
  renderApp('/today');
  fireEvent.click(await screen.findByRole('button', { name: /일일 의식/ })); // 상세 오버레이 열기
  // 회고 한 줄 — 과목수·세션·배운 것(마지막 요약 마지막 문장).
  expect(await screen.findByText(/오늘의 모양/)).toBeInTheDocument();
  expect(screen.getByText(/극한의 정의를 다시 정리/)).toBeInTheDocument();
  // cleanup: 다음 테스트에 새지 않게.
  useApp.getState().mutate((st) => {
    st.completions = {};
    st.summaries = {};
  });
});
