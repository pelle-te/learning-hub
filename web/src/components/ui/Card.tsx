import type { ReactNode } from 'react';

/* Card — 콘텐츠 패널(설계도 §3).
   ── C-7 마지막 티어 ────────────────────────────────────────────────────────
   룩은 전부 전역 `ds-rule` 가 소유한다(옛 `composes: card from ds.module.css`). 이 파일이
   갖고 있던 `.card::before`·`.card:hover` 는 ds 의 것과 **한 글자도 다르지 않은 사본**이라
   함께 지웠다 — 미러를 없애려고 composes 를 썼는데 사본이 남아 있었다.
   ⚠ `<h2>` 는 언레이어드 전역 `h2{}`(16px · -0.015em)를 받으므로 다른 값만 `!` 로 이긴다.
   같은 값(margin 0 0 13px · 700 · keep-all · color)은 전역에 맡긴다. */
const TITLE = 'text-lg! leading-text tracking-price! text-txt';

/** 콘텐츠 패널. title을 주면 카드 머리에 h2로 렌더. */
export function Card({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `ds-rule ${className}` : 'ds-rule'}>
      {title != null && <h2 className={TITLE}>{title}</h2>}
      {children}
    </section>
  );
}
