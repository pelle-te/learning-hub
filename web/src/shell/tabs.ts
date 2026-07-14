/* ============================================================
   shell/tabs.ts — 탭 레지스트리(레거시 tabs.js의 registerTab 분산 등록 → 네이티브 단일 표).
   탭 추가 = 이 배열에 한 줄 + features/registry.tsx에 컴포넌트 등록. 나브/팔레트가 이걸 단일 원천으로 순회.
============================================================ */
export interface TabMeta {
  key: string;
  label: string;
  group: string;
  order: number;
  hidden?: boolean;
  icon: string;
  /** 단일 화면 대시보드 탭(데모 v6 사상) — HudFrame을 가득 채우고 내부 스크롤 없음.
     App의 fillFrame 판정 단일 원천(옛 하드코딩 FILL_TABS 목록 대체, L-15). */
  fill?: boolean;
}

/** 모든 탭(표시 순서·그룹·아이콘). hidden은 나브에서 숨김(헤더 ⚙·⌘K로 진입).
   빈도 위계: 매일(계획) > 주간(자료·기록) > 드묾(졸업은 계획 끝에, 제어판/설정은 숨김·⌘K 진입). */
export const TABS: TabMeta[] = [
  { key: 'today', label: '오늘 학습', group: 'do', order: 10, icon: 'target', fill: true },
  // 내 길(goals) — 축 A '내 길 지도'(P9 Phase 6). 전략 앵커(전파통신 연구원 자립 트리)라 오늘 다음, 계획 그룹 상단.
  { key: 'goals', label: '내 길', group: 'do', order: 15, icon: 'compass' },
  { key: 'schedule', label: '주간 스케줄', group: 'do', order: 20, icon: 'calendar', fill: true },
  // 아래 흡수 탭들은 나브에서 숨기고, 호스트 탭(스케줄·기록·통계) 상단 섹션 세그먼트(SubTabs)로 전환한다.
  // 라우트·팔레트·g단축키로는 그대로 진입 가능(SUBTAB_GROUPS 참조).
  { key: 'routine', label: '가용시간·수업·일과', group: 'do', order: 30, hidden: true, icon: 'clock', fill: true },
  { key: 'degree', label: '졸업 계획', group: 'do', order: 35, hidden: true, icon: 'cap' },
  { key: 'items', label: '학습 항목', group: 'src', order: 40, icon: 'file' },
  { key: 'reads', label: '읽을거리', group: 'src', order: 45, icon: 'reads' },
  { key: 'markets', label: '증시 동향', group: 'src', order: 47, icon: 'trend' },
  { key: 'atlas', label: '진로 지도', group: 'src', order: 48, icon: 'radio' },
  { key: 'integrations', label: '연동 현황', group: 'src', order: 50, icon: 'link', fill: true },
  // 정본 원장 — 과목×챕터 5단계 파이프라인 진척(통합 4단계 소비). 연동 현황 호스트의 세그먼트로 접는다
  // (자료 생산·연결 상태 묶음). 나브 숨김 · 라우트·⌘K·g단축키·세그먼트로 진입 · fill(단일 화면).
  { key: 'ledger', label: '정본 원장', group: 'src', order: 52, hidden: true, icon: 'grid', fill: true },
  { key: 'journal', label: '학습 기록', group: 'log', order: 60, icon: 'notebook', fill: true },
  { key: 'review', label: '주간 리뷰', group: 'log', order: 70, hidden: true, icon: 'refresh', fill: true },
  // I-9: 복습 세션 러너 — 오늘 인출할 것(밀린 챕터·회상·착각 재확인)을 한 흐름으로 굴리는 doing surface.
  // hidden(나브 숨김) · 오늘탭 복습칩(I-2)·⌘K·기록 세그먼트로 진입 · fill(단일 화면).
  { key: 'review-run', label: '복습 실행', group: 'log', order: 72, hidden: true, icon: 'refresh', fill: true },
  { key: 'stats', label: '통계', group: 'log', order: 80, icon: 'chart', fill: true },
  { key: 'mastery', label: '숙달도 지도', group: 'log', order: 85, hidden: true, icon: 'grid', fill: true },
  // 지식맵은 통계 호스트의 섹션으로 접는다(숙달도 지도와 함께 '내가 뭘 아는가' 맵 묶음). 라우트·⌘K·g단축키는 유지.
  { key: 'graph', label: '지식맵', group: 'log', order: 87, hidden: true, icon: 'graph', fill: true },
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
  ['schedule', 'routine', 'degree'],
  ['integrations', 'ledger'],
  ['journal', 'review', 'review-run'],
  ['stats', 'mastery', 'graph'],
];

/* ── 나브 그룹(라벨+그룹 사이드바) ────────────────────────────────────────
   TabMeta.group(do/src/log/settings) → 사이드바 섹션 헤더 라벨. 빈도 위계를 시각적 청킹으로.
   settings 그룹은 하단(스페이서 아래)에 렌더 — 저빈도 운영/설정. */
export const GROUP_LABELS: Record<string, string> = {
  do: '계획',
  src: '자료',
  log: '분석',
  settings: '설정',
};

export interface NavGroup {
  key: string;
  label: string;
  tabs: TabMeta[];
}

/** 나브에 노출되는 탭을 그룹 순서대로 묶는다(첫 등장=order 최소). settings 탭은 hidden이라도
   하단 설정 그룹에 포함(레일 하단 진입점). 나머지 hidden(흡수 탭)은 SubTabs로만 진입. */
function buildNavGroups(): NavGroup[] {
  const visible = ORDERED_TABS.filter((t) => !t.hidden || t.key === 'settings');
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
/** 나브 그룹 — TABS 불변이라 1회 계산해 재사용(RailSidebar가 매 렌더 재빌드하던 것 제거, C-8). */
export const NAV_GROUPS: NavGroup[] = buildNavGroups();
export function navGroups(): NavGroup[] {
  return NAV_GROUPS;
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
