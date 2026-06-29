import type { ReactNode } from 'react';
import styles from './Pill.module.css';

export type PillTone = 'neutral' | 'good' | 'warn' | 'bad';

/** 상태 칩. tone으로 색, tiny로 약간 큰 글자(레거시 `pill tiny`와 대응). */
export function Pill({ tone = 'neutral', tiny, children }: { tone?: PillTone; tiny?: boolean; children: ReactNode }) {
  const cls = [styles.pill, tiny && styles.tiny, tone !== 'neutral' && styles[tone]].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}
