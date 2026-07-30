// @vitest-environment jsdom
/* ============================================================
   phoneConflicts.test.tsx — **폰에서도 진 편집을 보고 되살린다**(H20 · 2026-07-30).

   충돌 그림자는 폰에서도 정상 적재되는데(그 경로는 기기와 무관하다) **읽는 화면이 데스크톱에만**
   있었다. 하필 폰이 더 자주 지는 쪽이다 — 짧게 켜고 끄므로 마지막 저장이 PC 일 확률이 높다.

   ⚠ 여기서 잠그는 것 둘: ① 충돌이 있으면 화면이 **말한다** ② 파괴적 동작이 **한 번의 탭으로
   실행되지 않는다**(폰엔 ModalHost 가 없어 확인이 버튼 자신에게 있다 — 그 2단계가 계약이다).
============================================================ */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/* ⚠ `vi.mock` 은 호이스팅되므로 팩토리가 모듈 스코프 변수를 **참조할 수 없다** —
   `vi.hoisted` 로 그 변수를 함께 끌어올린다(vitest 계약). */
const { restore } = vi.hoisted(() => ({ restore: vi.fn(async () => {}) }));
vi.mock('@/store/syncController', () => ({ restoreConflict: restore }));

import ConflictsView from '@/phone/ConflictsView';
import { useConflicts } from '@/store/useConflicts';

const shadow = {
  tbl: 'summaries',
  key: ['s1', 'x1'],
  localData: ['내가 쓴 요약'],
  localUpdatedAt: 10,
  remoteData: ['다른 기기 요약'],
  remoteUpdatedAt: 20,
  detectedAt: 1_700_000_000_000,
};

beforeEach(() => {
  restore.mockClear();
  useConflicts.setState({ shadows: [] });
});
afterEach(() => {
  cleanup();
  useConflicts.setState({ shadows: [] });
});

test('충돌이 없으면 아무것도 안 그린다 — 평온은 화면을 어지럽히지 않는다', () => {
  const { container } = render(<ConflictsView />);
  expect(container).toBeEmptyDOMElement();
});

test('⚠ 충돌이 있으면 폰이 **말한다** — 종전엔 PC 를 열어야만 알 수 있었다', () => {
  useConflicts.getState().add([shadow]);
  render(<ConflictsView />);
  expect(screen.getByRole('region', { name: '동기화 충돌' })).toBeInTheDocument();
  expect(screen.getByText(/내가 쓴 요약/)).toBeInTheDocument(); // 덮이기 **전** 내 값
  expect(screen.getByText(/다른 기기 요약/)).toBeInTheDocument(); // 무엇으로 덮였나
});

test('⚠ 되살리기는 **한 번의 탭으로 실행되지 않는다** — 지금 값을 덮고 다른 기기에도 전파된다', () => {
  useConflicts.getState().add([shadow]);
  render(<ConflictsView />);

  fireEvent.click(screen.getByRole('button', { name: '되살리기' }));
  expect(restore, '첫 탭에 실행되면 그건 확인 없는 파괴적 동작이다').not.toHaveBeenCalled();
  // 첫 탭은 **약속을 보여 준다**(다른 기기에도 반영된다는 사실).
  expect(screen.getByText(/다른 기기에도 반영/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '정말 되살리기' }));
  expect(restore).toHaveBeenCalledTimes(1);
  expect(restore.mock.calls[0]![0]).toMatchObject({ tbl: 'summaries' });
});

test('취소하면 원래 상태로 돌아온다(약속만 보고 물러설 수 있다)', () => {
  useConflicts.getState().add([shadow]);
  render(<ConflictsView />);
  fireEvent.click(screen.getByRole('button', { name: '되살리기' }));
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(screen.getByRole('button', { name: '되살리기' })).toBeInTheDocument();
  expect(restore).not.toHaveBeenCalled();
});

test('확인은 되살리지 않고 기록만 지운다 — 옛 값이 필요 없을 때의 길', () => {
  useConflicts.getState().add([shadow]);
  render(<ConflictsView />);
  fireEvent.click(screen.getByRole('button', { name: '확인' }));
  expect(useConflicts.getState().shadows).toHaveLength(0);
  expect(restore).not.toHaveBeenCalled();
});
