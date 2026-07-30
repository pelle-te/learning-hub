/* ============================================================
   store/useSyncLedger — 동기화 원장의 **읽기**(E12 · 2026-07-29).

   `syncController`·`collectOutbox` 를 만지므로 store 층이다(`components` 는 store 를 import 할 수
   없다 — 레이어 경계 린트). 판정은 `lib/syncLedger`, 그리기는 `components/SyncLedger`.

   ⚠ 대기 건수는 **동기화 시도 직후**에만 다시 센다(+ 화면 복귀·온라인 전환). 매 렌더마다 세면
   헤더가 SQLite 를 두드리게 된다 — 편집 뒤에는 `syncSoon`(1.2초)이 어차피 시도를 걸므로
   그 흐름에 얹는 것으로 충분하다.
============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { lastSync } from './syncController';
import { collectOutbox } from '@/lib/cloud/outbox';
import { batchSize } from '@/lib/cloud/contract';
import type { Ledger } from '@/lib/syncLedger';

/** 30초 — 상대시각("3분 전")이 어긋나 보이지 않을 만큼만. 이 값이 DB 를 두드리지는 않는다. */
const TICK_MS = 30_000;

export function useSyncLedger(): { led: Ledger; now: number } {
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

    /* ⚠ **틱은 보이는 동안만 돈다**(H24 · 2026-07-30 `/감사 근본`). 종전엔 `document.hidden` 을
       무시해 창을 내려둔 하루에도 30초마다 리렌더가 났다(≈2,880회). 그런데 이 틱이 갱신하는 것은
       **상대시각 문구뿐**이다 — 아무도 안 보는 동안의 "3분 전"은 정의상 가치가 0 이고, 복귀
       시점에 어차피 다시 계산된다. 그래서 멈췄다가 복귀할 때 한 번에 따라잡는다. */
    let id: ReturnType<typeof setInterval> | null = null;
    const startTick = (): void => {
      if (id === null) id = setInterval(() => setNow(Date.now()), TICK_MS);
    };
    const stopTick = (): void => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };

    const onVis = (): void => {
      if (document.visibilityState === 'visible') {
        // 복귀 = 밀린 시간을 즉시 따라잡는다(멈춰 있던 동안의 문구가 한 틱 더 남지 않게).
        setNow(Date.now());
        startTick();
        void read();
      } else stopTick();
    };
    const onNet = (): void => void read();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    // 상대시각만 갱신하는 틱(DB 접근 없음) — "3분 전"이 5분 전인 채로 굳지 않게.
    if (!document.hidden) startTick();
    return () => {
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      stopTick();
    };
  }, [read]);

  return { led, now };
}
