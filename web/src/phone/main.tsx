/* ============================================================
   phone/main.tsx — 폰 웹앱 진입점(C-6). `web/phone.html` 이 이 파일을 문다.

   ## 데스크톱 `main.tsx` 와 다른 점 셋

   1. **`enableBrowserDb()` 를 부른다** — 이 스위치가 없으면 `getDb()` 는 브라우저에서
      null 이다. 기본을 꺼 둔 이유는 `npm run dev` 와 트랙 A(스냅샷 59장)가 localStorage
      경로를 쓰기 때문이다(`db/sqlite.ts` 주석). **폰만 켠다.**
   2. **localStorage → SQLite 이관을 안 한다**(`initPhoneStore`). 폰에 옮길 레거시 정본이 없다.
   3. **라우터·QueryClient 를 안 싣는다.** 폰은 탭이 둘이고 읽기 전용 산출물을 안 본다.

   ⚠ 순서가 계약이다: `enableBrowserDb()` → `initPhoneStore()` → **그다음** `useApp` 을
   import 하는 모듈을 로드한다. `useApp` 은 모듈 평가 시점에 부팅값을 읽으므로, 먼저
   import 되면 빈 상태로 굳는다(데스크톱 `main.tsx` 가 같은 이유로 동적 import 를 쓴다).
============================================================ */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';

import '@/styles/tokens.css'; // 색의 단일 원천 — Tailwind `@theme` 가 이걸 가리킨다
import './phone.css';

import { enableBrowserDb } from '@/lib/db/sqlite';
import { initPhoneStore } from '@/lib/db/boot';
import { readCloudConfig } from '@/lib/cloud/client';

function Fallback(): React.JSX.Element {
  return (
    <main className="p-6">
      <h1 className="text-base font-semibold text-txt">앱을 시작하지 못했어요</h1>
      <p className="mt-2 text-sm text-mut">
        새로고침해 보세요. 계속 안 되면 PC 에서 이 기기를 폐기하고 다시 연결하세요.
      </p>
    </main>
  );
}

enableBrowserDb();

/* 서비스워커 등록 — **폰에서만** 한다(`injectRegister: null` 이라 자동 주입이 없다).
   데이터는 OPFS SQLite 에 있지만 **앱 껍데기가 없으면 아무것도 안 뜬다** — 지하철에서
   여는 경우가 이 앱의 실사용이라 그 차이가 크다. 등록 실패는 삼킨다: SW 는 부가 기능이고,
   없다고 앱이 못 뜨면 안 된다(사설 브라우징·구형 브라우저에서 실패할 수 있다). */
void import('virtual:pwa-register').then((m) => m.registerSW({ immediate: true })).catch(() => {});

void initPhoneStore()
  .catch(() => {})
  .then(async () => {
    const [{ default: PhoneApp }, { default: Connect }, { installSyncTriggers }] = await Promise.all([
      import('./PhoneApp'),
      import('./Connect'),
      import('./sync'),
    ]);
    const connected = (await readCloudConfig()) !== null;
    const root = createRoot(document.getElementById('root')!);

    const render = (ok: boolean): void => {
      if (ok) installSyncTriggers();
      root.render(
        <StrictMode>
          <ErrorBoundary FallbackComponent={Fallback}>
            {ok ? <PhoneApp /> : <Connect onDone={() => render(true)} />}
          </ErrorBoundary>
        </StrictMode>,
      );
    };
    render(connected);
  });
