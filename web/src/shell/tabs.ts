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
}

/** 모든 탭(표시 순서·그룹·아이콘). hidden은 나브에서 숨김(헤더 ⚙·⌘K로 진입).
   빈도 위계: 매일(계획) > 주간(자료·기록) > 드묾(졸업은 계획 끝에, 제어판/설정은 숨김·⌘K 진입). */
export const TABS: TabMeta[] = [
  { key: 'today', label: '오늘 학습', group: 'do', order: 10, icon: 'target' },
  { key: 'schedule', label: '주간 스케줄', group: 'do', order: 20, icon: 'calendar' },
  // 아래 흡수 탭들은 나브에서 숨기고, 호스트 탭(스케줄·기록·통계) 상단 섹션 세그먼트(SubTabs)로 전환한다.
  // 라우트·팔레트·g단축키로는 그대로 진입 가능(SUBTAB_GROUPS 참조).
  { key: 'routine', label: '가용시간·수업·일과', group: 'do', order: 30, hidden: true, icon: 'clock' },
  { key: 'degree', label: '졸업 계획', group: 'do', order: 35, hidden: true, icon: 'cap' },
  { key: 'items', label: '학습 항목', group: 'src', order: 40, icon: 'file' },
  { key: 'integrations', label: '연동 현황', group: 'src', order: 50, icon: 'link' },
  { key: 'journal', label: '학습 기록', group: 'log', order: 60, icon: 'notebook' },
  { key: 'review', label: '주간 리뷰', group: 'log', order: 70, hidden: true, icon: 'refresh' },
  { key: 'stats', label: '통계', group: 'log', order: 80, icon: 'chart' },
  { key: 'mastery', label: '숙달도 지도', group: 'log', order: 85, hidden: true, icon: 'grid' },
  // 제어판은 나브에 노출(설정 그룹). 탐구 수집·지식 재빌드 등 운영 도구 진입점.
  { key: 'control', label: '탐구 수집', group: 'settings', order: 190, icon: 'search' },
  { key: 'settings', label: '설정', group: 'settings', order: 200, hidden: true, icon: 'gear' },
];

/* ── 섹션 세그먼트(흡수 탭) ─────────────────────────────────────────────
   한 호스트 탭의 '페이지 안 섹션'으로 묶이는 탭들(첫 항목=나브에 노출되는 호스트).
   나브 정리: 매일 안 쓰는 계획/분석 화면을 호스트 상단 세그먼트로 접어 1차 나브를 6개로 줄인다.
   라우트는 전부 살아있어 딥링크·⌘K·g단축키가 그대로 동작한다. */
export const SUBTAB_GROUPS: string[][] = [
  ['schedule', 'routine', 'degree'],
  ['journal', 'review'],
  ['stats', 'mastery'],
];

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

export const GROUP_LABELS: Record<string, string> = {
  do: '계획',
  src: '자료',
  log: '기록·분석',
  settings: '설정',
};
export const GROUP_ICONS: Record<string, string> = {
  do: 'calendar',
  src: 'book',
  log: 'chart',
  settings: 'gear',
};

/** 표시 순서대로 정렬된 탭. */
export function orderedTabs(): TabMeta[] {
  return TABS.slice().sort((a, b) => a.order - b.order);
}
export function tabByKey(key: string): TabMeta | undefined {
  return TABS.find((t) => t.key === key);
}
/** 등장 순서대로의 그룹 키(중복 제거). */
export function groupOrder(): string[] {
  const gs: string[] = [];
  orderedTabs().forEach((t) => {
    if (!t.hidden && gs.indexOf(t.group) < 0) gs.push(t.group);
  });
  return gs;
}
