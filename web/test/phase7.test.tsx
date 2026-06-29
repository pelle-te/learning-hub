// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';
import { ui } from '@/shell';
import { useApp } from '@/store/useApp';

/* Phase 7 — 성능/UX/접근성 보강 회귀 고정:
   - 나브 방향키 탐색(WAI-ARIA tablist 키보드 계약, 자동 활성)
   - 모달 포커스 복원 + aria-labelledby/describedby(접근성) */
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

test('나브 하위탭: ArrowRight로 다음 탭 자동 활성(today → schedule)', async () => {
  renderApp('/today');
  const today = await screen.findByRole('tab', { name: /오늘 학습/ });
  expect(today).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(today, { key: 'ArrowRight' });
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: /주간 스케줄/ })).toHaveAttribute('aria-selected', 'true'),
  );
});

test('나브 하위탭: End로 그룹의 마지막 탭으로 이동', async () => {
  renderApp('/today');
  const today = await screen.findByRole('tab', { name: /오늘 학습/ });
  fireEvent.keyDown(today, { key: 'End' });
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: /가용시간·수업·일과/ })).toHaveAttribute('aria-selected', 'true'),
  );
});

test('나브 그룹: ArrowRight로 다음 구역 활성(계획 → 자료)', async () => {
  renderApp('/today');
  const plan = await screen.findByRole('tab', { name: /계획/ });
  expect(plan).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(plan, { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByRole('tab', { name: /자료/ })).toHaveAttribute('aria-selected', 'true'));
});

test('단축키: ]는 다음 탭(today → schedule), [는 이전 탭(today → degree)', async () => {
  // 주의: MemoryRouter는 window.location을 안 바꾸므로 항상 today 기준 1홉만 검증(실 BrowserRouter는 정상).
  const { unmount } = renderApp('/today');
  await screen.findByRole('tab', { name: /오늘 학습/ });
  fireEvent.keyDown(document.body, { key: ']' });
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: /주간 스케줄/ })).toHaveAttribute('aria-selected', 'true'),
  );
  unmount();

  renderApp('/today');
  await screen.findByRole('tab', { name: /오늘 학습/ });
  fireEvent.keyDown(document.body, { key: '[' });
  await waitFor(() => expect(screen.getByRole('tab', { name: /졸업 계획/ })).toHaveAttribute('aria-selected', 'true'));
});

test('모달: 포커스 복원 + aria 라벨링(role=dialog)', async () => {
  renderApp('/today');
  const trigger = await screen.findByRole('button', { name: /명령 팔레트 열기/ });
  trigger.focus();
  expect(document.activeElement).toBe(trigger);

  const p = ui.confirm('정말 진행할까요?', { title: '확인' });
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveAttribute('aria-labelledby');
  expect(dialog).toHaveAttribute('aria-describedby');

  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  await expect(p).resolves.toBe(false);
  // 닫히면 직전 포커스(팔레트 버튼)로 복원.
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
