/* ============================================================
   EmptyState — 1급 빈 상태(설계도 Phase D). 데이터가 없을 때도 의도적으로 보이게:
   큰 글리프 + 에디토리얼 헤드라인 + 안내 + 행동(CTA). 여러 feature가 공유(중복 제거).
============================================================ */
import type { ReactNode } from 'react';
import s from './EmptyState.module.css';

export default function EmptyState({
  glyph,
  title,
  desc,
  actions,
}: {
  glyph?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={s.wrap}>
      {glyph != null && <div className={s.glyph}>{glyph}</div>}
      <div className={s.title}>{title}</div>
      {desc != null && <div className={s.desc}>{desc}</div>}
      {actions != null && <div className={s.actions}>{actions}</div>}
    </div>
  );
}
