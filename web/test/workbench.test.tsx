// @vitest-environment jsdom
/* ============================================================
   workbench.test.tsx — **N-13 작업대**(W9 · 2026-08-07).

   이 층에서만 잡히는 것 넷(전부 "조용히 두 벌이 되는" 부류):
   ① 닫혀 있으면 **아무것도 안 그린다** — 기본값이 그것이고, 그래서 기존 레이아웃이 안 바뀐다.
   ② 붙든 화면은 **자기 이름을 가진 영역**이다(이름 없는 두 번째 영역은 SR 에서 미아가 된다).
   ③ 페인 안의 화면은 **상단 크롬을 안 건드린다** — 전역 스토어 하나라 그대로 두면 옆 화면이
      주 화면의 리드아웃을 덮고, 닫힐 때 `clear()` 로 **주 화면 것까지** 지운다.
   ④ 토글 — 같은 화면을 두 번 붙들면 놓는다(여는 명령과 닫는 명령이 둘이면 하나는 늘 무동작).
============================================================ */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { usePageChrome, usePageChromeEffect, ChromeMuteProvider } from '@/store/usePageChrome';
import { useOverlay } from '@/store/useOverlay';
import { toggleBench } from '@/shell/actions';
import WorkbenchPane, { benchTabKey } from '@/app/WorkbenchPane';

beforeEach(() => {
  useOverlay.setState({ bench: null });
  usePageChrome.getState().clear();
});
afterEach(cleanup);

describe('N-13 작업대', () => {
  it('① 닫혀 있으면 아무것도 안 그린다', () => {
    const { container } = render(<WorkbenchPane />);
    expect(container.firstChild).toBeNull();
  });

  it('② 붙들면 이름 있는 영역이 생긴다', () => {
    act(() => useOverlay.getState().setBench('/alloc'));
    render(<WorkbenchPane />);
    expect(screen.getByRole('complementary', { name: /작업대 — 주간 배분/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '작업대 닫기' })).toBeTruthy();
  });

  it('⚠ 로스터에 없는 경로는 안 그린다(죽은 페인을 만들지 않는다)', () => {
    act(() => useOverlay.getState().setBench('/없는화면'));
    const { container } = render(<WorkbenchPane />);
    expect(container.firstChild).toBeNull();
  });

  it('③ 페인 안의 화면은 상단 크롬을 안 건드린다', () => {
    const Screen = () => {
      usePageChromeEffect(() => ({ primary: null, readouts: [{ label: '옆', value: 1 }] }), []);
      return null;
    };
    // 먼저 주 화면이 크롬을 세운다.
    render(
      <>
        <Screen />
      </>,
    );
    expect(usePageChrome.getState().readouts).toHaveLength(1);
    // 같은 화면을 페인 안에서 한 번 더 마운트했다가 걷어도 주 화면 것이 남아 있어야 한다.
    const paned = render(
      <ChromeMuteProvider value={true}>
        <Screen />
      </ChromeMuteProvider>,
    );
    paned.unmount();
    expect(usePageChrome.getState().readouts, '옆 페인이 언마운트되며 주 화면 리드아웃을 지웠다').toHaveLength(1);
  });

  it('④ 같은 화면을 두 번 붙들면 놓는다', () => {
    window.history.replaceState({}, '', '/alloc');
    act(() => toggleBench());
    expect(useOverlay.getState().bench).toBe('/alloc');
    act(() => toggleBench());
    expect(useOverlay.getState().bench).toBeNull();
  });

  it('⚠ 쿼리까지 싣는다 — `?view=` 로 갈라지는 화면이 여럿이다', () => {
    window.history.replaceState({}, '', '/degree?view=close');
    act(() => toggleBench());
    expect(useOverlay.getState().bench).toBe('/degree?view=close');
    expect(benchTabKey('/degree?view=close')).toBe('degree');
    expect(benchTabKey('/day/2026-08-01')).toBe('day');
  });
});
