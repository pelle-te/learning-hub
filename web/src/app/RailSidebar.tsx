import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { navGroups, Icon, type NavGroup, type TabMeta } from '@/shell';
import SyncLedger from '@/components/SyncLedger';
import { useSyncLedger } from '@/store/useSyncLedger';
import { prefetchTab } from '@/features/registry';
import { useUI } from '@/store/useUI';
import { useApp } from '@/store/useApp';
import { useConflicts } from '@/store/useConflicts';
import { selectNavSignals, selectRiskSummary } from '@/store/selectors';
import { openBacklog } from '@/lib/methodology';
import { markVia } from '@/lib/visits';
import { countableKeys, sinceCount } from '@/lib/since';

/* C-9: 복습 밀림·열린 보충은 review/mastery 탭 안에서만 보여 다른 탭에 있으면 알 길이 없었다.
   → 어디서든 보이는 카운트 배지(발광·펄스 금지).

   ⚠⚠ **W7 IA 재편(2026-08-02) — 배지가 틀린 탭에 붙어 있었다.** `journal`(학습 기록)은
   *적는* 화면인데 그 배지가 세는 것은 **인출 축의 대기**(밀린 복습 + 열린 보충)다. 즉 "복습이
   3건 밀렸다"를 기록 탭이 말하고 있었고, 눌러 가면 거기엔 그 3건이 없다 — 배지는 자기가
   가리키는 일이 **있는 곳**에 붙어야 한다. IA 판정 표가 이 어긋남을 `journal` 강등의 근거로
   적었다(_"인출 축의 대기 숫자가 기록 탭에 붙어 있다"_).
   → `review-run`(복습 실행 · 인출 축의 얼굴 · W17 이 destination 으로 올린 그 화면)으로 옮긴다. */
const NAV_BADGE_TAB = 'review-run';

/* 아코디언 밖에 사는 축 둘 — **상시**(매일 여는 것)와 **바닥 칩**(저빈도 운영).
   키는 `RAIL_SECTIONS` 의 것이고, 실재는 불변식 ㉜이 지킨다(오타면 축 하나가 조용히 사라진다). */
const LEAD_SECTION = 'now';
const FOOT_SECTION = 'system';

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
/* ⚠⚠ **모바일 탭바가 탭을 잘라 먹고 있었다**(U023 · 2026-08-21 ux 축 · `[재현]`).
   ≤700px 에서 레일은 하단 탭바가 되는데 `justify-around` + `overflow-visible` 이라 **넘치는
   버튼이 화면 밖으로 나가고 도달할 방법이 없었다.** 실측(내용 폭 696px 고정):

   | 뷰포트 | 화면 밖 탭 |
   |---|---|
   | 320px(400% 확대) | **9 / 16** |
   | 390px(폰 베이스라인) | **7 / 16** — `설정`·`연동 현황` 포함 |
   | 560px | 3 / 16 |

   즉 「320px 리플로우」로 발견됐지만 **확대만의 문제가 아니었다** — 좁은 창에서는 앱 절반이
   사라진다. 스크롤로 바꾼다(잘린 것을 손이 닿게 만드는 최소 변경 · 줄바꿈은 640px 화면에서
   탭바가 세 줄이 되어 본문을 먹는다).
   ⚠ 스크롤바는 숨긴다 — 44px 터치 타깃 위에 그리면 그 타깃을 깎는다. 대신 아래 이펙트가
   **활성 탭을 항상 보이는 자리로 데려온다**(스크롤이 가능하다는 사실은 그 움직임이 알린다).
   ⚠ 검증망은 이 대역을 안 본다: 트랙 A 의 모바일 스냅샷은 390px **4장**뿐이고 전부 `fullPage`
   라(sticky 를 흐름 위치로 편다) 탭바가 잘리는 그림이 애초에 안 찍힌다. */
const RAIL =
  /* ⚠ `z-nav` 이었다 — `--z-nav` 는 `@theme` 에 없어 **유틸이 생성되지 않았고**, 빌드 산출
     CSS 에 `.z-nav` 가 0건이었다(실측). 즉 데스크톱 레일이 z-index 없이 DOM 순서에만 기대는
     상태였다. 같은 문자열의 모바일 분기가 이미 쓰는 관용구(`z-[var(--z-dropdown)]`)로 맞춘다. */
  'z-[var(--z-nav)] row-[1/-1] flex h-screen w-full flex-col overflow-x-hidden overflow-y-auto border-r border-line2 bg-bg [view-transition-name:app-nav] max-mobile:fixed max-mobile:inset-x-0 max-mobile:top-auto max-mobile:bottom-0 max-mobile:z-[var(--z-dropdown)] max-mobile:row-auto max-mobile:h-auto max-mobile:w-auto max-mobile:flex-row max-mobile:items-center max-mobile:justify-start max-mobile:gap-0.5 max-mobile:overflow-x-auto max-mobile:overflow-y-hidden max-mobile:[scrollbar-width:none] max-mobile:border-r-0 max-mobile:border-t max-mobile:border-t-line max-mobile:px-2 max-mobile:pt-1.5 max-mobile:pb-[calc(6px+env(safe-area-inset-bottom,0px))]';
