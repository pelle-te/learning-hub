/* ============================================================
   store/settleBeforeExit.ts — **종료 전 저장 확정**의 단 하나의 자리(D004 · 2026-08-21).

   ## 왜 갈라 나왔나

   이 앱에는 프로세스가 사라지는 경로가 **셋**이다: 창 닫기 · 트레이 종료 · **업데이트 설치**.
   앞의 둘은 `StorageGuard` 가 네 줄짜리 관용구로 지켰고, 세 번째(`app.restart()`)는
   `on_close_requested` 를 태우지 않으므로 그 가드가 아예 안 뛰었다 — 오늘 탭에서 블록을
   체크하고(400ms 디바운스 예약) 곧바로 «설치하고 재시작» 을 누르면 그 편집이 사라졌다.
   쓰기 실패 백오프 중이면 최대 `PERSIST_RETRY_MAX_MS` 만큼.

   관용구가 **경로마다** 붙어 있었지 **한 곳**에 없었던 것이 원인이다(데이터 축 근본원인 ③).
   네 번째 종료 경로가 생기면 또 같은 일이 난다 — 그래서 자리를 만든다.

   ## 왜 `store/` 인가

   `flushNow` 는 zustand 스토어의 것이고 `lib/` 은 zustand 를 모른다(레이어 계약).
   그래서 `lib/db/write` 위, 화면 아래 — 즉 `store/` 가 이 관용구의 유일한 층이다.

   ⚠ 두 번 flush 하는 것이 계약이다. 병합창에 걸리면 첫 `flushNow` 는 `writeAndVerify` 가
   `deferred:true` 로 즉시 반환해 **아무것도 안 쓰고**, `whenSettled()` 는 이미 resolve 된
   링크를 보고 곧바로 통과한다(H9). 창이 닫히길 짧게 기다렸다 한 번 더 확정한다.
============================================================ */
import { whenSettled, waitForMergeWindow } from '@/lib/db/write';
import { useApp } from '@/store/useApp';

/** 디바운스·병합창·비동기 SQL 왕복을 모두 확정한 뒤 반환한다. 실패해도 던지지 않는다. */
export async function settleBeforeExit(): Promise<void> {
  useApp.getState().flushNow(); // 디바운스 건너뛰고 동기 정본부터 확정
  if (await waitForMergeWindow()) useApp.getState().flushNow();
  await whenSettled(); // 그 flush 가 띄운 SQL 쓰기까지 대기
}
