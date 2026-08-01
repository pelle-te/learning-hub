/* ============================================================
   useTodayISO — '오늘'을 **자정에 스스로 넘기는** 읽기. `lib/utils.todayISO` 의 훅 짝.

   ⚠ **왜 필요한가**(H20 · 2026-08-01 `/감사 근본`). `todayISO(state)` 는 순수 함수라 **렌더 시점의
   벽시계**를 한 번 읽고 끝난다. 그래서 자정 롤오버가 화면마다 갈려 있었다 — `today`(30초 틱) ·
   `schedule`(60초 틱)은 넘어가는데 `items`·`journal`·`alloc`·`SubjectDefinition` 은 **앱을 다시
   렌더할 이유가 생길 때까지 어제를 보여 준다**(D-day 가 하루 틀리고, 주간 기준 월요일이 안 밀린다).

   ⚠⚠ **더 나쁜 것은 읽기가 아니라 쓰기다.** `Today.tsx` 의 `RitualCard` 는 오버레이라 자기 틱이
   없어, 열어 둔 채 자정을 넘겨 체크하면 **어제 날짜 키에 쓴다**(`rituals[ds]`). 사용자는 오늘을
   체크했다고 믿는데 기록은 어제에 붙는다 — 조용하고, 되돌릴 단서도 없다.

   **60초 폴링이 아니라 `setTimeout` 하나다.** 재렌더가 필요한 순간은 하루에 정확히 한 번이므로,
   그 한 번을 위해 열려 있는 모든 화면이 분당 한 번씩 깨어날 이유가 없다.

   ⚠ **`focus`·`visibilitychange` 도 듣는다** — `setTimeout` 은 시스템 절전 중에 흐르지 않는다.
   자정을 자면서 넘기면 타이머는 **깨어난 뒤에야** 늦게 터지고, 그 사이 사용자가 먼저 화면을 볼 수
   있다. 두 이벤트는 값이 같으면 `setState` 가 같은 값이라 React 가 재렌더를 접으므로 사실상 공짜다.

   ⚠ 레이어: `hooks/` 는 `lib/` 만 import 한다(절대규칙 #2). 그래서 스토어를 직접 읽지 않고
   **호출부가 이미 들고 있는 state 를 그대로 받는다** — `todayISO(state)` → `useTodayISO(state)` 가
   드롭인이 되는 것이 그 결과다.
============================================================ */
import { useEffect, useState } from 'react';
import { todayISO } from '@/lib/utils';
import type { AppState } from '@/lib/types';

/** 다음 자정까지 남은 ms. 정각에 딱 맞추지 않고 조금 넘겨 잡는다 — 타이머가 1~2ms 일찍 터지면
 *  아직 어제라 값이 안 바뀌고, 그러면 0ms 재무장이 한 번 더 도는 낭비가 생긴다. */
function msUntilMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 250);
  return Math.max(0, next.getTime() - now.getTime());
}

/**
 * '오늘'(YYYY-MM-DD)을 반환하고, 자정을 넘기면 스스로 갱신한다.
 * `state._today` 시드가 있으면 그 값을 그대로 쓰고 **타이머를 걸지 않는다**(시뮬레이션·테스트는
 * 벽시계와 무관하다 — 여기서 타이머를 걸면 시드가 든 화면이 자정에 이유 없이 재렌더된다).
 */
export function useTodayISO(state?: Pick<AppState, '_today'> | null): string {
  const seed = state?._today ?? null;
  /* ⚠ **값은 상태가 아니라 렌더 시점 파생이다.** 상태에 담아 두면 ① 효과에서 동기 setState 로
     수렴시켜야 하고(그건 계단식 렌더라 `react-hooks/set-state-in-effect` 가 막는다) ② 무엇보다
     *다른 이유로 재렌더된 순간*에도 낡은 값을 그대로 들고 있게 된다 — 고치려던 것이 바로 그
     스테일이다. 파생으로 두면 어떤 재렌더든 자동으로 옳고, 아래 상태는 **재렌더를 일으키는
     것만이 일**이다(값을 담지 않으므로 이름이 `tick`). */
  const [, setTick] = useState(0);
  const today = todayISO(seed ? { _today: seed } : null);

  useEffect(() => {
    if (seed) return; // 시드 고정 — 넘어갈 자정이 없다.
    // 날짜가 실제로 바뀐 경우에만 tick 을 올린다 → 같은 값이면 React 가 재렌더를 접는다(포커스가 공짜인 이유).
    const sync = () => setTick((t) => (todayISO(null) === today ? t : t + 1));
    const t = window.setTimeout(sync, msUntilMidnight(new Date()));
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearTimeout(t);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [seed, today]); // `today` 가 바뀌면 다음 자정으로 타이머를 다시 무장한다.

  return today;
}
