import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'default' | 'primary' | 'ghost';

/** 공용 버튼. variant(기본/primary/ghost) + danger(위험색 호버) + sm(작게)를 조합. */
export function Button({
  variant = 'default',
  danger,
  sm,
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  danger?: boolean;
  sm?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [
    styles.btn,
    sm && styles.sm,
    variant !== 'default' && styles[variant],
    danger && styles.danger,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
