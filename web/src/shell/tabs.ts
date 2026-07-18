/* ============================================================
   shell/tabs.ts — 탭 레지스트리(레거시 tabs.js의 registerTab 분산 등록 → 네이티브 단일 표).
   탭 추가 = 이 배열에 한 줄 + features/registry.tsx에 컴포넌트 등록. 나브/팔레트가 이걸 단일 원천으로 순회.
============================================================ */
/** 나브 표면(Wave⑥) — 학습(핵심·숙련) vs 자료(수집·발견). surface 미지정=전역(두 표면 공통, 설정 그룹). */
export type Surface = 'study' | 'materials';

export interface TabMeta {
  key: string;
  label: string;
  group: string;
  order: number;
  hidden?: boolean;
  icon: string;
  /** 소속 표면(Wave⑥ 스위처). 미지정=전역(학습·자료 양쪽에 노출 · 설정 그룹). */
  surface?: Surface;
  /** 단일 화면 대시보드 탭(데모 v6 사상) — HudFrame을 가득 채우고 내부 스크롤 없음.
     App의 fillFrame 판정 단일 원천(옛 하드코딩 FILL_TABS 목록 대체, L-15). */
  fill?: boolean;
  /** 세그먼트 셸 호스트(예: plan-host) — 나브·라우트엔 존재하되 SubTabs 버튼으론 렌더하지 않는다
     (자체 화면 없이 기본 세그먼트로 리다이렉트, 자식 세그먼트만 세그먼트 바에 노출). */
  shell?: boolean;
  /** SubTabs 세그먼트 버튼에 쓸 짧은 라벨(없으면 label). 나브·⌘K·문서 제목은 그대로 label을 쓴다. */
  segLabel?: string;
}

/** 모든 탭(표시 순서·그룹·표면·아이콘). hidden은 나브에서 숨김(헤더 ⚙·⌘K로 진입).
   Wave⑥ 표면 분리: **학습**(study · 계획 plan/숙련 train)과 **자료**(materials · 수집 collect/발견 discover)를
   상단 스위처로 가르고, **설정**(settings) 그룹은 두 표면 공통(전역 · surface 미지정). group=표면 내 소분류.
   빈도 위계: 매일(계획) > 주간(숙련·수집) > 드묾(발견·설정은 하단·⌘K 진입). */
