// @vitest-environment jsdom
/* ============================================================
   state.test.tsx — **성공하지 않은 상태**의 계약(E17 · 2026-07-29 → 2026-07-30 확장).

   실측: 소비처 16곳 중 절반이 "없어요 + 설명"에서 끝나 사용자를 막다른 곳에 세웠다.
   `next` 를 **필수**로 만든 것이 처방이고, 그 강제는 **타입 검사**가 한다(선택 prop 이면
   바쁜 날 그냥 빠지고, 빠졌다는 사실은 아무 신호도 안 낸다). 여기서 잠그는 것은 그 다음이다:
   두 형태가 실제로 **다르게** 렌더되는가 — 안 그러면 "왜 없는지"가 CTA 처럼 보인다.

   ⚠ 2026-07-30: `EmptyState` 가 `State` 로 넓어졌다(로딩·에러·빈 한 표면). 그리고 옛 필수화에
   **구멍이 있었다** — `next: ReactNode` 는 `undefined` 를 포함하므로 `next={undefined}` 가 타입
   통과였고, `ArtifactGate` 가 실제로 그 값을 넘기고 있었다. 타입은 `tsc` 가 잠그므로 여기서는
   **런타임 계약**만 본다: 세 kind 가 서로 다르게 렌더되는가(로딩엔 행동이 없어야 하고, 에러는
   기본 글리프를 스스로 갖고, terminal 은 버튼처럼 보이지 않아야 한다).
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import State from '@/components/State';

afterEach(cleanup);

test('행동이 있으면 그대로 그린다', () => {
  render(<State title="비었어요" next={<button type="button">첫 항목 추가</button>} />);
  expect(screen.getByRole('button', { name: '첫 항목 추가' })).toBeInTheDocument();
});

test('종착 상태는 **이유**를 말하고 버튼을 만들지 않는다', () => {
  render(<State title="다 처리했어요" next={{ terminal: '수집이 더 돌면 새 후보가 차오릅니다.' }} />);
  expect(screen.getByText('수집이 더 돌면 새 후보가 차오릅니다.')).toBeInTheDocument();
  // 억지 CTA 금지 — 성공한 사람에게 할 일을 만들어 주지 않는다.
  expect(screen.queryByRole('button')).toBeNull();
});

test('둘 중 하나는 반드시 화면에 남는다 — 막다른 빈 화면이 구조적으로 불가능하다', () => {
  const { container } = render(<State title="비었어요" next={{ terminal: '아직 기다릴 때예요.' }} />);
  expect(container.textContent).toContain('아직 기다릴 때예요.');
});

/* ── 로딩·에러 kind (E17 · 2026-07-30) ─────────────────────────────────────
   로딩이 어휘에 들어온 것이 이번 변경의 핵심이다 — 종전엔 소속이 없어 세 문법으로 흩어져 있었다. */

test('로딩은 행동을 그리지 않는다 — 정답이 기다리기다', () => {
  const { container } = render(<State kind="loading" title="원장을 불러오는 중" />);
  expect(screen.getByText('원장을 불러오는 중')).toBeInTheDocument();
  // 억지 CTA 금지 — 버튼도, 종착 문구도 없어야 한다(타입이 `next` 를 아예 막는다).
  expect(container.querySelector('button')).toBeNull();
});

test('로딩은 스크린리더에 스스로 알린다(role=status)', () => {
  render(<State kind="loading" title="지식상태를 불러오는 중" />);
  // ⚠ 이 단언이 없으면 "로딩 중"이 **시각 사용자에게만** 존재한다 — 옛 인라인 스피너 두 곳이
  //   정확히 그 상태였다(형상 스켈레톤 쪽은 sr-only 를 갖고 있었는데 패널 쪽은 없었다).
  expect(screen.getByRole('status')).toHaveTextContent('지식상태를 불러오는 중');
});

test('에러는 글리프를 스스로 갖는다 — 호출부가 이모지를 고르지 않는다', () => {
  render(<State kind="error" title="불러오지 못했어요" next={<button type="button">다시 시도</button>} />);
  expect(screen.getByText('⚠️')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
});
