import styles from './ProgressBar.module.css';

/** 진행 막대. pct(0~100), color로 채움색 토큰(예: 'var(--good)') 지정 가능. */
export function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className={styles.bar} role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <i className={styles.fill} style={{ width: `${w}%`, ...(color ? { background: color } : null) }} />
    </div>
  );
}