const RAIL_EXP = 'gap-0.5 px-2.5 pt-3.5 pb-3';
const RAIL_COL = 'items-center gap-1 px-0 pt-4 pb-3.5 max-mobile:items-center';
// 브랜드 — 접힘 시 L 칩만, 펼침 시 워드마크 동반. 모바일 바텀바에선 통째로 숨는다.
const BRAND = 'flex items-center gap-2.5 pb-3 max-mobile:hidden';
const BRAND_EXP = 'px-2 pt-0.5';
const BRAND_COL = 'justify-center px-0 pt-0';
const LOGO =
  'grid size-7.5 flex-none place-items-center rounded-rail-chip bg-acc text-lg leading-text font-black tracking-rail-logo text-on-acc';
// ⚠ 규약 6 — `text-lg` 는 **내장 크기명**이라 동반 line-height(1.555)를 방출한다. 원본 `.word` 는
//    선언이 없어 body 1.6 을 상속했으므로(24px) 명시하지 않으면 줄상자가 23.3px 로 줄어든다.
const WORD = 'text-lg leading-text font-extrabold tracking-title whitespace-nowrap text-ink';
const GROUPS = 'flex flex-col gap-0.5 max-mobile:contents';
const GROUPS_COL = 'items-center gap-1';
const GROUP = 'flex flex-col gap-0.5 max-mobile:contents';
/* ⚠⚠ **섹션 간 여백이 죽어 있었다**(2026-08-28). `HEAD` 가 `mt-3 … first:mt-0` 을 함께 들었는데,
   펼침에서 구분선이 안 그려지므로 `h2` 는 **언제나 그룹의 첫 자식**이다 → `first:mt-0` 이 항상
   이겨 12px 이 한 번도 렌더되지 않았다. 즉 15줄이 2px 간격(`GROUPS` 의 gap)으로 붙어 있었고,
   그게 "밀도가 높다"의 절반이다. 여백의 주인을 **그룹 컨테이너**로 옮긴다 — 컨테이너는 형제
   순서를 알므로 `first:` 가 뜻대로 동작한다(첫 그룹만 붙는다). */
const GROUP_GAP = 'mt-3 first:mt-0 max-mobile:mt-0';
const GROUP_COL = 'items-center';
/* ── 축 헤더 = disclosure 버튼(2026-08-28) ───────────────────────────────────
   ⚠⚠ 종전엔 `<h2 aria-hidden>` 캡션 10.5px 이었다. 항목이 상시 15줄이던 시절엔 헤더가 **먼지**로
   물러나 있는 게 맞았지만, 축을 접는 순간 헤더가 **주역**이 된다 — 쉬는 상태에서 사용자가 읽는
   것이 그 세 줄이다. 그래서 13.5px 로 올리고 조작 가능한 버튼이 됐다.
   ⚠ 질문(N-16)은 그대로다 — 분류명이 아니라 «내가 지금 묻는 것»과 맞춰 보는 문장이다. */
const HEAD_BTN =
  'group relative flex w-full items-center gap-2 rounded-rail! border! border-transparent! bg-transparent! px-2.5! py-2! text-left text-rail-item! leading-auto font-bold! transition-[color,background] duration-fast ease-[var(--ease)] hover:bg-panel2! hover:text-ink! focus-visible:outline-2 focus-visible:outline-acc focus-visible:outline-offset-2 max-mobile:hidden';
const HEAD_OPEN = 'text-ink!';
const HEAD_SHUT = 'text-mut!';
// 셰브런 — 열림이면 90° 돈다. `chevronDown` 이 로스터에 없어서 회전으로 만든다(어휘를 안 늘린다).
const IC_CHEV = 'size-4! [stroke-width:2]! flex-none transition-transform duration-fast ease-[var(--ease)]';
const IC_CHEV_OPEN = 'rotate-90';
/* 접힌 축의 알약 — **접기의 위험은 «안 보이니 잊는다»이고 해독제는 도달성이 아니라 신호다.**
   그 축 안에서 «말할 것이 있는 화면»의 수를 센다(밀린 복습 · 다시 만날 문항 · 지난번 이후 새것). */
const HEAD_PILL =
  'ml-auto h-4 min-w-4 flex-none rounded-rail-chip bg-tint-acc-panel-20 px-1 text-center text-rail-head leading-4 font-extrabold text-acc-on-soft';
/* 축의 화면들. ⚠ 접혀도 **DOM 에서 빼지 않는다** — 모바일(≤700)에선 레일이 하단 탭바이고 거기엔
   축·아코디언이라는 개념이 없다. `hidden` 은 데스크톱에서만 걸리고 `max-mobile:contents` 가
   그 아래에서 되돌린다(탭바 멤버십 불변). */
const SEC = 'flex flex-col gap-0.5 max-mobile:contents';
const SEC_SHUT = 'hidden max-mobile:contents';
// 구분선: 접힘=짧은 중앙선 · 펼침=선두 3행 아래 한 줄(질문 헤더가 없는 경계를 대신 긋는다).
const DIVIDER = 'my-1 h-px w-6 flex-none bg-line2 max-mobile:hidden';
const DIVIDER_EXP = 'mt-2.5 h-px w-full flex-none bg-line2 max-mobile:hidden';
const SPACER = 'min-h-2 flex-1 max-mobile:hidden';
// 탭 버튼 — 펼침=아이콘+라벨 행, 접힘=42px 아이콘 칩. 모바일=44px 터치 타깃.
/* ⚠ **글꼴 크기·굵기는 base 가 안 갖는다**(무게 3단 · 2026-08-28) — 단마다 다르고, 한 속성을
   base 와 변형에 나눠 두면 방출 순서로 갈린다(이 파일이 배경색에서 이미 물린 형태). */
