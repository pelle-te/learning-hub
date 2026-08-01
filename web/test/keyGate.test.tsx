// @vitest-environment jsdom
/* ============================================================
   keyGate.test.tsx — **단일키 단축키를 언제 삼키나**(H10~H12 · 2026-08-01).

   두 층을 겨눈다. 둘 다 "게이트가 없으면 조용히 잘못된 것이 실행된다"는 같은 형태다.

   ① `shell/keyGate.singleKeyBlocked` — 앱 전역 리스너의 게이트. 종전엔 `isTyping() ||
      palette` 둘뿐이라 **치트시트를 열고 거기 적힌 `g`+키를 누르면 뒤에서 탭이 바뀌었다**
      (도움말이 자기 내용을 실행한다).
   ② `hooks/useListCursor` 의 소유권 — `/journal` 은 목록이 둘이라 `j` 한 번에 하이라이트가
      두 줄에 뜨고 `d` 가 **보이는 포커스와 다른 목록**을 지웠다.

   ⚠ 여기서 재는 것은 **판정**이다. 실제 키 전이(치트시트를 열고 g 를 누르는 왕복)는 e2e 의
   몫이고, 그 사각은 착수계획 §검증사각 표가 들고 있다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { singleKeyBlocked } from '@/shell/keyGate';
import { useOverlay } from '@/store/useOverlay';
import { confirm } from '@/shell/modal';
import { useListCursor } from '@/hooks/useListCursor';
import { MINI_PATH } from '@/lib/miniMode';

beforeEach(() => {
  useOverlay.setState({ palette: false, help: false, miniCapture: false });
  document.body.innerHTML = '';
  // jsdom 에 없는 API — `useListCursor.move` 가 `reveal()` 로 부른다(스크롤은 이 테스트의 관심 밖).
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('① 전역 단일키 게이트', () => {
  it('평소에는 안 막는다 — 막기만 하는 게이트는 단축키를 없애는 것과 같다', () => {
    expect(singleKeyBlocked('/today')).toBe(false);
  });

  it('⚠ 치트시트(`?`)가 떠 있으면 막는다 — 종전엔 `help` 를 **아무도 안 보고 있었다**', () => {
    useOverlay.setState({ help: true });
    expect(singleKeyBlocked('/today')).toBe(true);
  });

  it('팔레트(⌘K)가 떠 있으면 막는다', () => {
    useOverlay.setState({ palette: true });
    expect(singleKeyBlocked('/today')).toBe(true);
  });

  it('미니 캡처 한 줄이 떠 있으면 막는다', () => {
    useOverlay.setState({ miniCapture: true });
    expect(singleKeyBlocked('/today')).toBe(true);
  });

  it('⚠ 확인창이 떠 있으면 막는다 — `[`/`]` 로 확인창이 다른 화면 위로 옮겨 앉던 자리', () => {
    void confirm('지울까요?');
    expect(singleKeyBlocked('/today')).toBe(true);
  });

  it('⚠ `/mini`(알약)에서 막는다 — 라우팅만 되고 창은 320×92 로 남아 나갈 문이 사라진다(H11)', () => {
    expect(singleKeyBlocked(MINI_PATH)).toBe(true);
  });

  it('입력 중이면 막는다', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(singleKeyBlocked('/today')).toBe(true);
  });
});

/** 목록 하나를 렌더하고 `j`/`d` 를 눌러 보는 최소 하네스. */
function mountList(keys: string[], onDelete: (k: string) => void) {
  const Row = ({
    reg,
    k,
    tab,
    onFocus,
  }: {
    reg: (el: HTMLElement | null) => void;
    k: string;
    tab: number;
    onFocus: () => void;
  }) => <div ref={reg} data-k={k} tabIndex={tab} onFocus={onFocus} />;
  const Harness = () => {
    const c = useListCursor<string>({
      items: keys.map((k) => ({ key: k, item: k })),
      verbs: { d: (k) => onDelete(k) },
    });
    return (
      <div>
        {keys.map((k) => (
          <Row key={k} k={k} reg={c.register(k)} tab={c.tabStop === k ? 0 : -1} onFocus={() => c.onItemFocus(k)} />
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

describe('② useListCursor 소유권 — 목록이 둘일 때 누가 키를 갖나', () => {
  it('목록이 하나면 포커스 없이도 `j` 로 들어갈 수 있다(규칙 ③ — 들어오는 문)', () => {
    const del = vi.fn();
    mountList(['a', 'b'], del);
    press('j');
    press('d');
    expect(del).toHaveBeenCalledWith('a');
  });

  it('⚠⚠ 목록이 둘인데 포커스가 없으면 **아무도** 안 받는다 — 종전엔 둘 다 받아 `d` 가 오조준됐다', () => {
    const a = vi.fn();
    const b = vi.fn();
    mountList(['a1'], a);
    mountList(['b1'], b);
    press('j');
    press('d');
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('포커스가 든 목록 **하나만** 받는다', () => {
    const a = vi.fn();
    const b = vi.fn();
    const first = mountList(['a1'], a);
    mountList(['b1'], b);
    act(() => {
      first.container.querySelector<HTMLElement>('[data-k="a1"]')!.focus();
    });
    press('d');
    expect(a).toHaveBeenCalledWith('a1');
    expect(b).not.toHaveBeenCalled();
  });

  it('⚠ 포커스가 목록 밖(다이얼로그·버튼)에 있으면 단일 목록도 안 받는다 — 뒤에서 지워지던 자리', () => {
    const del = vi.fn();
    mountList(['a', 'b'], del);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => outside.focus());
    press('j');
    press('d');
    expect(del).not.toHaveBeenCalled();
  });
});
