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
