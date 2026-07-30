import { useEffect, useState } from 'react';
import { clamp } from '@/lib/utils';

/* TooltipHost — 앱 루트에 1개. 문서 전역에 위임 리스너를 달아 `data-tip` 속성을 가진 어떤
   요소든 hover/focus 시 스타일된 툴팁을 띄운다(네이티브 title 대체 — 터치 탭·키보드 포커스·
   스타일·즉시 표시). 위임이라 조밀한 그리드(히트맵 셀 수백 개)에도 핸들러는 단 한 쌍.

   접근성: 보이는 사용자는 이 툴팁, 스크린리더 사용자는 같은 요소의 aria-label을 읽는다
   (data-tip을 붙이는 쪽에서 aria-label도 함께 부여). fixed라 레이아웃/스크린샷 불변.

   ── C-7 컴포넌트 티어 이식(Tailwind) ────────────────────────────────────────
   ⚠ **8px 간격이 CSS 에서 JS 로 내려왔다.** 원본은 `translate(-50%, calc(-100% - 8px))` 였는데
   `calc(…-8px)` 은 유틸로 옮기면 임의 수치 금지에 걸리고(내부 `100%` 까지 룰에 걸린다),
   토큰으로 빼도 `--translate-*` 네임스페이스가 없어 되돌아온다. 그런데 이 값은 원래 **위치
   계산의 일부**다 — `top` 을 이미 JS 가 정하고 있으므로 거기서 8px 을 빼고 더하면 CSS 는
   순수한 `-100%`/`0` 만 남는다. 결과 좌표는 완전히 동일하다(계산스타일 덤프로 확인).
   `.rv small` 을 생산자 쪽에서 고친 것과 같은 판단이다 — 규약 4 의 정신. */
const GAP = 8;
const TIP =
  'pointer-events-none fixed z-[var(--z-tooltip)] max-w-tooltip -translate-x-1/2 rounded-sm border border-line bg-panel px-2.5 py-1.75 text-sm leading-[1.45] break-keep whitespace-pre-line text-txt shadow-float animate-[enter-fade_var(--dur-fast)_var(--ease)_both] motion-reduce:animate-none';
// 위/아래 배치 — 아래로 붙을 땐 변환이 필요 없다(위 GAP 이 top 에 이미 들어가 있다).
const ABOVE = '-translate-y-full';

interface TipState {
  text: string;
  left: number;
  top: number;
  below: boolean;
}

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
        top: below ? r.bottom + GAP : r.top - GAP,
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
    <div className={tip.below ? TIP : `${TIP} ${ABOVE}`} style={{ left: tip.left, top: tip.top }} role="tooltip">
      {tip.text}
    </div>
  );
}
