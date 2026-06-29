import type { ReactNode } from 'react';
import styles from './Table.module.css';

/** 박스형 표 래퍼. <thead>/<tbody>를 children으로 그대로 넣는다(셀 커스텀 자유). */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className ? `${styles.box} ${className}` : styles.box}>
      <table>{children}</table>
    </div>
  );
}
