/* ============================================================
   phone/sync.ts — 폰의 동기화 구동(C-6).

   `lib/cloud/run.ts` 의 `syncOnce()` 를 **언제 부를지**만 정한다. 무엇을 하는지는 전부
   `lib/` 가 소유한다(레이어 단방향 — 이 파일은 zustand 를 알고, `lib/` 는 모른다).

   ## ⚠ 주기를 공격적으로 잡지 않는다

   설계서 §9-3b 가 명시한 새 위험이다: Cloudflare 무료 티어는 **요청·행 단위**로 한도가
   걸린다(VM 은 안 걸리던 축). 사용자 1명 규모에선 여유가 크지만 "5초마다 폴링" 같은 주기는
   한도를 먼저 터뜨린다. 그래서 이벤트 기반으로 간다:

   | 언제 | 왜 |
   | --- | --- |
   | 부팅 직후 1회 | 폰을 열었다 = 최신을 보고 싶다 |
   | 앱이 다시 보일 때(`visibilitychange`) | 폰 전환 후 복귀가 실사용의 대부분이다 |
   | 편집 후 디바운스 | 올릴 것이 생겼을 때만 |

   폴링 타이머는 **두지 않는다.** 화면을 안 보는 동안의 최신성은 값이 0인데 한도는 그대로 먹는다.
============================================================ */
import { syncOnce, type SyncResult } from '@/lib/cloud/run';
import { useApp } from '@/store/useApp';

/** 편집 후 동기화까지의 유예. `useApp` 의 영속 디바운스(400ms)보다 **길어야** 한다 —
 *  안 그러면 아직 SQLite 에 안 쓰인 편집을 아웃박스가 못 보고 다음 회차로 밀린다. */
const AFTER_EDIT_MS = 1200;

let _inflight: Promise<SyncResult> | null = null;
let _timer: ReturnType<typeof setTimeout> | null = null;

/**
 * 동기화 1회. **겹쳐 돌지 않는다** — 이미 도는 중이면 그 약속을 돌려준다.
 *
 * ⚠ 겹치면 같은 아웃박스 구간을 두 번 올리고, 더 나쁘게는 워터마크 전진이 서로를 앞질러
 * **아직 안 보낸 것을 보냈다고 표시**할 수 있다(C-1 이 fence 로 막은 부류의 재현).
 */
export async function sync(): Promise<SyncResult> {
  _inflight ??= syncOnce().finally(() => {
    _inflight = null;
  });
  const r = await _inflight;
  // 병합 결과가 있으면 메모리에 반영한다 — `run.ts` 계약상 이건 호출부 몫이다.
  if (r.state) useApp.getState().loadState(r.state);
  return r;
}

/** 편집 뒤 한 박자 쉬고 동기화. 연속 편집은 마지막 것 하나로 합쳐진다. */
export function syncSoon(): void {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _timer = null;
    void sync();
  }, AFTER_EDIT_MS);
}

/** 부팅 시 1회 설치. 복귀할 때마다 동기화한다(머리주석 표 참조). */
export function installSyncTriggers(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync();
  });
  /* ⚠ 앱이 백그라운드로 갈 때도 한 번 밀어올린다. 폰은 사용자가 스와이프로 앱을 떠나는 것이
     정상 종료라, 그 순간을 놓치면 마지막 편집이 다음 실행까지 클라우드에 없다. */
  window.addEventListener('pagehide', () => void sync());
}
