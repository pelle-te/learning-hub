/* ============================================================
   shell/shortcuts.ts — 전역 키보드 단축키 정의(단일 원천).
   네비게이션은 'g' 다음 키 시퀀스(Linear/GitHub 결): g→t = 오늘 학습.
   App이 이 표를 읽어 키 핸들링하고, ShortcutsHelp가 같은 표로 치트시트를 그린다.
============================================================ */
import { MOD_LABEL } from '@/lib/platform';

export interface NavShortcut {
  /** 'g' 다음에 누르는 키 */
  seq: string;
  /** 이동할 탭 key(shell/tabs.ts) — 치트시트 라벨은 TabMeta.label에서 파생(SSOT, C-13). */
  tab: string;
}

/** g-시퀀스 네비게이션(가장 자주 쓰는 탭). 충돌 없는 단일 문자. */
export const NAV_SHORTCUTS: NavShortcut[] = [
  { seq: 't', tab: 'today' },
  { seq: 'p', tab: 'plan-host' }, // 계획 호스트(배치로 진입). g s/i/o 는 세그먼트 딥링크로 유지.
  { seq: 's', tab: 'schedule' },
  { seq: 'i', tab: 'items' },
  { seq: 'j', tab: 'journal' },
  { seq: 'r', tab: 'review' },
  { seq: 'a', tab: 'stats' },
  { seq: 'm', tab: 'mastery' },
  { seq: 'd', tab: 'degree' },
  { seq: 'o', tab: 'routine' },
  { seq: 'n', tab: 'integrations' },
  { seq: 'c', tab: 'control' },
  { seq: 'e', tab: 'settings' },
];

/** 치트시트에 함께 보일 전역 단축키(시퀀스 외). 수정자 표기는 플랫폼 파생(lib/platform). */
export const GLOBAL_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: `${MOD_LABEL} + K`, label: '명령 팔레트' },
  // D-2 — 팔레트 안에서만 유효하지만 여기 있는 이유: 캡처는 "떠올랐을 때" 쓰는 것이라
  // 팔레트를 열어 힌트 바를 읽고 나서 배우면 이미 늦다.
  { keys: `${MOD_LABEL} + Enter`, label: '팔레트에 친 문장을 그대로 캡처' },
  { keys: 'G 그다음 ↑표의 키', label: '탭으로 이동' },
  { keys: '[  /  ]', label: '이전 / 다음 탭' },
  { keys: ',  /  .', label: '이전 / 다음 주(스케줄·리뷰 탭)' },
  { keys: '← → Home End', label: '탭 사이 이동(나브 포커스 시)' },
  { keys: '?', label: '이 도움말 열기 / 닫기' },
  { keys: 'Esc', label: '팔레트·모달·도움말 닫기' },
];
