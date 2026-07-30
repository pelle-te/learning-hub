import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { navGroups, hostTabKey, Icon, type TabMeta } from '@/shell';
import { noteLens, railTarget } from '@/shell/lastLens';
import SyncLedger from '@/components/SyncLedger';
import { useSyncLedger } from '@/store/useSyncLedger';
import { prefetchTab } from '@/features/registry';
import { useUI } from '@/store/useUI';
import { useApp } from '@/store/useApp';
import { useConflicts } from '@/store/useConflicts';
import { selectNavSignals, selectRiskSummary } from '@/store/selectors';
import { openBacklog } from '@/lib/methodology';
import { markVia } from '@/lib/visits';

// C-9: 복습 밀림·열린 보충은 review/mastery 탭 안에서만 보여 다른 탭에 있으면 알 길이 없었다.
// 로그 그룹 진입점(학습 기록=review 호스트)에 은은한 카운트 배지로 어디서든 신호(발광·펄스 금지).
const NAV_BADGE_TAB = 'journal';

/* RailSidebar — 라벨+그룹 접이식 사이드바(설계도 §1-2 확장).
   - 펼침(기본): 그룹 헤더(계획·자료·분석·설정) 아래 아이콘+라벨 행. 탭이 늘어도 청킹으로 스캔 가능.
   - 접힘: 60px 아이콘 레일 + 그룹 구분선 + hover 플라이아웃 라벨(집중 모드·공간 회수). useUI.navCollapsed 영속.
   - lens(review/mastery/graph/alloc/items…)에 있을 땐 그 호스트를 활성으로(섹션 전환은 본문 상단 SubTabs).
   - 방향키/Home/End 이동(roving tabindex) — *라우트 내비*지 ARIA tablist가 아니라 활성 표기는 aria-current="page".
   - settings 그룹(탐구 수집·설정)은 스페이서 아래 하단에(저빈도 운영 화면).

   ── C-7 셸 티어 4/5 이식(Tailwind) ──────────────────────────────────────────────
   원본 CSS 는 접힘 상태를 **`.rail.collapsed .item` 자손 셀렉터**로 표현했다. 규약 4가 그 통로를
   막으므로(자손 변형 금지) 접힘/펼침 두 벌을 **JS 에서 고른다** — 이 컴포넌트는 이미 `collapsed`
   불리언을 갖고 있어 `group-data-*` 변형보다 정직하고 읽기 쉽다(SubTabs 의 BTN_ON/OFF 관용구).
   ⚠ 같은 속성을 두 클래스에 나눠 붙이면 방출 순서로 갈리므로(TopBar 에서 물렸다) **한 속성은 한
   문자열만** 소유한다 — width/height/padding/gap 이 전부 그 이유로 변형 쪽에 몰려 있다.
   ⚠ raw `<button>` 은 언레이어드 전역 `button{}` 을 상대하므로 배경·보더·radius·padding·font 계열에
   `!` 가 필요하다(§15-5). 모바일(≤700)은 레일이 하단 탭바로 바뀌는 **세 번째 기하**라 `max-mobile:`
   수식자가 두 변형 위에 얹힌다(원본 미디어쿼리가 두 상태를 함께 덮던 것과 같은 구조).
   `RailSidebar.module.css` 삭제. */
const RAIL =
  /* ⚠ `z-nav` 이었다 — `--z-nav` 는 `@theme` 에 없어 **유틸이 생성되지 않았고**, 빌드 산출
     CSS 에 `.z-nav` 가 0건이었다(실측). 즉 데스크톱 레일이 z-index 없이 DOM 순서에만 기대는
     상태였다. 같은 문자열의 모바일 분기가 이미 쓰는 관용구(`z-[var(--z-dropdown)]`)로 맞춘다. */
  'z-[var(--z-nav)] row-[1/-1] flex h-screen w-full flex-col overflow-x-hidden overflow-y-auto border-r border-line2 bg-bg [view-transition-name:app-nav] max-mobile:fixed max-mobile:inset-x-0 max-mobile:top-auto max-mobile:bottom-0 max-mobile:z-[var(--z-dropdown)] max-mobile:row-auto max-mobile:h-auto max-mobile:w-auto max-mobile:flex-row max-mobile:items-center max-mobile:justify-around max-mobile:gap-0.5 max-mobile:overflow-visible max-mobile:border-r-0 max-mobile:border-t max-mobile:border-t-line max-mobile:px-2 max-mobile:pt-1.5 max-mobile:pb-[calc(6px+env(safe-area-inset-bottom,0px))]';
