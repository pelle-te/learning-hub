/* ============================================================
   phone/SyncLedger — 폰 헤더의 **상시** 동기화 원장(UX-B4).

   ## 무엇이 결함이었나

   `PhoneApp` 헤더는 **실패했을 때만** 말했다. 성공·오프라인·대기 중은 전부 침묵이라, 폰에서
   완료를 체크하고 나서 **그게 올라갔는지 알 방법이 없었다.** 최악의 결과는 사용자가 확신을
   못 해 PC 에서 같은 걸 다시 입력하는 것이다(중복 입력) — 이 앱이 기기 사이를 잇겠다고 만든
   기능이 오히려 두 번 일하게 만드는 형태.

   ## 새 데이터가 0 이다

   `syncController.lastSync()` 가 마지막 성공 시각을, `collectOutbox()` 가 대기 건수를 이미
   준다. 없던 것은 **화면에 말하는 자리**뿐이었다.

   ## ⚠ 침묵하지 않되 떠들지도 않는다

   온라인이고 대기가 0 이면 한 줄로 축약한다("· 방금 동기화"). 이 앱의 빈 상태 규율(0·평온은
   아무것도 안 그린다)과 "올라갔나?"에 답해야 한다는 요구가 부딪히는 자리인데, 답이 필요한
   질문이므로 **말은 하되 가장 작게** 한다. 반대로 대기가 있거나 실패면 그때는 눈에 띄어야 한다.

   ⚠ 대기 건수는 **동기화 시도 직후**에만 다시 센다(+ 화면 복귀·온라인 전환). 매 렌더마다 세면
   SQLite 를 헤더가 두드리게 된다 — 편집 뒤에는 `syncSoon`(1.2초)이 어차피 시도를 걸므로
   그 흐름에 얹는 것으로 충분하다.
============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { lastSync } from '@/store/syncController';
import { collectOutbox } from '@/lib/cloud/outbox';
import { batchSize } from '@/lib/cloud/contract';
import { agoLabel } from '@/lib/utils';

interface Ledger {
  online: boolean;
  /** 대기 중(아직 못 올린) 편집 수. 셀 수 없으면 null — **0 과 구분한다**(모름 ≠ 없음). */
  pending: number | null;
  /** 마지막으로 **성공한** 동기화 시각(epoch ms). 없으면 null. */
  at: number | null;
  failed: boolean;
}

/** 30초 — 상대시각("3분 전")이 어긋나 보이지 않을 만큼만. 이 값이 DB 를 두드리지는 않는다. */
const TICK_MS = 30_000;

export default function SyncLedger(): React.JSX.Element | null {
  const [led, setLed] = useState<Ledger>({ online: true, pending: null, at: null, failed: false });
  /* ⚠ '지금'을 **상태로** 든다 — 렌더에서 `Date.now()` 를 부르면 순수성 린트가 막는다(옳다:
     시계는 렌더의 입력이 아니다). 틱이 이 값을 갈아 끼워 상대시각만 다시 계산되게 한다. */
  const [now, setNow] = useState(() => Date.now());

  const read = useCallback(async (): Promise<void> => {
    const ls = lastSync();
    let pending: number | null = null;
    try {
      const b = await collectOutbox();
      pending = b ? batchSize(b) : null;
    } catch {
      /* 셀 수 없으면 모른다고 둔다 — 관측이 앱을 해치지 않는다. */
    }
    setLed({
      online: navigator.onLine,
      pending,
      at: ls && ls.result.status === 'ok' ? ls.at : null,
      failed: ls?.result.status === 'failed',
    });
  }, []);

  useEffect(() => {
    /* ⚠ 첫 읽기를 이펙트 **본문에서** 부르지 않는다 — 그러면 setState-in-effect 로 막힌다.
       한 틱 뒤로 미루면 콜백이 되고, 헤더가 첫 페인트를 막지 않는 부수 효과도 있다. */
    const first = setTimeout(() => void read(), 0);
    const onVis = (): void => {
      if (document.visibilityState === 'visible') void read();
    };
    const onNet = (): void => void read();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    // 상대시각만 갱신하는 틱(DB 접근 없음) — "3분 전"이 5분 전인 채로 굳지 않게.
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      clearInterval(id);
    };
  }, [read]);

  /* 클라우드를 안 붙였으면 통째로 침묵한다 — 이 앱은 클라우드 없이도 완결된다(원칙과 같은 판단).
     "한 번도 성공한 적 없고 대기도 셀 수 없다"가 그 상태의 관측 가능한 형태다. */
  if (led.at === null && led.pending === null && !led.failed) return null;

  const waiting = led.pending != null && led.pending > 0;
  const tone = !led.online || led.failed || waiting ? 'text-warn' : 'text-mut';
  /* ⚠⚠ **한 번도 성공한 적 없으면 아무 말도 안 한다.** 처음 이 자리에 `'방금'` 폴백을 뒀다가
     실렌더에서 잡았다: 헤더에 "토큰 갱신 실패(503)"가 떠 있는데 바로 아래에서 "· 방금 동기화"
     라고 말했다 — 이 원장이 막으려던 **바로 그 거짓말**을 원장 자신이 한 것이다.
     `at === null` 은 "방금"이 아니라 **"모른다/아직 없다"** 이고, 그때 대기도 0이면 말할 것이
     없다(0·평온은 아무것도 안 그린다). */
  const text = !led.online
    ? `오프라인 — 편집 ${led.pending ?? 0}건은 이 기기에 저장돼 있어요`
    : led.failed
      ? `동기화 실패 — 편집 ${led.pending ?? 0}건이 대기 중이에요`
      : waiting
        ? `올리는 중 — ${led.pending}건 대기`
        : led.at != null
          ? `· ${agoLabel(led.at, now)} 동기화`
          : null;
  if (text === null) return null;

  return (
    <p role="status" className={`px-3 pb-2 text-xs ${tone}`}>
      {text}
    </p>
  );
}
