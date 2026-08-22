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
   소유한다(한 줄 요약: 리셋이 들어오면 트랙 A 시각 베이스라인이 전부 흔들려 "feature 단위 diff"
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
// H21 — 부팅 체인이 render 에 도달하지 못한 경우의 최후 화면. **의존 0** 이 그 모듈의 계약이다.
import { showBootFallback } from '@/lib/bootFallbackScreen';
/* W16 부팅 웨이브 ① — **엔트리 평가 시점**. 이 import 는 SD-7 계약에 안전하다(`lib/perf` 는
   의존 0 이라 `useApp` 모듈 평가를 유발하지 않는다 — 그게 이 파일의 정적 import 금지 규칙이다). */
import { mark as perfMark } from '@/lib/perf';

/* ⚠ `ThemeProvider` 를 **정적으로 import 하지 않는다** — 아래 계약이 그것 때문에 깨져 있었다.
   ThemeProvider 는 `useApp` 을 import 하고, ES import 는 호이스팅되므로 그 한 줄이 스토어를
   `initAppStore()` 가 시작하기도 **전에** 만들었다. 그러면 `preloadedState()` 가 아직 null 이라
   셸이 **SQLite 가 아니라 낡은 localStorage 로 부팅**한다(2단계-E 가 App 만 동적으로 바꾸고
   ThemeProvider 를 놓쳤다 · SD-6 작업 중 트랙 B 재시작 케이스가 이걸 잡았다).
   `queryClient` 는 안전하다 — `@tanstack/react-query` 만 import 한다(실측). */

function ShellFallback() {
  return (
    <div className="wrap">
      <div className="ds-well">
        <h2>앱을 시작하지 못했어요</h2>
        <p className="ds-tiny text-mut">새로고침하거나 ⋯ 메뉴 → 데이터 내보내기로 백업 후 점검하세요.</p>
      </div>
    </div>
  );
}

/* 다운그레이드 화면(C2 · 2026-07-26 감사) — **앱을 띄우지 않는다.**

   이 상태에서 정상 부팅시키면 DB 는 안 열리고 낡은 localStorage 로 떠서, 사용자는 정상으로
   보이는 앱에서 옛 데이터를 편집한다(= 신버전이 만든 정본과 갈라진다). 그래서 조용한 폴백이
   아니라 화면이고, 여기서 `App`·`ThemeProvider` 를 **import 하지 않는 것**이 방어의 일부다 —
   그 두 줄이 `useApp` 모듈 평가를 유발하고, 그러면 어떤 편집도 없이 쓰기 경로가 살아난다. */
function DowngradeScreen({
  applied,
  bundled,
  drifted,
}: {
  applied: number | null;
  bundled: number;
  drifted: number[];
}) {
  /* ⚠ **원인을 뭉치지 말 것**(I039). 두 상태의 처방이 다르다: 다운그레이드는 «업데이트해라»,
     드리프트는 «이 빌드로는 이 DB 를 못 연다 — 내보낸 파일에서 복구해라». 한 문장으로 합치면
     사용자는 업데이트를 기다리며 아무것도 못 한다. */
  if (drifted.length)
    return (
      <div className="wrap">
        <div className="ds-well">
          <h2>데이터 구조가 이 빌드와 달라요</h2>
          <p className="text-mut">
            저장소의 v{drifted.join(', v')} 구조가 지금 실행 중인 앱이 아는 것과 다릅니다. 이대로 열면 데이터가 갈리기
            때문에 시작을 멈췄어요 — <b>이 데이터를 만든 빌드</b>로 열어 내보내기 한 뒤, 이 빌드에서 가져오세요.
          </p>
          <p className="ds-tiny text-mut">
            개발 중이라면 마이그레이션 SQL 이 적용 후에 편집된 상태입니다(sqlx 는 체크섬으로 이를 거부합니다).
          </p>
        </div>
      </div>
    );
  return (
    <div className="wrap">
      <div className="ds-well">
        <h2>더 새 버전이 만든 데이터예요</h2>
        <p className="text-mut">
          이 데이터(v{applied})는 지금 실행 중인 앱(v{bundled})보다 새 버전이 만들었습니다. 구버전으로 열면 데이터가
          갈리기 때문에 시작을 멈췄어요 — <b>최신 버전으로 업데이트</b>한 뒤 다시 실행하세요.
        </p>
        <p className="ds-tiny text-mut">
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
/* ⚠⚠ **여기 전역 오류 훅(`installGlobalErrorHooks`)이 있었다 — 텔레메트리가 은퇴했다**
   (I052 · 2026-08-22 발상 축). 그 층이 잡던 것은 **렌더 밖 부팅 실패**이고, 그건 어떤
   `ErrorBoundary` 도 원리적으로 못 잡는다(`lib/utils.ts:84`). 즉 이 항목의 대체 경로
   («`ErrorBoundary` 가 화면에 스택을 그린다»)는 **React 트리 안만** 덮는다 — 부팅 경로는
   이제 콘솔뿐이고, 폰 브라우저에서는 아무 데도 안 남는다. 리포트가 이 항목의 근거를
   스스로 «약하다»고 적은 것이 이 대가 때문이다. */
perfMark('entry');

/* ⭐ **프런트 실패를 디스크로 잇는다**(O007 · 2026-08-22 운영 축). 바로 위 문단이 «부팅 경로는
   이제 콘솔뿐» 이라 적은 그 대가의 절반을 데스크톱에서 되돌린다 — Rust 는 릴리스에서 파일
   싱크를 이미 갖고 있었고 프런트만 거기 닿는 길이 없었다(`console.error` 38곳이 증발).
   ⚠ **`initAppStore()` 보다 먼저**여야 한다: 부팅 읽기 실패(`boot.ts:223`)가 이 다리가 나르려는
   대표 사례이고, 나중에 걸면 그 줄을 놓친다.
   ⚠ **await 하지 않는다** — 관측이 첫 페인트를 늦추면 안 된다. 셸이 아니면 즉시 반환하고,
   플러그인 로드 실패도 스스로 삼킨다(`lib/log.ts`).
   ⚠ 동적 import 는 SD-7 부팅 순서 계약이다(정적으로 끌면 그래프가 예측 불가해진다). */
void import('@/lib/log').then((m) => m.bridgeConsole());

void initAppStore()
  .catch((e: unknown) => console.error('[boot] initAppStore', e))
  .then(async () => {
    /* C2 — 다운그레이드면 여기서 끝난다(앱 모듈을 아예 안 부른다). */
    const down = dbDowngrade();
    if (down) {
      createRoot(document.getElementById('root')!).render(
        <StrictMode>
          <DowngradeScreen applied={down.applied} bundled={down.bundled} drifted={down.drifted} />
        </StrictMode>,
      );
      return;
    }
    await readCloudConfig()
      .then((cfg) => {
        setResumeDevice(cfg?.deviceId); // N-7 이어하기 커서 — 미연결이면 빈 값 = 전 경로 무동작
      })
      .catch(() => {});
    // 이 두 줄이 `useApp` 모듈 평가를 처음 유발한다 — 그래서 반드시 위 await 뒤여야 한다.
    const [{ default: App }, { default: ThemeProvider }, { warmTab }] = await Promise.all([
      import('@/app/App'),
      import('@/app/ThemeProvider'),
      import('@/features/registry'),
    ]);
    /* ⚠⚠ **부팅 260ms 를 없앤다**(2026-08-01 실측 · 근거 SSOT 는 `features/registry.warmTab` 머리주석).
       그 구간은 CPU 도 네트워크도 아니었다 — React 가 Suspense **폴백을 이미 커밋한 뒤** 깜빡임을
       피하려고 노출을 억제하는 `setTimeout(≈248ms)` 였다. 청크는 `modulepreload` 로 이미 와 있어
       113ms 에 준비되는데 360ms 까지 붙잡혔다. 첫 라우트의 lazy 를 **렌더 전에** 확정시키면
       폴백 자체가 안 뜨고 억제할 대상도 사라진다.
       ⚠ 라우트 키 산출은 `App.tsx:109` 와 **같은 식**이다(둘이 갈리면 엉뚱한 청크를 덥힌다).
       ⚠ `warmTab` 이 상한을 갖는다 — 최악이 "이득 없음"이지 "흰 화면"이 아니게. */
    await warmTab(window.location.pathname.split('/')[1] || 'today');
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        {/* ⚠ `onError` — 종전엔 폴백 UI 만 그리고 **아무것도 기록하지 않았다.** 셸 전체가
            죽는 가장 심각한 경우인데 그 사실이 어디에도 안 남았다(2026-07-25 감사). */}
        <ErrorBoundary FallbackComponent={ShellFallback} onError={(e: unknown) => console.error('[shell-boundary]', e)}>
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
  })
  /* ⚠⚠ **종단 catch — 없으면 청크 로드 실패가 영구 백지다(H21 · 2026-07-30 `/감사 근본`).**
     위 `await import('@/app/App')` 이 실패하면 `render()` 에 도달하지 못하고 `#root` 는 빈 div
     그대로다. `ShellFallback` 은 **자기가 렌더되지 못하는 트리 안에** 있어 정의상 못 잡는다 —
     즉 폴백이 있는데 이 경로만 폴백이 없었다. 근거·의존 0 계약은 그 모듈 머리주석이 SSOT. */
  .catch((e: unknown) => {
    console.error('[boot-chain]', e);
    showBootFallback(e);
  });
