import type { ReactNode } from 'react';
import styles from './Kpi.module.css';

export type KpiTone = 'warn' | 'bad' | 'good';

/** KPI 4열 그리드 컨테이너. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className={styles.kpis}>{children}</div>;
}

/** 큰 숫자 + 라벨. tone으로 숫자 색(경고/위험/성공). */
export function Kpi({ value, label, tone }: { value: ReactNode; label: ReactNode; tone?: KpiTone }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.v} data-tone={tone}>
        {value}
      </div>
      <div className={styles.l}>{label}</div>
    </div>
  );
}
