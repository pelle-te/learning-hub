/* ============================================================
   phone/sync.ts — 폰의 동기화 구동(C-6). **로직은 `store/syncController` 가 소유한다.**

   종전엔 이 파일이 겹침 방지·트리거·디바운스를 직접 들고 있었는데, 데스크톱(`StorageGuard`)이
   같은 것을 따로(더 얕게) 구현하면서 두 벌로 갈렸다. 그래서 구동을 공용 컨트롤러로 올리고,
   여기는 **폰의 트리거 구성**(폴링 없음 · 이탈 시 push)만 고른다(설계서 §9-3b 의 이벤트 기반).

   ⚠ 겹침 방지는 이제 `lib/cloud/run.ts` 의 `syncOnce` 자체가 보장한다 — 이 파일에서 그 가드가
   사라진 이유다(데스크톱 경로도 같은 가드를 상속받게 하는 것이 C-1 후속의 요점).
============================================================ */
import { installSyncTriggers as install, type SyncTriggerOptions } from '@/store/syncController';

export { runSync as sync, syncSoon } from '@/store/syncController';

/** 부팅 시 1회 설치(연결된 뒤 `main.tsx` 가 부른다). 폰은 폴링을 켜지 않고, 이탈 시 push 한다. */
export function installSyncTriggers(): () => void {
  const opts: SyncTriggerOptions = { onEdit: true, onPagehide: true };
  return install(opts);
}
