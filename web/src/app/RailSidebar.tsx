import { useLocation, useNavigate } from 'react-router-dom';
import { navGroups, hostTabKey, surfaceOf, surfaceHome, SURFACES, Icon, type TabMeta, type Surface } from '@/shell';
import { prefetchTab } from '@/features/registry';
import { useUI } from '@/store/useUI';
import { useApp } from '@/store/useApp';
import { useConflicts } from '@/store/useConflicts';
import { selectRiskSummary } from '@/store/selectors';
import { openBacklog } from '@/lib/methodology';

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
  'z-nav row-[1/-1] flex h-screen w-full flex-col overflow-x-hidden overflow-y-auto border-r border-line2 bg-bg [view-transition-name:app-nav] max-mobile:fixed max-mobile:inset-x-0 max-mobile:top-auto max-mobile:bottom-0 max-mobile:z-[var(--z-dropdown)] max-mobile:row-auto max-mobile:h-auto max-mobile:w-auto max-mobile:flex-row max-mobile:items-center max-mobile:justify-around max-mobile:gap-0.5 max-mobile:overflow-visible max-mobile:border-r-0 max-mobile:border-t max-mobile:border-t-line max-mobile:px-2 max-mobile:pt-1.5 max-mobile:pb-[calc(6px+env(safe-area-inset-bottom,0px))]';
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
// 표면 스위처(Wave⑥) — 학습 ↔ 자료. 펼침=2칸 세그먼트(트랙 있음), 접힘·모바일=아이콘 칩만.
const SURF_TRACK = 'flex max-mobile:m-0 max-mobile:flex-row max-mobile:flex-none max-mobile:gap-0.5 max-mobile:p-0.5';
const SURF_TRACK_EXP =
  'mx-0.5 mb-2.5 gap-0.75 rounded-rail-seg border border-line2 bg-panel2 p-0.75 max-mobile:rounded-none max-mobile:border-0 max-mobile:bg-transparent';
const SURF_TRACK_COL = 'mx-0 mb-2.5 flex-col gap-1 border-0 bg-transparent p-0.75';
const SURFACE_BTN =
  'flex items-center justify-center gap-1.75 rounded-rail-chip! border! border-transparent! text-rail-surface! leading-[normal] font-bold! tracking-price! transition-[color,background,box-shadow] duration-160 ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-acc focus-visible:outline-offset-2 max-mobile:h-auto! max-mobile:min-h-11 max-mobile:w-auto! max-mobile:min-w-10 max-mobile:flex-none';
const SURFACE_OFF = 'bg-transparent! text-mut! hover:text-ink!';
const SURFACE_BTN_EXP = 'flex-1 px-2! py-1.75!';
const SURFACE_BTN_COL = 'h-9 w-10.5 flex-none px-0! py-0!';
const SURFACE_ON_EXP = 'bg-bg! text-acc! shadow-rail-surface-on';
// ⚠ 접힘은 **배경만** 바꾼다(원본 `.rail.collapsed .surfaceOn` 이 background 만 덮었다) — inset 링은
//    두 상태 공통이다. 링을 빼면 접힘 레일에서 활성 표면 표시가 사라진다(실렌더 확인이 잡았다).
const SURFACE_ON_COL = 'bg-acc-soft! text-acc! shadow-rail-surface-on';
const GROUPS = 'flex flex-col gap-0.5 max-mobile:contents';
const GROUPS_COL = 'items-center gap-1';
const GROUP = 'flex flex-col gap-0.5 max-mobile:contents';
const GROUP_COL = 'items-center';
// 그룹 헤더(펼침 전용) — 소문자 캡스, 저채도. 구분선은 접힘 전용.
const HEAD = 'px-2.5 pt-2.5 pb-1 text-rail-head font-extrabold tracking-mode text-mut uppercase max-mobile:hidden';
const DIVIDER = 'my-1 h-px w-6 flex-none bg-line2 max-mobile:hidden';
const SPACER = 'min-h-2 flex-1 max-mobile:hidden';
// 탭 버튼 — 펼침=아이콘+라벨 행, 접힘=42px 아이콘 칩. 모바일=44px 터치 타깃.
const ITEM =
  'group relative flex items-center rounded-rail! border! border-transparent! text-left text-rail-item! leading-[normal] font-semibold! transition-[color,background,box-shadow] duration-160 ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-acc focus-visible:outline-offset-2 max-mobile:h-auto! max-mobile:min-h-11 max-mobile:w-auto! max-mobile:min-w-11 max-mobile:justify-center max-mobile:gap-0 max-mobile:px-0! max-mobile:py-0!';
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
  'pointer-events-none absolute top-1/2 left-[calc(100%+8px)] z-[var(--z-dropdown)] -translate-y-1/2 -translate-x-1 rounded-rail-chip border border-line bg-panel px-2.75 py-1.5 text-sm leading-[normal] font-bold tracking-topbar-sub whitespace-nowrap text-ink opacity-0 shadow-md transition-[opacity,transform] duration-140 ease-[var(--ease)] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 max-mobile:hidden';