export const TABS: TabMeta[] = [
  // ── 학습 표면 · 계획(plan) ──
  { key: 'today', label: '오늘 학습', group: 'plan', surface: 'study', order: 10, icon: 'target', fill: true },
  // 계획 호스트(plan-host) — 뼈대(routine)·과목(items)·배치(schedule)를 세그먼트로 묶는 셸.
  // 나브엔 '계획' 한 줄로 노출(today 다음·goals 앞, §3-2). 자체 화면 없이 배치(배치=주간 스케줄)로 리다이렉트.
  {
    key: 'plan-host',
    label: '계획',
    group: 'plan',
    surface: 'study',
    order: 12,
    icon: 'calendar',
    fill: true,
    shell: true,
  },
  // 내 길(goals) — 축 A '내 길 지도'(P9 Phase 6). 전략 앵커(전파통신 연구원 자립 트리)라 오늘 다음, 계획 상단.
  { key: 'goals', label: '내 길', group: 'plan', surface: 'study', order: 15, icon: 'compass' },
  // 배치 세그먼트(주간 스케줄) — 계획 호스트로 흡수(hidden). 라우트·⌘K·g s·딥링크는 유지. 세그먼트 라벨='배치'.
  {
    key: 'schedule',
    label: '주간 스케줄',
    group: 'plan',
    surface: 'study',
    order: 20,
    hidden: true,
    segLabel: '배치',
    icon: 'calendar',
    fill: true,
  },
  // 아래 흡수 탭들은 나브에서 숨기고, 호스트 탭(스케줄·기록·통계) 상단 섹션 세그먼트(SubTabs)로 전환한다.
  // 라우트·팔레트·g단축키로는 그대로 진입 가능(SUBTAB_GROUPS 참조).
  // routine — '뼈대' 세그먼트는 '과목' 탭으로 병합됐다(계획 재개편 v3). 이 키는 리다이렉트 shim만 남아
  // `g o`·⌘K·기존 `/routine` 딥링크를 '/items'로 넘긴다. SUBTAB_GROUPS에는 더 이상 없다(세그먼트 소멸).
  {
    key: 'routine',
    label: '가용시간·수업·일과 (→ 과목)',
    group: 'plan',
    surface: 'study',
    order: 30,
    hidden: true,
    icon: 'clock',
  },
  // 졸업 계획 — 스케줄 세그먼트에서 독립 탭으로 승격(주간 운영과 학기 단위 계획은 리듬이 달라 나브에 직접 노출).
  { key: 'degree', label: '졸업 계획', group: 'plan', surface: 'study', order: 35, icon: 'cap' },
  // 과목(items) — 전공 과목·챕터 카탈로그 + 뼈대(가용시간·수업·일과) + 과목별 요일 배분(계획 재개편 v3).
  // 계획 호스트로 흡수(hidden). 세그먼트 라벨='과목' — 계획은 이제 [과목 · 배치] 2세그먼트다.
  // fill: 좌 갤러리 / 우 가용 레일이 화면을 꽉 채우는 프레임이라 여백 래퍼 없이 붙인다.
  {
    key: 'items',
    label: '과목',
    group: 'plan',
    surface: 'study',
    order: 40,
    hidden: true,
    segLabel: '과목',
    icon: 'file',
    fill: true,
  },
  // ── 학습 표면 · 숙련(train) — '내가 뭘 아는가·무엇을 익힐까' ──
  { key: 'journal', label: '학습 기록', group: 'train', surface: 'study', order: 60, icon: 'notebook', fill: true },
  {
    key: 'review',
    label: '주간 리뷰',
    group: 'train',
    surface: 'study',
    order: 70,
    hidden: true,
    icon: 'refresh',
    fill: true,
  },
  // I-9: 복습 세션 러너 — 오늘 인출할 것(밀린 챕터·회상·착각 재확인)을 한 흐름으로 굴리는 doing surface.
  // hidden(나브 숨김) · 오늘탭 복습칩(I-2)·⌘K·기록 세그먼트로 진입 · fill(단일 화면).
  {
    key: 'review-run',
    label: '복습 실행',
    group: 'train',
    surface: 'study',
    order: 72,
    hidden: true,
    icon: 'refresh',
    fill: true,
  },
  { key: 'stats', label: '통계', group: 'train', surface: 'study', order: 80, icon: 'chart', fill: true },
  {
    key: 'mastery',
    label: '숙달도 지도',
    group: 'train',
    surface: 'study',
    order: 85,
    hidden: true,
    icon: 'grid',
    fill: true,
  },
  // 지식맵은 통계 호스트의 섹션으로 접는다(숙달도 지도와 함께 '내가 뭘 아는가' 맵 묶음). 라우트·⌘K·g단축키는 유지.
  {
    key: 'graph',
    label: '지식맵',
    group: 'train',
    surface: 'study',
    order: 87,
    hidden: true,
    icon: 'graph',
    fill: true,
  },
  // ── 자료 표면 · 수집(collect) — 피드·읽을거리 ──
  { key: 'reads', label: '읽을거리', group: 'collect', surface: 'materials', order: 45, icon: 'reads' },
  { key: 'markets', label: '증시 동향', group: 'collect', surface: 'materials', order: 47, icon: 'trend' },
  { key: 'atlas', label: '진로 지도', group: 'collect', surface: 'materials', order: 48, icon: 'radio' },
  // ── 자료 표면 · 발견(discover) — surface·triage·연동 ──
  // 발견 큐(discovery) — 축 C '발견 루프'(P9 Phase 6 Wave④). 수집·surface·다리개념 후보를 사람이 승격/기각(D5).
  { key: 'discovery', label: '발견', group: 'discover', surface: 'materials', order: 49, icon: 'discovery' },
  {
    key: 'integrations',
    label: '연동 현황',
    group: 'discover',
    surface: 'materials',
    order: 50,
    icon: 'link',
    fill: true,
  },
  // 정본 원장 — 과목×챕터 5단계 파이프라인 진척(통합 4단계 소비). 연동 현황 호스트의 세그먼트로 접는다
  // (자료 생산·연결 상태 묶음). 나브 숨김 · 라우트·⌘K·g단축키·세그먼트로 진입 · fill(단일 화면).
  {
    key: 'ledger',
    label: '정본 원장',
    group: 'discover',
    surface: 'materials',
    order: 52,
    hidden: true,
    icon: 'grid',
    fill: true,
  },
  // ── 전역(설정) — surface 미지정 → 학습·자료 두 표면 하단에 공통 노출 ──
  // 안내(guide) — 이 시스템이 할 수 있는 것 + 하는 법 매뉴얼(전역 참조). 스크롤 페이지라 fill 없음.
  { key: 'guide', label: '안내', group: 'settings', order: 185, icon: 'book' },
  // 제어판은 나브에 노출(설정 그룹). 탐구 수집·지식 재빌드 등 운영 도구 진입점.
  { key: 'control', label: '탐구 수집', group: 'settings', order: 190, icon: 'search', fill: true },
  { key: 'settings', label: '설정', group: 'settings', order: 200, hidden: true, icon: 'gear' },
];

/* TABS는 런타임 불변 상수 → 표시순 정렬·key 조회를 모듈 로드 시 1회만 계산하고 재사용(C-8).
   매 내비게이션마다 slice().sort()/find 선형스캔이 헛돌던 것 제거. 반환 배열은 읽기 전용으로 다룬다(제자리 변형 금지). */
export const ORDERED_TABS: TabMeta[] = [...TABS].sort((a, b) => a.order - b.order);
const TAB_BY_KEY = new Map(TABS.map((t) => [t.key, t]));

