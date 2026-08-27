/* ============================================================
   test/_render.tsx — **컴포넌트 테스트의 렌더 헬퍼 한 벌**(2026-08-20 리뷰 M-12).

   ## 왜 생겼나

   `renderApp()` 12줄이 **17개 파일에 문자 그대로 복사**돼 있었다(인자 이름만 `initialPath`/`path`
   로 갈렸다). 그건 단순 복붙이 아니라 **비용**이었다 — 탭 하나를 검사하려고 라우터 + 레일 +
   TopBar + 오버레이 + 부팅 이펙트 + lazy 청크 로드를 매번 돌린다.

   그 대가를 저장소가 이미 지불했다: `test/_setup.ts` 가 `asyncUtilTimeout` 을 5배로 늘리고
   `vitest.config.ts` 가 `testTimeout` 을 맞춰 놓았으며, 그 파일이 근본 처방을 *"케이스 다수를
   고쳐야 하고, 그건 이 커밋의 범위가 아니다"* 로 유예했다.

   ⚠ **그 진단이 반쪽이다.** 원인은 "Suspense 를 안 기다린다"가 아니라 **Suspense 를 탈 필요가
   없는 검사가 `App` 을 통과한다**는 것이다. 반례가 같은 트리에 있다 — `allocBoard.test.tsx` 는
   feature 를 직접 렌더하고 42케이스를 역할/라벨 질의로만 잠근다(lazy 0 · QueryClient 0).

   ## 어느 것을 쓰나

   · `renderApp(path)`  — **셸 자체**(라우팅·레일·활성 표기·오버레이)를 검사할 때만.
   · `renderTab(ui)`    — 그 외 전부. 라우터·쿼리만 두르고 feature 를 직접 렌더한다.

   새 컴포넌트 테스트는 기본이 `renderTab` 이다. `renderApp` 을 고르려면 "이 케이스가 셸을
   실제로 검사하는가"에 답할 수 있어야 한다.
============================================================ */
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';

/** ⚠ 케이스마다 새 클라이언트다 — 공유하면 앞 케이스의 캐시가 뒤 케이스의 로딩 상태를 지운다. */
const qc = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false } } });

export interface RenderAppOptions {
  /** 렌더 전에 쿼리 캐시를 심는다 — 외부 데이터 탭이 fetch 없이 성공 상태로 뜨게 할 때. */
  seed?: (client: QueryClient) => void;
  /** 라우터 location state(딥링크가 상태를 실어 보내는 경로). */
  state?: unknown;
}

/**
 * 셸 전체(라우터 + 레일 + TopBar + lazy 탭). **셸을 검사할 때만** 쓴다.
 *
 * ⭐⭐ **`await` 가 필요하다 — 렌더 전에 탭 청크를 덥힌다**(P051 · 2026-08-28 코드 축).
 *
 * ## 왜 — 게이트가 머신 부하에 종속돼 있었다
 *
 * 첫 라우트가 `React.lazy` 라 이 헬퍼는 **Suspense 를 탄다**. v8 커버리지 계측이 붙으면 그 청크의
 * import+평가가 길어져 RTL 의 `findBy*` 대기 예산을 넘긴다. 2026-07-30 이 그 부류를 진단하며
 * 예산을 1,000 → 5,000 ms 로 올렸는데 **두 번째로 흘러내렸다**: 2026-08-28 실측에서 같은 트리를
 * 다섯 번 돌려 실패 파일이 **8 · 7 · 5 · 4 · 1 · 0** 으로 매번 달랐다(옆에서 도는 브라우저가
 * CPU 97% 를 쓰는 동안 vitest import 가 136 s → 236 s). 단독 실행은 전부 통과한다.
 *
 * ⚠ 진짜 대가는 빨간불이 아니라 **판별 비용**이다 — 실패를 보고 자기 변경을 의심해 `git stash`
 * 로 두 번 확인해야 했고(베이스라인도 같은 부하에서 8개가 떨어졌다) 그게 한 시간이었다.
 *
 * ## 왜 예산을 또 올리지 않는가
 *
 * 예산의 상대는 **옆에서 도는 것**이라 얼마를 줘도 넘길 수 있다. 두 번 올려 두 번 흘러내린 노브를
 * 세 번째로 올리는 것은 처방이 아니다. 대기가 원인이므로 **대기를 없앤다.**
 * ⭐ 새 발명이 아니다 — `main.tsx` 가 부팅에서 하는 그대로다(`warmTab` 으로 첫 라우트의 lazy 를
 * 렌더 전에 확정 · 2026-08-01 의 260 ms 이자 P028 이 진입점을 고친 자리). 테스트가 제품의 부팅
 * 의미론을 따르게 한 것뿐이다.
 *
 * ⚠⚠ **`test/_setup.ts` 에서 전역으로 덥히지 마라 — 시도했고 8개가 깨졌다.** 레지스트리를 import
 * 하면 `useApp` 모듈이 평가되고, 그건 SD-7 부팅 순서 계약을 깬다(`main.tsx` 가 명시적으로 금지하는
 * 그것). `dbBoot`·`bootRecovery` 계열이 정확히 그 순서를 검사한다. 이 자리는 안전하다 — 그 여덟은
 * `renderApp` 을 쓰지 않는다.
 * ⚠ 덥히기 실패는 삼킨다: 그러면 **옛 경로(Suspense 대기)로 그대로 돌아간다**.
 */
export async function renderApp(initialPath = '/today', opts: RenderAppOptions = {}) {
  /* 라우트 키 산출은 `main.tsx`·`App.tsx` 와 **같은 식**이다(갈리면 엉뚱한 청크를 덥힌다). */
  await import('@/features/registry').then((m) => m.warmTab(initialPath.split('/')[1] || 'today')).catch(() => {});
  const client = qc();
  opts.seed?.(client);
  const entry = opts.state === undefined ? initialPath : { pathname: initialPath, state: opts.state };
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * 라우터·쿼리만 두르고 feature 를 **직접** 렌더한다 — `App`(레일·TopBar·부팅 이펙트·lazy)을
 * 안 태운다. 그래서 Suspense 대기가 없고 `asyncUtilTimeout` 예산도 안 쓴다.
 *
 * @param path 라우트에 의존하는 화면(`useParams`·`useSearchParams`)이면 준다.
 */
export function renderTab(ui: ReactElement, path = '/') {
  return render(
    <QueryClientProvider client={qc()}>
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider>{ui}</ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
