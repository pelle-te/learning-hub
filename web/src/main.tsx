import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

// 토큰 레이어(tokens.css)를 전역 스타일보다 먼저 — 테마 CSS 변수 단일 원천(설계도 §2).
// 전역 디자인 시스템(.card/.kpi/.tl/.nav…)은 styles/global/(theme·base·components·features)로 분해.
import '@/styles/tokens.css';
import '@/styles/global/index.css';
/* Tailwind(C-7) — **preflight 없이** theme + utilities 만. 왜 없이인지는 `tw.css` 머리주석이
   소유한다(한 줄 요약: 리셋이 들어오면 스냅샷 59장이 전부 흔들려 "feature 단위 diff"
   전략이 첫 걸음에서 죽는다). 전역 CSS **뒤에** 온다 — 유틸리티가 이겨야 한다. */
import '@/styles/tw.css';
/* 공유 디자인 시스템(옛 CSS Module) — C-7 마지막 티어에서 전역 `ds-*` 로 승격.
   ⚠ 위치가 계약이다: 옛 import 도 여기(tw.css 뒤)였다. **언레이어드**라 유틸리티를 이기는데,
   그건 이식 전 CSS Module 이 갖던 관계 그대로다(근거는 `ds.css` 머리주석). */
import '@/styles/ds.css';

import { queryClient } from '@/lib/queryClient';
import { initAppStore, dbDowngrade } from '@/lib/db/boot';
import { readCloudConfig } from '@/lib/cloud/client';
import { setResumeDevice } from '@/lib/resume';
import { collectWebVitals, initTelemetry, installGlobalErrorHooks, reportError } from '@/lib/telemetry';

/* ⚠ `ThemeProvider` 를 **정적으로 import 하지 않는다** — 아래 계약이 그것 때문에 깨져 있었다.
   ThemeProvider 는 `useApp` 을 import 하고, ES import 는 호이스팅되므로 그 한 줄이 스토어를
   `initAppStore()` 가 시작하기도 **전에** 만들었다. 그러면 `preloadedState()` 가 아직 null 이라
   셸이 **SQLite 가 아니라 낡은 localStorage 로 부팅**한다(2단계-E 가 App 만 동적으로 바꾸고
   ThemeProvider 를 놓쳤다 · SD-6 작업 중 트랙 B 재시작 케이스가 이걸 잡았다).
   `queryClient` 는 안전하다 — `@tanstack/react-query` 만 import 한다(실측). */

function ShellFallback() {
  return (
    <div className="wrap">
      <div className="ds-card">
        <h2>앱을 시작하지 못했어요</h2>
        <p className="ds-muted ds-tiny">새로고침하거나 ⋯ 메뉴 → 데이터 내보내기로 백업 후 점검하세요.</p>
      </div>
    </div>
  );
}

/* 다운그레이드 화면(C2 · 2026-07-26 감사) — **앱을 띄우지 않는다.**

   이 상태에서 정상 부팅시키면 DB 는 안 열리고 낡은 localStorage 로 떠서, 사용자는 정상으로
   보이는 앱에서 옛 데이터를 편집한다(= 신버전이 만든 정본과 갈라진다). 그래서 조용한 폴백이
   아니라 화면이고, 여기서 `App`·`ThemeProvider` 를 **import 하지 않는 것**이 방어의 일부다 —
   그 두 줄이 `useApp` 모듈 평가를 유발하고, 그러면 어떤 편집도 없이 쓰기 경로가 살아난다. */
function DowngradeScreen({ applied, bundled }: { applied: number | null; bundled: number }) {
  return (
    <div className="wrap">
      <div className="ds-card">
        <h2>더 새 버전이 만든 데이터예요</h2>
        <p className="ds-muted">
          이 데이터(v{applied})는 지금 실행 중인 앱(v{bundled})보다 새 버전이 만들었습니다. 구버전으로 열면 데이터가
          갈리기 때문에 시작을 멈췄어요 — <b>최신 버전으로 업데이트</b>한 뒤 다시 실행하세요.
        </p>
        <p className="ds-muted ds-tiny">
          이 앱은 다운그레이드를 지원하지 않습니다. 되돌려야 한다면 최신 버전에서 먼저 데이터를 내보내세요.
        </p>
      </div>
    </div>
  );
}

/* 2단계-E — 스토어를 **마운트 전에** 준비한다.
   셸에선 SQLite 가 정본이라 읽기가 비동기인데, 하이드레이션 게이트(기본값으로 먼저 렌더 후 교체)를
   쓰면 "하이드레이션 전 쓰기가 기본값으로 실데이터를 덮는" 실패 모드가 새로 생긴다(0단계-E에서
   물린 부류). 마운트 전 await 는 그 창 자체를 없앤다.
   ⚠ `initAppStore()` 는 어떤 이유로도 throw 하지 않는다 — 실패하면 localStorage 폴백으로 뜬다.
   그래도 방어적으로 catch 한다: 여기서 던지면 앱이 영구 백지가 되고 ShellFallback 도 못 잡는다.
   `useApp` 은 이 시점 이후에 import 돼야 한다(모듈 평가 시점에 부팅값을 읽으므로 순서가 계약). */
/* 관측(2026-07-25) — **전역 훅부터 건다.** 아래 부팅은 렌더 밖이라 어떤 `ErrorBoundary` 도
   못 잡는데(`lib/utils.ts:84` 가 같은 사실을 적어 뒀다), 지금까지 그쪽이 조용히 죽는 층이었다.
   `initTelemetry` 로 전송처를 켜기 전에는 훅이 수집만 하고 아무것도 보내지 않는다 —
   순서가 이래야 부팅 **자체**의 실패도 잡힌다(전송처는 부팅 뒤에야 알 수 있다). */
installGlobalErrorHooks();

void initAppStore()
  .catch((e: unknown) => reportError(e, 'initAppStore'))
  .then(async () => {
    /* C2 — 다운그레이드면 여기서 끝난다(앱 모듈을 아예 안 부른다). */
    const down = dbDowngrade();
    if (down) {
      createRoot(document.getElementById('root')!).render(
        <StrictMode>
          <DowngradeScreen applied={down.applied} bundled={down.bundled} />
        </StrictMode>,
      );
      return;
    }
    /* 전송처는 클라우드 설정에서 온다. 미연결이면 `null` → 전 경로 무동작(설계 원칙 ③). */
    await readCloudConfig()
      .then((cfg) => {
        initTelemetry(cfg?.baseUrl ?? null, 'shell');
        setResumeDevice(cfg?.deviceId); // N-7 이어하기 커서 — 미연결이면 빈 값 = 전 경로 무동작
      })
      .catch(() => {});
    collectWebVitals();
    // 이 두 줄이 `useApp` 모듈 평가를 처음 유발한다 — 그래서 반드시 위 await 뒤여야 한다.
    const [{ default: App }, { default: ThemeProvider }] = await Promise.all([
      import('@/app/App'),
      import('@/app/ThemeProvider'),
    ]);
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        {/* ⚠ `onError` — 종전엔 폴백 UI 만 그리고 **아무것도 기록하지 않았다.** 셸 전체가
            죽는 가장 심각한 경우인데 그 사실이 어디에도 안 남았다(2026-07-25 감사). */}
        <ErrorBoundary FallbackComponent={ShellFallback} onError={(e) => reportError(e, 'shell-boundary')}>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <ThemeProvider>
                <App />
              </ThemeProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </ErrorBoundary>
      </StrictMode>,
    );
  });
