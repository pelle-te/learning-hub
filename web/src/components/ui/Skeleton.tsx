import { Card } from './Card';
import styles from './Skeleton.module.css';

/** 단일 스켈레톤 줄. width로 폭을, height로 높이를 조절. */
export function Skeleton({ width, height }: { width?: string | number; height?: string | number }) {
  return <div className={styles.line} style={{ width, height }} aria-hidden="true" />;
}

/** 여러 줄 스켈레톤(제목 + 본문 라인들). lines로 본문 줄 수 조절. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className={styles.stack}>
      <Skeleton width="42%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </div>
  );
}

/** 탭 청크 로딩용 카드형 스켈레톤(Suspense 폴백 표준). */
export function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <Card>
      <SkeletonText lines={lines} />
    </Card>
  );
}
