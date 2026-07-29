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
  if (led.at === null && led.pending === null && !led.failed) return null;
  const waiting = led.pending != null && led.pending > 0;
  const warn = !led.online || led.failed || waiting;
  const text = !led.online
    ? `오프라인 — 편집 ${led.pending ?? 0}건은 이 기기에 저장돼 있어요`
    : led.failed
      ? `동기화 실패 — 편집 ${led.pending ?? 0}건이 대기 중이에요`
      : waiting
        ? `올리는 중 — ${led.pending}건 대기`
        : led.at != null
          ? `· ${agoLabel(led.at, now)} 동기화`
          : null;
  return text === null ? null : { text, warn };
}
