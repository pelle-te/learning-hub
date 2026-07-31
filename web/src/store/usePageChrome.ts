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
/* ── 화면의 첫째 수치(N-15) ─────────────────────────────────────────────────
   원칙 2("제일 큰 픽셀 = 제일 중요한 것")가 **문서에만** 있었다: `--fs-spine`(72) 참조 0회
   (그 죽은 칸은 W11 에서 아예 지웠다 — 사다리 최상단이 비어 있다는 것이 그 증거였다) ·
   `--fs-stat`(30) 0회 · `--fs-display`(44) 1회(그나마 `opacity-14 aria-hidden` 워터마크)이고
   `ds.css` 의 폰트 최댓값은 **24px**, 최빈값은 13px 이었다 — 어느 화면에 있든 가장 큰 글자가
   24px 이면 위계가 없는 것이다.

   ⚠ **optional 인 것이 설계다.** 16개 fill 탭에 전부 강제하면 3~4개는 억지 수치를 세운다
   (`items`·`graph` 처럼 요약 한 숫자가 거짓이 되는 화면에선 시그니처 비주얼이 최대 요소여야
   한다). 미지정 탭은 종전 그대로 렌더된다 — 점진 적용이 이 필드의 계약이다. */
export interface ChromePrimary {
  /** 수치 본문. 문자열로 받는다 — 이 자리는 **한 값**이지 조판이 아니다(ReactNode 를 받으면
   *  탭마다 다른 조판이 들어와 크기 계약이 곧바로 흐려진다). */
  value: string;
  /** 단위·접미(% · 일 · 개). 값보다 작게 붙는다. */
  unit?: string;
  /** 무엇의 수치인가(작은 캡스). */
  label: string;
}
export interface ChromeAction {
  label: string;
  onClick: () => void;
}
interface ChromeStore {
  readouts: ChromeReadout[];
  primary: ChromePrimary | null;
  action: ChromeAction | null;
  setChrome: (readouts: ChromeReadout[], action?: ChromeAction | null, primary?: ChromePrimary | null) => void;
  clear: () => void;
}

export const usePageChrome = create<ChromeStore>((set) => ({
  readouts: [],
  primary: null,
  action: null,
  setChrome: (readouts, action = null, primary = null) => set({ readouts, action, primary }),
  clear: () => set({ readouts: [], action: null, primary: null }),
}));

/** 탭 공용 보일러 — mount/deps 변경 시 리드아웃 주입, unmount 시 clear(10개 탭이 복붙하던 골격).
 *  build를 effect 안에서 호출하므로 렌더마다 새 배열이어도 deps가 같으면 재주입하지 않는다. */
export function usePageChromeEffect(
  build: () => { readouts: ChromeReadout[]; action?: ChromeAction | null; primary?: ChromePrimary | null },
  deps: unknown[],
): void {
  const setChrome = usePageChrome((s) => s.setChrome);
  const clear = usePageChrome((s) => s.clear);
  useEffect(() => {
    const { readouts, action, primary } = build();
    setChrome(readouts, action ?? null, primary ?? null);
    return () => clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 호출부가 deps를 명시(원래 보일러와 동일 계약).
  }, deps);
}