const ITEM =
  'group relative flex items-center rounded-rail! border! border-transparent! text-left leading-auto transition-[color,background,box-shadow] duration-fast ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-acc focus-visible:outline-offset-2 max-mobile:h-auto! max-mobile:min-h-11 max-mobile:w-auto! max-mobile:min-w-11 max-mobile:justify-center max-mobile:gap-0 max-mobile:px-0! max-mobile:py-0!';
// ⚠ 배경·색은 **변형이 통째로 소유한다** — base 에 `bg-transparent!`/`text-mut!` 를 두고 ON 에서
//    덮으려 하면 방출 순서로 갈려 활성 표시가 통째로 죽는다(이 이식에서 실제로 물렸다).
const ITEM_OFF = 'bg-transparent! text-mut! hover:bg-panel2! hover:text-ink!';
/* 선두 3행은 비활성에서도 **정색**이다 — 이 레일의 계층은 크기 하나가 아니라 «크기 × 색»이고,
   나머지 12행이 `text-mut` 이라 그 대비가 곧 "매일 여는 것"의 표식이 된다.
   ⚠ OFF/ON 은 **배타적으로** 붙으므로(삼항) `!` 끼리 부딪히지 않는다. */
const ITEM_OFF_LEAD = 'bg-transparent! text-ink! hover:bg-panel2!';
/* ── 무게 3단(2026-08-28) ────────────────────────────────────────────────────
   ⚠⚠ 종전엔 15행이 **픽셀 단위로 동일**했다(13.5px semibold · 20px 아이콘 · `text-mut`).
   그러면 매일 여는 `오늘 학습`과 달마다 여는 `정본 원장`이 같은 무게라, 눈이 자리를 외우지
   못하고 매번 15개 라벨을 **읽는다**. 줄을 지우지 않고 고칠 수 있는 것이 이것이다 —
   도달성은 그대로 두고 **서식만** 빈도를 따라가게 한다.
   단은 새 축이 아니라 `RAIL_SECTIONS` 에서 파생한다(IA 원천을 둘로 만들지 않는다):
   `now`=선두 · `system`=바닥 칩 · 나머지=본문.
   ⚠ 본문 단을 **작게 만들지 않았다** — 13.5px 그대로다. 가독성 불만에 글자를 줄여 답하면
   같은 불만을 더 나쁘게 되돌려받는다. 줄인 것은 **행 높이**(py-2 → py-1.5)뿐이다. */
const ITEM_LEAD = 'w-full gap-2.75 px-2.5! py-2.5! text-rail-lead! font-bold!';
const ITEM_EXP = 'w-full gap-2.5 py-2! pr-2.5! pl-4! text-rail-item! font-semibold!';
const ITEM_COL = 'size-10.5 justify-center gap-0 px-0! py-0! text-rail-item! font-semibold!';
/* 바닥 칩(펼침 전용) — 저빈도 운영 화면 둘은 **줄을 안 쓴다**. 라벨은 플라이아웃이 맡는다.
   ⚠ `size-9` 에 `!` 를 안 붙인 것이 의도다 — 모바일 탭바의 `min-h-11`·`h-auto!` 가 이겨야
   44px 터치 타깃이 유지된다(접힘 `size-10.5` 가 이미 쓰는 관용구). */
const ITEM_CHIP = 'size-9 justify-center gap-0 px-0! py-0! text-rail-item! font-semibold!';
// ⚠ 글자는 `text-acc` 가 아니라 **`text-acc-on-soft`** 다 — 액센트 틴트는 *같은 색을 흐리게 깐
//    배경*이라 라이트에서 원색 액센트를 얹으면 대비가 무너진다(라이트 4종 전부 4.04 이하였다 ·
//    근거·수치는 `tokens.css` 의 표). 다크에선 같은 값이므로 픽셀이 안 바뀐다.
const ITEM_ON = 'bg-acc-soft! text-acc-on-soft! shadow-rail-item-on';
// 복습·보충 대기 배지(C-9) — 코너 카운트. 절제: 발광·펄스 없이 저채도 알약.
const BADGE =
  'pointer-events-none absolute top-0.75 right-1.25 h-4 min-w-4 rounded-rail-chip bg-tint-acc-panel-20 px-1 text-center text-rail-head leading-4 font-extrabold text-acc-on-soft';
// 라벨 — 펼침=흐름 텍스트(생략표), 접힘=hover 플라이아웃(모바일은 숨김).
const LABEL = 'overflow-hidden text-ellipsis whitespace-nowrap max-mobile:hidden';
const LABEL_CHIP =
  'pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-[var(--z-dropdown)] -translate-x-1/2 translate-y-1 rounded-rail-chip border border-line bg-panel px-2.5 py-1 text-sm leading-auto font-bold whitespace-nowrap text-ink opacity-0 shadow-md transition-[opacity,transform] duration-fast ease-[var(--ease)] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 max-mobile:hidden';
const LABEL_COL =
  'pointer-events-none absolute top-1/2 left-[calc(100%+8px)] z-[var(--z-dropdown)] -translate-y-1/2 -translate-x-1 rounded-rail-chip border border-line bg-panel px-2.75 py-1.5 text-sm leading-auto font-bold tracking-topbar-sub whitespace-nowrap text-ink opacity-0 shadow-md transition-[opacity,transform] duration-fast ease-[var(--ease)] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 max-mobile:hidden';
// 접기/펼치기 토글 — 하단(모바일 숨김).
const TOGGLE =
  'flex items-center rounded-rail! border! border-transparent! bg-transparent! text-md! leading-auto font-semibold! text-mut! transition-[color,background] duration-fast ease-[var(--ease)] hover:bg-panel2! hover:text-ink! focus-visible:outline-2 focus-visible:outline-acc focus-visible:outline-offset-2 max-mobile:hidden';
