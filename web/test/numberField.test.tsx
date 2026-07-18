// @vitest-environment jsdom
/* ============================================================
   numberField.test.tsx — 숫자 입력의 '중간 타이핑 상태 확정 저장' 방지 계약.
   회귀 원본: 배분 셀에서 1.5를 치면 '.' 시점에 0이 확정되고, 그 0이 그 주를 managed로 승격시켜
   자동 제안을 영구 대체했다. 최종값도 의도(1.5h)가 아니라 5h가 됐다.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { NumberField } from '@/components/ui/NumberField';

afterEach(() => cleanup());

/** 실제 사용처처럼 확정값을 상위가 소유하는 하네스. commit 호출 기록을 함께 반환. */
function Harness({
  initial,
  emptyValue,
  onCommit,
}: {
  initial: number;
  emptyValue?: number;
  onCommit: (v: number) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <NumberField
      value={v}
      emptyValue={emptyValue}
      min={0}
      step={0.5}
      aria-label="값"
      onCommit={(n) => {
        setV(n);
        onCommit(n);
      }}
    />
  );
}

describe('NumberField — 미완 입력은 저장하지 않는다', () => {
  it('2 → 1.5로 고쳐 칠 때 중간의 빈값이 0으로 확정되지 않는다', () => {
    const commit = vi.fn();
    render(<Harness initial={2} onCommit={commit} />);
    const el = screen.getByLabelText('값');

    // 전체선택 후 다시 치는 실제 조작 순서. type=number는 미완 상태에서 '' 를 준다.
    fireEvent.change(el, { target: { value: '' } }); // 전체 지움 — 예전엔 여기서 0 확정
    fireEvent.change(el, { target: { value: '1' } });
    fireEvent.change(el, { target: { value: '' } }); // '1.' 입력 순간 브라우저가 주는 값
    fireEvent.change(el, { target: { value: '1.5' } });
    fireEvent.blur(el);

    expect(commit).not.toHaveBeenCalledWith(0); // 핵심: 0이 단 한 번도 확정되면 안 된다
    expect(commit).toHaveBeenLastCalledWith(1.5);
  });

  it('완성된 숫자는 타이핑 중에도 즉시 반영된다(실시간 감각 유지)', () => {
    const commit = vi.fn();
    render(<Harness initial={0} onCommit={commit} />);
    fireEvent.change(screen.getByLabelText('값'), { target: { value: '3' } });
    expect(commit).toHaveBeenCalledWith(3);
  });

  it('emptyValue를 주면 비운 채 떠날 때 그 값으로 확정된다(셀 지우기=0)', () => {
    const commit = vi.fn();
    render(<Harness initial={2} emptyValue={0} onCommit={commit} />);
    const el = screen.getByLabelText('값');
    fireEvent.change(el, { target: { value: '' } });
    expect(commit).not.toHaveBeenCalled(); // 아직은 아니다 — 떠날 때 정한다
    fireEvent.blur(el);
    expect(commit).toHaveBeenCalledWith(0);
  });

  it('emptyValue가 없으면 비운 채 떠나도 직전 값이 살아남는다', () => {
    const commit = vi.fn();
    render(<Harness initial={2} onCommit={commit} />);
    const el = screen.getByLabelText('값');
    fireEvent.change(el, { target: { value: '' } });
    fireEvent.blur(el);
    expect(commit).not.toHaveBeenCalled();
    expect(el).toHaveValue(2); // draft를 버리고 prop 값으로 복귀
  });

  it('min 아래 값은 클램프해서 확정한다', () => {
    const commit = vi.fn();
    render(<Harness initial={2} onCommit={commit} />);
    fireEvent.change(screen.getByLabelText('값'), { target: { value: '-5' } });
    expect(commit).toHaveBeenCalledWith(0);
  });

  it('포커스가 없으면 외부 값 변경을 그대로 비춘다', () => {
    const { rerender } = render(<NumberField value={1} onCommit={() => {}} aria-label="값" />);
    rerender(<NumberField value={7} onCommit={() => {}} aria-label="값" />);
    expect(screen.getByLabelText('값')).toHaveValue(7);
  });
});
