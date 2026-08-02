import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import {
  orderedTabs,
  tabByKey,
  routeLabelOf,
  destinations,
  hostTabKey,
  ToastHost,
  ModalHost,
  NAV_SHORTCUTS,
  vtMove,
} from '@/shell';
import { useUI } from '@/store/useUI';
import { useOverlay } from '@/store/useOverlay';
import { useFocus } from '@/store/useFocus';
import { isTyping } from '@/hooks/interactions';
import { useVaultAnchorsVersion } from '@/hooks/useVaultAnchors';
import { useLeaveCursor } from './useLeaveCursor';
import { useFrameMemory } from './useFrameMemory';
import { useTaskbarBadge } from './useTaskbarBadge';
import { useDailyReminder } from './useDailyReminder';
import { useMarkSeen } from './useMarkSeen';
import TopBar from '@/app/TopBar';
import RailSidebar from '@/app/RailSidebar';
import BootRecovery from '@/app/BootRecovery';
import MiniHud from '@/app/MiniHud';
import { MINI_PATH, enterMini } from '@/lib/miniMode';
import { singleKeyBlocked } from '@/shell/keyGate';
import StorageGuard from '@/app/StorageGuard';
import VaultSync from '@/app/VaultSync';
import StorageBanner from '@/app/StorageBanner';
import { routeTitle } from '@/app/docTitle';
import { reportError } from '@/lib/telemetry';
import { markVia, recordVisit, takeVia } from '@/lib/visits';
import { onGlobalCapture } from '@/lib/tauri';
import { mark as perfMark } from '@/lib/perf';
import { getReactTab, prefetchTab } from '@/features/registry';
/* ⚠ 팔레트·단축키 도움말은 **앱 크롬**이다(H10 · 2026-07-26 감사). `components/` 에 있던 동안
   `components → @/shell → store` 라는, 허용표상 금지인 경로가 배럴 한 칸을 거쳐 통과했다 —
   `components` 는 재사용 프리미티브(무상태에 가깝게)라는 계약을 그 둘이 애초에 만족하지 않았다
   (App 만 렌더하고, 액션·스토어·IPC 를 문다). 자리를 사실에 맞추면 계약 위반이 사라진다. */
import CommandPalette from '@/app/CommandPalette';
import SubTabs from '@/app/SubTabs';
import ShortcutsHelp from '@/app/ShortcutsHelp';
import OnlineStatus from '@/components/OnlineStatus';
import TooltipHost from '@/components/Tooltip';
import AmbientCanvas from '@/components/AmbientCanvas';
import { HudFrame } from '@/components/hud';
import { SkeletonCard, SkeletonFill, Button } from '@/components/ui';

/* W12 객체 축 — **탭이 아니라 라우트**라 `features/registry` 의 `LOADERS` 밖이다(그 표는
   탭↔컴포넌트 패리티를 불변식으로 잠그므로, 탭이 아닌 것을 넣으면 그 잠금이 거짓이 된다). */
const SubjectPage = lazy(() => import('@/features/items/Subject'));

/* 탭 렌더 중 한 탭이 던져도 앱이 안 죽게 — 라우트별 에러 경계(설계도 §3).

   ⚠ N-4 — **어느 탭이 죽었는지를 화면에도 적는다.** 22개 탭이 같은 폴백 한 장을 공유해서
   "이 탭"이 어느 탭인지 말하지 않았는데, 셸은 멀쩡히 살아 있고 나브도 그대로라 사용자는
   무엇이 고장났는지 알 수 없었다(그래서 이 경계의 사고는 특히 조용히 지나간다).
   `reportError` 는 이미 `tab:<key>` 컨텍스트를 싣고 있었다 — 화면만 그 사실을 몰랐다. */
function TabFallback({ error, resetErrorBoundary, label }: FallbackProps & { label: string }) {
  return (
    <div className="ds-well">
      <h2>{label ? `‘${label}’ 탭에서 오류가 발생했어요` : '이 탭에서 오류가 발생했어요'}</h2>
      <p className="ds-tiny text-mut">{String((error as Error)?.message || error)}</p>
      <Button variant="primary" sm onClick={resetErrorBoundary}>
        다시 시도
      </Button>
    </div>
  );
}

