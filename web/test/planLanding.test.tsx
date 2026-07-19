// @vitest-environment jsdom
/* ============================================================
   planLanding.test.tsx — 계획 탭 '착지'의 결정론 회귀 고정(Wave 2).
   결함: Today의 "오늘 계획 짜기"가 `/plan-host`로만 보내 캘린더의 **영속 뷰**(schedView·기본 week)에
   떨어졌다 — '오늘'을 요청했는데 주 격자(혹은 지난번 아무 뷰)가 열려 첫 화면이 매번 달랐다.
   계약: CTA는 ① 뷰를 day로 **보내는 쪽에서 먼저** 전환하고 ② `?ds=<오늘>` 딥링크로 날짜를 싣는다.
   (일반 진입 = 나브 '계획'·⌘K·g p는 영속 뷰 존중 — 그건 v4에서 사용자가 못박은 "기본 착지=캘린더 주 뷰".)
============================================================ */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import { todayISO, parseISO, fmtShort } from '@/lib/utils';

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
  // 과목은 있으나(hasItems) 챕터가 없어 오늘 블록이 0 → Today가 "오늘 계획 짜기" CTA를 띄우는 상태.
  useApp.getState().mutate((st) => {
    /* ⚠ '오늘'을 **고정한다**. 안 하면 이 파일은 **일요일에만 통과한다** — 시드가 주 3시간짜리
       과목이라 평일엔 배분 블록이 생기고, 그러면 전제("오늘 블록 0")가 깨져 CTA 자체가
       사라진다. 2026-07-19(일)에 작성돼 녹색이었다가 07-20(월)에 빨간불이 됐다.
       벽시계 대신 앱 정본 `_today` 를 쓰는 건 이 저장소의 기존 규약이다. */
    st._today = '2026-07-19'; // 일요일 — 배분 블록이 0인 날
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
    st.weekAlloc = {};
    st.dayPlans = {};
    st.tasks = [];
  });
});
afterEach(() => cleanup());

/** 클릭 후: 캘린더 일(day) 뷰 + 오늘 날짜에 착지했는지. */
async function expectLandedOnToday() {
  // ① 뷰가 day로 전환된다(보내는 쪽이 먼저 — 받는 쪽 effect 되받기 금지 규약).
  await waitFor(() => expect(useUI.getState().ui.schedView).toBe('day'));
  // ② 그 날짜가 '오늘'(앱 단일 출처 todayISO — new Date() 직접 사용 아님)이다.
  await waitFor(() => expect(screen.getByLabelText('이전 날')).toBeInTheDocument());
  const todayLab = fmtShort(parseISO(todayISO(useApp.getState().state)));
  expect(screen.getByText(todayLab)).toBeInTheDocument();
}

test('히어로 CTA "오늘 계획 짜기" → 영속 뷰가 month여도 캘린더 일 뷰 + 오늘로 착지', async () => {
  useUI.getState().setSchedView('month'); // 지난번에 월 뷰를 보다 나간 사용자
  renderApp('/today');

  // 히어로 CTA(캡션 '캘린더 · 오늘')를 상단 바 액션·레일 칩과 구분해 집는다.
  const cap = await screen.findByText('캘린더 · 오늘 →');
  fireEvent.click(cap.closest('button')!);
  await expectLandedOnToday();
});

test('상단 바 액션 "오늘 계획 짜기 →"도 같은 목적지(일 뷰 · 오늘)', async () => {
  useUI.getState().setSchedView('week'); // 기본값(v4 "기본 착지=캘린더 주 뷰")에서 출발해도
  renderApp('/today');

  fireEvent.click(await screen.findByRole('button', { name: '오늘 계획 짜기 →' }));
  await expectLandedOnToday();
});

test('?ds= 딥링크는 그 날짜로 열린다(초기값으로만 흡수)', async () => {
  useUI.getState().setSchedView('day');
  renderApp('/schedule?ds=2026-01-05');

  await waitFor(() => expect(screen.getByLabelText('이전 날')).toBeInTheDocument());
  expect(screen.getByText('1/5')).toBeInTheDocument();
});
