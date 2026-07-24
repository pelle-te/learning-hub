import { Card } from './Card';

/* Skeleton — 콘텐츠 로딩 자리표시. 탭 청크가 로드되는 짧은 순간 "불러오는 중…" 텍스트 대신
   레이아웃 형태를 미리 보여줘 체감 지연을 줄이고 레이아웃 시프트를 막는다.

   ── C-7 마지막 티어 이식(Tailwind) ─────────────────────────────────────────
   색 두 단계와 그라데이션은 `tokens.css` 로 올렸다(옛 `.line` 지역 변수 → 절대규칙 #3).
   ⚠ `200% 100%`(background-size)와 그라데이션은 임의값으로 못 적는다(내부 `%` 가 룰에 걸린다)
   → 토큰 이름으로 참조한다(`--grain`·`--acc-fill` 과 같은 관용구).
   키프레임은 전역(`tw.css`) — CSS Modules 가 이름을 스코프해 유틸에서 못 부르던 제약의 잔재다. */
const LINE =
  'h-3.25 rounded-sm bg-sk-base bg-[image:var(--bg-skeleton)] bg-[length:var(--bg-size-skeleton)] animate-[sk-shimmer_1.2s_var(--ease)_infinite] motion-reduce:animate-none';
const STACK = 'space-y-2.75';

/** 단일 스켈레톤 줄. width로 폭을, height로 높이를 조절. */
export function Skeleton({ width, height }: { width?: string | number; height?: string | number }) {
  return <div className={LINE} style={{ width, height }} aria-hidden="true" />;
}

/** 여러 줄 스켈레톤(제목 + 본문 라인들). lines로 본문 줄 수 조절. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className={STACK}>
      <Skeleton width="42%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </div>
  );
}

/** 탭 청크 로딩용 카드형 스켈레톤(Suspense 폴백 표준).
 *  스켈레톤 줄은 aria-hidden(장식)이라 스크린리더엔 침묵 → role="status" SR 안내로 로딩을 알린다. */
export function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <Card>
      <span role="status" className="sr-only">
        불러오는 중…
      </span>
      <SkeletonText lines={lines} />
    </Card>
  );
}
