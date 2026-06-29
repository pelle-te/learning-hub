/* ============================================================
   usePageChrome — 페이지가 상단 바(TopBar)에 컨텍스트 리드아웃 + 주 액션을 주입하는 슬롯
   (설계도 §1-2: TopBar 컨텍스트 리드아웃). 데모 v6처럼 진행률·연속·마감을 헤더에 큰 네온으로.
   휘발성 UI 상태(persist X) — 페이지가 mount 시 set, unmount 시 clear.
============================================================ */
import { create } from 'zustand';
import type { ReactNode } from 'react';

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
