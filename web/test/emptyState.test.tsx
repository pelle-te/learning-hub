// @vitest-environment jsdom
/* ============================================================
   emptyState.test.tsx — 빈 상태의 `next` 계약(E17 · 2026-07-29).

   실측: 소비처 16곳 중 절반이 "없어요 + 설명"에서 끝나 사용자를 막다른 곳에 세웠다.
   `next` 를 **필수**로 만든 것이 처방이고, 그 강제는 **타입 검사**가 한다(선택 prop 이면
   바쁜 날 그냥 빠지고, 빠졌다는 사실은 아무 신호도 안 낸다). 여기서 잠그는 것은 그 다음이다:
   두 형태가 실제로 **다르게** 렌더되는가 — 안 그러면 "왜 없는지"가 CTA 처럼 보인다.
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EmptyState from '@/components/EmptyState';

afterEach(cleanup);

test('행동이 있으면 그대로 그린다', () => {
  render(<EmptyState title="비었어요" next={<button type="button">첫 항목 추가</button>} />);
  expect(screen.getByRole('button', { name: '첫 항목 추가' })).toBeInTheDocument();
});

test('종착 상태는 **이유**를 말하고 버튼을 만들지 않는다', () => {
  render(<EmptyState title="다 처리했어요" next={{ terminal: '수집이 더 돌면 새 후보가 차오릅니다.' }} />);
  expect(screen.getByText('수집이 더 돌면 새 후보가 차오릅니다.')).toBeInTheDocument();
  // 억지 CTA 금지 — 성공한 사람에게 할 일을 만들어 주지 않는다.
  expect(screen.queryByRole('button')).toBeNull();
});

test('둘 중 하나는 반드시 화면에 남는다 — 막다른 빈 화면이 구조적으로 불가능하다', () => {
  const { container } = render(<EmptyState title="비었어요" next={{ terminal: '아직 기다릴 때예요.' }} />);
  expect(container.textContent).toContain('아직 기다릴 때예요.');
});
