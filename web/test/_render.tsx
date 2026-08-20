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

/** 셸 전체(라우터 + 레일 + TopBar + lazy 탭). **셸을 검사할 때만** 쓴다. */
export function renderApp(initialPath = '/today', opts: RenderAppOptions = {}) {
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
