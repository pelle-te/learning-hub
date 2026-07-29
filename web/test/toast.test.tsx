// @vitest-environment jsdom
/* ============================================================
   toast.test.tsx — 토스트의 **가역 창(되돌리기)** 계약(UX-3).

   왜: `toastUndo` 는 6.5초짜리 되돌릴 수 있는 창을 여는데, 그 창이 화면에 전혀 안 보였다.
   바를 붙인 뒤 지켜야 하는 것은 둘이다 — ① 되돌릴 게 **있는** 토스트에만 붙는다(일반 알림에
   시간 바를 달면 장식이다) ② 바의 시간이 **실제 타이머와 같은 상태**를 쓴다(hover 로 타이머를
   멈췄는데 바만 계속 줄면 보이는 것이 곧 거짓이 된다).

   ⚠ 색·픽셀은 안 본다. `animation-*` 인라인 값만 보는 이유는 그것이 **JS 가 소유한 계약**이고
     (길이=item.ms · 재생상태=paused) 나머지는 CSS 가 갖기 때문이다.
   ⚠ 토스트 스토어는 **모듈 싱글턴**이라 테스트 간에 샌다(언마운트해도 항목이 남는다).
     매 테스트 끝에 타이머를 밀어 스스로 소멸시킨 뒤 언마운트한다 — 그게 실제 소멸 경로다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ToastHost, toast, toastUndo } from '@/shell/toast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  /* ⚠ 그냥 타이머만 밀면 안 된다 — hover/focus 로 **일시정지된** 토스트는 자동 소멸 타이머가
     아예 안 돈다(그게 이 컴포넌트의 정상 동작이다). 실제 '조기 닫기' 경로(클릭)로 닫고,
     퇴장 애니만큼 밀어 스토어에서 빠지게 한다. */
  document.querySelectorAll('.toast').forEach((el) => fireEvent.click(el));
  act(() => void vi.advanceTimersByTime(1000));
  cleanup();
  vi.useRealTimers();
});

/** 수명 바 — 장식이라 role 이 없다. 클래스로 찾되 *존재 여부*만 본다(스타일은 단언 안 함). */
const life = (): HTMLElement | null => document.querySelector('.toast-life');

/** 보이는 토스트 상자. ⚠ `getByRole('status')` 로 잡지 않는다(H15) — 라이브 리전이 **토스트
 *  밖의 항상 마운트된 노드**로 옮겨갔고, 그게 이 파일이 지켜야 할 계약이다. */
const box = (): HTMLElement => document.querySelector('.toast')!;

describe('토스트 되돌리기 창 표시(UX-3)', () => {
  it('되돌릴 게 없는 알림에는 시간 바를 안 붙인다(장식 금지)', () => {
    render(<ToastHost />);
    act(() => toast('저장했어요', 'ok'));
    /* ⚠ 둘인 것이 계약이다(H15) — 보이는 토스트 + **미리 마운트된** 라이브 리전.
       리전이 토스트와 함께 삽입되면 공지가 씹혀 SR 사용자는 한 번도 못 듣는다. */
    expect(screen.getAllByText('저장했어요').length).toBe(2);
    expect(life()).toBeNull();
  });

  it('되돌리기가 있으면 붙고, 길이가 그 토스트의 실제 수명과 같다(6.5초 창)', () => {
    render(<ToastHost />);
    act(() => toastUndo('과목을 지웠어요', () => {}));
    expect(life()).not.toBeNull();
    expect(life()!.style.animationDuration).toBe('6500ms');
  });

  it('hover/포커스로 타이머가 멈추면 바도 멈춘다(보이는 것이 거짓이 되지 않게)', () => {
    render(<ToastHost />);
    act(() => toastUndo('지웠어요', () => {}));
    const el = box();
    expect(life()!.style.animationPlayState).toBe('running');

    fireEvent.mouseEnter(el);
    expect(life()!.style.animationPlayState).toBe('paused');
    fireEvent.mouseLeave(el);
    expect(life()!.style.animationPlayState).toBe('running');

    // 키보드 사용자도 같다 — WCAG 2.2.1 로 이미 focus 일시정지를 넣어 둔 자리를 바가 공유한다.
    fireEvent.focus(el);
    expect(life()!.style.animationPlayState).toBe('paused');
  });

  it('되돌리기 버튼은 그대로 동작한다(바가 클릭을 가리지 않는다)', () => {
    let undone = false;
    render(<ToastHost />);
    act(() => toastUndo('지웠어요', () => (undone = true)));
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(undone).toBe(true);
  });
});
