import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'ghost';

/* Button — 공용 버튼.
   ── C-7 마지막 티어 ────────────────────────────────────────────────────────
   ⚠ **룩을 이 파일이 갖지 않는다.** 옛 `Button.module.css` 는 전역 `button{}` 시스템
   (`global/components.css`)의 **통째 사본**이었다 — base 9개 선언과 `:hover:not(:disabled)`·
   `:active:not(:disabled)`·`:disabled` 가 한 글자도 다르지 않았고, 전역엔 `button.primary`·
   `button.ghost` 까지 이미 있었다. 두 시스템이 공존한 이유는 명시도가 아니라 **이름**이다:
   CSS Module 클래스는 해시(`_primary_96rvn`)라 리터럴 `primary` 와 서로 닿지 않는다.
   → 사본을 지우고 전역 이름을 그대로 쓴다(`ShortcutsHelp` 의 `className="primary modal-ok"` 와
   같은 어휘). 유틸리티로 옮기는 것은 전역 button 을 다시 쓸 때 **함께** 한다(설계서 §15-12).
   ⚠ 검증: 스냅샷은 정지 상태만 찍으므로 hover/disabled 는 원리적으로 못 본다 → 전 페이지의
   모든 `<button>` 계산 스타일을 **정적·hover 두 벌로 덤프해 전/후 대조**했다(전량 동일).
   ⚠ 정적 맵 — 부칙(동적 클래스 조립 금지). */
const VARIANT: Record<Exclude<ButtonVariant, 'default'>, string> = { primary: 'primary', ghost: 'ghost' };

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
  const cls = [sm && 'sm', variant !== 'default' && VARIANT[variant], danger && 'danger', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
