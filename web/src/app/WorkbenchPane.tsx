/* ============================================================
   WorkbenchPane — **N-13 작업대**(W9 · 2026-08-07). 옆에 한 화면을 붙든다.

   ## 왜

   이 앱은 화면 하나만 보여 준다. 그런데 실제 작업은 **오간다** — 배분을 고치며 오늘을 보고,
   오답을 적으며 그 챕터를 본다. 지금 그 왕복은 alt-tab 도 아니고 *같은 앱 안에서 화면을 갈아
   치우는 것*이라, 돌아올 때마다 스크롤·펼침·커서가 초기화된다(그리고 무엇을 보러 갔는지도
   잊는다). 붙들어 두면 그 왕복이 **시선 이동**이 된다.

   ## ⚠ 새 화면을 만들지 않는다 — **있는 화면을 하나 더 마운트**한다

   이 저장소는 "새 표면"을 다섯 번 강등했다. 여기서 는 것은 표면이 아니라 **자리**다: 라우트도
   레일 칸도 안 늘고, 페인은 기존 `features/registry` 의 같은 컴포넌트를 그대로 띄운다.

   ## ⚠ 두 벌이 되는 것 셋과 그 처방

   ① **상단 크롬** — 전역 스토어 하나라 옆 화면이 덮어쓴다 → `ChromeMuteProvider` 로 끈다.
   ② **라우터** — 페인의 `?view=`·`:ds` 가 주소창을 갈아 치우면 안 된다 → **`MemoryRouter`**
      로 자기 히스토리를 준다(주 라우터와 완전히 분리 · 페인 안의 이동은 페인 안에 머문다).
   ③ **키보드 소유권** — 목록 훅이 이미 포커스로 판정한다(`useListCursor` 규칙 ①②③).

   ## ⚠ 폐기 조건이 붙어 있다

   로드맵 N-13 의 판정 자료는 W2 홉 원장의 **왕복쌍**이다. A↔B 로 오간 흔적이 롱테일이면 이
   기능은 지운다 — 그 수는 `설정 → 방문 원장` 이 보여 준다. 지금 만드는 이유는 5회차가 세운
   규율("`⏳` 는 *못 만든다*가 아니라 *판정을 못 한다* — 틀은 만들고 폐기 조건만 관측 대기") 이고,
   무엇을 만들지는 관측과 무관하게 정해져 있었다(붙드는 것은 **아무 화면이나**다).
============================================================ */
import { Suspense, lazy, type ComponentType } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { LOADERS } from '@/features/registry';
import { tabByKey } from '@/shell/tabs';
import { ChromeMuteProvider } from '@/store/usePageChrome';
import { useOverlay } from '@/store/useOverlay';
import State from '@/components/State';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';

/** 경로에서 탭 key 를 뽑는다(`/day/2026-08-01?x=1` → `day`). */
export function benchTabKey(path: string): string {
  return (path.split('?')[0] || '').split('/')[1] || '';
}

/* lazy 컴포넌트는 **모듈 로드 때 한 번** 만든다(렌더 중이 아니라).
   ⚠ 렌더 중에 `lazy()` 를 부르면 그때마다 새 컴포넌트 타입이 나와 페인이 매 렌더 언마운트·
   재마운트되고, 붙들어 둔 스크롤·펼침이 초기화된다 — 이 기능의 존재 이유가 정확히 그것이라
   조용한 자기부정이 된다(린트 `react-hooks/static-components` 가 그 자리에서 잡았다).
   ⚠ `lazy()` 자체는 **아무것도 안 받아온다** — 실제 import 는 그 컴포넌트가 처음 렌더될 때
   일어난다. 그래서 이 표를 미리 만들어도 번들·네트워크 비용이 0이다. */
const PANES: Record<string, ComponentType> = Object.fromEntries(
  Object.entries(LOADERS).map(([k, load]) => [k, lazy(load) as unknown as ComponentType]),
);

export default function WorkbenchPane() {
  const bench = useOverlay((s) => s.bench);
  const setBench = useOverlay((s) => s.setBench);
  const key = bench ? benchTabKey(bench) : '';
  const meta = key ? tabByKey(key) : undefined;
  const Comp = key ? PANES[key] : null;
  if (!bench || !Comp) return null;

  const label = meta?.label ?? key;
  return (
    /* ⚠ `<aside>` 다 — `<main>` 안의 **보조** 콘텐츠이고, 스크린리더가 주 화면과 구분할 수 있어야
       한다(이름 없는 두 번째 영역은 "어디가 어디인지"를 통째로 지운다). */
    <aside
      aria-label={`작업대 — ${label}`}
      /* ⚠ 표면은 **`ds-*` 넷 중 하나**여야 한다(원칙 ④ · `check:tokens` 가 새 파일에서 그것을
         막는다 — 실제로 이 파일의 첫 판이 `rounded-lg border bg-panel` 로 걸렸다). 왼쪽 헤어라인
         하나가 두 페인을 가르는 데 충분하고, 그게 이 앱이 `Integrations` 우측 판에서 쓰는 관용구다. */
      className="ml-3.5 flex w-bench max-w-bench min-w-bench flex-col overflow-hidden border-l border-line2 pl-3.5 max-wide:hidden"
    >
      <div className="flex flex-none items-center gap-2 border-b border-line2 px-3 py-2">
        <Icon name={meta?.icon ?? 'file'} />
        <span className="ds-caps mb-0! min-w-0 flex-1 truncate">{label}</span>
        <Button sm variant="ghost" onClick={() => setBench(null)} aria-label="작업대 닫기">
          ✕
        </Button>
      </div>
      <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-auto">
        <ChromeMuteProvider value={true}>
          <ErrorBoundary
            fallbackRender={(p) => (
              <State
                kind="error"
                title={`${label} 를 못 그렸어요`}
                desc={String(p.error)}
                next={{ terminal: '닫고 다시 열어 보세요.' }}
              />
            )}
          >
            {/* ⚠ 자기 히스토리(위 ②). 주 라우터의 주소는 이 안의 이동에 **흔들리지 않는다**. */}
            <MemoryRouter initialEntries={[bench]}>
              <Suspense fallback={<State kind="loading" title={`${label} 여는 중…`} />}>
                <Routes>
                  <Route path={`/${key}`} element={<Comp />} />
                  {meta?.altRoute && <Route path={meta.altRoute} element={<Comp />} />}
                  {/* 매개변수 경로를 못 맞춘 경우에도 화면은 뜬다 — 빈 페인보다 낫다. */}
                  <Route path="*" element={<Comp />} />
                </Routes>
              </Suspense>
            </MemoryRouter>
          </ErrorBoundary>
        </ChromeMuteProvider>
      </div>
    </aside>
  );
}