const TOGGLE_COL = 'mt-1.5 size-10.5 justify-center gap-0 px-0! py-0!';
// 아이콘 크기·굵기(원본 `.item :global(.ic)`) — Icon 이 className 을 받는다(§15-5 재사용 자산).
// ⚠ 굵기도 `!` 가 필요하다 — 전역 `.ic{stroke-width:2}`(base.css)는 **언레이어드**라 유틸이 못 이긴다.
//    `!` 없이 두면 아이콘이 조용히 2px 로 굵어진다(레일 아이콘 20개 전부 · 실렌더 확인이 잡았다).
const IC_ITEM = 'size-5! [stroke-width:1.7]!';
/* 본문 단 아이콘 — 18px. ⚠ 모바일 탭바는 아이콘만 보이는 유일한 표면이라 **원래 크기를
   유지한다**(거기서 줄이면 계층이 아니라 그냥 작아진 것이 된다). */
const IC_ITEM_SM = 'size-4.5! max-mobile:size-5! [stroke-width:1.7]!';
/* 상태 슬롯(N-13) — 라벨 아래 한 줄. 배지(숫자 하나)가 말하지 못하던 **무엇이** 밀렸는지를 적는다.
   ⚠ 펼침에서만 뜬다(접힘 42px 레일엔 글자가 들어갈 자리가 없다 · 그쪽은 배지가 계속 맡는다).
   ⚠ 절제: 발광·색 없이 저채도 한 줄이다. 신호는 **있을 때만** 그려지므로 존재 자체가 강조다. */
const SIGNAL =
  'block overflow-hidden text-ellipsis whitespace-nowrap text-rail-head font-bold text-mut max-mobile:hidden';
const IC_TOGGLE = 'size-4.5! [stroke-width:1.7]!';
/* 바닥 줄 — 시스템 칩 둘 + (오른쪽 끝) 접기 토글. 모바일에선 `contents` 로 풀려 칩들이 탭바의
   형제가 된다(탭바 멤버십은 안 바뀐다). */
const FOOT = 'mt-1 flex items-center gap-1 px-1.5 max-mobile:contents';
const TOGGLE_CHIP = 'ml-auto size-9 justify-center gap-0 px-0! py-0!';

/** 행이 어느 단인가. `RAIL_SECTIONS` 에서 파생하므로 IA 원천이 늘지 않는다(위 ITEM_LEAD 주석). */
type Tier = 'lead' | 'body' | 'chip';

/* ⚠ 클래스 조립을 컴포넌트 밖에 두는 것은 취향이 아니다 — 단이 셋이라 삼항이 겹치고, 안에
   두면 `renderBtn` 이 인지복잡도 래칫(25)을 넘는다. 순수 함수라 여기가 제 자리이기도 하다. */
function itemClass(tier: Tier, collapsed: boolean, active: boolean): string {
  const geo = collapsed ? ITEM_COL : tier === 'lead' ? ITEM_LEAD : tier === 'chip' ? ITEM_CHIP : ITEM_EXP;
  const skin = active ? ITEM_ON : !collapsed && tier === 'lead' ? ITEM_OFF_LEAD : ITEM_OFF;
  return `${ITEM} ${geo} ${skin}`;
}

/** 본문 단만 한 눈금 작다(모바일 탭바는 IC_ITEM_SM 안에서 원래 크기로 되돌린다).
 *
 *  ⚠⚠ **접힘에서 무게 3단이 통째로 꺼져 있었다**(U072 · 2026-08-31). 종전 조건이
 *  `!collapsed && tier === 'body'` 라, 접히면 세 단이 전부 `ITEM_COL` + `IC_ITEM` 으로 **같은
 *  크기**가 됐다 — 하필 접힘이 **라벨이 없는 유일한 모드**이고, 그러니까 위계를 마크로만
 *  말해야 하는 곳이다. 즉 처방이 가장 필요한 자리에서 처방이 꺼졌다.
 *  ⚠ 크기(터치 타깃 `size-10.5`)는 안 건드린다 — 바뀌는 것은 **아이콘 눈금**뿐이고, 그건 펼침
 *  레일이 이미 쓰는 채널이라 새 어휘가 아니다.
 *  ⚠ 모바일 탭바는 `IC_ITEM_SM` 안의 `max-mobile:size-5` 가 원래 크기로 되돌린다(위 상수 주석) —
 *  거기선 아이콘만 보이므로 줄이면 계층이 아니라 그냥 작아진 것이 된다. 그 예외는 그대로다.
 *  ⚠ 그래서 인자에서 `collapsed` 가 빠졌다 — 조건이 접힘과 무관해졌으므로 받을 이유가 없다. */
function iconClass(tier: Tier): string {
  return tier === 'body' ? IC_ITEM_SM : IC_ITEM;
}

/* roving 대상의 **순서** — 보이는 것만. 접힌 축의 줄은 `display:none` 이라 브라우저가 포커스를
   안 주므로, 목록에 넣어 두면 화살표가 «아무 일도 안 하는 칸»을 돈다.
   ⚠ 컴포넌트 밖인 이유는 인지복잡도 래칫(25)이다 — 순수 함수라 여기가 제 자리이기도 하다. */
