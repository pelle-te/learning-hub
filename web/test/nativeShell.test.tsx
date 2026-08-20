// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { useApp } from '@/store/useApp';

/* Phase 6 — 레거시 JS 런타임 제거 후 네이티브 셸(shell/*)이 동작하는지:
   네이티브 토스트·확인 모달·테마 토글·아이콘 나브. */

beforeEach(() => {
  useApp.getState().mutate((st) => {
    st.theme = 'light';
    st.items = [];
  });
});
afterEach(() => cleanup());

/* ⚠ **묘비명 하나를 지웠다**(2026-08-20 리뷰 m-19): `expect(globalThis.state).toBeUndefined()`.
   레거시 브리지가 사라진 뒤로 그 단언은 **영원히 실패할 수 없다** — 아무도 그 전역을 세우지
   않으므로 코드가 어떻게 바뀌어도 통과한다. 검사처럼 보이는 상수이고, 그런 줄이 하나 있으면
   케이스 수가 안전을 과장한다. 사실 자체는 이 파일 머리주석이 이력으로 기록한다. */

test('네이티브 레일 나브: 주요 탭 + 라인 아이콘(svg.ic)이 렌더된다', async () => {
  const { container } = renderApp('/today');
  // 레일 사이드바는 1차 탭을 평면 리스트로 노출(그룹 계층 폐기). 라벨 정확 일치.
  // 주간 스케줄은 '계획' 호스트로 흡수(hidden) → 나브엔 '계획'. 통계는 그대로 1차 노출.
  await waitFor(() => expect(screen.getByRole('button', { name: '계획' })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: '통계' })).toBeInTheDocument();
  // 아이콘은 dangerouslySetInnerHTML로 주입한 인라인 svg.ic.
  expect(container.querySelectorAll('svg.ic').length).toBeGreaterThan(0);
});

test('테마 토글: <html data-theme> 다크↔라이트 + 토스트', async () => {
  renderApp('/today');
  const btn = await screen.findByRole('button', { name: /테마 전환/ });
  fireEvent.click(btn); // light → dark (세피아 폐기 — 2테마 토글)
  await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
  expect(useApp.getState().state.theme).toBe('dark');
  // 네이티브 토스트가 떴다.
  // ⚠ 둘이다(H15) — 보이는 토스트 + 항상 마운트된 라이브 리전. 근거는 `toast.test.tsx` 주석.
  await waitFor(() => expect(screen.getAllByText(/테마:/).length).toBe(2));
});

test('확인 모달: 전체 초기화 → 취소하면 데이터가 유지된다', async () => {
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
  renderApp('/today');
  fireEvent.click(await screen.findByRole('button', { name: '데이터·백업 메뉴' }));
  fireEvent.click(await screen.findByRole('button', { name: /전체 초기화/ })); // menu role 제거(디스클로저 패턴)
  // 네이티브 모달이 열린다.
  await screen.findByText(/모든 데이터를 지울까요/);
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  await waitFor(() => expect(screen.queryByText(/모든 데이터를 지울까요/)).not.toBeInTheDocument());
  // 취소 → 초기화 안 됨.
  expect(useApp.getState().state.items).toHaveLength(1);
});