const RAIL_EXP = 'gap-0.5 px-2.5 pt-3.5 pb-3';
const RAIL_COL = 'items-center gap-1 px-0 pt-4 pb-3.5 max-mobile:items-center';
// 브랜드 — 접힘 시 L 칩만, 펼침 시 워드마크 동반. 모바일 바텀바에선 통째로 숨는다.
const BRAND = 'flex items-center gap-2.5 pb-3 max-mobile:hidden';
const BRAND_EXP = 'px-2 pt-0.5';
const BRAND_COL = 'justify-center px-0 pt-0';
const LOGO =
  'grid size-7.5 flex-none place-items-center rounded-rail-chip bg-acc text-lg leading-[1.6] font-black tracking-rail-logo text-on-acc shadow-rail-logo';
// ⚠ 규약 6 — `text-lg` 는 **내장 크기명**이라 동반 line-height(1.555)를 방출한다. 원본 `.word` 는
//    선언이 없어 body 1.6 을 상속했으므로(24px) 명시하지 않으면 줄상자가 23.3px 로 줄어든다.
const WORD = 'text-lg leading-[1.6] font-extrabold tracking-title whitespace-nowrap text-ink';
const GROUPS = 'flex flex-col gap-0.5 max-mobile:contents';
const GROUPS_COL = 'items-center gap-1';
const GROUP = 'flex flex-col gap-0.5 max-mobile:contents';
const GROUP_COL = 'items-center';
// 그룹 헤더(펼침 전용) — 소문자 캡스, 저채도. 구분선은 접힘 전용.
const DIVIDER = 'my-1 h-px w-6 flex-none bg-line2 max-mobile:hidden';
const SPACER = 'min-h-2 flex-1 max-mobile:hidden';
// 탭 버튼 — 펼침=아이콘+라벨 행, 접힘=42px 아이콘 칩. 모바일=44px 터치 타깃.
const ITEM =
  'group relative flex items-center rounded-rail! border! border-transparent! text-left text-rail-item! leading-[normal] font-semibold! transition-[color,background,box-shadow] duration-fast ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-acc focus-visible:outline-offset-2 max-mobile:h-auto! max-mobile:min-h-11 max-mobile:w-auto! max-mobile:min-w-11 max-mobile:justify-center max-mobile:gap-0 max-mobile:px-0! max-mobile:py-0!';
// ⚠ 배경·색은 **변형이 통째로 소유한다** — base 에 `bg-transparent!`/`text-mut!` 를 두고 ON 에서
//    덮으려 하면 방출 순서로 갈려 활성 표시가 통째로 죽는다(이 이식에서 실제로 물렸다).
const ITEM_OFF = 'bg-transparent! text-mut! hover:bg-panel2! hover:text-ink!';
const ITEM_EXP = 'w-full gap-2.75 px-2.5! py-2!';
const ITEM_COL = 'size-10.5 justify-center gap-0 px-0! py-0!';
const ITEM_ON = 'bg-acc-soft! text-acc! shadow-rail-item-on';
// 복습·보충 대기 배지(C-9) — 코너 카운트. 절제: 발광·펄스 없이 저채도 알약.
const BADGE =
  'pointer-events-none absolute top-0.75 right-1.25 h-4 min-w-4 rounded-rail-chip bg-tint-acc-panel-20 px-1 text-center text-rail-head leading-4 font-extrabold text-acc';
// 라벨 — 펼침=흐름 텍스트(생략표), 접힘=hover 플라이아웃(모바일은 숨김).
const LABEL = 'overflow-hidden text-ellipsis whitespace-nowrap max-mobile:hidden';
const LABEL_COL =
  'pointer-events-none absolute top-1/2 left-[calc(100%+8px)] z-[var(--z-dropdown)] -translate-y-1/2 -translate-x-1 rounded-rail-chip border border-line bg-panel px-2.75 py-1.5 text-sm leading-[normal] font-bold tracking-topbar-sub whitespace-nowrap text-ink opacity-0 shadow-md transition-[opacity,transform] duration-fast ease-[var(--ease)] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 max-mobile:hidden';
