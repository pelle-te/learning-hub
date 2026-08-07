/* ============================================================
   app/useIdleLedger.ts — 유휴 원장(N-8)의 **구동**. 판정은 전부 `lib/idleLedger` 가 한다.

   경계는 `useDailyReminder`·`useTaskbarBadge` 와 같다: 훅은 **시계와 채널**만 알고,
   *무엇을 세는가·그것이 무엇을 뜻하는가* 는 lib 이 소유한다.

   ⚠ **1분에 한 번만 본다.** 유휴 임계가 5분이라 그보다 촘촘할 이유가 없고, 폴링은 IPC 왕복
   이라 초 단위로 깨우면 상주 프로세스가 하루 86,400번 Rust 를 부른다.
   ⚠ **브라우저에선 아무 일도 안 한다** — `systemIdleSeconds()` 가 셸 전용이고(0을 준다),
   dev·트랙 A 에서 타이머가 도는 것만으로 시각 베이스라인이 흔들릴 이유가 없다.
   ⚠⚠ **여기서 알림을 쏘지 않는다.** 이 웨이브가 다는 것은 자뿐이고, 개입은 원장이 전제를
   지지한 뒤의 일이다(`lib/idleLedger` 머리주석 · 로드맵 N-8 의 "가장 싼 검증").
============================================================ */
import { useEffect } from 'react';
import { observeIdle } from '@/lib/idleLedger';
import { isTauri, systemIdleSeconds } from '@/lib/tauri';

/** 폴링 주기(ms). 임계(5분)보다 훨씬 촘촘할 이유가 없다 — 머리주석 참조. */
const TICK_MS = 60_000;

export function useIdleLedger(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let dead = false;
    const tick = (): void => {
      void systemIdleSeconds().then((s) => {
        if (!dead) void observeIdle(s);
      });
    };
    const id = setInterval(tick, TICK_MS);
    /* ⚠ 부팅 직후 1회는 **안 한다.** 앱을 막 켠 순간의 유휴는 0 에 가깝고, 그보다 중요한 건
       그 호출이 부팅 웨이브에 IPC 를 하나 더 얹는다는 것이다(예산 축 ②가 재는 그 구간). */
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, []);
}
