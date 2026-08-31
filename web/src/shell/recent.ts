/* ============================================================
   shell/recent.ts — 팔레트 최근 명령 LRU의 얇은 어댑터.
   실제 상태·영속은 UI 설정 단일 store(useUI)가 소유한다(localStorage 산재 제거).
   ⌘K를 열면 최근 쓴 명령이 위로 올라와 재실행이 빠르다(Linear/Raycast 결).
   React 밖(명령 실행 시점)에서도 호출되므로 store의 getState()로 접근한다.
============================================================ */
import { useUI } from '@/store/useUI';

/** 최근 실행 명령 id(최신순). */
export function recentIds(): string[] {
  return useUI.getState().recentIds();
}

/** 명령 실행 기록 — 맨 앞으로(중복 제거) + 최대 RECENT_MAX 유지 + 영속. */
export function recordRecent(id: string): void {
  useUI.getState().recordRecent(id);
}

/**
 * **화면 방문도 「최근」에 든다**(U076 · 2026-08-31).
 *
 * ⚠⚠ 종전엔 `recordRecent` 를 부르는 곳이 **팔레트 명령 실행 하나**뿐이었다. 그런데 이 앱의
 * 이동 경로는 다섯이다 — ⌘K · 레일 · `g` 단축키 · 링(`[`/`]`) · 딥링크. 즉 **⌘K 로 간 화면만
 * 최근에 들고**, 레일·키보드로 다닌 화면은 아무리 자주 가도 팔레트에서 영원히 아래에 남았다.
 * 손가락이 빠른 사용자일수록 팔레트가 나빠지는 역전이다(Linear 의 데스크톱 내비게이션 노트가
 * 지적한 그 형태).
 *
 * ⚠ **id 문법을 맞춰 부른다** — 팔레트의 탭 명령 id 는 `tab:<key>` 라, 그 문자열로 넣어야
 * `rank()` 가 같은 목록 위에서 돈다. 새 저장소를 만들지 않는 것이 요점이다(`useUI` 의 LRU
 * 하나가 계속 유일한 원천이고, 그래서 상한·영속·중복 제거 규칙이 한 벌로 남는다).
 * ⚠ 첫 진입(`boot`)은 안 센다 — 그건 «내가 간 곳» 이 아니라 «앱이 연 곳» 이다.
 */
export function recordVisitAsRecent(visitKey: string): void {
  useUI.getState().recordRecent('tab:' + visitKey);
}