// 접기/펼치기 토글 — 하단(모바일 숨김).
const TOGGLE =
  'flex items-center rounded-rail! border! border-transparent! bg-transparent! text-md! leading-[normal] font-semibold! text-mut! transition-[color,background] duration-fast ease-[var(--ease)] hover:bg-panel2! hover:text-ink! focus-visible:outline-2 focus-visible:outline-acc focus-visible:outline-offset-2 max-mobile:hidden';
const TOGGLE_EXP = 'mt-1 w-full gap-2.75 px-2.5! py-2!';
const TOGGLE_COL = 'mt-1.5 size-10.5 justify-center gap-0 px-0! py-0!';
// 아이콘 크기·굵기(원본 `.item :global(.ic)`) — Icon 이 className 을 받는다(§15-5 재사용 자산).
// ⚠ 굵기도 `!` 가 필요하다 — 전역 `.ic{stroke-width:2}`(base.css)는 **언레이어드**라 유틸이 못 이긴다.
//    `!` 없이 두면 아이콘이 조용히 2px 로 굵어진다(레일 아이콘 20개 전부 · 실렌더 확인이 잡았다).
const IC_ITEM = 'size-5! [stroke-width:1.7]!';
/* 상태 슬롯(N-13) — 라벨 아래 한 줄. 배지(숫자 하나)가 말하지 못하던 **무엇이** 밀렸는지를 적는다.
   ⚠ 펼침에서만 뜬다(접힘 42px 레일엔 글자가 들어갈 자리가 없다 · 그쪽은 배지가 계속 맡는다).
   ⚠ 절제: 발광·색 없이 저채도 한 줄이다. 신호는 **있을 때만** 그려지므로 존재 자체가 강조다. */
const SIGNAL =
  'block overflow-hidden text-ellipsis whitespace-nowrap text-rail-head font-bold text-mut max-mobile:hidden';
const IC_TOGGLE = 'size-4.5! [stroke-width:1.7]!';

