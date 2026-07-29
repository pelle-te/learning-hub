/* ============================================================
   CountReadout — 카운트업 리드아웃(큰 숫자 + 라벨)의 단일 원천(C5).
   Stats·Settings가 각자 재정의하던 동일 컴포넌트를 통합 — 클래스는
   호출부가 소유(픽셀 불변). 카운트업은 정본 useCountUp.
============================================================ */
import type { ReactNode } from 'react';
import { useCountUp } from '@/hooks/interactions';

export function CountReadout({
  value,
  lab,
  prefix,
  suffix,
  className,
  numClassName,
  labClassName,
}: {
  value: number;
  lab: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  className?: string;
  numClassName?: string;
  labClassName?: string;
}) {
  const shown = useCountUp(value);
  return (
    <div className={className}>
      <span className={numClassName}>
        {prefix}
        {Math.round(shown)}
        {suffix}
      </span>
      <span className={labClassName}>{lab}</span>
    </div>
  );
}
