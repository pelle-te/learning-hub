/* ============================================================
   platform.ts — 실행 플랫폼에서 파생되는 표기(순수 · 부작용 없음).

   왜 있는가: 수정자 키 글리프가 `⌘K` 로 **하드코딩**돼 화면 네 곳에 박혀 있었다.
   이 앱의 배포 진입점은 Windows Tauri 셸 하나인데(CLAUDE.md), 정작 상단바·팔레트·
   치트시트가 macOS 글리프를 보여 주고 있었다 — 키보드를 배우라고 만든 표기가
   존재하지 않는 키를 가리키던 셈이다. 로드맵 Someday '⌘K→Ctrl K 글리프(관용성)'.

   ⚠ 값이 **모듈 로드 시 1회** 확정된다. 플랫폼은 세션 중 바뀌지 않으므로 매 렌더
   재판정할 이유가 없고, 상수라 스냅샷·테스트에서 결정론적이다.
============================================================ */

/** macOS 계열인가. userAgentData(신규) → platform(구형) 순으로 본다. 비브라우저면 false. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const p = uaData?.platform || navigator.platform || '';
  return /mac/i.test(p);
}

/** 수정자 키 이름 — 치트시트·title 처럼 '키 + 키' 로 조합할 때. */
export const MOD_LABEL = isMac() ? '⌘' : 'Ctrl';

/** 팔레트 호출 표기 — 버튼 라벨처럼 통짜로 보여 줄 때(`⌘K` / `Ctrl K`). */
export const MOD_K_LABEL = isMac() ? '⌘K' : 'Ctrl K';
