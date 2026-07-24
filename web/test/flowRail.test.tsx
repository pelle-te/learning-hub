// @vitest-environment jsdom
/* ============================================================
   flowRail.test.tsx — FlowRail 키보드 네비(j/k/Enter/s)의 오라클.

   ⚠ 이 경로는 **시각 스냅샷(트랙 A)이 원리적으로 못 본다** — 키보드 상호작용은 정적 렌더가 아니다.
   TodaySignature 에서 FlowRail 로 상호작용 상태기계를 이전(재설계)하면서, 그 동작을 여기서 잠근다.
============================================================ */
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FlowRail, type FlowNode } from '@/features/today/FlowRail';

beforeAll(() => {
  // jsdom 미구현 API — reveal() 이 부른다.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  if (!window.matchMedia) window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
});
afterEach(cleanup);

interface E {
  it: { sid: string; name: string };
}
const nodes = (): FlowNode<E>[] => [
  {
    key: 'study|a',
    kind: 'study',
    start: 540,
    end: 600,
    name: '수학',
    sub: '1장',
    done: false,
    e: { it: { sid: 'a', name: '수학' } },
  },
  { key: 'block|1', kind: 'block', start: 660, end: 720, name: '점심', sub: '일과', done: false, e: null },
  {
    key: 'study|b',
    kind: 'study',
    start: 780,
    end: 840,
    name: '영어',
    sub: '2장',
    done: false,
    e: { it: { sid: 'b', name: '영어' } },
  },
];
const noop = (): void => {};

test('j/k 로 선택이 이동하고 aria-current 로 표시된다', () => {
  const { container } = render(
    <FlowRail nodes={nodes()} nowMin={0} riskN={0} onToggle={noop} onFocus={noop} onPrefill={noop} onReview={noop} />,
  );
  const cur = (): Element | null => container.querySelector('[aria-current="true"]');
  expect(cur()).toBeNull(); // 초기엔 선택 없음

  fireEvent.keyDown(window, { key: 'j' }); // 첫 노드(수학)
  expect(cur()?.getAttribute('aria-label')).toContain('수학');
  fireEvent.keyDown(window, { key: 'j' }); // 점심(블록)
  fireEvent.keyDown(window, { key: 'j' }); // 영어
  expect(cur()?.getAttribute('aria-label')).toContain('영어');
  fireEvent.keyDown(window, { key: 'j' }); // 끝에서 더 못 감(클램프)
  expect(cur()?.getAttribute('aria-label')).toContain('영어');
  fireEvent.keyDown(window, { key: 'k' }); // 뒤로 → 점심(블록엔 aria-label 없음)
  fireEvent.keyDown(window, { key: 'k' }); // 수학
  expect(cur()?.getAttribute('aria-label')).toContain('수학');
});

test('Enter 는 학습 노드에 onFocus, s 는 onPrefill — 일과 블록(e=null)은 무시', () => {
  const onFocus = vi.fn();
  const onPrefill = vi.fn();
  render(
    <FlowRail
      nodes={nodes()}
      nowMin={0}
      riskN={0}
      onToggle={noop}
      onFocus={onFocus}
      onPrefill={onPrefill}
      onReview={noop}
    />,
  );
  fireEvent.keyDown(window, { key: 'j' }); // 수학(학습) 선택
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(onFocus).toHaveBeenCalledWith({ it: { sid: 'a', name: '수학' } });
  fireEvent.keyDown(window, { key: 's' });
  expect(onPrefill).toHaveBeenCalledWith({ it: { sid: 'a', name: '수학' } });

  fireEvent.keyDown(window, { key: 'j' }); // 점심(블록, e=null)
  onFocus.mockClear();
  onPrefill.mockClear();
  fireEvent.keyDown(window, { key: 'Enter' }); // 무시돼야
  fireEvent.keyDown(window, { key: 's' });
  expect(onFocus).not.toHaveBeenCalled();
  expect(onPrefill).not.toHaveBeenCalled();
});

test('입력 요소에 포커스가 있으면 단축키를 무시한다(타이핑 보호)', () => {
  const onFocus = vi.fn();
  render(
    <FlowRail
      nodes={nodes()}
      nowMin={0}
      riskN={0}
      onToggle={noop}
      onFocus={onFocus}
      onPrefill={noop}
      onReview={noop}
    />,
  );
  const input = document.createElement('input');
  document.body.appendChild(input);
  fireEvent.keyDown(input, { key: 'j' }); // INPUT 대상 → 무시
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onFocus).not.toHaveBeenCalled();
  input.remove();
});
