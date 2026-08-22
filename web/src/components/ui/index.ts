/* 공용 UI 프리미티브 배럴 — features가 `@/components/ui`에서 가져온다.
   boundaries: components는 lib만 import 가능(store/features 금지) → 전부 순수 프레젠테이션. */
export { Card } from './Card';
export { Button, type ButtonVariant } from './Button';
export { Pill, type PillTone } from './Pill';
export { Kpi, KpiGrid, type KpiTone } from './Kpi';
export { ProgressBar } from './ProgressBar';
export { Table } from './Table';
/* ⚠ `Skeleton`·`SkeletonText` 는 **배럴로 내보내지 않는다**(2026-08-23 · knip 6.32).
   소비처가 전부 `./Skeleton` 에서 직접 가져가므로 여기 재수출은 남아도는 입구였다 —
   입구가 둘이면 «어느 쪽이 정본인가»가 흐려진다(이 저장소가 반복해 모아 온 형태). */
export { SkeletonCard, SkeletonFill } from './Skeleton';
export { NumberField } from './NumberField';
