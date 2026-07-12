import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { orderedTabs, tabByKey, ToastHost, ModalHost, NAV_SHORTCUTS } from '@/shell';
import { useUI } from '@/store/useUI';
import { isTyping } from '@/lib/interactions';
import TopBar from '@/app/TopBar';
import RailSidebar from '@/app/RailSidebar';
import BootRecovery from '@/app/BootRecovery';
import { routeTitle } from '@/app/docTitle';
import { getReactTab, prefetchTab } from '@/features/registry';
import CommandPalette from '@/components/CommandPalette';
import SubTabs from '@/app/SubTabs';
import ShortcutsHelp from '@/components/ShortcutsHelp';
import OnlineStatus from '@/components/OnlineStatus';
import TooltipHost from '@/components/Tooltip';
import AmbientCanvas from '@/components/AmbientCanvas';
import { HudFrame } from '@/components/hud';
import { SkeletonCard, Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import s from './App.module.css';

/* 탭 렌더 중 한 탭이 던져도 앱이 안 죽게 — 라우트별 에러 경계(설계도 §3). */
function TabFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className={ds.card}>
      <h2>이 탭에서 오류가 발생했어요</h2>
      <p className={`${ds.muted} ${ds.tiny}`}>{String((error as Error)?.message || error)}</p>
      <Button variant="primary" sm onClick={resetErrorBoundary}>
        다시 시도
      </Button>
    </div>
  );
}

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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
            element={
              <ErrorBoundary FallbackComponent={TabFallback} resetKeys={[t.key]}>
                <SubTabs tabKey={t.key} />
                {ReactTab ? (
                  <Suspense fallback={<SkeletonCard />}>
                    <ReactTab />
                  </Suspense>
                ) : (
                  <div className={ds.card}>알 수 없는 탭: {t.key}</div>
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
  useEffect(() => {
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
        setPaletteOpen((v) => !v);
        return;
      }
      // 단일키 단축키는 수정자/입력 포커스/팔레트 열림 시 무시
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping() || paletteOpen) return;

      if (e.key === '?') {
        e.preventDefault();
        clearG();
        setHelpOpen((v) => !v);
        return;
      }
      // [ / ] — 이전/다음 탭 순환(숨김 탭 제외). 현재 경로는 이벤트 시점 값을 직접 읽어 stale 방지.
      if (e.key === '[' || e.key === ']') {
        const visible = orderedTabs().filter((t) => !t.hidden);
        const cur = window.location.pathname.replace(/^\//, '') || 'today';
        let i = visible.findIndex((t) => t.key === cur);
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
  }, [navigate, paletteOpen]);

  // 팔레트 '키보드 단축키 보기' 명령 → 도움말 열기(헤더 변경 없이 이벤트로 연결).
  useEffect(() => {
    const open = () => setHelpOpen(true);
    window.addEventListener('lh:open-shortcuts', open);
    return () => window.removeEventListener('lh:open-shortcuts', open);
  }, []);

  // SPA 라우트 전환을 문서 제목에 반영 — 탭마다 별개 '페이지'처럼 동작하는데도 제목이 '러닝허브'
  // 고정이던 문제(WCAG 2.4.2). document.title은 외부 시스템이라 effect가 적법(아나운서 텍스트는 파생).
  useEffect(() => {
    document.title = routeTitle(pathname); // FocusChip 세션 종료 복원과 공유하는 단일 출처(X-9).
  }, [pathname]);

  return (
    <div className={s.shell + (navCollapsed ? ' ' + s.navCollapsed : '')}>
      {/* 앰비언트 배경 — WebGL 오로라 메시(콘텐츠 뒤) + 그 위 필름 그레인. 깊이·"비싼" 질감. */}
      <AmbientCanvas />
      <div className={s.ambient} aria-hidden="true" />
      {/* 스크린리더/키보드 사용자가 매 탭마다 네비를 통과하지 않도록 본문으로 바로 점프(포커스 전엔 시각 숨김). */}
      <a href="#main" className="skip-link">
        본문 바로가기
      </a>
      {/* 라우트 아나운서 — 뷰 전환을 스크린리더에 polite로 알림(시각 숨김). document.title과 짝. */}
      <div className={s.srLive} role="status" aria-live="polite">
        {routeLabel}
      </div>
      <RailSidebar />
      {/* 본문 컬럼 — TopBar(고정) + 라우트 본문(HudFrame 안에서 흐름). */}
      <div className={s.col}>
        <TopBar onOpenPalette={() => setPaletteOpen(true)} />
        {/* 라우트 본문 = 페이지의 주 콘텐츠 → <main> 랜드마크. 스킵 링크 타깃(tabIndex=-1로 프로그램 포커스). */}
        <main id="main" tabIndex={-1} className={s.main}>
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
      <ToastHost />
      <ModalHost />
      <TooltipHost />
    </div>
  );
}
