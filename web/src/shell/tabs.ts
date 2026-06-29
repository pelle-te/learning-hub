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
  { key: 'routine', label: '가용시간·수업·일과', group: 'do', order: 30, icon: 'clock' },
  { key: 'degree', label: '졸업 계획', group: 'do', order: 35, icon: 'cap' },
  { key: 'items', label: '학습 항목', group: 'src', order: 40, icon: 'file' },
  { key: 'integrations', label: '연동 현황', group: 'src', order: 50, icon: 'link' },
  { key: 'journal', label: '학습 기록', group: 'log', order: 60, icon: 'notebook' },
  { key: 'review', label: '주간 리뷰', group: 'log', order: 70, icon: 'refresh' },
  { key: 'stats', label: '통계', group: 'log', order: 80, icon: 'chart' },
  { key: 'mastery', label: '숙달도 지도', group: 'log', order: 85, icon: 'grid' },
  // 저빈도 운영 화면 — 나브에서 숨기고 ⌘K/직접 URL로 진입(설정 이중화 해소: 제어판=설정 계열).
  { key: 'control', label: '시스템 제어판', group: 'settings', order: 190, hidden: true, icon: 'gear' },
  { key: 'settings', label: '설정', group: 'settings', order: 200, hidden: true, icon: 'gear' },
];

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
