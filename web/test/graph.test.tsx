// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import Graph from '@/features/graph/Graph';
import { useApp } from '@/store/useApp';

/* Graph(학습 구조도) 렌더 회귀 — 캔버스 시뮬레이션은 2D 컨텍스트 스텁 + reduced-motion(동기 레이아웃)
   경로로 결정적으로 돌린다(RAF 없이 step/draw까지 실행). 스크린리더 대체 목록·빈 상태를 검증. */

const ITEMS = [
  {
    id: 'i1',
    name: '알고리즘',
    mode: 'weekly',
    weeklyHours: 6,
    chapters: [
      { id: 'c1', name: '정렬', hours: 3, done: true },
      { id: 'c2', name: '그래프', hours: 3, done: false },
    ],
  },
  {
    id: 'i2',
    name: '미적분',
    mode: 'weekly',
    weeklyHours: 4,
    chapters: [{ id: 'c3', name: '극한', hours: 2, done: false }],
  },
];

beforeEach(() => {
  // reduced-motion=true → 컴포넌트가 동기 레이아웃 후 1회 그림(RAF 미사용·결정적).
  vi.stubGlobal(
    'matchMedia',
    (q: string) =>
      ({
        matches: true,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
  // jsdom엔 ResizeObserver가 없다 — 무동작 스텁.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // 캔버스 2D 컨텍스트 스텁(그리기 호출을 삼킴 — 좌표/색 계산 로직은 그대로 실행됨).
  const ctx = {
    setTransform() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
    fillText() {},
    strokeStyle: '',
    lineWidth: 0,
    fillStyle: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderGraph() {
  return render(
    <MemoryRouter>
      <Graph />
    </MemoryRouter>,
  );
}

test('항목이 있으면 canvas(role=img)와 스크린리더 대체 목록을 그린다', () => {
  useApp.getState().mutate((s) => {
    s.items = ITEMS as unknown as typeof s.items;
  });
  renderGraph();
  // 캔버스는 role=img + 요약 aria-label(항목 2 · 챕터 1/3 완료).
  const canvas = screen.getByRole('img', { name: /학습 구조도/ });
  expect(canvas).toBeInTheDocument();
  expect(canvas).toHaveAttribute('aria-label', expect.stringContaining('항목 2개'));
  // 스크린리더 대체 목록 — 항목별 done/total.
  expect(screen.getByText(/알고리즘 — 챕터 1\/2 완료/)).toBeInTheDocument();
  expect(screen.getByText(/미적분 — 챕터 0\/1 완료/)).toBeInTheDocument();
});

test('항목이 없으면 1급 빈 상태(EmptyState)를 보여준다', () => {
  useApp.getState().mutate((s) => {
    s.items = [];
  });
  renderGraph();
  expect(screen.getByText(/아직 학습 구조도가 비어 있어요/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /학습 항목 추가/ })).toBeInTheDocument();
});
