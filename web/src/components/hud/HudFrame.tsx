/* ============================================================
   HudFrame — 노치 HUD 프레임(설계도 §1-2). 페이지 본문을 감싸는 순수 표현 컨테이너.
   레이어 규칙: components → lib만 import(셸/스토어 의존 없음 — 순수 프리미티브).
   App이 라우트 본문을 이 프레임 안에 렌더하고, 내부 스크롤러가 콘텐츠를 흐르게 한다.
============================================================ */
import type { ReactNode } from 'react';
import s from './HudFrame.module.css';

/** fill=true → 내부 스크롤·패딩 없이 본문이 프레임을 가득 채움(단일 화면 대시보드, 데모 v6 today). */
export default function HudFrame({
  children,
  className,
  fill,
}: {
  children: ReactNode;
  className?: string;
  fill?: boolean;
}) {
  return (
    <section className={`${s.frame}${className ? ' ' + className : ''}`}>
      <div className={fill ? s.fillInner : s.scroll}>{children}</div>
    </section>
  );
}
