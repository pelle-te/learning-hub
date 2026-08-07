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
  /* ── N-13 **작업대**(W9 · 2026-08-07) — 옆에 한 화면을 붙든다 ─────────────────────
     이 앱은 화면 하나만 보여 준다. 그런데 실제 작업은 **오간다**: 배분을 고치며 오늘을 보고,
     오답을 적으며 챕터를 본다 — 그 왕복이 지금은 alt-tab 도 아니고 **같은 앱 안에서 화면을
     갈아 치우는 것**이라, 돌아올 때마다 스크롤·펼침·커서가 초기화된다.

     ⚠ **경로 문자열이다**(탭 key 가 아니라). `/day/2026-08-01` 처럼 매개변수·쿼리를 가진
     화면이 있고, 그걸 key 로 접으면 붙들어 둔 것이 *그 하루*가 아니라 *오늘*이 된다.
     ⚠ 영속하지 않는다 — 세션 UI 다(팔레트·치트시트와 같은 부류). 다음에 앱을 열었을 때
     이유를 모르는 두 번째 페인이 떠 있으면 그건 회복이 아니라 혼란이다.
     ⚠⚠ **폐기 조건이 붙어 있다**(로드맵 N-13): W2 홉 원장의 **왕복쌍**이 롱테일이면 —
     즉 A↔B 로 오간 흔적이 없으면 — 이 기능은 지운다. 판정 자료는 `설정 → 방문 원장`. */
  bench: string | null;
  setBench: (path: string | null) => void;
  setPalette: (v: boolean) => void;
  setMiniCapture: (v: boolean) => void;
  togglePalette: () => void;
  setHelp: (v: boolean) => void;
  toggleHelp: () => void;
  setDayBuffer: (v: boolean) => void;
}

export const useOverlay = create<OverlayStore>()((set) => ({
  bench: null,
  palette: false,
  miniCapture: false,
  help: false,
  dayBuffer: false,
  setBench: (path) => set({ bench: path }),
  setPalette: (v) => set({ palette: v }),
  setMiniCapture: (v) => set({ miniCapture: v }),
  togglePalette: () => set((s) => ({ palette: !s.palette })),
  setHelp: (v) => set({ help: v }),
  toggleHelp: () => set((s) => ({ help: !s.help })),
  setDayBuffer: (v) => set({ dayBuffer: v }),
}));
