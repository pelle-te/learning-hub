// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { useApp } from '@/store/useApp';

/* Phase 2 통합 스모크 — React 셸 + 레거시 어댑터가 실제로 맞물리는지(컴파일만이 아니라 런타임).
   '/today'로 들어가 (1) 레거시 render가 #page를 채우고 (2) React Nav가 그룹/탭을 그리며
   (3) 탭 전환이 라우터로 동작함을 jsdom에서 확인. */

afterEach(() => cleanup());

/* 대시보드를 보려면 셋업이 끝나 있어야 한다 — `defaults()`(items: []) 는 콜드 스타트 온보딩
   상태다(H14 이후 그 상태에선 대시보드를 **렌더하지 않는다**). 근거는 `today.test.tsx` 주석. */
function seedSubject(): void {
  useApp.getState().mutate((st) => {
    if (!st.items.some((i) => i.name)) {
      st.items.push({ id: 'seed', name: '테스트 과목', mode: 'weekly', weeklyHours: 5, chapters: [] } as never);
    }
  });
}

test('React 셸이 마운트되고 today(React화) 탭 + 나브 + 팔레트 버튼이 뜬다', async () => {
  seedSubject();
  renderApp('/today');

  // today는 Phase 3에서 React화 → 레거시 #page 대신 React 컨텐츠(대시보드 히어로).
  await waitFor(() => expect(screen.getByLabelText('오늘 대시보드')).toBeInTheDocument());

  // React 레일 사이드바: 1차 탭(오늘 학습/계획/내 길…)을 평면 리스트로 노출.
  // 주간 스케줄·학습 항목·가용시간은 '계획' 호스트로 흡수(hidden) → 나브엔 '계획' 한 줄.
  /* ⚠ 접근 가능한 이름에 **상태 신호가 붙는다**(N-13 나브 배지 — 과목이 있으면 "남은 N").
     정확 일치로 잡으면 신호가 뜨는 순간 이 스모크가 깨진다. 여기서 볼 것은 항목의 존재다. */
  expect(screen.getByRole('button', { name: /오늘 학습/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^계획/ })).toBeInTheDocument();

  // 헤더 ⌘K 버튼이 있다(팔레트 진입점).
  expect(screen.getByRole('button', { name: /명령 팔레트 열기/ })).toBeInTheDocument();
});

test('탭 전환: 숙달도 지도(Phase 5 React화) 탭은 #page를 쓰지 않는다', async () => {
  // Phase 5까지 전 탭 React화 — integrations·control·mastery도 React(TanStack Query).
  // 레거시 render(#page) 경로를 쓰는 등록 탭은 더 이상 없음(어댑터 mountTab은 폴백으로만 잔존).
  renderApp('/mastery');
  await waitFor(() => expect(screen.getByRole('heading', { name: /숙달도 지도/ })).toBeInTheDocument());
  expect(document.getElementById('page')).toBeNull();
});