/* ── 섹션 세그먼트(흡수 탭) ─────────────────────────────────────────────
   한 호스트 탭의 '페이지 안 섹션'으로 묶이는 탭들(첫 항목=나브에 노출되는 호스트).
   나브 정리: 매일 안 쓰는 계획/분석 화면을 호스트 상단 세그먼트로 접어 1차 나브를 6개로 줄인다.
   라우트는 전부 살아있어 딥링크·⌘K·g단축키가 그대로 동작한다. */
export const SUBTAB_GROUPS: string[][] = [
  // 계획 호스트: plan-host(셸·나브 노출) 아래 뼈대(routine)·과목(items)·배치(schedule) 3세그먼트.
  // host=첫 항목=plan-host → hostTabKey가 세 세그먼트를 '계획'으로 하이라이트. SubTabs는 셸을 버튼에서 제외.
  ['plan-host', 'items', 'schedule'],
  ['integrations', 'ledger'],
  ['journal', 'review', 'review-run'],
  ['stats', 'mastery', 'graph'],
];

/* ── 나브 그룹(라벨+그룹 사이드바) ────────────────────────────────────────
   TabMeta.group(plan/train/collect/discover/settings) → 사이드바 섹션 헤더 라벨. 빈도 위계를 시각적 청킹으로.
   settings 그룹은 하단(스페이서 아래)에 렌더 — 저빈도 운영/설정(두 표면 공통). */
export const GROUP_LABELS: Record<string, string> = {
  plan: '계획',
  train: '숙련',
  collect: '수집',
  discover: '발견',
  settings: '설정',
};

/* ── 표면 스위처(Wave⑥) ──────────────────────────────────────────────────
   학습(핵심·숙련) vs 자료(수집·발견) 두 표면. RailSidebar 상단 세그먼트가 이걸 순회한다. */
export interface SurfaceMeta {
  key: Surface;
  label: string;
  icon: string;
  /** 스위처 클릭 시 이동할 홈 탭 key(그 표면 첫 노출 탭). */
  home: string;
}
export const SURFACES: SurfaceMeta[] = [
  { key: 'study', label: '학습', icon: 'target', home: 'today' },
  { key: 'materials', label: '자료', icon: 'reads', home: 'reads' },
];

export interface NavGroup {
  key: string;
  label: string;
  tabs: TabMeta[];
}

/** 한 표면(surface)에 노출되는 탭을 그룹 순서대로 묶는다(첫 등장=order 최소). 포함 조건:
   ① 나브 노출(!hidden 또는 settings=하단 진입점) ② 그 표면 소속(t.surface===surface) 또는 전역(미지정).
   나머지 hidden(흡수 탭)은 SubTabs로만 진입. 전역(설정) 그룹은 두 표면 모두에 하단 노출. */
function buildNavGroups(surface: Surface): NavGroup[] {
  const visible = ORDERED_TABS.filter(
    (t) => (!t.hidden || t.key === 'settings') && (t.surface === surface || t.surface === undefined),
  );
  const groups: NavGroup[] = [];
  for (const t of visible) {
    let g = groups.find((x) => x.key === t.group);
    if (!g) {
      g = { key: t.group, label: GROUP_LABELS[t.group] ?? t.group, tabs: [] };
      groups.push(g);
    }
    g.tabs.push(t);
  }
  return groups;
}
/** 표면별 나브 그룹 — TABS 불변이라 표면당 1회 계산해 재사용(C-8 · 매 렌더 재빌드 제거). */
const NAV_GROUPS_BY_SURFACE: Record<Surface, NavGroup[]> = {
  study: buildNavGroups('study'),
  materials: buildNavGroups('materials'),
};
export function navGroups(surface: Surface): NavGroup[] {
  return NAV_GROUPS_BY_SURFACE[surface];
}

/** key가 속한 표면 — 탭 메타의 surface(전역=undefined). 라우트에서 활성 표면 파생에 쓴다. */
export function surfaceOf(key: string): Surface | undefined {
  return TAB_BY_KEY.get(key)?.surface;
}
/** 표면의 홈 탭 key(스위처 클릭 시 이동). SURFACES.home 단일 원천. */
export function surfaceHome(surface: Surface): string {
  return SURFACES.find((s) => s.key === surface)?.home ?? 'today';
}

/** key가 속한 섹션 그룹의 탭 메타 배열(첫 항목=호스트). 그룹에 없으면 null. */
export function subTabGroupOf(key: string): TabMeta[] | null {
  const g = SUBTAB_GROUPS.find((arr) => arr.includes(key));
  if (!g) return null;
  return g.map((k) => tabByKey(k)).filter((t): t is TabMeta => !!t);
}

/** 나브가 1차 활성으로 칠 호스트 key — 흡수 탭이면 그 호스트, 아니면 자기 자신. */
export function hostTabKey(key: string): string {
  const g = SUBTAB_GROUPS.find((arr) => arr.includes(key));
  return g ? g[0]! : key;
}

/** 표시 순서대로 정렬된 탭(모듈 로드 시 1회 계산된 상수 반환 — 제자리 변형 금지). */
export function orderedTabs(): TabMeta[] {
  return ORDERED_TABS;
}
export function tabByKey(key: string): TabMeta | undefined {
  return TAB_BY_KEY.get(key);
}
