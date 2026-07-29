// @vitest-environment jsdom
/* ============================================================
   flowRail.test.tsx — FlowRail 키보드 계약(j/k + 동사키 x/f/s)의 오라클.

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

/* ── E5 동사키(2026-07-29) ────────────────────────────────────────────────
   종전 계약은 `Enter`=집중 시작이었고, 그건 **DOM 포커스 위에서는 완료 토글**이라 같은 키가
   커서에 따라 두 뜻을 가졌다. 지금은 커서가 하나(포커스)이고 동사가 각자 키를 갖는다.
   ⚠ `Enter` 는 **여기서 안 다룬다** — 포커스한 노드는 버튼이라 네이티브 활성이 곧 완료다.
     가로채면 두 뜻이 다시 생긴다. 아래 음성 테스트가 그 계약을 잠근다. */
test('x 완료 · f 집중 · s 기록 — 셋 다 같은 커서에 대해 돈다', () => {
  const onToggle = vi.fn();
  const onFocus = vi.fn();
  const onPrefill = vi.fn();
  render(
    <FlowRail
      nodes={nodes()}
      nowMin={0}
      riskN={0}
      onToggle={onToggle}
      onFocus={onFocus}
      onPrefill={onPrefill}
      onReview={noop}
    />,
  );
  fireEvent.keyDown(window, { key: 'j' }); // 수학(학습) 선택
  const 수학 = { it: { sid: 'a', name: '수학' } };
  fireEvent.keyDown(window, { key: 'x' });
  expect(onToggle).toHaveBeenCalledWith(수학); // 이 앱에서 가장 잦은 쓰기 — 종전엔 키가 없었다
  fireEvent.keyDown(window, { key: 'f' });
  expect(onFocus).toHaveBeenCalledWith(수학);
  fireEvent.keyDown(window, { key: 's' });
  expect(onPrefill).toHaveBeenCalledWith(수학);
});

test('Enter 는 가로채지 않는다 — 버튼의 네이티브 활성이 곧 완료다', () => {
  const onFocus = vi.fn();
  const onToggle = vi.fn();
  render(
    <FlowRail
      nodes={nodes()}
      nowMin={0}
      riskN={0}
      onToggle={onToggle}
      onFocus={onFocus}
      onPrefill={noop}
      onReview={noop}
    />,
  );
  fireEvent.keyDown(window, { key: 'j' });
  fireEvent.keyDown(window, { key: 'Enter' });
  // 집중도 아니고 우리 핸들러의 토글도 아니다(클릭은 브라우저가 만든다 — jsdom 에선 안 만든다).
  expect(onFocus).not.toHaveBeenCalled();
  expect(onToggle).not.toHaveBeenCalled();
});

test('일과 블록(e=null)엔 동사가 없다 — 페이로드 없는 노드는 무시', () => {
  const onToggle = vi.fn();
  const onFocus = vi.fn();
  const onPrefill = vi.fn();
  render(
    <FlowRail
      nodes={nodes()}
      nowMin={0}
      riskN={0}
      onToggle={onToggle}
      onFocus={onFocus}
      onPrefill={onPrefill}
      onReview={noop}
    />,
  );
  fireEvent.keyDown(window, { key: 'j' }); // 수학
  fireEvent.keyDown(window, { key: 'j' }); // 점심(블록)
  fireEvent.keyDown(window, { key: 'x' });
  fireEvent.keyDown(window, { key: 'f' });
  fireEvent.keyDown(window, { key: 's' });
  expect(onToggle).not.toHaveBeenCalled();
  expect(onFocus).not.toHaveBeenCalled();
  expect(onPrefill).not.toHaveBeenCalled();
});

/* roving tabindex — 레일 전체가 탭 스톱 **하나**여야 한다. 아니면 Tab 이 노드 수만큼 걸려
   "완료하려면 Tab 6번"이라는 E5 이전 상태로 되돌아간다. */
test('레일은 탭 스톱이 하나다(roving tabindex)', () => {
  const { container } = render(
    <FlowRail nodes={nodes()} nowMin={0} riskN={0} onToggle={noop} onFocus={noop} onPrefill={noop} onReview={noop} />,
  );
  const stops = container.querySelectorAll('button[tabindex="0"]');
  expect(stops).toHaveLength(1);
  // 커서가 없어도 문이 있다 — 첫 노드가 그 자리를 맡는다.
  expect(stops[0]!.getAttribute('aria-label')).toContain('수학');
  fireEvent.keyDown(window, { key: 'j' });
  fireEvent.keyDown(window, { key: 'j' });
  fireEvent.keyDown(window, { key: 'j' }); // 영어
  expect(container.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
  expect(container.querySelector('button[tabindex="0"]')?.getAttribute('aria-label')).toContain('영어');
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
  fireEvent.keyDown(input, { key: 'f' });
  expect(onFocus).not.toHaveBeenCalled();
  input.remove();
});

/* ── E9 "오늘 밖"을 오늘 것처럼 그리지 않는다(2026-07-29) ─────────────────
   종결 캡이 항상 "이후 일정 없음"이었는데, 남은 창을 넘는 블록이 있으면 그건 거짓말이다.
   접힌 줄 자체가 "이건 못 한 게 아니라 애초에 오늘 것이 아니었다"는 판단이다. */
test('종결 캡: 오늘 밖 블록이 있으면 그 사실을 말한다', () => {
  const { container } = render(
    <FlowRail
      nodes={nodes()}
      nowMin={0}
      riskN={0}
      onToggle={noop}
      onFocus={noop}
      onPrefill={noop}
      onReview={noop}
      beyond={{ count: 3, min: 150 }}
    />,
  );
  expect(container.textContent).toContain('오늘 밖 3개');
  expect(container.textContent).not.toContain('이후 일정 없음');
});

test('종결 캡: 전부 창 안이면 종전대로 "이후 일정 없음"', () => {
  const { container } = render(
    <FlowRail nodes={nodes()} nowMin={0} riskN={0} onToggle={noop} onFocus={noop} onPrefill={noop} onReview={noop} />,
  );
  expect(container.textContent).toContain('이후 일정 없음');
});
