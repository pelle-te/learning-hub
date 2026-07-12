// @vitest-environment jsdom
/* ============================================================
   atlasTab.test.tsx — 진로 지도 컴포넌트 회귀(라우트 기반).
   그리드 렌더 → 카드 클릭 시 딥링크 상세 → 상세 콘텐츠 → 관심 토글 영속 → 대분류 필터.
============================================================ */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Atlas from '@/features/atlas/Atlas';

function renderAt(path: string) {
  // Atlas는 usePing/useAtlasNews(react-query)를 쓴다 — 서버 없으니 isError → 시드 폴백 렌더.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Atlas />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

test('atlas: /atlas 그리드가 대분류·카드를 렌더', () => {
  renderAt('/atlas');
  expect(screen.getByRole('heading', { level: 2, name: '이동통신 네트워크' })).toBeInTheDocument();
  // 카드는 상세로 가는 링크.
  expect(screen.getByRole('link', { name: /기지국 · RAN/ })).toHaveAttribute('href', '/atlas/ran');
});

test('atlas: 카드 클릭 → 딥링크 상세로 전환', () => {
  renderAt('/atlas');
  fireEvent.click(screen.getByRole('link', { name: /안테나 설계/ }));
  // 상세 표제(h1) + 신규 섹션이 뜬다.
  expect(screen.getByRole('heading', { level: 1, name: '안테나 설계' })).toBeInTheDocument();
  expect(screen.getByText('진입 경로')).toBeInTheDocument();
  expect(screen.getByText('대표 기업 · 기관 · 연구실')).toBeInTheDocument();
});

test('atlas: /atlas/<key> 직접 진입 시 상세 렌더 + 목록 링크', () => {
  renderAt('/atlas/ran');
  expect(screen.getByRole('heading', { level: 1, name: '기지국 · RAN' })).toBeInTheDocument();
  expect(screen.getByText('필요 역량')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /분야 목록/ })).toHaveAttribute('href', '/atlas');
});

test('atlas: 관심 토글이 localStorage에 영속', () => {
  renderAt('/atlas');
  const star = screen.getByRole('button', { name: '안테나 설계 관심 표시' });
  fireEvent.click(star);
  expect(JSON.parse(localStorage.getItem('atlas.stars')!)).toContain('antenna');
  // 별표 뒤 라벨이 해제로 뒤집힘(관심 핀 + 원 그룹 두 곳에 나타나므로 getAll).
  expect(screen.getAllByRole('button', { name: '안테나 설계 관심 해제' }).length).toBeGreaterThanOrEqual(1);
});

test('atlas: 관심 표시하면 상단 관심 분야 핀에 나타난다', () => {
  renderAt('/atlas');
  fireEvent.click(screen.getByRole('button', { name: '안테나 설계 관심 표시' }));
  // 관심 분야 섹션이 생기고, 안테나 카드가 핀 + 원 대분류 두 곳에 존재.
  expect(screen.getByRole('heading', { level: 2, name: '관심 분야' })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /안테나 설계/ }).length).toBeGreaterThanOrEqual(2);
});

test('atlas: 대분류 필터가 그 그룹만 남긴다', () => {
  renderAt('/atlas');
  fireEvent.click(screen.getByRole('button', { name: /위성 · 우주 통신/ }));
  expect(screen.queryByRole('heading', { level: 2, name: '이동통신 네트워크' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: '위성 · 우주 통신' })).toBeInTheDocument();
});
