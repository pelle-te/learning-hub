/* ============================================================
   features/registry.tsx — 탭 key → React 컴포넌트 매핑(lazy 코드분할 + hover 프리페치).
   탭 목록/순서/나브 메타는 shell/tabs.ts가 단일 원천. App이 라우트를 그릴 때 이 맵에서
   컴포넌트를 찾아 Suspense로 마운트한다(전 탭 React화 완료 — Phase 6).

   프리페치: lazy()는 import 썽크를 한 번 더 호출해도 모듈 캐시가 dedupe하므로,
   썽크를 보관해 두고 나브 hover/focus 시 미리 호출 → 탭 청크를 선로딩(Linear/Vercel급 즉시반응).
============================================================ */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** key → 동적 import 썽크(단일 원천). lazy 컴포넌트와 프리페치가 같은 썽크를 공유.
    export하는 이유: `test/invariants.test.ts`가 LOADERS 키 === TABS 키(shell/tabs.ts) 패리티를 검증한다.
    "탭 추가 = 2곳 한 줄"의 두 원천 사이 이음매를 자동으로 잠근다(한쪽만 추가 시 런타임 '알 수 없는 탭' 방지). */
export const LOADERS: Record<string, () => Promise<{ default: ComponentType }>> = {
  items: () => import('./items/Items'),
  goals: () => import('./goals/Goals'),
  guide: () => import('./guide/Guide'),
  reads: () => import('./reads/Reads'),
  markets: () => import('./markets/Markets'),
  atlas: () => import('./atlas/Atlas'),
  discovery: () => import('./discovery/Discovery'),
  today: () => import('./today/Today'),
  'plan-host': () => import('./plan-host/PlanHost'),
  schedule: () => import('./schedule/Schedule'),
  alloc: () => import('./alloc/Alloc'),
  routine: () => import('./routine/Routine'),
  journal: () => import('./journal/Journal'),
  review: () => import('./review/Review'),
  'review-run': () => import('./review-run/ReviewRun'),
  stats: () => import('./stats/Stats'),
  forecast: () => import('./forecast/Forecast'),
  degree: () => import('./degree/Degree'),
  settings: () => import('./settings/Settings'),
  integrations: () => import('./integrations/Integrations'),
  ledger: () => import('./ledger/Ledger'),
  control: () => import('./control/Control'),
  mastery: () => import('./mastery/Mastery'),
  graph: () => import('./graph/Graph'),
};

/** key → React 탭 컴포넌트(lazy). LOADERS를 1:1로 감싼다. */
const REACT_TABS: Record<string, LazyExoticComponent<ComponentType>> = Object.fromEntries(
  Object.entries(LOADERS).map(([key, loader]) => [key, lazy(loader)]),
);

/** 해당 탭의 React 구현(있으면 컴포넌트, 없으면 null). */
export function getReactTab(key: string): LazyExoticComponent<ComponentType> | null {
  return REACT_TABS[key] ?? null;
}

/** 이미 프리페치(또는 로드)한 key — 중복 import 호출 방지. */
const prefetched = new Set<string>();

/** 탭 청크를 미리 로딩(나브 hover/focus, 라우트 진입 직전). 실패는 무시(실제 진입 시 Suspense가 재시도). */
export function prefetchTab(key: string): void {
  if (prefetched.has(key)) return;
  const loader = LOADERS[key];
  if (!loader) return;
  prefetched.add(key);
  loader().catch(() => prefetched.delete(key));
}