/* 지연 로드 탭의 로딩 상태 — 스켈레톤은 **눈에만** 보인다. 스크린리더에는 라우트 아나운서가
   탭 이름을 읽어 준 뒤 아무 일도 일어나지 않는 정적이 흐른다(느린 첫 진입에서 특히 길다).
   role=status 한 줄로 "불러오는 중"을 알리고, 뜬 뒤엔 그 노드가 사라져 다시 조용해진다.

   ⚠ N-4 — 골격은 **착지할 화면의 모양을 따라간다.** 종전엔 fill 탭 16개에도 카드 한 장을
   띄워서, 프레임 상단의 작은 카드가 화면 전체로 갈아 끼워지는 레이아웃 점프가 매 진입마다
   났다(스켈레톤이 막으려던 현상을 스켈레톤이 만들고 있었다). 판정은 `TabMeta.fill` 단일
   원천에서 온다 — 여기서 탭 목록을 다시 세면 그 순간 두 번째 SSOT 가 생긴다. */
function TabLoading({ fill, tabKey }: { fill: boolean; tabKey: string }) {
  return (
    <>
      <span className="sr-only" role="status">
        탭을 불러오는 중
      </span>
      {/* Q-16 — 청크가 아직 없는 이 순간이 형상 기억이 값을 내는 유일한 자리다(Skeleton.tsx 주석). */}
      {fill ? <SkeletonFill tabKey={tabKey} /> : <SkeletonCard />}
    </>
  );
}

/* W16 부팅 웨이브 ③ — **첫 탭이 실제로 마운트된 시점**(스켈레톤이 아니라).
   Suspense **안**에 있어야 의미가 있다: 폴백이 떠 있는 동안엔 이 이펙트가 안 돈다.
   ⚠ 어느 라우트든 첫 마운트 1회만 찍힌다(`perf.mark` 가 중복을 버린다) — 딥링크로 들어와도
   같은 정의가 성립한다("사용자가 요청한 화면이 데이터로 그려졌다"). */
function TabReady({ children }: { children: React.ReactNode }) {
  useEffect(() => perfMark('firstData'), []);
  return children;
}

