// @vitest-environment jsdom
/* useFormSubmit — Q-20 `advance`(한 문장 그릇에서 Enter = 다음 칸) 계약. */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFormSubmit } from '@/hooks/useFormSubmit';

describe('Q-20 advance — 한 문장 그릇에서 Enter 는 다음 칸', () => {
  const mkEvent = (over: Record<string, unknown> = {}) => {
    const prevented = { value: false };
    const e = {
      key: 'Enter',
      altKey: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      nativeEvent: { isComposing: false },
      currentTarget: { tagName: 'TEXTAREA' } as unknown as HTMLElement,
      preventDefault: () => (prevented.value = true),
      stopPropagation: () => {},
      ...over,
    };
    return { e, prevented };
  };

  it('advance 를 안 주면 종전대로 줄바꿈이다(제출도 이동도 아니다)', () => {
    const submit = vi.fn();
    const { result } = renderHook(() => useFormSubmit(submit));
    const { e, prevented } = mkEvent();
    result.current.onKeyDown(e as never);
    expect(submit).not.toHaveBeenCalled();
    expect(prevented.value).toBe(false);
  });

  it('⭐ advance 가 옮기면 줄바꿈을 막는다', () => {
    const submit = vi.fn();
    const advance = vi.fn(() => true);
    const { result } = renderHook(() => useFormSubmit(submit, undefined, { advance }));
    const { e, prevented } = mkEvent();
    result.current.onKeyDown(e as never);
    expect(advance).toHaveBeenCalled();
    expect(prevented.value).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });

  it('⚠ 마지막 칸(advance=false)이면 Enter 는 줄바꿈 그대로 — 죽은 키를 만들지 않는다', () => {
    const submit = vi.fn();
    const { result } = renderHook(() => useFormSubmit(submit, undefined, { advance: () => false }));
    const { e, prevented } = mkEvent();
    result.current.onKeyDown(e as never);
    expect(prevented.value).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('⌘Enter 는 advance 가 있어도 여전히 제출이다', () => {
    const submit = vi.fn();
    const advance = vi.fn(() => true);
    const { result } = renderHook(() => useFormSubmit(submit, undefined, { advance }));
    const { e } = mkEvent({ metaKey: true });
    result.current.onKeyDown(e as never);
    expect(submit).toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it('⇧Enter 는 advance 가 있어도 줄바꿈이다', () => {
    const advance = vi.fn(() => true);
    const { result } = renderHook(() => useFormSubmit(vi.fn(), undefined, { advance }));
    const { e, prevented } = mkEvent({ shiftKey: true });
    result.current.onKeyDown(e as never);
    expect(advance).not.toHaveBeenCalled();
    expect(prevented.value).toBe(false);
  });

  it('IME 조합 중이면 아무것도 안 한다', () => {
    const advance = vi.fn(() => true);
    const { result } = renderHook(() => useFormSubmit(vi.fn(), undefined, { advance }));
    const { e } = mkEvent({ nativeEvent: { isComposing: true } });
    result.current.onKeyDown(e as never);
    expect(advance).not.toHaveBeenCalled();
  });
});
