/* ============================================================
   useOverlay.ts — 앱 전역 오버레이(⌘K 명령 팔레트 · 단축키 치트시트)의 열림 상태.

   왜 스토어인가: 원래 둘 다 App 의 `useState` 였고, 그 결과 **여는 경로마다 다른 배선**이
   생겼다 — 팔레트는 `onOpenPalette` prop 을 TopBar 까지 내려보냈고, 치트시트는 그마저
   안 되니 `window.dispatchEvent(new CustomEvent('lh:open-shortcuts'))` 라는 **DOM 이벤트
   우회**로 App 에 신호를 보냈다(TopBar 의 ? 버튼). 같은 성격의 상태 하나를 두 가지 방식으로
   나르고 있었고, 후자는 타입도 검색성도 없다.

   영속하지 않는다(세션 UI). 그래서 `useUI`(설정·localStorage)가 아니라 별도 스토어다.

   ⚠ 구독 없이 읽어야 하는 곳(App 의 전역 keydown 핸들러)은 `useOverlay.getState()` 를 쓴다 —
   구독하면 팔레트를 열고 닫을 때마다 document 리스너가 재등록된다.
============================================================ */
import { create } from 'zustand';

interface OverlayStore {
  /** ⌘K 명령 팔레트 */
  palette: boolean;
  /** '?' 단축키 치트시트 */
  help: boolean;
  setPalette: (v: boolean) => void;
  togglePalette: () => void;
  setHelp: (v: boolean) => void;
  toggleHelp: () => void;
}

export const useOverlay = create<OverlayStore>()((set) => ({
  palette: false,
  help: false,
  setPalette: (v) => set({ palette: v }),
  togglePalette: () => set((s) => ({ palette: !s.palette })),
  setHelp: (v) => set({ help: v }),
  toggleHelp: () => set((s) => ({ help: !s.help })),
}));
