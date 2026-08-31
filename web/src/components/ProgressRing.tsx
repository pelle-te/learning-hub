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
  tentative,
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
  /** 잠정값 — 획을 흐리게(P-12). ⛔ 판정을 하던 `lib/confidence.ts` 는 2026-08-29 에 은퇴했다(숙달도 축 · 목적 정정). 여기는 그리기만 한다.
   *
   *  ⚠ **그라데이션 페이드가 아니라 균일 투명이다.** 로드맵은 stroke 그라데이션을 적었는데 두
   *  가지가 막았다: ① `strokeDasharray` 는 **호 길이 자체에 이미 쓰이고 있어** 대시로는 불확실성을
   *  표현할 수 없다 ② `<stop currentColor>` 는 그라데이션 요소의 `color` 로 풀리는데 이 링의 색은
   *  호출부 클래스가 `stroke` 로 주므로 **둘이 안 맞는다**(호출부마다 색이 다르다).
   *  인용된 근거가 허용하는 부호화는 채도저하·블러·**투명**·스케치니스이고, 균일 투명은 그중
   *  하나다 — 그리고 캡션이 분모를 함께 말하므로 "비활성"으로 오독될 여지가 닫힌다. */
  tentative?: boolean;
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
        style={{
          strokeDasharray: c,
          strokeDashoffset: c * (1 - clamped / 100),
          ...(tentative ? { strokeOpacity: 0.45 } : null),
        }}
      />
    </svg>
  );
}
