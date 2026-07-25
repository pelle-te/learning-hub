import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import {
  orderedTabs,
  tabByKey,
  destinations,
  surfaceOf,
  hostTabKey,
  ToastHost,
  ModalHost,
  NAV_SHORTCUTS,
  vtMove,
} from '@/shell';
import { useUI } from '@/store/useUI';
import { useOverlay } from '@/store/useOverlay';
import { isTyping } from '@/hooks/interactions';
import TopBar from '@/app/TopBar';
import RailSidebar from '@/app/RailSidebar';
import BootRecovery from '@/app/BootRecovery';
import StorageGuard from '@/app/StorageGuard';
import { routeTitle } from '@/app/docTitle';
import { reportError } from '@/lib/telemetry';
import { getReactTab, prefetchTab } from '@/features/registry';
import CommandPalette from '@/components/CommandPalette';
import SubTabs from '@/app/SubTabs';
import ShortcutsHelp from '@/components/ShortcutsHelp';
import OnlineStatus from '@/components/OnlineStatus';
import TooltipHost from '@/components/Tooltip';
import AmbientCanvas from '@/components/AmbientCanvas';
import { HudFrame } from '@/components/hud';
import { SkeletonCard, Button } from '@/components/ui';

/* 탭 렌더 중 한 탭이 던져도 앱이 안 죽게 — 라우트별 에러 경계(설계도 §3). */
function TabFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="ds-card">
      <h2>이 탭에서 오류가 발생했어요</h2>
      <p className="ds-muted ds-tiny">{String((error as Error)?.message || error)}</p>
      <Button variant="primary" sm onClick={resetErrorBoundary}>
        다시 시도
      </Button>
    </div>
  );
}

/* 지연 로드 탭의 로딩 상태 — 스켈레톤은 **눈에만** 보인다. 스크린리더에는 라우트 아나운서가
   탭 이름을 읽어 준 뒤 아무 일도 일어나지 않는 정적이 흐른다(느린 첫 진입에서 특히 길다).
   role=status 한 줄로 "불러오는 중"을 알리고, 뜬 뒤엔 그 노드가 사라져 다시 조용해진다. */
function TabLoading() {
  return (
    <>
      <span className="sr-only" role="status">
        탭을 불러오는 중
      </span>
      <SkeletonCard />
    </>
  );
}

