// @vitest-environment jsdom
/* ============================================================
   monthCalendar.test.tsx — 월 칸의 "숨긴 건 반드시 센다" 불변식.

   회귀 원본: 마감 칩이 MAX_CHIPS 캡 **밖에서** 따로 렌더됐다. 캡도 "+N개 더" 계산도 chips만
   봤기 때문에, 마감 3개인 날은 4줄을 48px 칸에 그려 2줄이 표시도 없이 잘렸다 —
   사용자는 숨은 항목이 있다는 사실조차 알 수 없었다(잘린 정보는 정보가 아니라 소실이다).
   측정값: contentH 72px vs boxH 48px = 24px 넘침 → 고친 뒤 -2px(여유).
============================================================ */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import { renderApp } from './_render';
import { iso, todayISO } from '@/lib/utils';

/* ⚠ 셸 렌더는 **공용 헬퍼**를 쓴다(P051 · 2026-08-28). 여기 사본이 있으면 그 헬퍼가
   렌더 전에 하는 일(탭 청크 덥히기 = Suspense 대기 제거)을 이 파일만 못 받는다 —
   이 저장소가 `_render.tsx` 를 만든 이유가 «12줄이 17개 파일에 복사돼 있었다» 였다. */
const renderMonth = () => renderApp('/schedule');

const mkItem = (id: string, name: string, deadline: string) => ({
  id,
  source: '직접' as const,
  name,
  color: '#4f8ff0',
  mode: 'weekly' as const,
  weeklyHours: 3,
  dailyMin: 30,
  deadline,
  chapters: [],
});

beforeEach(() => {
  useUI.getState().setSchedView('month');
});
afterEach(() => cleanup());

test('월 칸: 마감이 여러 개여도 캡을 넘긴 만큼 "+N개 더"로 셈한다(조용히 잘리지 않음)', async () => {
  const today = todayISO(useApp.getState().state);
  const ds = iso(new Date(new Date(today).getFullYear(), new Date(today).getMonth(), 20));
  useApp.getState().mutate((st) => {
    st.items = [mkItem('a', '미적분', ds), mkItem('b', '일반물리', ds), mkItem('c', '전자기학', ds)];
    st.events = [];
    st.tasks = [];
  });

  await renderMonth();
  // 그 날 칸 = 마감 3개. MAX_CHIPS(2)를 넘으므로 나머지 1개는 "+1개 더"로 드러나야 한다.
  const cell = await screen.findByRole('button', { name: new RegExp('마감 미적분, 일반물리, 전자기학') });
  expect(within(cell).getByText(/\+1개 더/)).toBeInTheDocument();

  // 그리는 칩 수는 캡을 넘지 않는다 — 넘게 그리면 칸이 잘라내고 그 사실이 어디에도 안 남는다.
  const chipTexts = within(cell)
    .queryAllByTitle(/^마감: /)
    .map((el) => el.textContent);
  expect(chipTexts.length).toBeLessThanOrEqual(2);

  // 접근성 라벨은 잘린 것과 무관하게 **전부** 읽어준다(시각 캡이 정보 접근을 줄이면 안 된다).
  expect(cell).toHaveAccessibleName(/전자기학/);
});
