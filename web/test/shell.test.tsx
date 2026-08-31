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
  await renderApp('/today');

  // today는 Phase 3에서 React화 → 레거시 #page 대신 React 컨텐츠(대시보드 히어로).
  await waitFor(() => expect(screen.getByLabelText('오늘 대시보드')).toBeInTheDocument());

  /* React 레일 사이드바가 1차 탭을 노출한다.
     ⚠ **여기서 재는 것은 «DOM 에 있다»이지 «보인다»가 아니다**(축 접기 · 2026-08-28). 데스크톱
     에선 `계획` 이 접힌 축 안이라 CSS 로 숨는데, jsdom 은 Tailwind 를 로드하지 않으므로 이
     케이스는 그 차이를 못 본다 — 가시성·아코디언 계약은 `railAxis.test.tsx` 가 잰다. */
  /* ⚠ 접근 가능한 이름에 **상태 신호가 붙는다**(N-13 나브 배지 — 과목이 있으면 "남은 N").
     정확 일치로 잡으면 신호가 뜨는 순간 이 스모크가 깨진다. 여기서 볼 것은 항목의 존재다. */
  expect(screen.getByRole('button', { name: /오늘 학습/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^계획/ })).toBeInTheDocument();

  // 헤더 ⌘K 버튼이 있다(팔레트 진입점).
  expect(screen.getByRole('button', { name: /명령 팔레트 열기/ })).toBeInTheDocument();
});

test('탭 전환: 정본 원장 탭은 #page를 쓰지 않는다', async () => {
  /* ⚠ 종전 이 단언은 `/mastery`(숙달도 지도)로 돌았다. 그 화면이 2026-08-29 에 은퇴해
     (부모 목적 정정 · 지식상태 생산자 삭제) 같은 호스트인 `/ledger` 로 옮겼다 — 재는 것은
     **React 탭이 레거시 `#page` 경로를 안 쓴다**이지 어느 탭이냐가 아니므로 증명력은 같다. */
  await renderApp('/ledger');
  /* ⚠ `level: 2` 로 좁힌다 — 2026-08-31 부터 셸이 **라우트 이름을 `<h1 class="sr-only">`** 로도
     그린다(U065: 표제 축으로 «지금 어디인가»를 되찾게). 레벨을 안 주면 같은 이름이 둘이라
     쿼리가 모호해지고, 이 케이스가 묻는 것은 **탭 본문의 표제**이므로 레벨이 곧 그 뜻이다. */
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /정본 원장/ })).toBeInTheDocument());
  expect(document.getElementById('page')).toBeNull();
});