// 접기/펼치기 토글 — 하단(모바일 숨김).
const TOGGLE =
  'flex items-center rounded-rail! border! border-transparent! bg-transparent! text-md! leading-[normal] font-semibold! text-mut! transition-[color,background] duration-160 ease-[var(--ease)] hover:bg-panel2! hover:text-ink! focus-visible:outline-2 focus-visible:outline-acc focus-visible:outline-offset-2 max-mobile:hidden';
const TOGGLE_EXP = 'mt-1 w-full gap-2.75 px-2.5! py-2!';
const TOGGLE_COL = 'mt-1.5 size-10.5 justify-center gap-0 px-0! py-0!';
// 아이콘 크기·굵기(원본 `.item :global(.ic)`) — Icon 이 className 을 받는다(§15-5 재사용 자산).
// ⚠ 굵기도 `!` 가 필요하다 — 전역 `.ic{stroke-width:2}`(base.css)는 **언레이어드**라 유틸이 못 이긴다.
//    `!` 없이 두면 아이콘이 조용히 2px 로 굵어진다(레일 아이콘 20개 전부 · 실렌더 확인이 잡았다).
const IC_ITEM = 'size-5! [stroke-width:1.7]!';
const IC_SURFACE = 'size-4.25! [stroke-width:1.8]!';
const IC_TOGGLE = 'size-4.5! [stroke-width:1.7]!';

