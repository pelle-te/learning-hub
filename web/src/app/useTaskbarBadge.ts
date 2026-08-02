/* ============================================================
   app/useTaskbarBadge.ts — **말 걸지 않는 알림**(Q-30 · 2026-08-02).

   레일 배지(`RailSidebar`)가 이미 "복습·보충 N건 대기"를 세고 있는데, 그 수는 **앱을 열어야만**
   보인다. 그래서 이 앱이 사용자에게 먼저 닿는 채널은 P-8 이 알림을 고친 뒤에도 하나(알림)뿐이고,
   알림은 하던 일을 끊는다. 작업표시줄 오버레이 배지는 그 사이 칸이다 — **보러 갔을 때만** 보인다.

   ⚠ **새 계산을 만들지 않는다.** 세는 식은 레일 배지와 **글자 그대로 같아야 한다**(`selectRiskSummary
   .overdue + openBacklog().length`). 두 벌이 되면 작업표시줄이 3 이라 하고 레일이 5 라 하는 상태가
   생기고, 어느 쪽이 맞는지 화면 어디에도 안 적힌다. 그래서 `store/selectors` 를 다시 부른다.

   ⚠ **값이 바뀔 때만 쏜다.** `shellBadge` 는 부를 때마다 캔버스를 그리고 IPC 를 탄다 —
   `useEffect` 의 deps 가 그 스로틀 전부다(수는 정수라 값 비교가 정확하다).
   ⚠ **언마운트에서 지운다.** 창을 닫아도 오버레이는 OS 가 들고 있으므로, 남기면 다음 부팅에 옛
   수가 잠깐 떠 있다(그리고 그 수는 이제 거짓이다).
   ⚠ 여기 있는 이유는 `useFrameMemory`·`useLeaveCursor` 와 같다 — 스토어와 셸 경계가 여기서 만난다.
============================================================ */
import { useEffect } from 'react';
import { useApp } from '@/store/useApp';
import { selectRiskSummary } from '@/store/selectors';
import { openBacklog } from '@/lib/methodology';
import { shellBadge } from '@/lib/tauri';

export function useTaskbarBadge(): void {
  // 숫자만 구독 — 레일 배지와 같은 셀렉터라 참조 캐시를 공유한다(state 버전당 1회 스캔).
  const n = useApp((st) => selectRiskSummary(st.state).overdue + openBacklog(st.state).length);
  useEffect(() => {
    void shellBadge(n);
  }, [n]);
  useEffect(() => () => void shellBadge(0), []);
}
