/* ============================================================
   store/useSyncLedger — 동기화 원장의 **읽기**(E12 · 2026-07-29).

   `syncController`·`collectOutbox` 를 만지므로 store 층이다(`components` 는 store 를 import 할 수
   없다 — 레이어 경계 린트). 판정은 `lib/syncLedger`, 그리기는 `components/SyncLedger`.

   ⚠ 대기 건수는 **동기화 시도 직후**에만 다시 센다(+ 화면 복귀·온라인 전환). 매 렌더마다 세면
   헤더가 SQLite 를 두드리게 된다 — 편집 뒤에는 `syncSoon`(1.2초)이 어차피 시도를 걸므로
   그 흐름에 얹는 것으로 충분하다.
============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { lastSync, onSyncResult } from './syncController';
import { collectOutbox, readLastOk } from '@/lib/cloud/outbox';
import { readCloudConfig } from '@/lib/cloud/client';
import { batchSize } from '@/lib/cloud/contract';
import { onVisible, onHidden } from '@/lib/visibility';
import { attemptFailed, blockedReason, okAt, staleDaysOf, type Ledger } from '@/lib/syncLedger';

/** 30초 — 상대시각("3분 전")이 어긋나 보이지 않을 만큼만. 이 값이 DB 를 두드리지는 않는다. */
const TICK_MS = 30_000;

export function useSyncLedger(): { led: Ledger; now: number } {
  const [led, setLed] = useState<Ledger>({
    online: true,
    pending: null,
    at: null,
    failed: false,
    blocked: null,
    staleDays: null,
    /* ⚠ **초깃값이 `false` 인 것이 계약이다**(Q-23). `true` 로 두면 클라우드를 안 붙인 사용자도
       첫 프레임에 "확인 중"을 보고, 그건 영원히 끝나지 않는다 — 아래 첫 읽기가 자격증명을 확인한
       **뒤에만** 켠다. 이 앱은 클라우드 없이도 완결된다는 것이 그 침묵의 근거다. */
    checking: false,
  });
  /* ⚠ '지금'을 **상태로** 든다 — 렌더에서 `Date.now()` 를 부르면 순수성 린트가 막는다(옳다:
     시계는 렌더의 입력이 아니다). 틱이 이 값을 갈아 끼워 상대시각만 다시 계산되게 한다. */
  const [now, setNow] = useState(() => Date.now());

  const read = useCallback(async (): Promise<void> => {
    const ls = lastSync();
    /* Q-23 — "아직 모른다"와 "볼 것이 없다"를 가르는 유일한 사실이 **자격증명의 존재**다.
       ⚠ 매 읽기마다 확인한다(캐시하지 않는다) — 설정 탭에서 연결/해제하면 그 즉시 뜻이 뒤집히고,
       한 번 캐시하면 연결 직후 세션 내내 침묵하거나 해제 뒤 영원히 "확인 중"이 된다. */
    let cloud = false;
    try {
      cloud = (await readCloudConfig()) !== null;
    } catch {
      /* 읽을 수 없으면 없는 것으로 — 없는 확인을 약속하지 않는다. */
    }
    let pending: number | null = null;
    try {
      const b = await collectOutbox();
      pending = b ? batchSize(b) : null;
    } catch {
      /* 셀 수 없으면 모른다고 둔다 — 관측이 앱을 해치지 않는다. */
    }
    /* ⚠ 이 세 판정(중단 사유 · 성공 시각 · 실패)은 **`lib/syncLedger` 가 소유한다**(O009 ·
       2026-08-22). 종전엔 여기 지역 구현이 있었고 `CloudCard` 가 그것을 못 써서 자기 판정을
       다시 지었는데 **그쪽이 틀렸다**(시도를 성공으로 그렸다). 규율은 이 파일 머리주석에
       이미 있었다 — 판정=lib · 읽기=여기 · 그리기=components. */
    const blocked = blockedReason(ls);
    /* ⚠ **디스크에서 읽는다 — 세션 상태가 아니다**(O008). 이 한 줄이 「방금 한 번 실패」와
       「3주 연속 실패」를 가른다. `collectOutbox` 와 같은 규율으로 실패를 삼킨다(모르면 null:
       관측이 앱을 해치지 않고, 「모른다」를 「0일」로 그리지도 않는다). */
    let lastOk: number | null = null;
    try {
      lastOk = await readLastOk();
    } catch {
      /* 못 읽으면 모른다 — 경과를 0 으로 꾸미지 않는다. */
    }
    setLed({
      online: navigator.onLine,
      pending,
      /* ⚠ 중단됐으면 "언제 성공했나"를 말하지 않는다 — pull 은 성공했더라도 **내 편집은 하나도
         안 올라갔다.** 여기서 `ls.at` 을 주면 "· 방금 동기화" 로 읽힐 수 있는데(blocked 문구가
         이기긴 하지만) 원장이 서로 모순되는 두 사실을 들고 있게 된다. */
      at: okAt(ls),
      failed: attemptFailed(ls),
      blocked,
      staleDays: staleDaysOf(lastOk, Date.now()),
      /* 클라우드가 붙어 있는데 **이번 세션에 결과가 하나도 없다** = 첫 확인이 아직 안 끝났다.
         `_lastSync` 는 모듈 상태라 새로고침마다 null 로 돌아온다(그게 "이번 세션"의 정의다). */
      checking: cloud && ls === null,
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

    const offVisible = onVisible(() => {
      // 복귀 = 밀린 시간을 즉시 따라잡는다(멈춰 있던 동안의 문구가 한 틱 더 남지 않게).
      setNow(Date.now());
      startTick();
      void read();
    });
    const offHidden = onHidden(stopTick);
    const onNet = (): void => void read();
    /* ⚠ **동기화가 끝났다는 사실을 여기서 받는다**(H3). 이 구독이 없어서 위 주석의 "동기화 시도
       직후에만 다시 센다"가 실제로는 이행되지 않고 있었다 — 화면을 떠났다 돌아오기 전까지
       원장이 낡은 채였고, 중단은 영원히 안 보였다. */
    const offResult = onSyncResult(() => void read());
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    // 상대시각만 갱신하는 틱(DB 접근 없음) — "3분 전"이 5분 전인 채로 굳지 않게.
    if (!document.hidden) startTick();
    return () => {
      clearTimeout(first);
      offResult();
      offVisible();
      offHidden();
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      stopTick();
    };
  }, [read]);

  return { led, now };
}
