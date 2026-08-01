// @vitest-environment jsdom
/* Q-17 — `<Num>` 이 지키는 것은 **위계** 하나다. 크기는 호출부 것이라는 계약도 함께 잠근다. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Num } from '@/components/Num';

describe('Num — 수치 조판 위계', () => {
  it('값·소수·단위가 각자 다른 층으로 선다', () => {
    const { container } = render(<Num value={3} frac={2} unit="h" />);
    expect(container.textContent).toBe('3.2h');
    expect(container.querySelector('.ds-num-frac')?.textContent).toBe('.2');
    expect(container.querySelector('.ds-num-unit')?.textContent).toBe('h');
  });

  it('소수가 없으면 소수점도 없다 — 빈 `.` 이 남으면 그건 값이 아니라 오타로 읽힌다', () => {
    const { container } = render(<Num value={87} unit="%" />);
    expect(container.textContent).toBe('87%');
    expect(container.querySelector('.ds-num-frac')).toBeNull();
  });

  it('후행 0 을 지킨다 — 문자열 소수는 그대로 나간다(정밀도를 지우지 않는다)', () => {
    const { container } = render(<Num value={0} frac="20" />);
    expect(container.textContent).toBe('0.20');
  });

  it('값 부재도 같은 자리에 선다', () => {
    render(<Num value="—" unit="h" />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  /* ⚠ 이 케이스가 "크기는 호출부 것"이라는 계약의 집행자다 — 프리미티브가 폰트 크기를 들면
     화면마다 `!` 로 덮게 되고, 그 순간 위계는 다시 화면마다 갈린다. */
  it('바깥 클래스는 호출부가 준 것 그대로다 — 프리미티브가 크기를 덧붙이지 않는다', () => {
    const { container } = render(<Num className="text-primary-num text-acc" value={1} />);
    expect((container.firstChild as HTMLElement).className).toBe('text-primary-num text-acc');
  });
});
