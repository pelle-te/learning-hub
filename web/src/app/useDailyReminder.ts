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
import { selectRiskSummary, selectSchedule } from '@/store/selectors';
import { openBacklog } from '@/lib/methodology';
import { pickReminderLead, reminderBody, shouldFire } from '@/lib/reminder';
import { riskChapters } from '@/lib/spacedReview';
import { isTauri, shellNotify } from '@/lib/tauri';
import { toast } from '@/shell/toast';
import { reviewBlockMin, todayISO } from '@/lib/utils';

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
      /* A-1 — **무엇을** 말할지는 lib 이 고른다. 여기서 하는 일은 재료를 모으는 것뿐이고,
         그 재료는 위 `pending` 과 **같은 두 원천**이다(밀린 챕터 + 열린 보충) — 세는 식과
         부르는 식이 갈리면 알림이 하나를 부르면서 다른 것을 셌다는 뜻이 된다.
         ⚠ `riskChapters` 는 위험 큰 순이라 `[0]` 이 곧 "가장 오래 방치된 것"이다. */
      const ds = todayISO(st);
      const { lead, rest } = pickReminderLead({
        chapters: riskChapters(st, selectSchedule(st).days, ds, 1),
        backlog: openBacklog(st),
        reviewMin: reviewBlockMin(st.moduleLen || 120),
      });
      const { title, body } = reminderBody(lead, rest);
      /* ⚠ **쐈다는 표시를 먼저 남긴다.** `shellNotify` 가 실패해도(권한 거부·플러그인 부재)
         오늘 몫은 쓴 것으로 친다 — 안 그러면 실패하는 환경에서 30초마다 재시도하고, 그건
         "하루 1회"라는 이 항목의 유일한 계약을 깨는 경로다. */
      setReminderFired(todayISO(st));
      /* ⚠⚠ **못 쐈으면 앱 안에서라도 말한다**(H-9 · 2026-08-06 감사). 종전엔 결과를 안 봤고
         `shellNotify` 의 _"토스트가 커버한다"_ 는 주석은 **거짓**이었다(그런 토스트가 없었다).
         위에서 오늘 몫을 이미 쓴 뒤이므로, 여기서 폴백을 안 걸면 권한이 거부된 환경에서 이
         기능은 **영구 무음**이다 — 사용자는 켜 놓고 매일 아무것도 못 받는다.
         ⚠ 토스트는 앱이 떠 있을 때만 보이지만, 그 경우가 곧 "알림이 안 오는데 앱은 켜져
         있는" 상황이라 정확히 이 폴백이 필요한 자리다. */
      /* W3 — **착지 경로를 함께 보낸다.** 이름을 부르는 알림(A-1)이 그 이름으로 데려가지
         않으면 절약한 홉이 도로 생긴다. 리드가 없으면 오늘 화면이 기본 착지다. */
      void shellNotify(title, body, lead?.route ?? '/today').then((sent) => {
        if (!sent) toast(`${title} — ${body}`, 'warn', 12_000);
      });
    };
    const id = setInterval(tick, TICK_MS);
    tick(); // 부팅 직후 1회 — 시각을 지나쳐 켠 경우를 덮는다(`lib/reminder` 머리주석)
    return () => clearInterval(id);
  }, []);
}
