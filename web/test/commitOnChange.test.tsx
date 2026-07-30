// @vitest-environment jsdom
/* ============================================================
   commitOnChange.test.tsx — `useCommitOnChange` 의 계약(E15 · 2026-07-30).

   왜 유닛으로 잠그나: 이 훅의 결함은 **전부 조용하다.**
   · 마운트에 번쩍이면 → 탭을 열 때마다 모든 숫자가 번쩍여 `commit` 이 아무 뜻도 없어진다.
   · 값이 안 바뀌었는데 번쩍이면 → 리렌더마다 번쩍여 `live`(무한)가 된다.
   · 값이 바뀌었는데 안 번쩍이면 → 사용자가 자기 행동의 반영을 못 본다(이 훅의 존재 이유가 무효).
   셋 다 화면이 "그럴듯하게" 보이므로 스냅샷·타입·린트 어느 쪽도 못 잡는다.

   ⚠ WAAPI(`el.animate`)를 스파이로 대체해 **호출 횟수**를 센다 — jsdom 에는 `animate` 가 없어서
     `commit()` 이 그냥 반환하기 때문이다(그 가드 자체는 `lib/motion.ts` 의 의도된 동작).
============================================================ */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useCommitOnChange } from '@/hooks/useCommitOnChange';

let calls = 0;

beforeEach(() => {
  calls = 0;
  // jsdom 에 없는 WAAPI 를 심는다(호출만 센다 · 반환값은 `commit()` 이 쓰지 않는다).
  (HTMLElement.prototype as unknown as { animate: () => void }).animate = () => {
    calls += 1;
  };
  // 모션 자제 판정은 `matchMedia` 를 보므로 '자제 아님'으로 고정한다(없으면 `commit` 이 통과만 한다).
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe({ value }: { value: number }) {
  const ref = useCommitOnChange(value);
  return <span ref={ref}>{value}</span>;
}

test('마운트에는 번쩍이지 않는다 — 그건 enter 어휘의 일이다', () => {
  render(<Probe value={3} />);
  expect(calls).toBe(0);
});

test('값이 바뀌면 1회 번쩍인다', () => {
  const { rerender } = render(<Probe value={3} />);
  rerender(<Probe value={4} />);
  expect(calls).toBe(1);
});

test('같은 값으로 리렌더되면 번쩍이지 않는다 — 무한 애니는 live 어휘만 허용된다', () => {
  const { rerender } = render(<Probe value={3} />);
  rerender(<Probe value={3} />);
  rerender(<Probe value={3} />);
  expect(calls).toBe(0);
});

test('연속 변화는 변화 횟수만큼 번쩍인다(누락 없음)', () => {
  const { rerender } = render(<Probe value={0} />);
  rerender(<Probe value={1} />);
  rerender(<Probe value={2} />);
  rerender(<Probe value={2} />); // 무변화는 세지 않는다
  rerender(<Probe value={3} />);
  expect(calls).toBe(3);
});
