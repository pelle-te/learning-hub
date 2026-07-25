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

/** g-시퀀스 네비게이션(가장 자주 쓰는 탭). 충돌 없는 단일 문자.
 *  ⚠ **모든 seq 의 tab 은 실존해야 한다** — `test/invariants.test.ts` 가 기계로 잠근다.
 *  D-4 이전엔 `g o` 가 은퇴한 `routine`(리다이렉트 shim)을 가리켜, 누르면 죽은 탭에 갔다
 *  `/items` 로 튕겼다. 목적지가 사라지는 것은 조용한 사건이라 표가 스스로 낡는다. */
export const NAV_SHORTCUTS: NavShortcut[] = [
  { seq: 't', tab: 'today' },
  /* ⚠ `p`(계획)와 `s`(캘린더)가 **같은 곳을 가리킨다 — 의도된 것이다.** D-4 이전에도 `g p` 는
     plan-host 를 거쳐 `/schedule` 로 튕겼으니 두 키의 착지는 원래 같았다. 셸이 사라졌다고 한
     쪽을 지우면 그 손가락 습관만 깨지고 얻는 것이 없다(이 저장소는 사용자 1인이다). */
  { seq: 'p', tab: 'schedule' },
  { seq: 's', tab: 'schedule' },
  { seq: 'i', tab: 'items' },
  { seq: 'j', tab: 'journal' },
  { seq: 'r', tab: 'review' },
  { seq: 'a', tab: 'stats' },
  { seq: 'm', tab: 'mastery' },
  { seq: 'd', tab: 'degree' },
  { seq: 'n', tab: 'integrations' },
  { seq: 'c', tab: 'control' },
  { seq: 'e', tab: 'settings' },
];

/** 치트시트에 함께 보일 전역 단축키(시퀀스 외). 수정자 표기는 플랫폼 파생(lib/platform).
 *  ⚠ **여기 있는 것은 진짜로 어디서나 동작해야 한다.** N-16 에서 `,`/`.`(주 이동)를 뺐다 —
 *  전역이라 적혀 있었지만 실제 리스너는 2화면에만 있어 **12개 탭에서 거짓말**이었다. 그 항목은
 *  이제 `useKeymap` 이 화면과 함께 등록하고 치트시트 '이 화면' 섹션이 문맥에 맞게 그린다. */
export const GLOBAL_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: `${MOD_LABEL} + K`, label: '명령 팔레트' },
  // D-2 — 팔레트 안에서만 유효하지만 여기 있는 이유: 캡처는 "떠올랐을 때" 쓰는 것이라
  // 팔레트를 열어 힌트 바를 읽고 나서 배우면 이미 늦다.
  { keys: `${MOD_LABEL} + Enter`, label: '팔레트에 친 문장을 그대로 캡처' },
  { keys: 'G 그다음 ↑표의 키', label: '탭으로 이동' },
  { keys: '[  /  ]', label: '이전 / 다음 탭' },
  { keys: '← → Home End', label: '탭 사이 이동(나브 포커스 시)' },
  { keys: '?', label: '이 도움말 열기 / 닫기' },
  { keys: 'Esc', label: '팔레트·모달·도움말 닫기' },
];
