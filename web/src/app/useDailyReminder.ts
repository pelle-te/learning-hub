/* ============================================================
   app/useDailyReminder.ts — **T-6 예약 한 발**의 구동(2026-08-02).

   판정은 전부 `lib/reminder` 가 한다. 여기는 **시계와 채널**만 안다 — 그 경계가 `useTaskbarBadge`
   (Q-30)와 같고, 이유도 같다: 스토어와 셸이 만나는 자리라 훅이지만, *언제·무엇을* 은 lib 이다.

   ⚠ **세는 식이 레일 배지·작업표시줄 배지와 글자 그대로 같다**(`selectRiskSummary.overdue +
   openBacklog().length`). 셋이 갈리면 알림이 3 이라 하고 레일이 5 라 하는 상태가 생기고,
   어느 쪽이 맞는지 화면 어디에도 안 적힌다.

   ⚠ 분당 한 번만 본다. 초 단위로 깨우면 상주 프로세스가 하루 86,400번 스토어를 스캔한다 —
   이 항목의 값(하루 한 번 말 걸기)에 비해 터무니없는 비용이다.

   ⚠ **브라우저에선 아무 일도 안 한다** — `shellNotify` 가 셸 전용이고(P-8), dev·트랙 A 에서
   타이머가 도는 것만으로 시각 베이스라인이 흔들릴 이유가 없다.
============================================================ */
import { useEffect } from 'react';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import { selectRiskSummary } from '@/store/selectors';
import { openBacklog } from '@/lib/methodology';
import { reminderBody, shouldFire } from '@/lib/reminder';
import { isTauri, shellNotify } from '@/lib/tauri';
import { todayISO } from '@/lib/utils';

/** 시각 판정 주기(ms). 분 경계를 놓치지 않을 만큼만 촘촘하다. */
const TICK_MS = 30_000;

export function useDailyReminder(): void {
  useEffect(() => {
    if (!isTauri()) return;
    const tick = (): void => {
      const { ui, setReminderFired } = useUI.getState();
      if (!ui.reminderAt) return; // 꺼져 있으면 스토어를 스캔조차 하지 않는다
      const st = useApp.getState().state;
      const now = new Date();
      const verdict = shouldFire({
        at: ui.reminderAt,
        lastDs: ui.reminderLastDs,
        today: todayISO(st),
        nowMin: now.getHours() * 60 + now.getMinutes(),
        pending: selectRiskSummary(st).overdue + openBacklog(st).length,
      });
      if (!verdict.fire) return;
      const { title, body } = reminderBody(selectRiskSummary(st).overdue + openBacklog(st).length);
      /* ⚠ **쐈다는 표시를 먼저 남긴다.** `shellNotify` 가 실패해도(권한 거부·플러그인 부재)
         오늘 몫은 쓴 것으로 친다 — 안 그러면 실패하는 환경에서 30초마다 재시도하고, 그건
         "하루 1회"라는 이 항목의 유일한 계약을 깨는 경로다. */
      setReminderFired(todayISO(st));
      void shellNotify(title, body);
    };
    const id = setInterval(tick, TICK_MS);
    tick(); // 부팅 직후 1회 — 시각을 지나쳐 켠 경우를 덮는다(`lib/reminder` 머리주석)
    return () => clearInterval(id);
  }, []);
}
