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
  mistakes: () => import('./mistakes/Mistakes'),
  questions: () => import('./questions/Questions'),
  items: () => import('./items/Items'),
  /* ⚠ `goals`·`guide` 가 여기서 빠졌다(W9 · 2026-08-06). 둘 다 **은퇴**했고, 은퇴한 탭은
     자기 라우트가 없다(불변식 ②가 그것을 요구한다 — 화면이 다른 곳에 흡수됐다는 뜻이므로).
     화면 코드는 살아 있고 흡수한 호스트가 `lazy` 로 띄운다:
       goals → `degree`(`?view=path`) · guide → `find`(`?view=guide`)
     ⚠⚠ **`reads`·`markets`·`discovery`·`atlas`·`control` 은 은퇴가 아니라 _제거_ 다**(P10 W4 ·
     2026-08-07). 흡수한 호스트가 없다 — 다른 필러(`survey/`)로 갔다. 강등과 혼동하지 말 것:
     강등은 같은 앱 안에서 자리를 옮기는 것이라 코드가 살아야 하지만, 이건 **이사**라 두 벌이 된다. */
  find: () => import('./find/Find'),
  today: () => import('./today/Today'),
  schedule: () => import('./schedule/Schedule'),
  alloc: () => import('./alloc/Alloc'),
  journal: () => import('./journal/Journal'),
  review: () => import('./review/Review'),
  'review-run': () => import('./review-run/ReviewRun'),
  stats: () => import('./stats/Stats'),
  forecast: () => import('./forecast/Forecast'),
  degree: () => import('./degree/Degree'),
  settings: () => import('./settings/Settings'),
  integrations: () => import('./integrations/Integrations'),
  ledger: () => import('./ledger/Ledger'),
  mastery: () => import('./mastery/Mastery'),
};

/** key → React 탭 컴포넌트(lazy). LOADERS를 1:1로 감싼다. */
const REACT_TABS: Record<string, LazyExoticComponent<ComponentType>> = Object.fromEntries(
  Object.entries(LOADERS).map(([key, loader]) => [key, lazy(loader)]),
);

/* 부팅에 **미리 확정된** 탭 — `lazy` 가 아니라 평범한 컴포넌트다(아래 `warmTab` 머리주석).
   ⚠ 여기 들어간 키는 렌더 중 컴포넌트 **identity 가 바뀌면 안 된다**(바뀌면 React 가 remount 해
   그 탭의 상태가 날아간다). 그래서 채우는 곳은 `warmTab` 하나이고, 그건 **첫 렌더 전에 한 번만**
   불린다(`main.tsx`). hover 프리페치(`prefetchTab`)가 여길 채우지 않는 이유도 그것이다 — 그건
   이미 렌더 중일 수 있다. */
const warmed = new Map<string, ComponentType>();

/** 해당 탭의 React 구현(있으면 컴포넌트, 없으면 null). */
export function getReactTab(key: string): LazyExoticComponent<ComponentType> | ComponentType | null {
  return warmed.get(key) ?? REACT_TABS[key] ?? null;
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

/* ============================================================
   warmTab — `prefetchTab` 의 **기다리는** 짝. 부팅 경로 하나가 쓴다.

   ## ⚠⚠ 왜 필요한가 — 부팅 260ms 의 정체는 React 의 Suspense 억제였다 (2026-08-01 실측)

   `boot:app→first-data` 가 **260ms** 였고 그 구간에 **네트워크 요청 0 · 롱태스크 0 · CPU 91.6%가
   idle** 이었다. 즉 아무 일도 안 하면서 기다리고 있었다. 타이머를 계측해 범인을 특정했다 —
   `app` 직후 React 가 거는 **`setTimeout(≈248ms)` 두 개**(스택: react 청크의 Suspense 재시도 경로)다.

   React 는 Suspense **폴백이 이미 커밋된 뒤** 콘텐츠가 준비되면, 깜빡임을 피하려고 노출을 일정
   시간 **억제**한다(just-noticeable-difference). 그런데 이 앱의 부팅에서는 그 전제가 성립하지
   않는다: 탭 청크는 `modulepreload` 로 **이미 받아져 있어** 113ms 에 준비되고, React 가 그걸
   360ms 까지 붙잡는다. **깜빡임을 막는 장치가 깜빡임의 원인 그 자체**가 되어 있었다.

   그래서 청크를 쪼개도 KB 를 깎아도 이 수치가 **1ms 도 안 움직였다** — 바이트 문제가 아니었다.

   → 처방은 억제를 끄는 것이 아니라(불가능하고, 다른 화면에서는 옳은 동작이다) **폴백이 뜨지
   않게** 하는 것이다.

   ## ⚠⚠ 그런데 "청크를 미리 받아 두기"만으로는 **안 된다** — 실측으로 기각된 1차 처방

   먼저 `loader()` 를 await 한 뒤 렌더해 봤다. **간격이 1ms 도 안 줄었다**(260 → 260). 이유는
   `React.lazy` 의 계약에 있다: 모듈이 이미 브라우저 캐시에 있어도 **첫 렌더에서 무조건 한 번
   throw** 한다 — 이미 이행된 프라미스를 동기로 읽을 방법이 없기 때문이다. 즉 폴백은 뜨고,
   억제도 그대로다. **모듈 캐시를 덥히는 것과 React 에게 "이미 있다"고 말하는 것은 다른 일이다.**

   → 그래서 `warmTab` 은 캐시를 덥히는 데서 그치지 않고 **해석된 컴포넌트를 `warmed` 에 넣는다.**
   `getReactTab` 이 그걸 먼저 보므로 첫 라우트는 `lazy` 를 **아예 거치지 않는다** — 던질 것이
   없으니 폴백도, 억제도 없다.

   ⚠ **상한을 둔다.** 청크가 느리거나 실패하면 기다리다 흰 화면을 보여 주게 되는데, 그건 지금보다
   나쁘다. 상한을 넘기면 그냥 진행해 **종전 동작(스켈레톤 + Suspense)** 으로 정확히 되돌아간다 —
   즉 이 최적화의 최악은 "이득이 없음"이지 "회귀"가 아니다.
   ⚠ 키가 `LOADERS` 에 없으면(`/subject/:id`·`/mini`·오타 딥링크) 즉시 통과한다.
============================================================ */
const WARM_CAP_MS = 1500;

export function warmTab(key: string): Promise<void> {
  const loader = LOADERS[key];
  if (!loader) return Promise.resolve();
  prefetched.add(key);
  return Promise.race([
    loader().then(
      (m) => {
        warmed.set(key, m.default);
      },
      () => {
        prefetched.delete(key); // 실패 → `lazy` 경로가 그대로 남아 Suspense 가 재시도한다.
      },
    ),
    new Promise<void>((res) => setTimeout(res, WARM_CAP_MS)),
  ]);
}
