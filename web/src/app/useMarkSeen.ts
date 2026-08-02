/* ============================================================
   app/useMarkSeen.ts — **T-13 "지난번 이후"**의 표시 쪽(2026-08-02).

   이 화면을 오늘 봤다고 기기-로컬로 적는다. 그게 전부다 — 델타 계산은 `lib/since` 가 소유하고,
   그리기는 `SubTabs` 가 한다(판정=lib · 표시=화면 · 여기는 **시점**만).

   ⚠ **떠날 때가 아니라 들어올 때 적는다.** 떠날 때 적으면 "잠깐 들렀다가 아무것도 안 읽고
   나간" 경우까지 본 것으로 처리되는데, 그건 오히려 정확하다 — 화면을 열었다는 사실이
   이 레이어가 재는 전부이기 때문이다(무엇을 읽었는지는 앱이 알 수 없고, 알 수 있는 척하면
   그게 곧 거짓말이다). 대신 **표식은 다음 진입부터** 사라진다: 지금 화면에 뜬 표식이 눈앞에서
   사라지면 사용자는 자기가 뭘 놓쳤는지 영영 모른다.

   ⚠ 같은 날 재방문은 **쓰기가 아니다**(`markSeen` 이 자기 안에서 가드한다) — 라우트 이동마다
   localStorage + IDB 미러를 때리면 그건 이 기능의 값에 비해 터무니없는 비용이다.
============================================================ */
import { useEffect } from 'react';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import { todayISO } from '@/lib/utils';

export function useMarkSeen(routeKey: string): void {
  useEffect(() => {
    /* ⚠ 표식을 **한 프레임 뒤**에 지운다. 같은 렌더에서 지우면 방금 그리려던 표식이 그 자리에서
       사라져, 사용자가 "뭔가 있었는데?"만 남는다. 라우트가 바뀔 때 정리(cleanup)에서 적으면
       그 화면을 떠난 뒤에 반영되므로 이 순서가 공짜로 성립한다. */
    return () => {
      useUI.getState().markSeen(routeKey, todayISO(useApp.getState().state));
    };
  }, [routeKey]);
}
