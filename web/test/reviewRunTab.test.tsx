// @vitest-environment jsdom
/* ============================================================
   reviewRunTab.test.tsx — 복습 세션 러너(I-9) 컴포넌트 회귀.
   빈 큐 폴백 + 회상 카드 흐름(카드 렌더 → 전진 → 세션 완료 리캡).
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    st.summaries = {};
    st.cbms = [];
    st.items = [];
  });
});

test('review-run: 복습할 게 없으면 깨끗함 폴백', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.items = [];
    st.summaries = {};
    st.cbms = [];
    st.completions = {};
  });
  renderApp('/review-run');
  expect(await screen.findByText('복습할 게 없어요')).toBeInTheDocument();
});

/** 회상 카드 1장짜리 세션(4일 전 요약 → pickRetrieval 이 카드 생성 · minAge 2일↑). */
function seedOneRetrieval() {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.items = [];
    st.cbms = [];
    st.completions = {};
    st.summaries = { '2026-07-04': [{ id: 'r1', sid: 's1', name: '선형대수', s1: 'a', s2: 'b', s3: 'c' }] };
  });
}
const press = (key: string) => fireEvent.keyDown(document, { key });

test('review-run: 회상 카드 흐름 — 렌더 → 펼침 → 판정 → 세션 완료', async () => {
  seedOneRetrieval();
  renderApp('/review-run');
  expect(await screen.findByText('회상')).toBeInTheDocument();
  // 발치 키캡 바가 카드의 옛 버튼 무리를 대신한다(D-3) — 키캡은 진짜 버튼이다.
  // ⚠ 펼치기 전엔 판정 칩(2)이 **바에 없다** — 있으면 Space 와 같은 일을 하는 칩이 둘이 된다.
  expect(screen.queryByRole('button', { name: /다시 설명했어요/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /원래 요약 펼치기/ }));
  fireEvent.click(screen.getByRole('button', { name: /다시 설명했어요/ }));
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(screen.getByText(/카드 1장 중/)).toBeInTheDocument();
});

/* ── D-3 키보드 계약 ─────────────────────────────────────────────────────
   이 화면엔 keydown 이 0개였다. 계약 자체가 새 표면이라 각 키를 잠근다 — 특히
   "대조 없는 판정 금지"는 어기면 **조용히** 거짓 기록을 만든다(눈에 안 보인다). */
test('review-run 키: Space 펼치기 → 2 판정 → 완료', async () => {
  seedOneRetrieval();
  renderApp('/review-run');
  await screen.findByText('회상');
  expect(screen.queryByText('a')).toBeNull(); // 아직 원래 요약은 감춰져 있다
  press(' ');
  expect(await screen.findByText('a')).toBeInTheDocument();
  press('2');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
});

test('review-run 키: 펼치기 전 2 는 판정이 아니라 펼치기다(대조 없는 인출 기록 금지)', async () => {
  seedOneRetrieval();
  renderApp('/review-run');
  await screen.findByText('회상');
  press('2');
  // 세션이 끝나지 않았고, 대신 원래 요약이 펼쳐졌다.
  expect(screen.queryByText('복습 세션 완료')).toBeNull();
  expect(await screen.findByText('a')).toBeInTheDocument();
});

test('review-run 키: 1 은 펼치기 전에도 건너뛴다 — 인출로 세지 않는다', async () => {
  seedOneRetrieval();
  renderApp('/review-run');
  await screen.findByText('회상');
  press('1');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(screen.getByText(/카드 1장 중/).textContent).toContain('0개를 인출'); // 건너뛰기는 성과가 아니다
});

test('review-run 키: u 는 직전 전진을 되돌린다(빨라진 키의 짝)', async () => {
  seedOneRetrieval();
  renderApp('/review-run');
  await screen.findByText('회상');
  press('1');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  press('u');
  expect(await screen.findByText('회상')).toBeInTheDocument(); // 카드로 돌아왔다
});
