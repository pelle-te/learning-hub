/* ============================================================
   syncLedger.ts — 동기화 원장의 **판정**(순수 · E12 · 2026-07-29).

   이 판정이 lib 에 있는 이유: 폰 헤더와 데스크톱 레일이 **같은 조건에서** 말하고 같은 조건에서
   침묵해야 한다. 화면마다 "언제 말할까"를 다시 정하면 두 기기가 서로 다르게 침묵하게 되고,
   그 차이는 아무 데도 안 적힌다(§9-4 — 화면은 따로, 규칙은 lib).

   ⚠ 층이 갈린 이유도 적어 둔다: `components` 는 `store` 를 import 할 수 없다(레이어 경계 린트).
   그래서 셋으로 나뉜다 — **판정=lib(여기)** · **읽기=store/useSyncLedger** · **그리기=components**.
============================================================ */
import { agoLabel } from './utils';

export interface Ledger {
  online: boolean;
  /** 대기 중(아직 못 올린) 편집 수. 셀 수 없으면 null — **0 과 구분한다**(모름 ≠ 없음). */
  pending: number | null;
  /** 마지막으로 **성공한** 동기화 시각(epoch ms). 없으면 null. */
  at: number | null;
  failed: boolean;
  /**
   * 재시도가 무의미한 중단 사유(`push.status === 'blocked'`). 없으면 null.
   *
   * ⚠⚠ **이 축이 없어서 원장이 거짓말을 하고 있었다**(H3 · 2026-07-30 `/감사 근본`).
   * `runSyncOnce` 는 push 가 `blocked` 여도 `SyncResult.status:'ok'` 를 돌려준다 — pull 은
   * 멀쩡히 됐기 때문이다. 그런데 blocked 는 **워터마크를 전진시키지 않으므로** 대기 건수가
   * 영원히 안 줄고, 원장은 `waiting` 분기에 걸려 _"올리는 중 — N건 대기"_ 를 **무한히** 말했다.
   * "올리는 중"은 곧 끝난다는 뜻인데 실제로는 사람이 손대기 전까지 아무 일도 안 일어난다.
   *
   * ⚠ 우선순위가 **오프라인보다 위**다. 오프라인은 스스로 낫고 blocked 는 안 낫는다 —
   * 기기 폐기·D1 한도·인증 만료는 전부 사람이 무언가를 해야 풀린다. 그 조건을 "오프라인"으로
   * 덮으면 사용자는 네트워크가 돌아오기를 기다리며 계속 편집한다.
   */
  blocked: string | null;
}

/**
 * 원장이 지금 무슨 말을 하나. 말할 것이 없으면 null(그리지 않는다).
 *
 * ⚠⚠ **한 번도 성공한 적 없으면 아무 말도 안 한다.** 처음엔 `'방금'` 폴백을 뒀다가 실렌더에서
 * 잡혔다: 헤더에 "토큰 갱신 실패(503)"가 떠 있는데 바로 아래에서 "· 방금 동기화"라고 말했다 —
 * 이 원장이 막으려던 **바로 그 거짓말**을 원장 자신이 한 것이다. `at === null` 은 "방금"이 아니라
 * "모른다/아직 없다"이고, 그때 대기도 0이면 말할 것이 없다(0·평온은 아무것도 안 그린다).
 * ⚠ 클라우드를 안 붙였으면 통째로 침묵한다 — 이 앱은 클라우드 없이도 완결된다.
 *   "한 번도 성공한 적 없고 대기도 셀 수 없다"가 그 상태의 관측 가능한 형태다.
 */
export function ledgerLine(led: Ledger, now: number): { text: string; warn: boolean } | null {
  /* ⚠ blocked 가 **가장 먼저**다 — 유일하게 스스로 낫지 않는 상태라서다(위 필드 주석).
     "이 기기에 남아 있어요"를 함께 말하는 것이 계약이다: 중단은 곧 유실이라고 읽히기 쉬운데,
     실제로는 워터마크가 안 움직였을 뿐 편집은 전부 로컬에 있다. */
  if (led.blocked) {
    return { text: `동기화 중단 — ${led.blocked} (편집 ${led.pending ?? 0}건은 이 기기에 남아 있어요)`, warn: true };
  }
  if (led.at === null && led.pending === null && !led.failed) return null;
  const waiting = led.pending != null && led.pending > 0;
  const warn = !led.online || led.failed || waiting;
  const text = !led.online
    ? `오프라인 — 편집 ${led.pending ?? 0}건은 이 기기에 저장돼 있어요`
    : led.failed
      ? /* ⚠ 대기가 없으면 **건수를 말하지 않는다**(H3). 종전엔 늘 "편집 0건이 대기 중이에요"라
           적었는데, 0건 대기는 사실이 아니라 잡음이다 — 그리고 이 원장의 존재 이유가 "숫자가
           있으면 말하고 없으면 침묵한다"이다. 실제로 폰 헤더에서 그 문구가 보이기 시작하며
           드러났다(H3 의 구독이 붙기 전까지는 이 분기가 화면에 도달한 적이 없었다). */
        waiting
        ? `동기화 실패 — 편집 ${led.pending}건이 대기 중이에요`
        : '동기화 실패 — 다음 시도에 다시 올려요'
      : waiting
        ? `올리는 중 — ${led.pending}건 대기`
        : led.at != null
          ? `· ${agoLabel(led.at, now)} 동기화`
          : null;
  return text === null ? null : { text, warn };
}