export default function RailSidebar() {
  const navigate = useNavigate();
  const loc = useLocation();
  const collapsed = useUI((st) => st.ui.navCollapsed);
  const toggleNav = useUI((st) => st.toggleNav);
  const persistedSurface = useUI((st) => st.ui.navSurface);
  const setNavSurface = useUI((st) => st.setNavSurface);
  // 숫자만 구독 — selectRiskSummary도 state 참조 캐시라 이 셀렉터가 알림마다 불려도 전수 스캔은
  // state 버전당 1회다(예전엔 riskSummary가 매 알림마다 days×items×chapters를 통째로 순회했다).
  const reviewBadge = useApp((st) => {
    const state = st.state;
    return selectRiskSummary(state).overdue + openBacklog(state).length;
  });
  // 동기화 충돌(다른 기기 편집에 덮인 로컬 편집) 대기 수 — 설정 탭 코너 배지(Phase 4).
  const conflictBadge = useConflicts((s) => s.shadows.length);
  const curKey = loc.pathname.split('/')[1] || 'today';
  const cur = hostTabKey(curKey);
  /* @param animate 뷰 전환(크로스페이드)을 쓸지. ⚠ 방향키 roving 은 **끈다** — 화살표를 누르고
     있으면 키 반복(초당 20~30회)마다 View Transition 이 시작되고, 각 전환이 이전 것을 중단시켜
     레일·본문이 계속 반투명 상태로 깜빡인다(원하는 탭에 도착해도 잔상이 남는다). 클릭·⌘K 처럼
     '한 번의 의도적 이동'에서만 애니가 의미가 있다. */
  const go = (key: string, animate = true) => navigate('/' + key, { viewTransition: animate });

  // 활성 표면 = 현재 라우트 탭의 surface(1차 원천). 전역 탭(설정)이면 영속값으로 폴백.
  // 라우트가 이기므로 ⌘K·딥링크로 다른 표면 탭에 가면 나브가 자동으로 그 표면으로 따라간다(desync 없음).
  const activeSurface: Surface = surfaceOf(curKey) ?? persistedSurface;
  // 스위처 클릭 — 영속값 갱신 + 그 표면 홈으로 이동(라우트가 activeSurface를 확정).
  const switchSurface = (target: Surface) => {
    if (target === activeSurface) return;
    setNavSurface(target);
    go(surfaceHome(target));
  };

  const groups = navGroups(activeSurface);
  const topGroups = groups.filter((g) => g.key !== 'settings');
  const bottomGroup = groups.find((g) => g.key === 'settings');

  // roving tabindex 대상 = 모든 나브 탭(그룹 순서대로 평면화). 활성 탭이 목록에 없으면(예외) 첫 버튼을 tab stop으로.
  const flat = groups.flatMap((g) => g.tabs);
  const idxOf = (key: string) => flat.findIndex((t) => t.key === key);
  const hasActive = flat.some((t) => t.key === cur);

  // roving: ↑↓/←→/Home/End로 탭 이동(자동 활성) + 렌더 후 포커스.
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
    go(t.key, false);
    requestAnimationFrame(() => document.getElementById('rail-' + t.key)?.focus());
  };

  const renderBtn = (t: TabMeta) => {
    const i = idxOf(t.key);
    const active = cur === t.key;
    // 배지 두 종류: journal=복습·보충 대기 · settings=동기화 충돌 대기. 라벨도 각각.
    const isConflict = t.key === 'settings' && conflictBadge > 0;
    const badge = t.key === NAV_BADGE_TAB ? reviewBadge : t.key === 'settings' ? conflictBadge : 0;
    const badgeLabel = isConflict ? `동기화 충돌 ${badge}건` : `복습·보충 ${badge}건 대기`;
    return (
      <button
        key={t.key}
        id={'rail-' + t.key}
        type="button"
        aria-current={active ? 'page' : undefined}
        aria-label={badge > 0 ? `${t.label} — ${badgeLabel}` : t.label}
        tabIndex={active || (!hasActive && i === 0) ? 0 : -1}
        className={`${ITEM} ${collapsed ? ITEM_COL : ITEM_EXP} ${active ? ITEM_ON : ITEM_OFF}`}
        onKeyDown={onKey(i)}
        onMouseEnter={() => prefetchTab(t.key)}
        onFocus={() => prefetchTab(t.key)}
        onClick={() => go(t.key)}
      >
        <Icon name={t.icon} className={IC_ITEM} />
        <span className={collapsed ? LABEL_COL : LABEL}>{t.label}</span>
        {badge > 0 && (
          <span className={BADGE} aria-hidden="true">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    );
  };

  // 그룹 = 헤더(펼침) 또는 구분선(접힘, 최상단 제외) + 탭 버튼들.
  const renderGroup = (g: { key: string; label: string; tabs: TabMeta[] }, showSep: boolean) => (
    <div key={g.key} className={`${GROUP} ${collapsed ? GROUP_COL : ''}`} role="group" aria-label={g.label}>
      {collapsed ? (
        showSep && <div className={DIVIDER} aria-hidden="true" />
      ) : (
        <div className={HEAD} aria-hidden="true">
          {g.label}
        </div>
      )}
      {g.tabs.map(renderBtn)}
    </div>
  );

  return (
    <nav className={`${RAIL} ${collapsed ? RAIL_COL : RAIL_EXP}`} aria-label="주요 메뉴" data-collapsed={collapsed}>
      <div className={`${BRAND} ${collapsed ? BRAND_COL : BRAND_EXP}`} aria-hidden="true">
        <div className={LOGO}>L</div>
        {!collapsed && <span className={WORD}>러닝 허브</span>}
      </div>

      {/* 표면 스위처(Wave⑥) — 학습(핵심·숙련) ↔ 자료(수집·발견). 펼침=세그먼트, 접힘=아이콘 토글. */}
      {/* role="tablist"/"tab"은 화살표 이동·roving tabindex·aria-controls→tabpanel까지 약속하는 계약인데
          이 스위처는 그 어느 것도 이행하지 않았다 — SR 사용자는 탭 탐색을 시도했다가 아무 반응도 못 얻는다.
          Schedule 세그먼트가 이미 같은 이유로 내린 판단(group + aria-pressed)을 여기에도 적용한다. */}
      <div
        className={`${SURF_TRACK} ${collapsed ? SURF_TRACK_COL : SURF_TRACK_EXP}`}
        role="group"
        aria-label="표면 전환"
      >
        {SURFACES.map((sf) => {
          const on = sf.key === activeSurface;
          const onCls = on ? (collapsed ? SURFACE_ON_COL : SURFACE_ON_EXP) : SURFACE_OFF;
          return (
            <button
              key={sf.key}
              type="button"
              aria-pressed={on}
              aria-label={sf.label}
              title={sf.label}
              className={`${SURFACE_BTN} ${collapsed ? SURFACE_BTN_COL : SURFACE_BTN_EXP} ${onCls}`}
              onClick={() => switchSurface(sf.key)}
            >
              <Icon name={sf.icon} className={IC_SURFACE} />
              {!collapsed && <span className="whitespace-nowrap max-mobile:hidden">{sf.label}</span>}
            </button>
          );
        })}
      </div>

      <div className={`${GROUPS} ${collapsed ? GROUPS_COL : ''}`}>{topGroups.map((g, i) => renderGroup(g, i > 0))}</div>
      <div className={SPACER} />
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
