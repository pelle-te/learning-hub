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

/* Phase 4 — 앱상태 탭 7개(schedule·routine·journal·review·stats·degree·settings)가
   React로 동작하고 변경이 store(앱상태)에 반영되는지. 모두 #page(레거시 노드)를 쓰지 않음. */
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

beforeEach(() => {
  useApp.getState().mutate((st) => {
    st.items = [
      {
        id: 'sx',
        source: '직접',
        name: '미적분',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
    ];
    st.routine = [];
    st.summaries = {};
    st.cbms = [];
    st.backlog = [];
    st.weekly = {};
    st.degree = { targetTotal: 130, reqMajorReq: 60, reqMajorSel: 30, reqLiberal: 30, semesters: [] };
  });
});
afterEach(() => cleanup());

// 계획 재개편 v4 — 캘린더 세그먼트는 [일·주·월]만 소유하고, 배분은 /alloc 독립 세그먼트로 승격됐다.
test('schedule: 캘린더 세그먼트가 일/주/월 뷰를 전환한다(#page 미사용)', async () => {
  renderApp('/schedule');
  // 기본 = 주 뷰(배분이 빠지며 캘린더가 계획의 첫 착지)
  await waitFor(() => expect(screen.getByRole('button', { name: '주' })).toHaveAttribute('aria-pressed', 'true'));
  expect(document.getElementById('page')).toBeNull();
  // 배분은 뷰 스위치에서 빠졌다 — 세그먼트 나브의 '배분' 버튼과 헷갈리지 않게 그룹 안으로 범위를 좁혀 확인.
  const viewSwitch = within(screen.getByRole('group', { name: '캘린더 보기 방식' }));
  expect(viewSwitch.queryByRole('button', { name: '배분' })).toBeNull();
  // 일 뷰로 전환 → aria-pressed 이동(세그먼트는 tablist 미이행 → group+aria-pressed, WCAG 4.1.2)
  fireEvent.click(screen.getByRole('button', { name: '일' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '일' })).toHaveAttribute('aria-pressed', 'true'));
  // 주 뷰로 전환 → 주간 네비 등장
  fireEvent.click(screen.getByRole('button', { name: '주' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '◀ 이전 주' })).toBeInTheDocument());
  // 월 뷰로 전환 → aria-pressed 이동
  fireEvent.click(screen.getByRole('button', { name: '월' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '월' })).toHaveAttribute('aria-pressed', 'true'));
});

// 계획 재개편 v3 — '뼈대'는 '과목' 탭의 접이식 스트립으로 병합됐다(/routine은 /items 리다이렉트).
// 편집기는 온디맨드라 스트립을 먼저 펼쳐야 '+ 블록 추가'가 나온다.
test('routine: + 블록 추가가 store.routine에 들어간다', async () => {
  renderApp('/routine');
  fireEvent.click(await screen.findByRole('button', { name: /수업·일과 편집/ }));
  const add = await screen.findByRole('button', { name: '+ 블록 추가' });
  fireEvent.click(add);
  await waitFor(() => expect(useApp.getState().state.routine.some((b) => b.type !== '수업')).toBe(true));
});

test('alloc: 배분 세그먼트가 과목×요일 보드를 렌더한다', async () => {
  renderApp('/alloc');
  await waitFor(() => expect(screen.getByRole('grid', { name: '주간 배분 보드' })).toBeInTheDocument());
  expect(document.getElementById('page')).toBeNull();
});

test('journal: 3문장 요약 저장이 store.summaries에 기록된다', async () => {
  renderApp('/journal');
  const ta = await screen.findByPlaceholderText(/시변 환경에서/);
  fireEvent.change(ta, { target: { value: '맥스웰 방정식 해석' } });
  fireEvent.click(screen.getByRole('button', { name: '요약 저장' }));
  const ds = iso(new Date());
  await waitFor(() => expect((useApp.getState().state.summaries[ds] || []).length).toBe(1));
});

test('review: 주간 점검 체크가 store.weekly에 저장된다', async () => {
  renderApp('/review');
  const cbs = await screen.findAllByRole('checkbox');
  fireEvent.click(cbs[0]);
  await waitFor(() => {
    const weekly = useApp.getState().state.weekly;
    expect(Object.values(weekly).some((w) => Object.values(w.checks).some(Boolean))).toBe(true);
  });
});

test('stats: 과목이 있으면 KPI/과목별 진행 표가 뜬다', async () => {
  renderApp('/stats');
  await waitFor(() => expect(screen.getByRole('heading', { name: '과목별 진행' })).toBeInTheDocument());
  expect(screen.getByText('연속 학습일')).toBeInTheDocument();
});

test('degree: + 학기 추가가 store.degree.semesters에 들어간다', async () => {
  renderApp('/degree');
  const add = await screen.findByRole('button', { name: '+ 학기 추가' });
  fireEvent.click(add);
  await waitFor(() => expect(useApp.getState().state.degree.semesters.length).toBe(1));
});

test('settings: 모듈 길이 변경이 store에 반영된다', async () => {
  renderApp('/settings');
  const input = await screen.findByLabelText('모듈 길이 (시간)');
  fireEvent.change(input, { target: { value: '3' } });
  await waitFor(() => expect(useApp.getState().state.moduleLen).toBe(180));
});
