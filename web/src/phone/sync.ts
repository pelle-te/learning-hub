/* ============================================================
   phone/sync.ts — 폰의 동기화 구동(C-6). **로직은 `store/syncController` 가 소유한다.**

   종전엔 이 파일이 겹침 방지·트리거·디바운스를 직접 들고 있었는데, 데스크톱(`StorageGuard`)이
   같은 것을 따로(더 얕게) 구현하면서 두 벌로 갈렸다. 그래서 구동을 공용 컨트롤러로 올리고,
   여기는 **폰의 트리거 구성**(폴링 없음 · 이탈 시 push)만 고른다(설계서 §9-3b 의 이벤트 기반).

   ⚠ 겹침 방지는 이제 `lib/cloud/run.ts` 의 `syncOnce` 자체가 보장한다 — 이 파일에서 그 가드가
   사라진 이유다(데스크톱 경로도 같은 가드를 상속받게 하는 것이 C-1 후속의 요점).
============================================================ */
import { installSyncTriggers as install, type SyncTriggerOptions } from '@/store/syncController';

/* ⚠ `syncSoon` 은 여기서 다시 내보내지 않는다(2026-08-23) — 폰 소비처가 없고,
   쓰는 쪽은 `@/store/syncController` 에서 직접 가져간다. */
export { runSync as sync } from '@/store/syncController';

/** 부팅 시 1회 설치(연결된 뒤 `main.tsx` 가 부른다). 폰은 폴링을 켜지 않고, 이탈 시 push 한다.
 *  ⚠ **실시간 poke(`live`)는 폰만 켠다**(Phase 2) — 폰은 Workers 오리진의 동일출처 WS 라 붙는다.
 *  데스크톱(Tauri 웹뷰)은 CSP `connect-src 'self' ipc:` 로 막혀 못 붙으므로 StorageGuard 는 안 켠다.
 *
 *  ⚠ **`onResult` 를 여기서 주지 않는 것이 지금은 의도다**(H3 · 2026-07-30). 종전엔 이 부재가
 *  곧 침묵이었다 — 기기 폐기·D1 한도(`push.status:'blocked'`)를 폰이 알 방법이 0이었다. 지금은
 *  중단이 **원장의 축**(`lib/syncLedger` 의 `blocked`)이 되어 헤더의 `SyncLedger` 가 상시 말하고,
 *  그 갱신은 `syncController.onSyncResult` 구독이 담당한다 — 즉 트리거 옵션과 무관하게 상속된다.
 *  데스크톱이 `onResult` 로 토스트를 띄우는 것은 **레일에 상시 자리가 없어서**이지 다른 계약이
 *  아니다. 폰에 토스트 호스트를 새로 들이면 그 하나를 위해 표면이 늘어난다. */
export function installSyncTriggers(): () => void {
  /* ⚠ `live: true`(실시간 poke)가 여기 있었다 — 은퇴했다(I051 · 2026-08-22). */
  const opts: SyncTriggerOptions = { onEdit: true, onPagehide: true };
  return install(opts);
}
