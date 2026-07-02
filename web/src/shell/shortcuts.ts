/* ============================================================
   shell/shortcuts.ts — 전역 키보드 단축키 정의(단일 원천).
   네비게이션은 'g' 다음 키 시퀀스(Linear/GitHub 결): g→t = 오늘 학습.
   App이 이 표를 읽어 키 핸들링하고, ShortcutsHelp가 같은 표로 치트시트를 그린다.
============================================================ */
export interface NavShortcut {
  /** 'g' 다음에 누르는 키 */
  seq: string;
  /** 이동할 탭 key(shell/tabs.ts) */
  tab: string;
  /** 치트시트 표시 라벨 */
  label: string;
}

/** g-시퀀스 네비게이션(가장 자주 쓰는 탭). 충돌 없는 단일 문자. */
export const NAV_SHORTCUTS: NavShortcut[] = [
  { seq: 't', tab: 'today', label: '오늘 학습' },
  { seq: 's', tab: 'schedule', label: '주간 스케줄' },
  { seq: 'i', tab: 'items', label: '학습 항목' },
  { seq: 'j', tab: 'journal', label: '학습 기록' },
  { seq: 'r', tab: 'review', label: '주간 리뷰' },
  { seq: 'a', tab: 'stats', label: '통계' },
  { seq: 'm', tab: 'mastery', label: '숙달도 지도' },
  { seq: 'd', tab: 'degree', label: '졸업 계획' },
  { seq: 'o', tab: 'routine', label: '가용시간·수업·일과' },
  { seq: 'n', tab: 'integrations', label: '연동' },
  { seq: 'c', tab: 'control', label: '탐구 수집' },
  { seq: 'e', tab: 'settings', label: '설정' },
];

/** 치트시트에 함께 보일 전역 단축키(시퀀스 외). */
export const GLOBAL_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Ctrl / ⌘ + K', label: '명령 팔레트' },
  { keys: 'G 그다음 ↑표의 키', label: '탭으로 이동' },
  { keys: '[  /  ]', label: '이전 / 다음 탭' },
  { keys: '← → Home End', label: '탭 사이 이동(나브 포커스 시)' },
  { keys: '?', label: '이 도움말 열기 / 닫기' },
  { keys: 'Esc', label: '팔레트·모달·도움말 닫기' },
];
