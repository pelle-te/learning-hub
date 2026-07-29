/* ============================================================
   ProgressRing — SVG 도넛 게이지의 단일 원천(C2).
   TodaySignature·Stats·Mastery·Degree·ItemCard가 각자 들고 있던
   트랙+아크 2겹·둘레 dashoffset 수식을 통합. 순수 표현 컴포넌트라
   크기·굵기·색·중앙 콘텐츠·카운트업은 호출부(클래스·useCountUp)가 소유
   — 픽셀은 호출부 클래스 그대로라 통합 전후 동일.
============================================================ */

export function ProgressRing({
  size,
  r,
  pct,
  className,
  trackClassName,
  arcClassName,
}: {
  /** viewBox 한 변(px 아님 — 실제 크기는 CSS가 결정). */
  size: number;
  /** 링 반지름(viewBox 좌표계). */
  r: number;
  /** 진행률 0~100 — 범위 밖은 클램프(음수 dashoffset 방지). */
  pct: number;
  className?: string;
  trackClassName?: string;
  arcClassName?: string;
}) {
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden="true">
      <circle className={trackClassName} cx={mid} cy={mid} r={r} />
      <circle
        className={arcClassName}
        cx={mid}
        cy={mid}
        r={r}
        style={{ strokeDasharray: c, strokeDashoffset: c * (1 - clamped / 100) }}
      />
    </svg>
  );
}
