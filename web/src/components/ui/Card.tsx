import type { ReactNode } from 'react';
import styles from './Card.module.css';

/** 콘텐츠 패널. title을 주면 카드 머리에 h2로 렌더. */
export function Card({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `${styles.card} ${className}` : styles.card}>
      {title != null && <h2 className={styles.title}>{title}</h2>}
      {children}
    </section>
  );
}
