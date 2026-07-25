// @vitest-environment jsdom
/* ============================================================
   useSwipe.test.tsx — 좌우 스와이프 훅의 **판정 규칙** 회귀(UX-B 팩).

   왜 이 파일이 있는가: 이 훅은 폰 3화면이 공유하는 단일 판정기다. 여기서 틀리면 세 화면이
   동시에 틀리는데, 증상이 **조용하다** — "가끔 화면이 제멋대로 넘어간다"는 재현이 어렵고
   스냅샷·e2e 어느 쪽도 손가락 궤적을 재지 않는다. 그래서 궤적을 직접 먹여 잠근다.

   ⚠ 여기서 픽셀·클래스는 안 본다. 보는 것은 **어떤 궤적이 무엇으로 판정되는가** 하나다.
============================================================ */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { useSwipe } from '@/hooks/useSwipe';

afterEach(() => cleanup());

interface Spies {
  left?: () => void;
  right?: () => void;
  tap?: () => void;
  click?: () => void;
}

/** 스와이프 영역 + 그 안의 버튼(팩의 전제 = 버튼은 전부 유지). */
function Harness({ left, right, tap, click }: Spies) {
  const swipe = useSwipe({ onSwipeLeft: left, onSwipeRight: right, onTap: tap });
  return (
    <section {...swipe} data-testid="zone">
      <button type="button" onClick={click}>
        건너뛰기
      </button>
    </section>
  );
}

/** 한 제스처 = down → move* → up. 좌표는 클라이언트 px. */
function gesture(el: HTMLElement, from: [number, number], path: [number, number][], opts?: { type?: string }): void {
  const pointerType = opts?.type ?? 'touch';
  fireEvent.pointerDown(el, { pointerId: 1, pointerType, clientX: from[0], clientY: from[1] });
  for (const [x, y] of path) fireEvent.pointerMove(el, { pointerId: 1, pointerType, clientX: x, clientY: y });
  const last = path.at(-1) ?? from;
  fireEvent.pointerUp(el, { pointerId: 1, pointerType, clientX: last[0], clientY: last[1] });
}

const zone = (): HTMLElement => screen.getByTestId('zone');

describe('useSwipe — 방향 판정', () => {
  it('임계(60px) 넘게 왼쪽으로 밀면 onSwipeLeft', () => {
    const left = vi.fn();
    const right = vi.fn();
    render(<Harness left={left} right={right} />);
    gesture(
      zone(),
      [200, 100],
      [
        [180, 102],
        [120, 104],
      ],
    );
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).not.toHaveBeenCalled();
  });

  it('오른쪽으로 밀면 onSwipeRight', () => {
    const left = vi.fn();
    const right = vi.fn();
    render(<Harness left={left} right={right} />);
    gesture(
      zone(),
      [100, 100],
      [
        [130, 100],
        [180, 100],
      ],
    );
    expect(right).toHaveBeenCalledTimes(1);
    expect(left).not.toHaveBeenCalled();
  });

  it('임계 미만이면 아무것도 아니다(실수로 넘어가지 않는다)', () => {
    const left = vi.fn();
    render(<Harness left={left} />);
    gesture(
      zone(),
      [200, 100],
      [
        [180, 100],
        [160, 100],
      ],
    ); // 40px
    expect(left).not.toHaveBeenCalled();
  });
});

describe('useSwipe — 축 우세(이 훅의 실패 1순위)', () => {
  it('세로가 먼저 우세하면 그 뒤 가로로 크게 움직여도 스와이프가 아니다', () => {
    /* 스크롤하려고 세로로 긋다가 손이 옆으로 흐르는 것이 실제 사용 궤적이다.
       축을 매 프레임 다시 재면 여기서 화면이 넘어간다 — 한 번 'y' 면 끝까지 'y'. */
    const left = vi.fn();
    render(<Harness left={left} />);
    gesture(
      zone(),
      [200, 100],
      [
        [202, 130], // 세로 우세로 잠김
        [100, 160], // 이후 가로 100px
      ],
    );
    expect(left).not.toHaveBeenCalled();
  });

  it('가로가 먼저 우세하면 이후 세로가 섞여도 스와이프다', () => {
    const left = vi.fn();
    render(<Harness left={left} />);
    gesture(
      zone(),
      [200, 100],
      [
        [170, 104], // 가로 우세로 잠김
        [120, 190],
      ],
    );
    expect(left).toHaveBeenCalledTimes(1);
  });

  it('브라우저가 스크롤을 가져가면(pointercancel) 그 제스처는 버린다', () => {
    const left = vi.fn();
    render(<Harness left={left} />);
    const el = zone();
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'touch', clientX: 170, clientY: 100 });
    fireEvent.pointerCancel(el, { pointerId: 1, pointerType: 'touch', clientX: 170, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    expect(left).not.toHaveBeenCalled();
  });
});

describe('useSwipe — 탭과 버튼의 경계', () => {
  it('거의 안 움직이고 떼면 onTap', () => {
    const tap = vi.fn();
    render(<Harness tap={tap} />);
    gesture(zone(), [150, 100], [[152, 101]]);
    expect(tap).toHaveBeenCalledTimes(1);
  });

  it('버튼 위에서 탭하면 버튼만 눌리고 onTap 은 안 뜬다', () => {
    // 카드 전체가 '펼치기'인 화면에서 '건너뛰기'를 눌렀는데 펼쳐지기까지 하면 안 된다.
    const tap = vi.fn();
    render(<Harness tap={tap} />);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerUp(btn, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    expect(tap).not.toHaveBeenCalled();
  });

  it('버튼 위에서 시작한 스와이프는 그 버튼을 누르지 않는다', () => {
    // 브라우저는 이동량과 무관하게 click 을 낸다 → 스와이프 뒤 click 을 삼켜야 한다.
    const left = vi.fn();
    const click = vi.fn();
    render(<Harness left={left} click={click} />);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 100 });
    fireEvent.pointerMove(btn, { pointerId: 1, pointerType: 'touch', clientX: 170, clientY: 100 });
    fireEvent.pointerUp(btn, { pointerId: 1, pointerType: 'touch', clientX: 110, clientY: 100 });
    fireEvent.click(btn);
    expect(left).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
  });

  it('스와이프 뒤 **다음** 클릭은 정상 동작한다(삼킴이 한 번뿐)', () => {
    const click = vi.fn();
    render(<Harness left={() => {}} click={click} />);
    const btn = screen.getByRole('button');
    gesture(
      btn,
      [200, 100],
      [
        [170, 100],
        [110, 100],
      ],
    );
    fireEvent.click(btn); // 삼켜짐
    fireEvent.click(btn); // 정상
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('useSwipe — 입력 장치', () => {
  it('마우스 드래그는 스와이프가 아니다(데스크톱에서 텍스트 선택이 화면을 넘기면 안 된다)', () => {
    const left = vi.fn();
    render(<Harness left={left} />);
    gesture(
      zone(),
      [200, 100],
      [
        [150, 100],
        [100, 100],
      ],
      { type: 'mouse' },
    );
    expect(left).not.toHaveBeenCalled();
  });
});
