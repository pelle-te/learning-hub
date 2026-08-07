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
   - 레일 나브 방향키 탐색(roving tabindex · **수동 활성** — H10/2026-07-30) — 활성 표기는 aria-current="page"
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

/* ⚠⚠ **아래 세 케이스는 2026-07-30 `/감사 근본`(H10)에서 계약이 뒤집혔다.**

   종전 이름은 _"ArrowRight로 다음 탭 **자동 활성**"_ 이었고, 화살표 한 번에 라우트가 바뀌는 것을
   **계약으로 적어** 두고 있었다. 그 거동이 두 가지를 깼다: ① SR 사용자가 레일을 훑을 수 없다
   (라우트 아나운서가 매번 갱신돼 읽으려던 라벨이 잘린다) ② `go()` → `markVia('rail')` →
   `recordVisit` 이라 **키보드 탐색이 '레일 방문'으로 집계**돼, IA 재판정이 기다리는
   `route_visits` 가 오염된다.

   새 계약은 형제 위젯 `SubTabs` 와 같다(그 파일이 근거를 이미 적어 뒀다): **화살표는 포커스,
   활성화는 Enter/Space/클릭.** 그래서 케이스도 두 쪽을 함께 잠근다 — 포커스가 옮겨지는 것과
   **라우트가 안 바뀌는 것**, 그리고 Enter 로는 실제로 바뀌는 것. 한쪽만 검사하면 "아무것도
   안 하는 화살표"도 통과한다. */
test('레일 나브: ArrowRight 는 포커스만 옮기고 라우트를 바꾸지 않는다(수동 활성)', async () => {
  renderApp('/today');
  const today = await screen.findByRole('button', { name: /오늘 학습/ });
  expect(today).toHaveAttribute('aria-current', 'page');

  fireEvent.keyDown(today, { key: 'ArrowRight' });

  // 포커스는 다음 도달점으로 간다(계획 개편: today(10) 다음 order 12 = '계획').
  await waitFor(() => expect(document.activeElement).toBe(document.getElementById('rail-schedule')));
  // 그러나 현재 페이지는 그대로다 — 이게 H10 이 되찾은 성질이다.
  expect(today).toHaveAttribute('aria-current', 'page');
  expect(document.getElementById('rail-schedule')).not.toHaveAttribute('aria-current', 'page');
});

test('레일 나브: 포커스를 옮긴 뒤 Enter 가 실제로 활성화한다(도달성은 유지)', async () => {
  renderApp('/today');
  const today = await screen.findByRole('button', { name: /오늘 학습/ });
  fireEvent.keyDown(today, { key: 'ArrowRight' });
  await waitFor(() => expect(document.activeElement).toBe(document.getElementById('rail-schedule')));

  /* 네이티브 버튼의 Enter = click. 화살표에서 활성화를 뺐어도 **키보드로 도달 가능**해야 한다 —
     그게 빠지면 접근성을 고치려다 접근성을 깨는 것이다. */
  fireEvent.click(document.getElementById('rail-schedule')!);
  await waitFor(() => expect(document.getElementById('rail-schedule')).toHaveAttribute('aria-current', 'page'));
});

test('레일 나브: End 는 마지막 항목(설정)으로 포커스를 옮긴다', async () => {
  renderApp('/today');
  const today = await screen.findByRole('button', { name: /오늘 학습/ });
  fireEvent.keyDown(today, { key: 'End' });
  // roving 대상 = 라벨+그룹 사이드바의 모든 나브 항목(설정 그룹 포함): …·control·settings → 마지막은 '설정'.
  await waitFor(() => expect(document.activeElement).toBe(document.getElementById('rail-settings')));
  expect(today).toHaveAttribute('aria-current', 'page'); // 라우트는 불변
});

/* ⚠ **A-9(2026-08-07) — 레일의 첫 항목이 `find` 로 바뀌었다.** 이 케이스가 지키는 것은
   *"첫 항목에서 ← 를 누르면 마지막으로 감긴다"* 이고 그 명제는 그대로다 — 바뀐 것은 *누가
   첫 항목인가* 뿐이라, 시작점을 로스터에 맞춰 옮긴다(검사를 지우지 않고 대역을 간다).
   ⚠ `today` 에서 시작하던 옛 형태를 되살리지 말 것: 지금 `today` 는 첫 항목이 아니라
   `find` 로 한 칸 갈 뿐이고, 그러면 이 케이스가 **순환을 안 재게 된다**(공허한 통과). */
test('레일 나브: ArrowLeft 가 첫 항목에서 마지막(설정)으로 순환한다', async () => {
  renderApp('/today');
  const first = await screen.findByRole('button', { name: /찾기/ });
  fireEvent.keyDown(first, { key: 'ArrowLeft' });
  await waitFor(() => expect(document.activeElement).toBe(document.getElementById('rail-settings')));
  expect(document.getElementById('rail-today')).toHaveAttribute('aria-current', 'page'); // 라우트는 불변
});

test('단축키: ]는 다음 도달점(today → 계획), [는 이전(today → 찾기 · 링이 레일 순서를 돈다)', async () => {
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
  /* D-4 — 링이 **레일과 같은 목록**(destination)을 돈다. 예전엔 전역 목록을 돌아 학습 화면에서
     자료 표면 탭으로 새어 나갔고(레일엔 없는 곳), 정작 레일 마지막인 '설정'은 링에서 빠져
     있었다 — 둘 다 조용한 결함이었다.
     ⚠ **A-9(2026-08-07): `today` 의 이전은 이제 `find` 다**(레일 최상단 승격). 링이 레일에서
     파생된다는 이 케이스의 명제 자체가 그 변화를 따라온 것이라 값을 갱신한다 — 여기가 옛
     값에 머물면 그건 링이 레일을 안 따라간다는 뜻이 되고, 정확히 이 검사가 막으려는 상태다. */
  await waitFor(() => expect(document.getElementById('rail-find')).toHaveAttribute('aria-current', 'page'));
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

  /* ⚠ Q-13 이후 `ui.confirm` 은 없다 — 파괴적 동작은 3단 사다리 어휘로만 말한다
     (`shell/destructive.ts`). 이 케이스가 재는 것은 **모달 자체의 a11y 계약**이라 어느 단으로
     띄우든 같다. ②단(재구성 가능)이 중립적이라 그것으로 띄운다. */
  const p = ui.confirmLossy('정말 진행할까요?', { title: '확인' });
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveAttribute('aria-labelledby');
  expect(dialog).toHaveAttribute('aria-describedby');

  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  await expect(p).resolves.toBe(false);
  // 닫히면 직전 포커스(팔레트 버튼)로 복원.
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
