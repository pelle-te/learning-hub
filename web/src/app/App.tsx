import { Suspense, useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { orderedTabs, ToastHost, ModalHost, NAV_SHORTCUTS } from '@/shell';
import TopBar from '@/app/TopBar';
import RailSidebar from '@/app/RailSidebar';
import { getReactTab, prefetchTab } from '@/features/registry';
import CommandPalette from '@/components/CommandPalette';
import SubTabs from '@/app/SubTabs';
import ShortcutsHelp from '@/components/ShortcutsHelp';
import OnlineStatus from '@/components/OnlineStatus';
import TooltipHost from '@/components/Tooltip';
import { HudFrame } from '@/components/hud';
import { SkeletonCard, Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import s from './App.module.css';

/** 포커스가 입력 요소(텍스트 편집)에 있으면 전역 단일키 단축키를 무시. */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

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
  // 단일 화면 대시보드 탭(데모 v6 사상) — 프레임을 가득 채우고 내부 스크롤 없음.
  const FILL_TABS = ['/', '/today', '/schedule', '/stats', '/journal', '/review'];
  const fillFrame = FILL_TABS.includes(pathname);
  const tabs = orderedTabs();
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

  return (
    <div className={s.shell}>
      {/* 스크린리더/키보드 사용자가 매 탭마다 네비를 통과하지 않도록 본문으로 바로 점프(포커스 전엔 시각 숨김). */}
      <a href="#main" className="skip-link">
        본문 바로가기
      </a>
      <RailSidebar />
      {/* 본문 컬럼 — TopBar(고정) + 라우트 본문(HudFrame 안에서 흐름). */}
      <div className={s.col}>
        <TopBar onOpenPalette={() => setPaletteOpen(true)} />
        {/* 라우트 본문 = 페이지의 주 콘텐츠 → <main> 랜드마크. 스킵 링크 타깃(tabIndex=-1로 프로그램 포커스). */}
        <main id="main" tabIndex={-1} className={s.main}>
          <HudFrame fill={fillFrame}>
            <Routes>
              <Route path="/" element={<Navigate to="/today" replace />} />
              {tabs.map((t) => {
                const ReactTab = getReactTab(t.key);
                return (
                  <Route
                    key={t.key}
                    path={'/' + t.key}
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
              })}
              <Route path="*" element={<Navigate to="/today" replace />} />
            </Routes>
          </HudFrame>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <OnlineStatus />
      <ToastHost />
      <ModalHost />
      <TooltipHost />
    </div>
  );
}
