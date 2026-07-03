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
   - 레일 나브 방향키 탐색(roving tabindex, 자동 활성) — 활성 표기는 aria-current="page"
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
  const today = await screen.findByRole('button', { name: /오늘 학습/ });
  expect(today).toHaveAttribute('aria-current', 'page');
  fireEvent.keyDown(today, { key: 'ArrowRight' });
  await waitFor(() => expect(document.getElementById('rail-schedule')).toHaveAttribute('aria-current', 'page'));
});

test('레일 나브: End로 마지막 1차 탭(제어판)으로 이동', async () => {
  renderApp('/today');
  const today = await screen.findByRole('button', { name: /오늘 학습/ });
  fireEvent.keyDown(today, { key: 'End' });
  // 레일 1차 탭(숨김 제외): today·schedule·items·integrations·journal·stats·control → 마지막은 '탐구 수집'.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /탐구 수집/ })).toHaveAttribute('aria-current', 'page'),
  );
});

test('레일 나브: ArrowLeft가 첫 탭에서 마지막(제어판)으로 순환', async () => {
  renderApp('/today');
  const today = await screen.findByRole('button', { name: /오늘 학습/ });
  expect(today).toHaveAttribute('aria-current', 'page');
  fireEvent.keyDown(today, { key: 'ArrowLeft' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /탐구 수집/ })).toHaveAttribute('aria-current', 'page'),
  );
});

test('단축키: ]는 다음 탭(today → schedule), [는 이전 탭(today → control=탐구수집)', async () => {
  // 주의: MemoryRouter는 window.location을 안 바꾸므로 항상 today 기준 1홉만 검증(실 BrowserRouter는 정상).
  const { unmount } = renderApp('/today');
  await screen.findByRole('button', { name: /오늘 학습/ });
  fireEvent.keyDown(document.body, { key: ']' });
  await waitFor(() => expect(document.getElementById('rail-schedule')).toHaveAttribute('aria-current', 'page'));
  unmount();

  renderApp('/today');
  await screen.findByRole('button', { name: /오늘 학습/ });
  fireEvent.keyDown(document.body, { key: '[' });
  // 표시(비숨김) 탭 마지막은 이제 '시스템 제어판'(routine·degree·review·mastery는 섹션 세그먼트로 흡수·숨김).
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /탐구 수집/ })).toHaveAttribute('aria-current', 'page'),
  );
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