export default function RailSidebar() {
  const navigate = useNavigate();
  const loc = useLocation();
  const collapsed = useUI((st) => st.ui.navCollapsed);
  const toggleNav = useUI((st) => st.toggleNav);
  // 숫자만 구독 — selectRiskSummary도 state 참조 캐시라 이 셀렉터가 알림마다 불려도 전수 스캔은
  // state 버전당 1회다(예전엔 riskSummary가 매 알림마다 days×items×chapters를 통째로 순회했다).
  const reviewBadge = useApp((st) => {
    const state = st.state;
    return selectRiskSummary(state).overdue + openBacklog(state).length;
  });
  // 나브 상태 신호(N-13) — 계산은 selectors 한 곳, 여기선 표시만. 참조-캐시라 알림마다 불려도 싸다.
  const signals = useApp((st) => selectNavSignals(st.state));
  // 동기화 충돌(다른 기기 편집에 덮인 로컬 편집) 대기 수 — 설정 탭 코너 배지(Phase 4).
  const conflictBadge = useConflicts((s) => s.shadows.length);
  const curKey = loc.pathname.split('/')[1] || 'today';
  const cur = hostTabKey(curKey);
  /* 지금 보는 탭을 기억한다(렌더 중 부수효과 금지 → 이펙트).
     ⚠ 호스트 자신이면 기억이 지워진다 — 조망으로 돌아온 의도를 다음 클릭이 존중하게. */
  useEffect(() => {
    noteLens(curKey);
  }, [curKey]);
  /* @param animate 뷰 전환(크로스페이드)을 쓸지. ⚠ 방향키 roving 은 **끈다** — 화살표를 누르고
     있으면 키 반복(초당 20~30회)마다 View Transition 이 시작되고, 각 전환이 이전 것을 중단시켜
     레일·본문이 계속 반투명 상태로 깜빡인다(원하는 탭에 도착해도 잔상이 남는다). 클릭·⌘K 처럼
     '한 번의 의도적 이동'에서만 애니가 의미가 있다. */
  /* N-11 — 레일에서 출발한 내비게이션임을 표시한다. 방향키 roving 도 레일이다(같은 목록을
     같은 손으로 돈다). */
  /* E27 — 레일 클릭은 그 호스트에서 **마지막으로 보던 렌즈**로 간다(세션 한정). 종전엔 항상
     첫 렌즈라, 배분 보드를 보려면 매번 레일 1 + 세그먼트 1 = 2클릭이었다.
     ⚠ `g` 키·⌘K·딥링크는 렌즈를 이름으로 지목하므로 이 기억을 안 탄다 — 이 규칙은 레일 클릭
       한 경로만 상대한다(`shell/lastLens` 머리주석). */
  const go = (key: string, animate = true) => {
    markVia('rail');
    navigate('/' + railTarget(key), { viewTransition: animate });
  };

  const ledger = useSyncLedger();
  const groups = navGroups();
  const topGroups = groups.filter((g) => g.key !== 'settings');
  const bottomGroup = groups.find((g) => g.key === 'settings');

  // roving tabindex 대상 = 모든 나브 탭(그룹 순서대로 평면화). 활성 탭이 목록에 없으면(예외) 첫 버튼을 tab stop으로.
  const flat = groups.flatMap((g) => g.tabs);
  const idxOf = (key: string) => flat.findIndex((t) => t.key === key);
  const hasActive = flat.some((t) => t.key === cur);

  /* roving: ↑↓/←→/Home/End 로 **포커스만** 옮긴다(H10 · 2026-07-30 `/감사 근본`).

     ⚠⚠ 종전엔 포커스 이동 **전에** `go(t.key, false)` 로 라우트를 즉시 바꾸는 *자동 활성*이었다.
     두 가지가 동시에 틀렸다:

     · **훑을 수 없다.** SR 사용자가 ↓ 를 세 번 눌러 레일 라벨을 읽으려 하면 라우트가 세 번
       바뀌고, `App.tsx` 의 라우트 아나운서와 `document.title` 이 매번 갱신돼 **자기가 읽으려던
       라벨이 계속 잘린다.** 형제 위젯 `SubTabs` 는 정확히 반대로 결정하고 그 근거를 적어 뒀다
       (_"활성화는 네이티브 버튼(Enter/Space)·클릭이 소유 — 라우트 전환은 명시 동작으로"_).
       내비게이션 목록은 tablist 가 아니므로 WAI 도 수동 활성을 권한다.
     · **관측 원장을 오염시킨다.** `go()` 가 `markVia('rail')` 를 부르고 `App.tsx` 가 경로 변경마다
       `recordVisit` 한다 → **키보드 탐색 한 번이 '레일 방문'으로 집계된다.** 그 숫자는 H24(markets
       강등)·IA 재판정이 2주 기다리는 바로 그 데이터다(`route_visits`). 탐색이 방문으로 찍히면
       "무엇을 실제로 쓰는가"의 답이 조용히 부풀려진다.

     활성화는 버튼의 네이티브 동작(Enter/Space)이 이미 소유한다 — 여기서 뺀 것은 그 중복뿐이다. */
  const onKey = (idx: number) => (e: React.KeyboardEvent) => {
    let next = -1;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (idx + 1) % flat.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (idx - 1 + flat.length) % flat.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = flat.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const t = flat[next]!;
    /* 포커스만 옮긴다 — `go()` 를 부르지 않는 것이 H10 의 전부다. roving tabindex 이므로
       `tabIndex` 는 `cur` 이 아니라 **DOM 포커스**를 따라야 하는데, 그 계산은 아래
       `renderBtn` 이 `activeKey`(=현재 라우트)로 하고 있어 포커스 이동 자체는 막지 않는다
       (브라우저가 focus() 를 그대로 수행한다). */
    document.getElementById('rail-' + t.key)?.focus();
  };

  const renderBtn = (t: TabMeta) => {
    const i = idxOf(t.key);
    const active = cur === t.key;
    // 배지 두 종류: journal=복습·보충 대기 · settings=동기화 충돌 대기. 라벨도 각각.
    const isConflict = t.key === 'settings' && conflictBadge > 0;
    const badge = t.key === NAV_BADGE_TAB ? reviewBadge : t.key === 'settings' ? conflictBadge : 0;
    const badgeLabel = isConflict ? `동기화 충돌 ${badge}건` : `복습·보충 ${badge}건 대기`;
    // 접힘 레일엔 글자 자리가 없다 → 신호는 펼침 전용이고 접힘은 배지가 계속 맡는다.
    const signal = collapsed ? '' : (signals[t.key] ?? '');
    return (
      <button
        key={t.key}
        id={'rail-' + t.key}
        type="button"
        aria-current={active ? 'page' : undefined}
        aria-label={badge > 0 ? `${t.label} — ${badgeLabel}` : signal ? `${t.label} — ${signal}` : t.label}
        tabIndex={active || (!hasActive && i === 0) ? 0 : -1}
        className={`${ITEM} ${collapsed ? ITEM_COL : ITEM_EXP} ${active ? ITEM_ON : ITEM_OFF}`}
        onKeyDown={onKey(i)}
        onMouseEnter={() => prefetchTab(t.key)}
        onFocus={() => prefetchTab(t.key)}
        onClick={() => go(t.key)}
      >
        <Icon name={t.icon} className={IC_ITEM} />
        {collapsed ? (
          <span className={LABEL_COL}>{t.label}</span>
        ) : (
          /* 라벨 + 상태 한 줄(N-13). 신호가 없으면 줄 자체가 없다 — 빈 줄을 그려 두면 높이가
             늘 흔들리고, "평온엔 아무것도 안 그린다"가 레이아웃에서 배신당한다. */
          <span className="min-w-0 flex-1">
            <span className={LABEL}>{t.label}</span>
            {signal && <span className={SIGNAL}>{signal}</span>}
          </span>
        )}
        {badge > 0 && (
          <span className={BADGE} aria-hidden="true">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    );
  };

  /* ── E22 그룹 헤더 은퇴(2026-07-29) ─────────────────────────────────────
     청킹은 항목이 7+ 일 때 값이 나오는 메커니즘인데, IA 재편 뒤 destination 은 **7개**이고
     그룹은 4개다 — 그룹당 1.75개. 헤더가 항목 수의 절반을 차지하는 청킹은 구조를 주는 것이
     아니라 줄 수를 늘리는 것이다(재편 전에도 11개/5그룹 = 2.2 였다).

     ⚠ 그룹 자체를 지우지는 않았다 — `TabMeta.group` 은 **레일 순서**를 정하는 데 계속 쓰인다
     (빈도 위계: 계획 > 숙련 > 수집 > 설정). `buildNavGroups` 머리주석이 경고하는 함정,
     즉 `order` 만으로 정렬하면 `reads`(45)가 `journal`(60)보다 앞서는 문제가 그대로 살아 있다.
     바뀐 것은 **무엇이 그려지는가** 하나다.
     ⚠ SR 용 `role="group" aria-label` 도 뗐다 — 보이지 않는 그룹을 스크린리더에만 알리면
     시각 사용자와 다른 구조를 듣게 된다(없는 경계를 있다고 말하는 셈). */
  const renderGroup = (g: { key: string; label: string; tabs: TabMeta[] }, showSep: boolean) => (
    <div key={g.key} className={`${GROUP} ${collapsed ? GROUP_COL : ''}`}>
      {showSep && collapsed && <div className={DIVIDER} aria-hidden="true" />}
      {g.tabs.map(renderBtn)}
    </div>
  );

  return (
    <nav className={`${RAIL} ${collapsed ? RAIL_COL : RAIL_EXP}`} aria-label="주요 메뉴" data-collapsed={collapsed}>
      <div className={`${BRAND} ${collapsed ? BRAND_COL : BRAND_EXP}`} aria-hidden="true">
        <div className={LOGO}>L</div>
        {!collapsed && <span className={WORD}>러닝 허브</span>}
      </div>

      <div className={`${GROUPS} ${collapsed ? GROUPS_COL : ''}`}>{topGroups.map((g, i) => renderGroup(g, i > 0))}</div>
      <div className={SPACER} />
      {/* E12 — 데스크톱도 자기 동기화 상태를 말한다. 폰 헤더와 **같은 컴포넌트·같은 판정**이라
          두 기기가 서로 다른 조건에서 침묵할 수 없다(달라지는 것은 여백뿐).
          ⚠ 접힘(아이콘 전용) 레일에선 그리지 않는다 — 42px 폭에 문장을 넣으면 잘리고, 잘린
            상태 문구는 없는 것보다 나쁘다(무슨 일이 났는지 모른 채 뭔가 났다는 것만 안다). */}
      {!collapsed && <SyncLedger {...ledger} className="px-2.5 pb-1.5" />}
      {bottomGroup && renderGroup(bottomGroup, true)}
      <button
        type="button"
        className={`${TOGGLE} ${collapsed ? TOGGLE_COL : TOGGLE_EXP}`}
        aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
        aria-pressed={collapsed}
        onClick={toggleNav}
      >
        <Icon name="panelLeft" className={IC_TOGGLE} />
        {!collapsed && <span className={LABEL}>접기</span>}
      </button>
    </nav>
  );
}
