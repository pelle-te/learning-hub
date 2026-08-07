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
  /** W9 — 미니 HUD(알약) 안의 인라인 캡처 한 줄. **새 라우트가 아니다**(MiniHud 내부 모드).
   *  전역 캡처 핫키의 착지가 문맥 의존이 된 자리: 알약 상태에서 풀사이즈 팔레트를 띄우면
   *  320×92 뷰포트 안에서 뜬다(게다가 MiniHud 는 포커스 트랩 상태다 · H11). */
  miniCapture: boolean;
  /** '?' 단축키 치트시트 */
  help: boolean;
  /** N-15 — **오늘 버퍼**(하루를 텍스트 한 장으로). 읽기 전용 전면 오버레이 · ⌘K 로 연다.
   *  ⚠ 라우트가 아닌 이유: 이건 *가는 곳*이 아니라 **지금 화면 위에서 훑는 것**이다(⌘K·`?` 와
   *  같은 부류). 라우트로 만들면 명사 축(N-12)에 "하루"가 둘이 된다(`/day` 와 겹친다). */
  dayBuffer: boolean;
  setPalette: (v: boolean) => void;
  setMiniCapture: (v: boolean) => void;
  togglePalette: () => void;
  setHelp: (v: boolean) => void;
  toggleHelp: () => void;
  setDayBuffer: (v: boolean) => void;
}

export const useOverlay = create<OverlayStore>()((set) => ({
  palette: false,
  miniCapture: false,
  help: false,
  dayBuffer: false,
  setPalette: (v) => set({ palette: v }),
  setMiniCapture: (v) => set({ miniCapture: v }),
  togglePalette: () => set((s) => ({ palette: !s.palette })),
  setHelp: (v) => set({ help: v }),
  toggleHelp: () => set((s) => ({ help: !s.help })),
  setDayBuffer: (v) => set({ dayBuffer: v }),
}));
