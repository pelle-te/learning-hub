/* ============================================================
   Readout — 라벨 + 큰 숫자(설계도 §1-2). 순수 표현 컴포넌트.
   value는 ReactNode(숫자에 <small>단위</small>를 섞을 수 있음). size·accent로 위계 표현.
============================================================ */
import type { ReactNode } from 'react';
import s from './Readout.module.css';

export default function Readout({
  label,
  value,
  sub,
  size = 'md',
  accent = false,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  accent?: boolean;
  className?: string;
}) {
  const sizeCls = size === 'sm' ? s.sm : size === 'lg' ? s.lg : '';
  return (
    <div
      className={`${s.readout}${sizeCls ? ' ' + sizeCls : ''}${accent ? ' ' + s.accent : ''}${className ? ' ' + className : ''}`}
    >
      <span className={s.label}>{label}</span>
      <span className={s.value}>{value}</span>
      {sub != null && <span className={s.sub}>{sub}</span>}
    </div>
  );
}
