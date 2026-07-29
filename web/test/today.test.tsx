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
  /* ⚠⚠ **오버레이 안으로 범위를 좁힌다 — 안 좁히면 이 테스트는 저녁에만 깨진다.**
     '오늘의 모양'은 두 곳에서 렌더된다: 여기 의식 카드(`Today.tsx` · 잴 것이 있으면 언제나)와
     시그니처(`TodaySignature` · **`dayPhase`가 `closing`일 때만**). 늦은 시각엔 남은 가용이
     가장 짧은 블록보다 작아져 `closing`이 참이 되고, 그러면 화면에 둘 다 떠서
     `findByText`가 "Found multiple elements"로 죽는다.
     실제로 2026-07-26(N-5 국면 도입) 이후 **저녁에 게이트를 돌렸다면 늘 실패했을** 테스트였다 —
     게이트가 늘 낮에 돌아 안 보였을 뿐이고, 2026-07-29 21:39 커밋에서 처음 드러났다.
     벽시계에 따라 답이 달라지는 단언은 그 자체가 결함이다(`e2e`가 `boot(at)`으로 시각을
     고정하는 것과 같은 이유). 여기서 보려는 것은 **의식 오버레이의 회고 한 줄**이므로
     그 컨테이너 안에서만 찾으면 국면과 무관해진다. */
  const sheet = within(await screen.findByRole('dialog', { name: '오늘 상세' }));
  expect(await sheet.findByText(/오늘의 모양/)).toBeInTheDocument();
  expect(sheet.getByText(/극한의 정의를 다시 정리/)).toBeInTheDocument();
  // cleanup: 다음 테스트에 새지 않게.
  useApp.getState().mutate((st) => {
    st.completions = {};
    st.summaries = {};
  });
});