export default function App() {
  const paletteOpen = useOverlay((s) => s.palette);
  const setPaletteOpen = useOverlay((s) => s.setPalette);
  const helpOpen = useOverlay((s) => s.help);
  const setHelpOpen = useOverlay((s) => s.setHelp);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // 현재 라우트 메타는 pathname의 순수 파생(별도 state 불필요) — 렌더마다 계산해 아나운서/제목/프레임에 쓴다.
  // 첫 경로 세그먼트 = 기저 탭 key(중첩 라우트 /atlas/:key 대응 — 라벨·fill·나브 활성이 기저 탭을 따르게).
  const routeKey = pathname.split('/')[1] || 'today';
  const routeLabel = tabByKey(routeKey)?.label ?? '';
  // 단일 화면 대시보드 탭(프레임을 가득 채우고 내부 스크롤 없음) 여부는 TabMeta.fill 단일 원천에서 파생 —
  // 옛 하드코딩 FILL_TABS 목록이 TabMeta와 별개 SSOT로 표류하던 문제(L-15) 해소.
  const fillFrame = tabByKey(routeKey)?.fill ?? false;
  const tabs = orderedTabs();
  // C-8: 라우트 엘리먼트 트리는 불변 TABS의 순수 파생 → 1회만 생성(⌘K 토글·매 내비마다 15개 재구축 방지).
  // tabs 참조는 모듈 상수(ORDERED_TABS)라 안정 — deps에 둬도 재생성 안 함.
  const routeEls = useMemo(
    () =>
      tabs.map((t) => {
        const ReactTab = getReactTab(t.key);
        return (
          <Route
            key={t.key}
            path={t.key === 'atlas' ? '/atlas/*' : '/' + t.key}
            /* ⚠ `onError` — 탭 하나가 죽어도 셸은 살아 있어 사용자가 다른 탭으로 넘어간다.
               그래서 이 경계의 사고는 **특히 조용히 지나간다**(2026-07-25 감사). 어느 탭이
               죽었는지를 컨텍스트로 싣는다 — 그게 없으면 스택만 보고 화면을 못 특정한다. */
            element={
              <ErrorBoundary
                FallbackComponent={TabFallback}
                resetKeys={[t.key]}
                onError={(e) => reportError(e, `tab:${t.key}`)}
              >
                <SubTabs tabKey={t.key} />
                {ReactTab ? (
                  <Suspense fallback={<TabLoading />}>
                    <ReactTab />
                  </Suspense>
                ) : (
                  <div className="ds-card">알 수 없는 탭: {t.key}</div>
                )}
              </ErrorBoundary>
            }
          />
        );
      }),
    [tabs],
  );
  const navCollapsed = useUI((st) => st.ui.navCollapsed);
  const gPending = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 전역 단축키: ⌘K/Ctrl+K 팔레트 · '?' 도움말 · 'g'+키 탭 이동(입력 중엔 단일키 무시).
  // ⚠ 오버레이 상태는 **구독이 아니라 getState 로** 읽는다 — deps 에 넣으면 팔레트를 열고 닫을
  //   때마다 document 리스너가 떼였다 붙는다(예전엔 `paletteOpen` 이 deps 에 있었다).
  useEffect(() => {
    const ov = useOverlay.getState();
    const navMap = new Map(NAV_SHORTCUTS.map((s) => [s.seq, s.tab]));
    const clearG = () => {
      gPending.current = false;
      if (gTimer.current) clearTimeout(gTimer.current);
    };
    const onKey = (e: KeyboardEvent) => {
      // ⌘K/Ctrl+K — 입력 중에도 동작(팔레트 토글)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        clearG();
        ov.togglePalette();
        return;
      }
      // 단일키 단축키는 수정자/입력 포커스/팔레트 열림 시 무시
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping() || useOverlay.getState().palette) return;

      if (e.key === '?') {
        e.preventDefault();
        clearG();
        ov.toggleHelp();
        return;
      }
      /* [ / ] — 이전/다음 도달점 순환. 현재 경로는 이벤트 시점 값을 직접 읽어 stale 방지.
         ⚠ D-4: **레일과 같은 목록**(`destinations(표면)`)을 돈다. 예전엔 `!t.hidden` 전역
         목록이라 학습 화면에서 `]` 를 누르면 레일에 없는 자료 탭으로 조용히 새어 나갔고,
         `settings` 는 레일엔 있는데 링에만 없었다. 링이 곧 레일이라는 계약이 이제 코드다.
         세그먼트(lens)에 있을 땐 그 **호스트** 위치에서 도는 것이 링의 뜻과 맞다. */
      if (e.key === '[' || e.key === ']') {
        const cur = window.location.pathname.replace(/^\//, '') || 'today';
        const visible = destinations(surfaceOf(hostTabKey(cur)) ?? useUI.getState().ui.navSurface);
        let i = visible.findIndex((t) => t.key === hostTabKey(cur));
        if (i < 0) i = 0;
        const n = e.key === ']' ? (i + 1) % visible.length : (i - 1 + visible.length) % visible.length;
        e.preventDefault();
        clearG();
        navigate('/' + visible[n]!.key, { viewTransition: true });
        return;
      }
      if (gPending.current) {
        const tab = navMap.get(e.key.toLowerCase());
        clearG();
        if (tab) {
          e.preventDefault();
          navigate('/' + tab, { viewTransition: true });
        }
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        gPending.current = true;
        NAV_SHORTCUTS.forEach((s) => prefetchTab(s.tab)); // 시퀀스 시작 → 후보 탭 선로딩(즉시 전환)
        if (gTimer.current) clearTimeout(gTimer.current);
        gTimer.current = setTimeout(() => (gPending.current = false), 1200); // 시퀀스 시간창
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      clearG();
    };
  }, [navigate]);

  /* ── D-8 전이의 방향 ──────────────────────────────────────────────────
     `<html data-vt>` 를 세우면 `motion.css` 가 그 값에 맞는 전이를 고른다. 판정은 순수
     함수(`shell/vt.vtMove`)가 `tabs.ts` 의 order·세그먼트 관계에서 뽑으므로 **호출부 22곳은
     한 줄도 안 바뀐다**(그 자리에 방향을 적기 시작하면 즉시 특례가 번식한다).

     ⚠ `useLayoutEffect` 인 것이 핵심이다. React Router 의 `viewTransition` 은
     `startViewTransition(cb)` 안에서 DOM 을 갱신하고, 레이아웃 이펙트는 그 커밋과 같은
     동기 구간에서 돈다 — 즉 **전이 애니가 시작되기 전**에 속성이 선다. `useEffect` 로 두면
     한 박자 늦어 첫 프레임을 놓친다(그리고 그 어긋남은 조용하다). */
  const prevPath = useRef(pathname);
  useLayoutEffect(() => {
    const from = prevPath.current;
    prevPath.current = pathname;
    if (from === pathname) return;
    const move = vtMove(from, pathname);
    const el = document.documentElement;
    el.dataset.vt = move.kind;
    if (move.dir) el.dataset.vtDir = move.dir;
    else delete el.dataset.vtDir;
  }, [pathname]);

  // SPA 라우트 전환을 문서 제목에 반영 — 탭마다 별개 '페이지'처럼 동작하는데도 제목이 '러닝허브'
  // 고정이던 문제(WCAG 2.4.2). document.title은 외부 시스템이라 effect가 적법(아나운서 텍스트는 파생).
  useEffect(() => {
    document.title = routeTitle(pathname); // FocusChip 세션 종료 복원과 공유하는 단일 출처(X-9).
  }, [pathname]);

  return (
    <div
      className={`relative isolate grid h-screen transition-[grid-template-columns] duration-200 ease-[var(--ease)] max-mobile:h-auto max-mobile:min-h-screen max-mobile:grid-cols-1 ${navCollapsed ? 'grid-cols-shell-collapsed' : 'grid-cols-shell'}`}
    >
      {/* 앰비언트 배경 — WebGL 오로라 메시(콘텐츠 뒤) + 그 위 필름 그레인. 깊이·"비싼" 질감.
          그레인: fixed·z-[-1]·pointer 무시 · 노이즈 data-URI(--grain 토큰)를 overlay 로 4% 얹음. */}
      <AmbientCanvas />
      <div
        className="pointer-events-none fixed inset-0 z-[-1] bg-[image:var(--grain)] opacity-[0.04] mix-blend-overlay"
        aria-hidden="true"
      />
      {/* 스크린리더/키보드 사용자가 매 탭마다 네비를 통과하지 않도록 본문으로 바로 점프(포커스 전엔 시각 숨김). */}
      <a href="#main" className="skip-link">
        본문 바로가기
      </a>
      {/* 라우트 아나운서 — 뷰 전환을 스크린리더에 polite로 알림(시각 숨김). document.title과 짝. */}
      <div className="sr-only" role="status" aria-live="polite">
        {routeLabel}
      </div>
      <RailSidebar />
      {/* 본문 컬럼 — TopBar(고정) + 라우트 본문(HudFrame 안에서 흐름). */}
      <div className="flex h-screen min-w-0 flex-col overflow-hidden max-mobile:h-auto max-mobile:min-h-screen max-mobile:overflow-visible max-mobile:pb-16">
        <TopBar />
        {/* 라우트 본문 = 페이지의 주 콘텐츠 → <main> 랜드마크. 스킵 링크 타깃(tabIndex=-1로 프로그램 포커스). */}
        <main
          id="main"
          tabIndex={-1}
          className="flex min-h-0 flex-1 px-6.5 pt-0 pb-6.5 focus:outline-none max-mobile:px-3 max-mobile:pb-6"
        >
          <HudFrame fill={fillFrame} scrollResetKey={pathname}>
            <Routes>
              <Route path="/" element={<Navigate to="/today" replace />} />
              {routeEls}
              <Route path="*" element={<Navigate to="/today" replace />} />
            </Routes>
          </HudFrame>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <OnlineStatus />
      <BootRecovery />
      <StorageGuard />
      <ToastHost />
      <ModalHost />
      <TooltipHost />
    </div>
  );
}
