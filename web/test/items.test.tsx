// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';
import { useApp } from '@/store/useApp';
import { weekMonOf } from '@/lib/weekAlloc';
import { todayISO } from '@/lib/utils';

/* items 탭이 React로 동작: 과목/챕터 추가가 store(앱상태)에 반영되는지.
   (Phase 6에서 레거시 globalThis.state 브리지 제거 — 단일 원천은 Zustand 스토어.) */
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
    st.items = [];
    st.weekAlloc = {};
  });
});
afterEach(() => cleanup());

test('items: React 탭으로 렌더되고 #page를 쓰지 않는다', async () => {
  renderApp('/items');
  // 계획 재개편 v3 — 탭 이름이 '학습 항목' → '과목'(뼈대 병합).
  await waitFor(() => expect(screen.getByRole('heading', { name: /^과목/ })).toBeInTheDocument());
  expect(document.getElementById('page')).toBeNull();
  expect(screen.getByText(/아직 과목이 없어요/)).toBeInTheDocument();
});

test('items: 과목 추가가 store(앱상태)에 반영된다', async () => {
  renderApp('/items');
  const addBtn = await screen.findByRole('button', { name: '+ 과목 추가' });
  fireEvent.click(addBtn);

  await waitFor(() => expect(screen.getByDisplayValue('새 과목')).toBeInTheDocument());
  expect(useApp.getState().state.items).toHaveLength(1);
});

test('items: 챕터 추가가 해당 과목에 들어간다', async () => {
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
  });
  renderApp('/items');

  // 과목 줄을 눌러 펼친다.
  fireEvent.click(await screen.findByText('미적분'));
  const addCh = await screen.findByRole('button', { name: '+ 챕터 추가' });
  fireEvent.click(addCh);

  await waitFor(() => expect(useApp.getState().state.items[0].chapters).toHaveLength(1));
  expect(screen.getByDisplayValue('새 챕터')).toBeInTheDocument();
});

/* ── 회귀 고정: 과목 삭제 · 수정 ───────────────────────────────────────────
   여긴 오래 '추가'만 검증했다. 삭제 경로는 store에서 items만 걷어내는데, weekAlloc은
   `weekAlloc[주][sid]` 맵이라 참조 무결성이 없다 → 지운 과목의 배분이 전 주에 고아로 남아
   요일 열 합·가용 초과 경고를 부풀렸다("보이는 행 합 1h인데 푸터는 4h"). 아래 테스트가 그 청소를
   못박는다(removeSidFromAlloc 배선이 빠지면 즉시 빨개진다). */

/** 시트를 열고 '과목 삭제' → confirm 모달의 '삭제'까지 눌러 실제 삭제 경로를 태운다. */
async function deleteSubjectViaUI(name: string) {
  fireEvent.click(await screen.findByText(name));
  fireEvent.click(await screen.findByRole('button', { name: '과목 삭제' }));
  // ui.confirm 모달(shell/modal) — 취소면 아무 일도 없어야 하므로 '삭제'를 명시적으로 누른다.
  const dialogs = await screen.findAllByRole('dialog');
  const confirmBtn = await within(dialogs[dialogs.length - 1]!).findByRole('button', { name: '삭제' });
  fireEvent.click(confirmBtn);
}

test('items: 과목을 지우면 그 sid의 주간 배분도 함께 사라진다(고아 방지)', async () => {
  const wk = weekMonOf(todayISO(useApp.getState().state));
  useApp.getState().mutate((st) => {
    st.items = [
      {
        id: 'sdel',
        source: '직접',
        name: '삭제될과목',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
      {
        id: 'skeep',
        source: '직접',
        name: '남을과목',
        color: '#f08f4f',
        mode: 'weekly',
        weeklyHours: 2,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
    ];
    // managed 주 — 두 과목 모두 월요일(wd=1)에 배분해 둔다.
    st.weekAlloc = { [wk]: { sdel: [0, 180, 0, 0, 0, 0, 0], skeep: [0, 60, 0, 0, 0, 0, 0] } };
  });
  renderApp('/items');

  await deleteSubjectViaUI('삭제될과목');

  await waitFor(() => expect(useApp.getState().state.items.map((i) => i.id)).toEqual(['skeep']));
  const map = useApp.getState().state.weekAlloc?.[wk];
  expect(map && 'sdel' in map).toBe(false); // ← 고아 배분이 남으면 실패(회귀 고정)
  expect(map?.skeep).toEqual([0, 60, 0, 0, 0, 0, 0]); // 남은 과목 배분은 그대로
});

test('items: 시트에서 과목 이름·주당 시간 수정이 store에 반영된다', async () => {
  useApp.getState().mutate((st) => {
    st.items = [
      {
        id: 'sedit',
        source: '직접',
        name: '옛이름',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
    ];
  });
  renderApp('/items');

  fireEvent.click(await screen.findByText('옛이름'));
  fireEvent.change(await screen.findByLabelText('과목 이름'), { target: { value: '새이름' } });
  await waitFor(() => expect(useApp.getState().state.items[0]!.name).toBe('새이름'));

  // 주당 목표 스텝퍼(+0.5h) — 시트가 소유한 유일한 시간 편집 입구.
  fireEvent.click(screen.getByRole('button', { name: 'h 늘리기' }));
  await waitFor(() => expect(useApp.getState().state.items[0]!.weeklyHours).toBe(3.5));
});

/* N-10 — 완료 체크는 **끝낸 날을 함께 남긴다**. 이 스탬프가 없으면 스케줄러가 done 챕터의
   블록을 더는 안 만들면서 그 챕터의 날짜 링크가 통째로 끊겨, 유지 복습이 걸 사다리가 사라진다. */
test('items: 챕터 완료 체크가 doneDs(끝낸 날)를 남기고, 해제하면 지운다', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
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
        chapters: [{ id: 'c1', name: '극한', hours: 2, done: false }],
      },
    ];
  });
  renderApp('/items');
  fireEvent.click(await screen.findByText('미적분'));
  const done = await screen.findByRole('checkbox', { name: '완료' });

  fireEvent.click(done);
  await waitFor(() => expect(useApp.getState().state.items[0]!.chapters[0]!.done).toBe(true));
  expect(useApp.getState().state.items[0]!.chapters[0]!.doneDs).toBe('2026-07-08');

  fireEvent.click(done);
  await waitFor(() => expect(useApp.getState().state.items[0]!.chapters[0]!.done).toBe(false));
  expect(useApp.getState().state.items[0]!.chapters[0]!.doneDs).toBeUndefined();
});
