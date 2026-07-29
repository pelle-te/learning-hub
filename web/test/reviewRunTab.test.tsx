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

function renderApp(path: string, state?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[state === undefined ? path : { pathname: path, state }]}>
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
    st.reviewTouches = {};
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

/* ── N-7 이어하기 착지 ───────────────────────────────────────────────────
   칩이 `(7/12)` 를 약속하는 동안 러너는 언제나 0 에서 열렸다 — `resume.ts` 머리주석이 이
   기능의 존재 이유로 든 중복 학습을 기능이 **보장**하던 자리다.

   ⚠ **긍정문으로 잠근다.** "0 에서 시작하지 않는다"만 단언하면 착지가 엉뚱한 카드로 가도
   통과한다(N-1 이 물린 "부정문만 있는 검사"). 몇 번째 카드인지를 직접 본다.
   ⚠ 짝이 되는 음성 테스트가 더 중요하다: 내비 state 없이 그냥 열면 **반드시** 1장부터다.
   그게 깨지면 레일·⌘K 로 연 사람이 묻지도 않고 중간에서 시작한다. */
/** 2장짜리 세션 — 회상(요약) + 유지(끝낸 챕터). 회상·착각은 각각 최대 1장이라 종류를 섞는다. */
function seedTwoCards() {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.cbms = [];
    st.completions = {};
    st.summaries = { '2026-07-04': [{ id: 'r1', sid: 's1', name: '선형대수', s1: 'a', s2: 'b', s3: 'c' }] };
    st.items = [
      {
        id: 'p',
        name: '물리',
        source: '직접',
        mode: 'weekly',
        weeklyHours: 4,
        chapters: [{ id: 'c1', name: '역학', hours: 2, done: true }],
      },
    ] as never;
  });
}

test('review-run: 이어하기로 오면 그 카드에서 시작한다(N-7 착지)', async () => {
  seedTwoCards();
  renderApp('/review-run', { resumeAt: 1 });
  // 1장을 건너뛰고 2번째 카드(유지)에 착지 — 회상 카드는 이미 다른 기기에서 봤다.
  expect(await screen.findByText('유지')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '복습 진행 2 / 2');
  // 건너뛴 카드가 있다는 사실을 말하고, 되돌아갈 길을 함께 준다.
  expect(screen.getByText(/다른 기기에서 1장까지 봤어요/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '처음부터 보기' }));
  expect(await screen.findByText('회상')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '복습 진행 1 / 2');
});

test('review-run: 그냥 열면 언제나 1장부터 — 이어하기는 기본값이 아니라 의도다', async () => {
  seedTwoCards();
  renderApp('/review-run');
  expect(await screen.findByText('회상')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '복습 진행 1 / 2');
  expect(screen.queryByText(/다른 기기에서/)).toBeNull();
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

/* N-10 — 끝낸 챕터가 유지 카드로 **실제 러너에** 뜨는지. 유닛(reviewQueue)은 큐 배열까지만 보고,
   배선(`ch.maintenance` 가 카드 문구까지 닿는지)은 여기서만 관측된다. 설명 없는 재등장은
   "앱이 완료를 잊었다"로 읽히므로 문구 자체가 계약이다(§15-4). */
test('review-run: 끝낸 챕터가 유지 카드로 뜨고 왜 돌아왔는지 말한다', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.summaries = {};
    st.cbms = [];
    st.completions = {};
    st.items = [
      {
        id: 'p',
        name: '물리',
        source: '직접',
        mode: 'weekly',
        weeklyHours: 4,
        chapters: [{ id: 'c1', name: '역학', hours: 2, done: true }], // 앵커 없는 옛 완료 챕터
      },
    ] as never;
  });
  renderApp('/review-run');
  expect(await screen.findByText('유지')).toBeInTheDocument();
  expect(screen.getByText(/끝낸 챕터인데 마지막으로 본 날이 기록에 없어요/)).toBeInTheDocument();
  // 앵커가 없으면 "N일 방치"를 말하지 않는다 — 모르는 것을 아는 척하지 않는다.
  expect(screen.queryByText(/일 방치/)).not.toBeInTheDocument();
});

/* ── E1 인출이 앵커를 옮긴다(2026-07-29) ─────────────────────────────────
   이 화면은 챕터 카드에 "한 번 인출하면 그때부터 유지 주기가 잡힙니다"라고 **약속해 놓고
   그 경로를 주지 않았다** — `touchReview` 의 쓰기 호출부가 `FocusChip` 하나였고, 그건 25분
   세션 완주 + 토스트 클릭까지 요구했다. 유닛(persistence)은 함수만 보고, **배선**(키 → 앱 상태)은
   여기서만 관측된다.

   ⚠ 반증이 본체다: `2`(집중 시작)가 앵커를 옮기면 안 된다. 옮기면 공부 없이 키만 눌러도
   망각곡선이 리셋되고, 그건 조용하다. */
/** 유지 카드 1장짜리 세션(끝낸 챕터 · 앵커 없음) — sid='p' · chapter='역학'. */
function seedOneMaintenance() {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.summaries = {};
    st.cbms = [];
    st.completions = {};
    st.reviewTouches = {};
    st.items = [
      {
        id: 'p',
        name: '물리',
        source: '직접',
        mode: 'weekly',
        weeklyHours: 4,
        chapters: [{ id: 'c1', name: '역학', hours: 2, done: true }],
      },
    ] as never;
  });
}
const touches = () => useApp.getState().state.reviewTouches || {};

test('review-run 키: 3 은 앵커를 오늘로 옮긴다 — 화면이 한 약속을 실제로 지킨다', async () => {
  seedOneMaintenance();
  renderApp('/review-run');
  await screen.findByText('유지');
  expect(touches()['p|역학']).toBeUndefined();
  press('3');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(touches()['p|역학']).toBe('2026-07-08');
});

test('review-run 키: 2(집중 시작)는 앵커를 옮기지 **않는다** — 세션 시작은 인출 사건이 아니다', async () => {
  seedOneMaintenance();
  renderApp('/review-run');
  await screen.findByText('유지');
  press('2');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  // 25분을 실제로 보고 완료해야 FocusChip 이 옮긴다. 여기서 옮기면 키 연타가 곧 리셋이 된다.
  expect(touches()['p|역학']).toBeUndefined();
});

test('review-run 키: 1(건너뛰기)도 앵커를 안 옮긴다', async () => {
  seedOneMaintenance();
  renderApp('/review-run');
  await screen.findByText('유지');
  press('1');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(touches()['p|역학']).toBeUndefined();
});

test('review-run 키: u 는 앵커까지 되돌린다 — 화면과 모델이 갈리지 않는다', async () => {
  seedOneMaintenance();
  renderApp('/review-run');
  await screen.findByText('유지');
  press('3');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(touches()['p|역학']).toBe('2026-07-08');
  press('u');
  expect(await screen.findByText('유지')).toBeInTheDocument();
  // 세션만 물리고 앵커를 두고 오면 "물렸는데 인출한 것으로 남는" 조용한 어긋남이 된다.
  expect(touches()['p|역학']).toBeUndefined();
});
