/* ============================================================
   HudFrame — 노치 HUD 프레임(설계도 §1-2). 페이지 본문을 감싸는 순수 표현 컨테이너.
   레이어 규칙: components → lib만 import(셸/스토어 의존 없음 — 순수 프리미티브).
   App이 라우트 본문을 이 프레임 안에 렌더하고, 내부 스크롤러가 콘텐츠를 흐르게 한다.

   ⚠ 룩은 `styles/global/features.css`(앱 크롬 · `@layer components`)의 `.hud`/`.hud-scroll`/
   `.hud-fill` 이 소유한다 — clip-path 노치와 `::-webkit-scrollbar` 는 유틸리티로 표현할 수
   없어서 CSS 로 남는 부류다(설계서 §15-12·§15-15).
============================================================ */
import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** fill=true → 내부 스크롤·패딩 없이 본문이 프레임을 가득 채움(단일 화면 대시보드, 데모 v6 today). */
export default function HudFrame({
  children,
  className,
  fill,
  scrollResetKey,
}: {
  children: ReactNode;
  className?: string;
  fill?: boolean;
  /** C-11: 이 값이 바뀌면 내부 스크롤러를 최상단으로. App이 라우트 key를 넘겨 탭 전환 시
     이전 스크롤 위치가 다른 콘텐츠 위에 남아 중간 착지하던 표류를 없앤다. fill 탭은 스크롤 없어 무해. */
  scrollResetKey?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [scrollResetKey]);
  return (
    <section className={className ? `hud ${className}` : 'hud'}>
      {/* ⚠ 스크롤러에 `tabIndex={0}` — axe `scrollable-region-focusable`(2026-07-25).
          브라우저는 `overflow:auto` 컨테이너를 **자동으로 포커스 대상으로 만들지 않는다.**
          안에 포커스 가능한 자식이 하나라도 있으면 그걸 타고 스크롤이 따라오지만, `guide`
          처럼 **순수 텍스트뿐인 탭**은 키보드·스위치 사용자가 첫 화면 아래를 볼 방법이
          아예 없었다(마우스 휠·터치 전용 콘텐츠). 게이트가 정확히 그 탭에서 잡았다.

          ⚠ `fill` 일 땐 붙이지 않는다 — 그쪽은 스크롤이 없어서 포커스 정지점만 늘린다.
          ⚠ `role="group"` 은 **이름을 주지 않는다**(`region` 도 아니다): 이름 없는 group 은
          스크린리더가 사실상 무시하므로 탭마다 잡음 랜드마크가 생기지 않으면서, 동시에
          `jsx-a11y/no-noninteractive-tabindex` 에 "의도된 스크롤 컨테이너"임을 표시한다
          (그 규칙과 axe 가 충돌하는 이유는 `eslint.config.js` 가 소유). 삼항식으로 규칙을
          우회할 수도 있었지만 그건 우연한 통과다. 픽셀은 안 바뀐다(포커스 링은 `:focus-visible`). */}
      <div
        ref={scrollRef}
        className={fill ? 'hud-fill' : 'hud-scroll'}
        tabIndex={fill ? undefined : 0}
        role={fill ? undefined : 'group'}
      >
        {children}
      </div>
    </section>
  );
}
