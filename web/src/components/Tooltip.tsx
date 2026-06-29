import { useEffect, useState } from 'react';
import styles from './Tooltip.module.css';

/* TooltipHost — 앱 루트에 1개. 문서 전역에 위임 리스너를 달아 `data-tip` 속성을 가진 어떤
   요소든 hover/focus 시 스타일된 툴팁을 띄운다(네이티브 title 대체 — 터치 탭·키보드 포커스·
   스타일·즉시 표시). 위임이라 조밀한 그리드(히트맵 셀 수백 개)에도 핸들러는 단 한 쌍.

   접근성: 보이는 사용자는 이 툴팁, 스크린리더 사용자는 같은 요소의 aria-label을 읽는다
   (data-tip을 붙이는 쪽에서 aria-label도 함께 부여). fixed라 레이아웃/스크린샷 불변. */

interface TipState {
  text: string;
  left: number;
  top: number;
  below: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export default function TooltipHost() {
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    const showFor = (el: Element | null) => {
      const host = (el as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!host) return;
      const text = host.getAttribute('data-tip');
      if (!text) return;
      const r = host.getBoundingClientRect();
      const below = r.top < 64; // 위 공간 부족하면 아래로
      setTip({
        text,
        left: clamp(r.left + r.width / 2, 128, window.innerWidth - 128),
        top: below ? r.bottom : r.top,
        below,
      });
    };
    const hide = () => setTip(null);

    const onOver = (e: MouseEvent) => showFor(e.target as Element);
    const onOut = (e: MouseEvent) => {
      // 같은 data-tip 요소 내부 이동은 유지, 밖으로 나가면 숨김
      const to = e.relatedTarget as Element | null;
      const from = (e.target as HTMLElement | null)?.closest?.('[data-tip]');
      if (from && to && from.contains(to)) return;
      hide();
    };
    const onFocus = (e: FocusEvent) => showFor(e.target as Element);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    // 스크롤/리사이즈 시 위치가 어긋나므로 숨김(다음 hover에 재계산)
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      className={`${styles.tip} ${tip.below ? styles.below : styles.above}`}
      style={{ left: tip.left, top: tip.top }}
      role="tooltip"
    >
      {tip.text}
    </div>
  );
}
