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
import { selectRiskSummary, selectSchedule } from '@/store/selectors';
import { openBacklog } from '@/lib/methodology';
import { shellBadge, shellTrayTooltip } from '@/lib/tauri';
import { pickReminderLead, trayTooltip } from '@/lib/reminder';
import { riskChapters } from '@/lib/spacedReview';
import { reviewBlockMin, todayISO } from '@/lib/utils';

export function useTaskbarBadge(): void {
  // 숫자만 구독 — 레일 배지와 같은 셀렉터라 참조 캐시를 공유한다(state 버전당 1회 스캔).
  const n = useApp((st) => selectRiskSummary(st.state).overdue + openBacklog(st.state).length);
  useEffect(() => {
    void shellBadge(n);
  }, [n]);
  useEffect(() => () => void shellBadge(0), []);

  /* ── A-6 트레이 툴팁(발산 6회차 · 2026-08-07) ────────────────────────────
     ⚠⚠ **배지만으로는 상주 모드에서 아무것도 안 남는다.** 창을 `hide()` 하면 작업표시줄
     버튼이 사라지고 위 오버레이 배지도 **함께 사라진다** — "창을 닫아도 남는다"를 켠 순간
     남는 유일한 표면이 아무것도 말하지 않는 아이콘 하나가 된다. 그게 가장 필요한 때인데.

     ⚠ **같은 훅에 둔다.** 세는 식이 갈리면 배지가 3 이라 하고 툴팁이 5 라 하는 상태가
     생기고, 그건 이 파일 머리주석이 레일 배지에 대해 이미 금지한 형태다.
     ⚠ 리드(무엇을 먼저 할까)는 알림과 **같은 함수**가 고른다(`pickReminderLead`) — 두 채널이
     같은 사실을 다르게 부르면 사용자는 둘을 다른 것으로 읽는다.
     ⚠ 툴팁은 **문자열이 바뀔 때만** 쏜다. 리드는 스케줄 파생이라 매 렌더 새 객체가 되는데,
     그걸 deps 에 넣으면 렌더마다 IPC 를 탄다 — 문자열로 접어 비교한다. */
  const tip = useApp((st) => {
    const s = st.state;
    const ds = todayISO(s);
    const { lead } = pickReminderLead({
      chapters: riskChapters(s, selectSchedule(s).days, ds, 1),
      backlog: openBacklog(s),
      reviewMin: reviewBlockMin(s.moduleLen || 120),
    });
    return trayTooltip(lead, selectRiskSummary(s).overdue + openBacklog(s).length);
  });
  useEffect(() => {
    void shellTrayTooltip(tip);
  }, [tip]);
}
