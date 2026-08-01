/* ============================================================
   app/useFrameMemory.ts — 성공 렌더의 **형상**을 기록하는 한 줄(Q-16 · 2026-08-02).

   왜 `app/` 인가: 형상을 아는 두 사실이 여기서만 만난다 — **어느 탭인가**(`routeKey` · 라우터)와
   **무엇을 세웠나**(`usePageChrome` · 스토어). feature 안에 두면 16곳에 복붙이고, `store` 안에
   두면 스토어가 라우팅을 알게 된다. `useLeaveCursor` 가 같은 이유로 여기 있다.

   ⚠ **기록 조건이 "성공 렌더"의 정의다.** 크롬이 비어 있는 순간(마운트 직전·언마운트 직후)에
   기록하면 다음 진입의 뼈대가 *빈 화면*을 기억한다 — 그건 형상이 아니라 공백이다. 그래서
   리드아웃이 하나라도 있거나 `primary` 가 서 있을 때만 쓴다.
============================================================ */
import { useEffect } from 'react';
import { usePageChrome } from '@/store/usePageChrome';
import { rememberFrame } from '@/lib/frameMemory';

export function useFrameMemory(routeKey: string): void {
  const readouts = usePageChrome((s) => s.readouts.length);
  const hasPrimary = usePageChrome((s) => s.primary !== null);
  useEffect(() => {
    if (readouts === 0 && !hasPrimary) return; // 아직/이미 비었다 — 공백은 형상이 아니다
    rememberFrame(routeKey, { readouts, primary: hasPrimary });
  }, [routeKey, readouts, hasPrimary]);
}
