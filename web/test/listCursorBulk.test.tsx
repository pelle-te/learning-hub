// @vitest-environment jsdom
/* ============================================================
   listCursorBulk.test.tsx — **A-12 여덟째 키 `m`(표시)와 일괄 동사**(W9 · 2026-08-07).

   로드맵의 관측: _"챕터 7개 완료 = 25 키스트로크 · 토스트 7장 · ⌘Z 7회. 다중 선택 코드 **0건**"_.
   여기서 잠그는 것은 그 결함의 **반대 명제** 넷이다:

   ① 표시가 있으면 동사가 **표시 전체**에 걸리고, 그것도 **한 번의 호출**이다(N번이 아니라).
      — 이게 "토스트 N장 · ⌘Z N번"을 없애는 유일한 조건이다.
   ② 표시가 없으면 종전 그대로 **커서 하나**에 걸린다(기존 계약 무손상).
   ③ 실행하면 표시가 **비워진다**(다음 동사가 방금 처리한 것에 또 걸리지 않게).
   ④ 일괄 판을 **안 준 동사**는 표시가 있어도 커서 하나에만 걸린다(있는 척하지 않는다).
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useListCursor } from '@/hooks/useListCursor';

beforeEach(() => {
  document.body.innerHTML = '';
  Element.prototype.scrollIntoView = vi.fn(); // jsdom 에 없다(`reveal()` 이 부른다)
});
afterEach(() => {
  /* ⚠ **언마운트를 해야 한다** — 이 훅은 살아 있는 목록 수(`MOUNTED`)로 소유권 규칙 ③을 판정한다.
     DOM 만 비우면 앞 케이스의 목록이 계속 등록돼 있어 "목록이 나 하나뿐"이 거짓이 되고, 그러면
     포커스 없이 시작하는 `j` 가 조용히 안 먹는다(케이스 ②③④가 그 자리에서 빨개졌다). */
  cleanup();
  vi.restoreAllMocks();
});

function mount(keys: string[], one: (k: string) => void, many?: (ks: string[]) => void) {
  const Harness = () => {
    const c = useListCursor<string>({
      items: keys.map((k) => ({ key: k, item: k })),
      verbs: { x: (k) => one(k) },
      ...(many ? { bulk: { x: (ks: string[]) => many(ks) } } : {}),
    });
    return (
      <div>
        {keys.map((k) => (
          <div
            key={k}
            data-k={k}
            data-marked={c.marked.has(k) ? '1' : '0'}
            ref={c.register(k)}
            tabIndex={c.tabStop === k ? 0 : -1}
            onFocus={() => c.onItemFocus(k)}
          />
        ))}
      </div>
    );
  };
  return render(<Harness />);
}

const press = (key: string): void => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

describe('A-12 — 표시(`m`)와 일괄 동사', () => {
  it('① 표시 둘에 동사 하나 = **한 번의 호출**(N번이 아니다)', () => {
    const one = vi.fn();
    const many = vi.fn();
    mount(['a', 'b', 'c'], one, many);
    press('j'); // a
    press('m');
    press('j'); // b
    press('m');
    press('x');
    expect(many).toHaveBeenCalledTimes(1);
    expect(many).toHaveBeenCalledWith(['a', 'b']);
    expect(one, '일괄이 개별 동사를 반복 호출하면 토스트·⌘Z 가 그대로 N개다').not.toHaveBeenCalled();
  });

  it('② 표시가 없으면 커서 하나에만 걸린다(종전 계약)', () => {
    const one = vi.fn();
    const many = vi.fn();
    mount(['a', 'b'], one, many);
    press('j');
    press('x');
    expect(one).toHaveBeenCalledWith('a');
    expect(many).not.toHaveBeenCalled();
  });

  it('③ 실행하면 표시가 비워진다', () => {
    const many = vi.fn();
    const { container } = mount(['a', 'b'], vi.fn(), many);
    press('j');
    press('m');
    expect(container.querySelector('[data-k="a"]')?.getAttribute('data-marked')).toBe('1');
    press('x');
    expect(container.querySelector('[data-k="a"]')?.getAttribute('data-marked')).toBe('0');
    press('x'); // 두 번째 x — 표시가 비었으니 이번엔 단일 경로다
    expect(many).toHaveBeenCalledTimes(1);
  });

  it('④ 일괄 판을 안 준 화면은 `m` 이 아무 일도 안 한다(있는 척하지 않는다)', () => {
    const one = vi.fn();
    const { container } = mount(['a', 'b'], one); // bulk 없음
    press('j');
    press('m');
    expect(container.querySelector('[data-k="a"]')?.getAttribute('data-marked')).toBe('0');
    press('x');
    expect(one).toHaveBeenCalledWith('a');
  });
});
