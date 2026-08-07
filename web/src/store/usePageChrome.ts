/* ============================================================
   usePageChrome — 페이지가 상단 바(TopBar)에 컨텍스트 리드아웃 + 주 액션을 주입하는 슬롯
   (설계도 §1-2: TopBar 컨텍스트 리드아웃). 데모 v6처럼 진행률·연속·마감을 헤더에 큰 네온으로.
   휘발성 UI 상태(persist X) — 페이지가 mount 시 set, unmount 시 clear.
============================================================ */
import { create } from 'zustand';
import { createContext, useContext, useEffect, type ReactNode } from 'react';

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

/* ── N-13 **두 번째 페인에서는 크롬을 주입하지 않는다**(W9 · 2026-08-07) ──────────────
   작업대(옆 페인)는 **같은 화면 컴포넌트를 다시 마운트**한다. 그런데 이 슬롯은 전역 스토어
   하나라, 그대로 두면 옆에 붙든 화면이 상단 바의 수를 **덮어쓴다** — 그리고 그 화면이 닫힐 때
   `clear()` 가 돌아 주 화면의 리드아웃까지 함께 사라진다(마지막에 마운트된 쪽이 이긴다).

   ⚠ 판정을 화면에 맡기지 않는다(“페인 안이면 넘기지 마세요”는 화면 스물몇 개의 계약이 된다) —
   **컨텍스트가 그 자리에서 끈다.** 페인을 그리는 쪽(`app/WorkbenchPane`)만 이걸 안다. */
const ChromeMuted = createContext(false);
export const ChromeMuteProvider = ChromeMuted.Provider;

/** 탭 공용 보일러 — mount/deps 변경 시 리드아웃 주입, unmount 시 clear(10개 탭이 복붙하던 골격).
 *  build를 effect 안에서 호출하므로 렌더마다 새 배열이어도 deps가 같으면 재주입하지 않는다.
 *
 *  ## ⚠⚠ `primary` 가 **필수 키**인 것이 W22 의 집행자다(H3 · 2026-07-31 `/감사 근본`)
 *
 *  W22 는 "원칙 ②(제일 큰 픽셀 = 제일 중요한 것)의 물리적 표현을 목적지마다 세운다"였고,
 *  집행자를 **불변식의 정규식**(`/\bprimary:/` 을 feature 폴더 전체에서 찾기)에 뒀다. 그게
 *  그 자리에서 뚫렸다 — `review-run`(가장 최근 승격된 목적지)은 크롬 호출에 `primary` 가
 *  **없는데**, 같은 파일의 키캡 객체 두 줄(`primary: true`·`primary: revealed`)에 정규식이
 *  걸려 **통과**했다. 즉 그 배치가 다른 세 축에서 고친 형태("선언은 있는데 집행자가 없다")를
 *  자기 집행자 안에 새로 하나 만든 셈이다.
 *
 *  같은 커밋이 인용한 선례가 정답을 이미 갖고 있었다: `State.next` 는 **타입이** `undefined` 를
 *  막는다(`ReactNode` 를 쓰면 `next={undefined}` 가 통과해 필수화가 무력해진다고 그 파일이
 *  적어 뒀다). 그래서 `primary?:` → **`primary:`** 로 바꾼다 — 값이 없어도 `null` 을 **쓰게**
 *  만드는 것이 요점이다(잊는 것과 없다고 정하는 것은 다르다). 화면 단위 "세웠는가"는 여전히
 *  불변식이 보되, 이제 **크롬 호출 구간 안에서만** 본다(`test/invariants.test.ts`).
 */
export function usePageChromeEffect(
  build: () => { readouts: ChromeReadout[]; action?: ChromeAction | null; primary: ChromePrimary | null },
  deps: unknown[],
): void {
  const setChrome = usePageChrome((s) => s.setChrome);
  const clear = usePageChrome((s) => s.clear);
  const muted = useContext(ChromeMuted);
  useEffect(() => {
    if (muted) return; // N-13 — 옆 페인은 상단 바를 안 건드린다(위 주석)
    const { readouts, action, primary } = build();
    setChrome(readouts, action ?? null, primary ?? null);
    return () => clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 호출부가 deps를 명시(원래 보일러와 동일 계약).
  }, deps);
}