export default function App() {
  const paletteOpen = useOverlay((s) => s.palette);
  const setPaletteOpen = useOverlay((s) => s.setPalette);
  const helpOpen = useOverlay((s) => s.help);
  const setHelpOpen = useOverlay((s) => s.setHelp);
  const navigate = useNavigate();
  /* 볼트 앵커(W2)는 스토어가 아니라 모듈 레지스트리라 **아무도 다시 그리지 않았다**(H7).
     공통 조상 하나가 구독해 그 아래를 전부 덮는다 — 근거는 `hooks/useVaultAnchors.ts` 머리주석. */
  useVaultAnchorsVersion();
  const { pathname } = useLocation();
  // 현재 라우트 메타는 pathname의 순수 파생(별도 state 불필요) — 렌더마다 계산해 아나운서/제목/프레임에 쓴다.
  // 첫 경로 세그먼트 = 기저 탭 key(중첩 라우트 /atlas/:key 대응 — 라벨·fill·나브 활성이 기저 탭을 따르게).
  const routeKey = pathname.split('/')[1] || 'today';
  const routeLabel = routeLabelOf(routeKey); // H27 — 탭이 아닌 라우트도 아나운서가 말한다
  /* Q-27 — **떠날 때 1회** 이어하기 커서를 남긴다. 탭 이동마다가 아니다(원 주석의 우려는
     그것이었고 이 훅은 그걸 안 한다). 공통 조상 하나가 걸어야 전 화면이 덮인다. */
  useLeaveCursor(routeLabel);
  /* Q-16 — 성공 렌더의 형상(리드아웃 수·앵커 유무)을 기억해 **다음 진입의 뼈대**가 그 화면을
     닮게 한다. 여기 있는 이유는 `useLeaveCursor` 와 같다(라우트와 스토어가 여기서만 만난다). */
  useFrameMemory(routeKey);
  /* Q-30 — 작업표시줄 배지. 레일 배지와 **같은 식**을 쓴다(그 훅 머리주석이 이유의 SSOT). */
  useTaskbarBadge();
  /* T-6 — 예약 한 발(하루 최대 1회). 배지와 **같은 수**를 쓴다: 셋이 갈리면 알림이 3 이라 하고
     레일이 5 라 하는 상태가 생긴다. 상주(T-3)가 켜져 있어야 앱을 안 여는 날에도 뜬다. */
  useDailyReminder();
  /* T-13 — "지난번 이후". 이 화면을 오늘 봤다고 기기-로컬로 표시한다.
     ⚠ 여기 있는 이유는 `useLeaveCursor`·`useFrameMemory` 와 같다(라우트가 스토어를 만나는 유일한
     자리). ⚠ 델타를 **여기서 계산하지 않는다** — 판정은 `lib/since` 가 소유하고, 소음 문턱을
     넘으면 표식을 아예 안 준다(그 파일 머리주석이 그 규율의 SSOT). */
  useMarkSeen(routeKey);
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
                fallbackRender={(p) => <TabFallback {...p} label={t.label} />}
                resetKeys={[t.key]}
                onError={(e) => reportError(e, `tab:${t.key}`)}
              >
                <SubTabs tabKey={t.key} />
                {ReactTab ? (
                  <Suspense fallback={<TabLoading fill={!!t.fill} tabKey={t.key} />}>
                    <TabReady>
                      <ReactTab />
                    </TabReady>
                  </Suspense>
                ) : (
                  <div className="ds-well">알 수 없는 탭: {t.key}</div>
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

  /* 전역(OS) 캡처 단축키(E20) — 앱이 포커스가 아닐 때도 캡처 입구가 열린다.
     Rust 가 창을 띄우고 포커스한 뒤 "눌렸다"만 보내고, **무엇을 열지는 여기서 정한다** →
     ⌘K 팔레트를 연다(새 라우트·새 창 0 · 되돌리기는 이 블록 삭제 한 번).
     ⚠ 셸이 아니면 구독이 no-op 이라 브라우저·트랙 A 에 영향이 0 이다. */
  /* W16 부팅 웨이브 ② — App 청크가 실제로 마운트된 시점. `main.tsx` 가 `App` 을 **동적으로**
     부르는 것은 최적화가 아니라 부팅 순서 계약(SD-7)이라, 그 구간이 얼마나 걸리는지는 정적
     번들 그래프(`npm run budget` ①축)가 원리적으로 못 본다 — H14 가 그 사각에서 14.7 KB gz 이
     새던 것을 잡은 자리이고, 여기는 그 **시간 쪽 짝**이다. */
  useEffect(() => perfMark('app'), []);

  /* ⚠ W9 — **착지가 문맥에 의존한다.** 이 핫키의 유일한 값 구간은 "집중 세션 중"인데
     (`hotkey.rs:39-41` 이 그렇게 못박았다) 그 구간의 창은 대개 320×92 알약이다. 그런데
     착지는 무조건 `setPalette(true)` 였고 `CommandPalette` 는 항상 렌더되므로 **풀사이즈
     팔레트가 알약 뷰포트 안에서** 떴다(게다가 MiniHud 는 H11 포커스 트랩 상태다).
     새 라우트는 만들지 않는다 — 알약이 그 자리에서 캡처 한 줄로 바뀐다(MiniHud 내부 모드).
     ⚠ 리스너는 한 번만 붙는다 → 경로는 **구독이 아니라 ref** 로 읽는다(아래 keydown 과 같은 규율). */
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  useEffect(() => {
    let off: (() => void) | null = null;
    let dead = false;
    /* ── Q-26 캡처 착지 — **창을 복원하지 않고 알약으로 받는다**(2026-08-02) ──────────────
       종전엔 핫키가 1440×900 창을 복원했다. 한 줄을 적어 두려고 눌렀는데 화면 전체가 뜨고
       레일·리드아웃·오늘 계획이 통째로 눈에 들어온다 — 그건 캡처가 아니라 **문맥 전환**이고,
       핫키가 지키려던 집중을 핫키가 깨뜨리는 형태다.

       ⚠⚠ **집중 세션 중에만 그렇게 한다.** `hotkey.rs` 머리주석이 실측으로 못박은 범위가 그것이고
       (_"값이 나오는 구간은 집중 세션 중"_), 그 파일이 **드롭했다고 적은 것은 `/capture` 라는 새
       상시 인박스 라우트**다 — 여기서 하는 것은 새 라우트가 아니라 **`/mini` 기하 재사용**이다.
       닫힌 결정을 다시 여는 것이 아니라 그 결정이 남긴 좁은 값을 제대로 착지시키는 것이다.
       ⚠ 세션이 없으면 착지할 알약이 없다 → 종전 그대로 팔레트. 미니 진입이 실패해도 같다
       (작아지지 않았는데 알약 화면만 뜨는 반쪽 상태 금지 — `lib/miniMode` 가 세운 규율). */
    const land = () => {
      const o = useOverlay.getState();
      if (pathRef.current === MINI_PATH) return o.setMiniCapture(true);
      if (!useFocus.getState().session) return o.setPalette(true);
      const from = pathRef.current;
      void enterMini(from, true).then((ok) => {
        if (!ok) return o.setPalette(true);
        navigate(MINI_PATH, { replace: true });
        o.setMiniCapture(true);
      });
    };
    void onGlobalCapture(land).then((f) => {
      // ⚠ 언마운트가 구독 완료보다 빠를 수 있다 — 그때 바로 떼지 않으면 리스너가 샌다.
      if (dead) f();
      else off = f;
    });
    return () => {
      dead = true;
      off?.();
    };
    /* ⚠ `navigate` 를 deps 에 넣지 않는다 — react-router 가 그것을 안정 참조로 보장하지 않아
       넣으면 라우팅마다 **전역 핫키 구독이 떼였다 붙는다**(IPC 왕복 포함). 바로 아래 전역
       단축키 이펙트가 같은 이유로 오버레이 상태를 `getState` 로 읽는다 — 같은 규율이다. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      /* ⌘Z/Ctrl+Z — **전역 되돌리기**(근본① · 2026-08-01). 되돌릴 것이 없으면 그쪽이 말한다.
         ⚠ **입력 중에는 안 뺏는다**(`isTyping()`). 글자를 치는 중의 ⌘Z 는 브라우저의 텍스트
           되돌리기이고, 그걸 가로채면 사용자는 *한 글자*를 되돌리려다 **직전 편집 전체**를
           되돌리게 된다 — 되돌리기를 두려운 키로 만드는 가장 빠른 길이다.
         ⚠⚠ **Shift 조합(⌘⇧Z = 다시 실행)이 2026-08-02 에 붙었다**(Q-8). 종전 주석은 _"다시
           실행은 이번 범위 밖이고, 여기서 삼키면 아무 일도 안 일어나는 키가 된다"_ 였다 — 그
           판단은 옳았고, 이제 **실제로 무언가 일어나므로** 잡는다. 되돌리기만 있으면 사용자는
           되돌리기 자체를 회피한다(잘못 되돌리면 복구가 없다). */
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        if (isTyping()) return;
        e.preventDefault();
        clearG();
        const shift = e.shiftKey;
        void import('@/store/undoController').then((m) => (shift ? m.redoLastEdit() : m.undoLastEdit()));
        return;
      }
      /* Q-12 내비 스택 — Alt+←/→ 로 왔던 길을 오간다(`TopBar` 의 `‹ ›` 와 같은 동작).
         ⚠ **입력 중에도 잡는다**(`isTyping()` 가드 없음): Alt+화살표는 텍스트 편집 관용구가
           아니라 내비게이션 관용구이고(Windows 탐색기·브라우저가 같은 키), 여기서 안 잡으면
           브라우저가 잡아 **같은 일**을 한다 — 즉 가로채도 잃는 것이 없다.
         ⚠ 라우터 히스토리를 그대로 쓴다. 자체 스택을 만들면 딥링크·⌘K·리다이렉트가 만든
           이동을 놓쳐서 "뒤로"가 사용자가 기억하는 순서와 갈린다. */
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        clearG();
        navigate(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      /* 단일키 단축키는 수정자 조합이거나 **떠 있는 층이 하나라도 있으면** 무시한다.
         ⚠ 판정은 `shell/keyGate` 하나가 소유한다(H10~H11) — 여기 조건을 늘리면 새 오버레이가
         생길 때마다 목록이 갈린다(실제로 `help` 는 아무도 안 보고 있었다). 근거는 그 파일. */
      if (e.metaKey || e.ctrlKey || e.altKey || singleKeyBlocked(window.location.pathname)) return;

      if (e.key === '?') {
        e.preventDefault();
        clearG();
        ov.toggleHelp();
        return;
      }
      /* [ / ] — 이전/다음 도달점 순환. 현재 경로는 이벤트 시점 값을 직접 읽어 stale 방지.
         ⚠ D-4: **레일과 같은 목록**(`destinations()`)을 돈다. 예전엔 `!t.hidden` 전역 목록이라
         학습 화면에서 `]` 를 누르면 레일에 없는 자료 탭으로 조용히 새어 나갔고, `settings` 는
         레일엔 있는데 링에만 없었다. 링이 곧 레일이라는 계약이 이제 코드다.
         ⚠ N-6 이후 이 함수는 인자를 안 받는다 — 표면이 사라져 "어느 표면의 목록인가"라는
         질문 자체가 없어졌고, 그와 함께 링↔레일이 서로 다른 표면을 보던 마지막 틈도 닫혔다.
         세그먼트(lens)에 있을 땐 그 **호스트** 위치에서 도는 것이 링의 뜻과 맞다. */
      if (e.key === '[' || e.key === ']') {
        const cur = window.location.pathname.replace(/^\//, '') || 'today';
        const visible = destinations();
        let i = visible.findIndex((t) => t.key === hostTabKey(cur));
        if (i < 0) i = 0;
        const n = e.key === ']' ? (i + 1) % visible.length : (i - 1 + visible.length) % visible.length;
        e.preventDefault();
        clearG();
        markVia('key');
        navigate('/' + visible[n]!.key, { viewTransition: true });
        return;
      }
      if (gPending.current) {
        const tab = navMap.get(e.key.toLowerCase());
        clearG();
        if (tab) {
          e.preventDefault();
          markVia('key');
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

  /* ── N-11 방문 원장 ───────────────────────────────────────────────────
     계수는 **여기 한 곳**이다. 22개 내비게이션 호출부에 기록을 흩으면 새 링크가 생길 때마다
     빠뜨리고, 빠진 것은 0 으로 보인다(없는 것과 안 센 것이 구분되지 않는다). 호출부는
     `markVia` 힌트만 남기고, 힌트가 없으면 `link` 로 떨어진다 — 누락이 오분류이지 유실이 아니다.

     ⚠ 첫 마운트는 `boot` 다(= 딥링크이거나 그냥 앱을 연 것). 그 둘을 구분하려면 라우트가
     기본값인지를 봐야 하는데, 기본 경로로 딥링크하는 것도 가능해 구분이 원리적으로 흐리다 —
     한 칸으로 두고 그 사실을 이름으로 말한다.

     ⚠ `await` 하지 않는다. 관측이 내비게이션을 늦추면 관측 대상이 관측 때문에 달라진다.
     브라우저(dev·트랙 A)에선 `recordVisit` 이 통째로 무동작이다. */
  const firstVisit = useRef(true);
  useEffect(() => {
    const via = firstVisit.current ? 'boot' : takeVia('link');
    firstVisit.current = false;
    void recordVisit(routeKey, via);
  }, [pathname, routeKey]);

  return (
    <div
      className={`relative isolate grid h-screen transition-[grid-template-columns] duration-base ease-[var(--ease)] max-mobile:h-auto max-mobile:min-h-screen max-mobile:grid-cols-1 ${navCollapsed ? 'grid-cols-shell-collapsed' : 'grid-cols-shell'}`}
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
        {/* 정본 저장소 실패의 지속 표시(C1) — 정상 경로·브라우저에선 null 이라 레이아웃 영향 0. */}
        <StorageBanner />
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
              {/* 미니 HUD(N-8) — 본문은 비운다. 화면은 셸을 덮는 오버레이가 그리고, 이 자리는
                  `*` 리다이렉트에 잡혀 /today 로 튕기지 않게 라우트를 **존재하게** 하는 몫이다
                  (탭이 아니라 나브·팔레트·g단축키엔 안 뜬다). */}
              <Route path={MINI_PATH} element={null} />
              {/* ⚠ **옛 `/graph` 딥링크 보존**(P-19 · 2026-08-01). 탭은 은퇴했지만 화면은
                  `/items` 의 뷰로 살아 있다 — 리다이렉트가 없으면 `*` 가 `/today` 로 튕겨
                  "탭을 없앤 대가로 도달성을 잃는" 형태가 된다(북마크·문서 링크·옛 ⌘K 이력). */}
              <Route path="/graph" element={<Navigate to="/items?view=structure" replace />} />
              {/* W12 객체 축 — **탭이 아니다.** 레일·`[ ]` 링·`g` 키에 안 뜬다(그 셋은 `role` 파생이고
                  이건 명사 하나의 상세다). ⌘K 의 과목·챕터 히트와 과목 카드가 여기 착지한다. */}
              <Route
                path="/subject/:id"
                element={
                  <ErrorBoundary
                    fallbackRender={(p) => <TabFallback {...p} label="과목" />}
                    onError={(e) => reportError(e, 'tab:subject')}
                  >
                    <Suspense fallback={<TabLoading fill={false} tabKey="subject" />}>
                      <SubjectPage />
                    </Suspense>
                  </ErrorBoundary>
                }
              />
              <Route path="*" element={<Navigate to="/today" replace />} />
            </Routes>
          </HudFrame>
        </main>
      </div>
      {/* 미니 HUD 는 **셸을 덮는다**(걷어내지 않는다) — 세션 종료의 단일 감시자인 FocusChip 이
          TopBar 안에 살아 있어야 알림·완료 토스트·자동 휴식이 계속 돈다(MiniHud 머리주석). */}
      {pathname === MINI_PATH && <MiniHud />}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <OnlineStatus />
      <BootRecovery />
      <StorageGuard />
      <VaultSync />
      <ToastHost />
      <ModalHost />
      <TooltipHost />
    </div>
  );
}
