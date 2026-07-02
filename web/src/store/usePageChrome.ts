/* ============================================================
   usePageChrome — 페이지가 상단 바(TopBar)에 컨텍스트 리드아웃 + 주 액션을 주입하는 슬롯
   (설계도 §1-2: TopBar 컨텍스트 리드아웃). 데모 v6처럼 진행률·연속·마감을 헤더에 큰 네온으로.
   휘발성 UI 상태(persist X) — 페이지가 mount 시 set, unmount 시 clear.
============================================================ */
import { create } from 'zustand';
import { useEffect, type ReactNode } from 'react';

export interface ChromeReadout {
  label: string;
  value: ReactNode;
  accent?: boolean;
}
export interface ChromeAction {
  label: string;
  onClick: () => void;
}
interface ChromeStore {
  readouts: ChromeReadout[];
  action: ChromeAction | null;
  setChrome: (readouts: ChromeReadout[], action?: ChromeAction | null) => void;
  clear: () => void;
}

export const usePageChrome = create<ChromeStore>((set) => ({
  readouts: [],
  action: null,
  setChrome: (readouts, action = null) => set({ readouts, action }),
  clear: () => set({ readouts: [], action: null }),
}));

/** 탭 공용 보일러 — mount/deps 변경 시 리드아웃 주입, unmount 시 clear(10개 탭이 복붙하던 골격).
 *  build를 effect 안에서 호출하므로 렌더마다 새 배열이어도 deps가 같으면 재주입하지 않는다. */
export function usePageChromeEffect(
  build: () => { readouts: ChromeReadout[]; action?: ChromeAction | null },
  deps: unknown[],
): void {
  const setChrome = usePageChrome((s) => s.setChrome);
  const clear = usePageChrome((s) => s.clear);
  useEffect(() => {
    const { readouts, action } = build();
    setChrome(readouts, action ?? null);
    return () => clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 호출부가 deps를 명시(원래 보일러와 동일 계약).
  }, deps);
}
