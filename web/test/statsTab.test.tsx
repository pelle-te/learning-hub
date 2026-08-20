// @vitest-environment jsdom
/* ============================================================
   statsTab.test.tsx — Stats 탭 컴포넌트 회귀. 평가(2026-07-09)가 지적한
   "빈 상태·드로어 차트가 한 번도 마운트되지 않음" 갭을 메운다.
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { useApp } from '@/store/useApp';

afterEach(() => cleanup());

test('stats: 항목이 없으면 EmptyState로 폴백(#page 미사용)', async () => {
  useApp.getState().mutate((st) => {
    st.items = [];
  });
  renderApp('/stats');
  // Stats는 lazy 로드 → Suspense 해제까지 findBy로 대기.
  expect(await screen.findByText('아직 통계가 없어요')).toBeInTheDocument();
});

test('stats: 상세 리포트 드로어를 열면 차트 위젯들이 마운트된다', async () => {
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
  renderApp('/stats');
  fireEvent.click(await screen.findByText(/상세 리포트/)); // lazy 로드 대기 후 페이지 크롬 액션 → 드로어 open
  expect(await screen.findByText(/인출 증거/)).toBeInTheDocument(); // RetrievalCard
  expect(screen.getByText('주별 학습시간')).toBeInTheDocument(); // WeeklyBars 섹션
});
