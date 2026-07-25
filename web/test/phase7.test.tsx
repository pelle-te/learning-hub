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
import { useUI } from '@/store/useUI';

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

test('나브 하위탭: ArrowRight로 다음 탭 자동 활성(today → 계획)', async () => {
  // 계획 개편: today(10) 다음 order 12 = '계획'(=캘린더 자신 · D-4 로 plan-host 셸 은퇴).
  renderApp('/today');
  const today = await screen.findByRole('button', { name: /오늘 학습/ });
  expect(today).toHaveAttribute('aria-current', 'page');
  fireEvent.keyDown(today, { key: 'ArrowRight' });
  await waitFor(() => expect(document.getElementById('rail-schedule')).toHaveAttribute('aria-current', 'page'));
});

test('레일 나브: End로 마지막 나브 항목(설정)으로 이동', async () => {
  renderApp('/today');
  const today = await screen.findByRole('button', { name: /오늘 학습/ });
  fireEvent.keyDown(today, { key: 'End' });
  // roving 대상 = 라벨+그룹 사이드바의 모든 나브 항목(설정 그룹 포함): …·control·settings → 마지막은 '설정'.
  await waitFor(() => expect(document.getElementById('rail-settings')).toHaveAttribute('aria-current', 'page'));
});

test('레일 나브: ArrowLeft가 첫 항목에서 마지막(설정)으로 순환', async () => {
  renderApp('/today');
  const today = await screen.findByRole('button', { name: /오늘 학습/ });
  expect(today).toHaveAttribute('aria-current', 'page');
  fireEvent.keyDown(today, { key: 'ArrowLeft' });
  await waitFor(() => expect(document.getElementById('rail-settings')).toHaveAttribute('aria-current', 'page'));
});

test('단축키: ]는 다음 도달점(today → 계획), [는 이전(today → 설정 · 링이 표면 안에서 순환)', async () => {
  // 주의: MemoryRouter는 window.location을 안 바꾸므로 항상 today 기준 1홉만 검증(실 BrowserRouter는 정상).
  // 계획 개편: today 다음 도달점 = 계획(schedule · order 12).
  const { unmount } = renderApp('/today');
  await screen.findByRole('button', { name: /오늘 학습/ });
  fireEvent.keyDown(document.body, { key: ']' });
  await waitFor(() => expect(document.getElementById('rail-schedule')).toHaveAttribute('aria-current', 'page'));
  unmount();

  renderApp('/today');
  await screen.findByRole('button', { name: /오늘 학습/ });
  fireEvent.keyDown(document.body, { key: '[' });
  /* D-4 — 링이 **레일과 같은 목록**(학습 표면의 destination)을 돈다. 그 마지막은 '설정'이다.
     예전엔 전역 목록을 돌아 학습 화면에서 자료 표면 탭으로 새어 나갔고(레일엔 없는 곳), 정작
     레일 마지막인 '설정'은 링에서 빠져 있었다 — 둘 다 조용한 결함이었다. */
  await waitFor(() => expect(document.getElementById('rail-settings')).toHaveAttribute('aria-current', 'page'));
});

test('레일 나브: 접기 토글이 사이드바를 접고 펼친다(navCollapsed)', async () => {
  useUI.setState((s) => {
    s.ui.navCollapsed = false;
  });
  renderApp('/today');
  const toggle = await screen.findByRole('button', { name: '사이드바 접기' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(toggle);
  await waitFor(() => expect(useUI.getState().ui.navCollapsed).toBe(true));
  // 접힘 상태에선 라벨이 '펼치기'로 바뀐다(aria-pressed=true).
  const expand = screen.getByRole('button', { name: '사이드바 펼치기' });
  expect(expand).toHaveAttribute('aria-pressed', 'true');
  // 복원(다른 테스트 누수 방지).
  fireEvent.click(expand);
  await waitFor(() => expect(useUI.getState().ui.navCollapsed).toBe(false));
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