function visibleFocusIds(groups: NavGroup[], collapsed: boolean, isOpen: (key: string) => boolean): string[] {
  const ids = (g: NavGroup) => g.tabs.map((t) => 'rail-' + t.key);
  if (collapsed) return groups.flatMap(ids);
  const out: string[] = [];
  for (const g of groups) {
    if (g.key === LEAD_SECTION || g.key === FOOT_SECTION) {
      out.push(...ids(g));
      continue;
    }
    out.push('rail-sec-' + g.key);
    if (isOpen(g.key)) out.push(...ids(g));
  }
  return out;
}

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
  /* ⚠⚠ **T-13「지난번 이후」의 소비처가 여기다**(2026-08-20 리뷰 m-4).

     `lib/since.ts` 는 판정을, `app/useMarkSeen.ts` 는 시점을 소유했는데 **그리는 쪽이 없었다** —
     원래 그 자리였던 `SubTabs` 가 N-14/W5 에서 은퇴하며 함께 걷히지 않았고, 그래서 `seenDs` 는
     매 내비게이션마다 쓰이면서 **한 번도 읽히지 않는 값**이었다(쓰기만 있는 원장).

     ⚠ `seenDs` 는 `useApp`(동기화 대상)이 아니라 `useUI`(기기별)에 산다 — 그래서 `selectNavSignals`
     의 `keyed` 캐시 안에서 읽으면 안 된다(캐시 키가 `AppState` 라 무효화가 안 걸린다). 조립을
     화면에서 하는 것이 그 이유다: 판정=lib · 시점=훅 · 표시=여기, 세 층이 그대로 유지된다.
     ⚠ 신호가 이미 있는 탭은 **덮지 않는다** — "남은 3"이 "새 2"로 바뀌면 더 급한 말을 잃는다. */
  const seenDs = useUI((s) => s.ui.seenDs);
  const sinceState = useApp((st) => st.state);
  const sinceSignals = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of countableKeys()) {
      const n = sinceCount(sinceState, k, seenDs[k]);
      if (n != null) out[k] = `새 ${n}`;
    }
    return out;
  }, [sinceState, seenDs]);
  // 동기화 충돌(다른 기기 편집에 덮인 로컬 편집) 대기 수 — 설정 탭 코너 배지(Phase 4).
  const conflictBadge = useConflicts((s) => s.shadows.length);
  const curKey = loc.pathname.split('/')[1] || 'today';
  const cur = curKey; // N-14 — 평탄한 레일에서는 **자기 자신**이 활성이다(호스트 개념이 없다)
  /* @param animate 뷰 전환(크로스페이드)을 쓸지. ⚠ 방향키 roving 은 **끈다** — 화살표를 누르고
     있으면 키 반복(초당 20~30회)마다 View Transition 이 시작되고, 각 전환이 이전 것을 중단시켜
     레일·본문이 계속 반투명 상태로 깜빡인다(원하는 탭에 도착해도 잔상이 남는다). 클릭·⌘K 처럼
     '한 번의 의도적 이동'에서만 애니가 의미가 있다. */
  /* N-11 — 레일에서 출발한 내비게이션임을 표시한다. 방향키 roving 도 레일이다(같은 목록을
     같은 손으로 돈다). */
  /* ⚠⚠ **E27 `lastLens` 가 여기 있었다 — N-14(W5) 가 그 이유를 없앴다.** 그 장치는 *"레일 클릭이
     호스트의 첫 렌즈로만 가서 배분 보드까지 2클릭"* 을 덧대는 것이었는데, 평탄화 뒤에는 렌즈가
     자기 줄을 가지므로 **1클릭**이다. 덧댈 것이 없으면 덧대는 장치도 없앤다(그 기억은 세션
     한정 전역 상태였고, 그런 상태는 없을수록 좋다). */
  const go = (key: string, animate = true) => {
    markVia('rail');
    void navigate('/' + key, { viewTransition: animate });
  };

  const ledger = useSyncLedger();
  /* ⚠⚠ **여기 N-17 「사용자가 조립한 레일」(숨김·순서)이 있었다 — 은퇴했다**(I027 · 2026-08-22).
     그 노브의 근거는 _"안 쓰는 화면이 매일 눈에 들어온다"_ 였고, 처방은 **강등을 사용자에게
     넘긴다** 였다. 실측이 그 처방을 반증했다: 2026-08-07 출하 뒤 **15일 · `railHidden` 과
     `railOrder` 가 둘 다 빈 배열**이었다(그사이 설정 화면 방문은 원장에 있다 — 못 본 게 아니라
     **접을 이유가 없었다**). 판단이 필요 없는 결정을 판단으로 만들지 않겠다던 노브가, 정작
     아무 판단도 받지 않은 채 216줄 + 설정 한 절 + 유닛 파일 하나를 지고 있었다.
     ⚠ **레일을 줄이는 일 자체는 함께 죽지 않았다** — 다만 이 노브는 「무엇을 줄일까」의
     근거가 되어 주기로 했던 것이고(«무엇을 접었는지가 곧 답»), 그 답이 **빈 배열**이라
     지금은 근거가 없다. 줄이려면 오염되지 않은 방문 원장(I030 뒤)이 먼저다. */
  /* ── 축 접기(2026-08-28) ──────────────────────────────────────────────────
     ⚠⚠ **평탄한 레일은 화면 수와 함께 자란다** — W5 평탄화 이후 «새 화면 = 새 레일 줄»이
     기본값이었고 15줄이 됐다. 그 축을 끊는다: 레일은 **모든 화면의 목록**이 아니라 **작업 세트**다.
     전량 열거의 집은 `찾기`(guide 흡수)와 ⌘K 이고, 링(`[`/`]`)은 접힘과 무관하게 계속 전부를
     돈다 — 즉 **도달성은 하나도 줄지 않는다**(줄어드는 것은 «상시 읽어야 하는 줄»뿐이다).

     ⚠ **열림 상태를 저장하지 않는다.** 열린 축 = **현재 축**이고, 그게 전부다. 상태를 두면
     ① 두 축이 동시에 열려 다시 15줄이 되고 ② 사용자가 접어 둔 것과 라우트가 어긋나 «내가 지금
     어디인가»가 흐려진다. 순수 파생이라 되돌릴 상태 자체가 없다(I027 이 남긴 교훈 — 판단이
     필요 없는 결정을 노브로 만들지 않는다).
     ⚠ 그래서 헤더 클릭은 **접기 토글이 아니라 그 축의 얼굴로 가는 이동**이다(빈손으로 끝나는
     클릭을 만들지 않는다). 얼굴은 로스터가 이미 안다 — 축마다 `destination` 하나다. */
  const groups = navGroups();
  const leadGroup = groups.find((g) => g.key === LEAD_SECTION);
  const axisGroups = groups.filter((g) => g.key !== LEAD_SECTION && g.key !== FOOT_SECTION);
  const bottomGroup = groups.find((g) => g.key === FOOT_SECTION);
  /* ⚠⚠ **객체 라우트(`/subject/:id`)는 어느 축에도 없다**(U058 · 2026-08-31). 그대로 두면
     `curSection` 이 `undefined` 가 되어 **두 축이 동시에 닫히고**, 과목을 열고 닫을 때마다 레일
     9줄이 점멸한다 — 이 앱에서 가장 잦은 객체 상호작용이다. 접기 설계가 내건 보장(_"열림은
     라우트의 파생"_)이 성립하지 않는 유일한 구간이었다.

     ⚠ 리포트의 처방은 «직전 축을 이어 쓴다» 였지만 **그대로 쓰지 않았다.** ① 그건 렌더 중
     `ref` 를 읽는 형태가 되고, 이 저장소는 React Compiler 전제라 `react-hooks/refs` 가 그것을
     **error 로 막는다**(실제로 막혔다). ② 더 중요하게, 그 안은 «어디서 왔는가» 에 의존해서
     **같은 화면이 경로마다 다른 축을 연다** — 새로고침하면 또 달라진다.
     → **객체의 집을 정적으로 정한다.** 과목 상세는 「과목」 탭의 객체이므로 그 축이 곧 답이고,
     이건 상태가 아니라 파생이라 되돌릴 것도 저장할 것도 없다(설계가 못박은 규율 그대로). */
  const 객체의집: Record<string, string> = { subject: 'items' };
  const 축키 = 객체의집[cur] ?? cur;
  const curSection = groups.find((g) => g.tabs.some((t) => t.key === 축키))?.key;
  // 접힘(42px 아이콘 레일)엔 헤더가 들어갈 폭이 없다 → 거기선 평탄한 옛 형태 그대로다.
  const isOpen = (key: string) => collapsed || key === curSection;
  /** 그 축의 얼굴. 로스터의 `destination` 이 곧 얼굴이라 새 필드를 안 만든다(불변식 ㉜이 지킨다). */
  const faceOf = (g: NavGroup) => g.tabs.find((t) => t.role === 'destination') ?? g.tabs[0]!;

  const focusIds = visibleFocusIds(groups, collapsed, isOpen);
  // 활성 탭이 목록에 없으면(명사 주소·접힌 축) 첫 버튼을 tab stop 으로.
  const tabStop = focusIds.includes('rail-' + cur) ? 'rail-' + cur : focusIds[0];

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
  const onKey = (id: string) => (e: React.KeyboardEvent) => {
    const idx = focusIds.indexOf(id);
    if (idx < 0) return;
    let next = -1;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (idx + 1) % focusIds.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (idx - 1 + focusIds.length) % focusIds.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = focusIds.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    /* 포커스만 옮긴다 — `go()` 를 부르지 않는 것이 H10 의 전부다. roving tabindex 이므로
       `tabIndex` 는 `cur` 이 아니라 **DOM 포커스**를 따라야 하는데, 그 계산은 아래
       `renderBtn` 이 `activeKey`(=현재 라우트)로 하고 있어 포커스 이동 자체는 막지 않는다
       (브라우저가 focus() 를 그대로 수행한다). */
    document.getElementById(focusIds[next]!)?.focus();
  };

  /* U023 — 탭바가 가로로 스크롤되면 **활성 탭이 화면 밖에서 시작할 수 있다**(예: `/settings` 는
     목록 끝이다). 「지금 어디인가」는 나브의 첫 번째 일이므로 현재 탭을 보이는 자리로 데려온다.
     ⚠ 세로는 건드리지 않는다(`block: 'nearest'`) — 데스크톱 레일에서도 이 이펙트가 도는데
     거기서 페이지를 스크롤하면 안 된다. 가로 축만 필요하다. */
  useEffect(() => {
    const el = document.getElementById('rail-' + cur);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [cur]);

  const renderBtn = (t: TabMeta, tier: Tier = 'body') => {
    const id = 'rail-' + t.key;
    const active = cur === t.key;
    // 배지 두 종류: journal=복습·보충 대기 · settings=동기화 충돌 대기. 라벨도 각각.
    const isConflict = t.key === 'settings' && conflictBadge > 0;
    const badge = t.key === NAV_BADGE_TAB ? reviewBadge : t.key === 'settings' ? conflictBadge : 0;
    const badgeLabel = isConflict ? `동기화 충돌 ${badge}건` : `복습·보충 ${badge}건 대기`;
    // 접힘 레일엔 글자 자리가 없다 → 신호는 펼침 전용이고 접힘은 배지가 계속 맡는다.
    // ⚠ 기존 신호가 이기고, 없을 때만 「지난번 이후」가 말한다(위 ⚠ 참조).
    const signal = collapsed ? '' : (signals[t.key] ?? sinceSignals[t.key] ?? '');
    return (
      <button
        key={t.key}
        id={id}
        type="button"
        aria-current={active ? 'page' : undefined}
        aria-label={badge > 0 ? `${t.label} — ${badgeLabel}` : signal ? `${t.label} — ${signal}` : t.label}
        tabIndex={id === tabStop ? 0 : -1}
        className={itemClass(tier, collapsed, active)}
        onKeyDown={onKey(id)}
        onMouseEnter={() => prefetchTab(t.key)}
        onFocus={() => prefetchTab(t.key)}
        onClick={() => go(t.key)}
      >
        <Icon name={t.icon} className={iconClass(tier)} />
        {collapsed ? (
          <span className={LABEL_COL}>{t.label}</span>
        ) : tier === 'chip' ? (
          <span className={LABEL_CHIP}>{t.label}</span>
        ) : (
          /* 라벨 + 상태 한 줄(N-13). 신호가 없으면 줄 자체가 없다 — 빈 줄을 그려 두면 높이가
             늘 흔들리고, "평온엔 아무것도 안 그린다"가 레이아웃에서 배신당한다. */
          <span className="min-w-0 flex-1">
            <span className={LABEL}>{t.label}</span>
            {signal && <span className={SIGNAL}>{signal}</span>}
          </span>
        )}
        {/* ⚠⚠ **배지는 접힘 전용이다(W7 · 2026-07-31).** 종전엔 `journal` 하나가 같은 두 수를
            두 번 그렸다 — 배지는 `overdue + backlog` **합계**, 바로 아래 신호줄은 `밀림 N ·
            보충 M` **분해**. 두 조건이 정확히 일치해 펼침 상태에선 **항상 동시에** 렌더됐다.
            게다가 합계 형태는 `selectors.ts:151` 이 스스로 _"둘은 성격이 다른 일이라 합치면
            어느 쪽도 행동으로 안 이어진다"_ 라 금지한 바로 그 형태다 — 주석이 금지한 것을 옆
            파일이 계속 그리고 있었다. 배지가 필요한 유일한 상태는 **글자가 안 들어가는 42px
            접힘**이고, 그 근거는 위 `SIGNAL` 주석이 이미 소유한다. */}
        {badge > 0 && (collapsed || !signal) && (
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

     ⚠⚠ **N-14+N-16(W5 · 2026-08-07)이 그 전제를 뒤집어 헤더를 되살렸다.** 평탄화로 레일이
     **두 자릿수**가 됐다 — 즉 E22 가 근거로 든 수(destination 7 · 그룹당 1.75)가 더는 사실이
     아니고, 청킹이 값을 내는 구간(7+)에 정확히 들어왔다.
     ⚠ 이 판단의 근거가 되는 수는 **여기 적지 않는다**(2026-08-20 리뷰 n-5): 정본은
     `shell/tabs.ts` 의 `railCandidates()` 이고, 종전에 손으로 적힌 "열넷"은 실측과 달랐다.
     판단의 전제가 되는 수를 산문에 굳히면 전제가 조용히 낡는다.
     그런데 **이름이 바뀌었다**: 라벨이 명사(계획·숙련)면 그건 *분류*라 사용자가 외워야 하고,
     질문이면 자기가 지금 묻는 것과 **맞춰 보기만** 하면 된다(N-16 질문 축). 그래서 헤더에
     뜨는 것은 `RAIL_SECTIONS[].question` 이다.
     ⚠ 접힘(42px)에서는 여전히 **구분선**이다 — 질문 한 줄이 들어갈 폭이 없고, 잘린 질문은
       없는 것보다 나쁘다(H12 가 동기화 문구에서 내린 것과 같은 판정).
     ⚠ SR 에는 `aria-label` 로 같은 질문을 준다 — 시각 사용자에게 보이는 경계이므로 이번엔
       "보이지 않는 그룹을 SR 에만 알리는" 문제가 아니다(E22 가 뗀 이유가 바로 그것이었다). */
  /** 그 축 안에서 «말할 것이 있는 화면»의 수. 접혔을 때만 쓴다(펼치면 각 줄이 스스로 말한다). */
  const pendingIn = (g: NavGroup) =>
    g.tabs.filter(
      (t) =>
        (signals[t.key] ?? sinceSignals[t.key]) ||
        (t.key === NAV_BADGE_TAB && reviewBadge > 0) ||
        (t.key === 'settings' && conflictBadge > 0),
    ).length;

  /* ⚠ **선두 축은 헤더도 접기도 없다** — 매일 여는 셋이라 상시다. 그 경계는 구분선이 긋는다.
     (N-16 의 질문 «지금 뭐부터?» 는 SR 에 `aria-label` 로 계속 간다 — 시각적으로는 맞춰 볼
     것도 없이 그 답 자체라 캡션 한 줄을 더 읽히지 않는다.) */
  const renderLead = (g: NavGroup) => (
    <div
      key={g.key}
      className={`${GROUP} ${collapsed ? GROUP_COL : GROUP_GAP}`}
      role={collapsed ? undefined : 'group'}
      aria-label={collapsed ? undefined : g.label}
    >
      {g.tabs.map((t) => renderBtn(t, 'lead'))}
      {!collapsed && <div className={DIVIDER_EXP} aria-hidden="true" />}
    </div>
  );

  /* 축 하나 = 헤더(disclosure) + 그 축의 화면들.
     ⚠ 헤더 클릭은 **접기 토글이 아니다** — 그 축의 얼굴로 이동하고, 그 결과로 열린다(열림은
     라우트의 파생이다). 이미 그 축에 있으면 얼굴로 돌아간다.
     ⚠ hover 로는 안 펼친다 — 포인터가 스칠 때 레일이 튀는 것이 「편함」을 가장 크게 깎는다. */
  const renderAxis = (g: NavGroup) => {
    const open = isOpen(g.key);
    const n = open ? 0 : pendingIn(g);
    return (
      <div key={g.key} className={`${GROUP} ${collapsed ? GROUP_COL : GROUP_GAP}`}>
        {collapsed ? (
          <div className={DIVIDER} aria-hidden="true" />
        ) : (
          <button
            id={'rail-sec-' + g.key}
            type="button"
            className={`${HEAD_BTN} ${open ? HEAD_OPEN : HEAD_SHUT}`}
            aria-expanded={open}
            aria-controls={'rail-sec-body-' + g.key}
            aria-label={n > 0 ? `${g.label} — 신호 ${n}개` : g.label}
            tabIndex={'rail-sec-' + g.key === tabStop ? 0 : -1}
            onKeyDown={onKey('rail-sec-' + g.key)}
            onMouseEnter={() => prefetchTab(faceOf(g).key)}
            onFocus={() => prefetchTab(faceOf(g).key)}
            onClick={() => go(faceOf(g).key)}
          >
            <Icon name="chevronRight" className={`${IC_CHEV} ${open ? IC_CHEV_OPEN : ''}`} />
            <span className={LABEL}>{g.label}</span>
            {n > 0 && (
              <span className={HEAD_PILL} aria-hidden="true">
                {n > 99 ? '99+' : n}
              </span>
            )}
          </button>
        )}
        <div
          id={'rail-sec-body-' + g.key}
          className={collapsed || open ? `${SEC} ${collapsed ? GROUP_COL : ''}` : SEC_SHUT}
          role={collapsed ? undefined : 'group'}
          aria-label={collapsed ? undefined : g.label}
        >
          {g.tabs.map((t) => renderBtn(t, 'body'))}
        </div>
      </div>
    );
  };

  return (
    <nav className={`${RAIL} ${collapsed ? RAIL_COL : RAIL_EXP}`} aria-label="주요 메뉴" data-collapsed={collapsed}>
      <div className={`${BRAND} ${collapsed ? BRAND_COL : BRAND_EXP}`} aria-hidden="true">
        <div className={LOGO}>L</div>
        {!collapsed && <span className={WORD}>러닝 허브</span>}
      </div>

      <div className={`${GROUPS} ${collapsed ? GROUPS_COL : ''}`}>
        {leadGroup && renderLead(leadGroup)}
        {axisGroups.map(renderAxis)}
      </div>
      <div className={SPACER} />
      {/* E12 — 데스크톱도 자기 동기화 상태를 말한다. 폰 헤더와 **같은 컴포넌트·같은 판정**이라
          두 기기가 서로 다른 조건에서 침묵할 수 없다(달라지는 것은 여백뿐).
          ⚠ 접힘(아이콘 전용) 레일에선 **문장만** 숨긴다(H12 · 2026-07-31) — 42px 폭에 넣으면
            잘리고 잘린 상태 문구는 없는 것보다 나쁘다. 그런데 종전엔 컴포넌트를 통째로 언마운트해
            **상시 라이브 리전까지 함께 사라졌다**: 접힘을 쓰는 사용자는 "동기화 중단"을 시각으로도
            스크린리더로도 못 받았고, 접힘은 영속 설정이라 그 침묵이 항구적이었다. */}
      <SyncLedger {...ledger} hideText={collapsed} className="px-2.5 pb-1.5" />
      {/* ⚠ 저빈도 운영 화면 둘은 **줄이 아니라 칩**이다(2026-08-28) — 상시 노출은 유지하되
          "매일 여는 것"과 같은 형상을 쓰지 않는다. 접힘 레일에선 이미 칩이므로 그대로 둔다.
          ⚠⚠ 1280×720 에서 레일 콘텐츠가 **뷰포트를 넘어** `연동 현황`·접기 토글이 스크롤
          아래에 있었다(스냅샷 실측 · 스크롤바는 숨김이라 넘쳤다는 신호조차 없었다). 이 줄과
          위 행 높이 축소가 그 넘침을 걷는다. */}
      {bottomGroup &&
        (collapsed ? (
          renderAxis(bottomGroup)
        ) : (
          <div className={FOOT} role="group" aria-label={bottomGroup.label}>
            {bottomGroup.tabs.map((t) => renderBtn(t, 'chip'))}
            <button
              type="button"
              className={`${TOGGLE} ${TOGGLE_CHIP}`}
              aria-label="사이드바 접기"
              aria-pressed={false}
              onClick={toggleNav}
            >
              <Icon name="panelLeft" className={IC_TOGGLE} />
            </button>
          </div>
        ))}
      {collapsed && (
        <button
          type="button"
          className={`${TOGGLE} ${TOGGLE_COL}`}
          aria-label="사이드바 펼치기"
          aria-pressed
          onClick={toggleNav}
        >
          <Icon name="panelLeft" className={IC_TOGGLE} />
        </button>
      )}
    </nav>
  );
}
