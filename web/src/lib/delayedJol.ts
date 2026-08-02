/* ============================================================
   delayedJol.ts — **T-9 지연 JOL**(하루 한 문항). 순수 · React 무관.

   ## 무엇이 없었나

   JOL(내가 이걸 떠올릴 수 있을까)은 **이미 있다** — 러너가 펼치기 직전에 묻는다(`ID-11`).
   그런데 그건 **즉시 JOL** 이고, 학습 연구가 반복해 보여 준 것은 즉시 판단이 *체계적으로*
   과신한다는 것이다(방금 본 것이 머리에 남아 있어 "안다"고 느낀다). 정확해지는 것은
   **지연된 판단**이다. 그리고 이 앱의 즉시 JOL 은 **세션 로컬이라 영속조차 안 된다**
   (`insights.ts` 의 `JolEntry` 가 그렇게 적어 뒀다) → 어제의 예측이 오늘 맞았는지 물어볼
   대상 자체가 없었다.

   ## ⚠⚠ 이 파일의 설계 핵심 — **해소를 저장하지 않는다**

   예측만 적고, "맞았나"는 **`blankResults` 에서 파생한다**(예측일 이후 그 챕터의 첫 인출).
   이유가 셋이다:

   1. **쓰기 경로가 안 늘어난다.** 러너를 안 건드리므로 해소가 빠지는 실패 모드가 없다
      (`chapterStrength`(T-5)가 같은 원천을 이미 그렇게 읽는다).
   2. **예측이 인출을 오염시키지 않는다.** 러너가 "너 어제 이거 된다고 했지"를 알면 그게
      단서가 되고, 그러면 재는 대상 자체가 달라진다.
   3. **소급 정정이 공짜다.** 인출 기록이 나중에 지워지면 그 예측은 자동으로 미해소로 돌아간다 —
      해소를 저장했다면 사라진 근거 위의 채점이 남았을 것이다.

   ## ⚠ "하루 한 문항"이 계약이다

   하루 1건이 소음이 아니라는 것이 이 항목의 전제였다(로드맵). 여러 건이면 그건 설문이고,
   러너가 설문이 되는 것을 이미 한 번 피했다(`ReviewRun` 의 `JOL_MAX` 주석 — 같은 판단).

   ## ⚠ 지연이 없으면 지연 JOL 이 아니다

   오늘 공부한 챕터를 오늘 물으면 그건 그냥 즉시 JOL 이다 — `MIN_DELAY_DAYS` 가 그 경계이고,
   이 상수를 0 으로 내리는 순간 이 파일의 존재 이유가 사라진다.
============================================================ */
import type { AppState, BlankResult } from './types';
import { dayDiff } from './utils';

/** 예측 하나 — **이것만** 저장한다(해소는 파생). */
export interface JolAsk {
  id: string;
  /** 예측한 날. */
  ds: string;
  sid: string;
  chapter: string;
  /** `true` = "떠오를 것 같다". */
  predicted: boolean;
}

/** 마지막 인출로부터 이만큼 지나야 묻는다. **0 이면 즉시 JOL 이 된다**(머리주석). */
export const MIN_DELAY_DAYS = 2;

/** 이만큼 해소돼야 정확도를 말한다. 미만이면 `null` — 표본 3개로 "과신 경향"을 말하면 거짓이다. */
export const MIN_SAMPLES = 5;

export function asksOf(state: Pick<AppState, 'jolAsks'>): JolAsk[] {
  return state.jolAsks || [];
}

/** 해소된 예측 하나 — 예측 + 그 뒤 첫 인출 결과. */
export interface JolResolved {
  ask: JolAsk;
  recalled: boolean;
  resolvedDs: string;
}

/**
 * 예측 하나를 해소한다 — **예측일 이후** 그 챕터의 **첫** 인출. 아직 없으면 null(미해소).
 *
 * ⚠ `ds > ask.ds` 다(같은 날은 안 센다). 같은 날 인출을 세면 "아침에 예측하고 저녁에 푼다"가
 * 아니라 "풀기 직전에 예측한다"와 구분되지 않는다 — 그게 즉시 JOL 이고 이미 있다.
 */
export function resolveAsk(state: Pick<AppState, 'blankResults'>, ask: JolAsk): JolResolved | null {
  const after = (state.blankResults || [])
    .filter((b: BlankResult) => b.sid === ask.sid && b.chapter === ask.chapter && b.ds > ask.ds)
    .sort((a, b) => (a.ds < b.ds ? -1 : a.ds > b.ds ? 1 : 0))[0];
  return after ? { ask, recalled: !!after.passed, resolvedDs: after.ds } : null;
}

/** 아직 결과가 안 나온 예측들(오래된 것 먼저). */
export function pendingAsks(state: Pick<AppState, 'jolAsks' | 'blankResults'>): JolAsk[] {
  return asksOf(state).filter((a) => !resolveAsk(state, a));
}

/** 예측 정확도. 표본이 `MIN_SAMPLES` 미만이면 **null** — 그때는 화면이 아무것도 안 그린다. */
export interface JolAccuracy {
  n: number;
  hit: number;
  /** 된다고 했는데 안 된 것 — **가장 위험한 방향**(즉시 JOL 이 체계적으로 만드는 오차). */
  over: number;
  /** 안 된다고 했는데 된 것. */
  under: number;
}

export function jolAccuracy(state: Pick<AppState, 'jolAsks' | 'blankResults'>): JolAccuracy | null {
  const done = asksOf(state)
    .map((a) => resolveAsk(state, a))
    .filter((r): r is JolResolved => !!r);
  if (done.length < MIN_SAMPLES) return null;
  let hit = 0;
  let over = 0;
  let under = 0;
  for (const r of done) {
    if (r.ask.predicted === r.recalled) hit += 1;
    else if (r.ask.predicted) over += 1;
    else under += 1;
  }
  return { n: done.length, hit, over, under };
}

/**
 * 오늘 물을 챕터 하나 — 없으면 null(= 화면이 줄을 안 그린다).
 *
 * 고르는 규칙: **마지막 인출이 가장 오래된** 챕터. 지연이 길수록 판단이 정확해지고, 동시에
 * 그 챕터가 실제로 위험한 것일 확률도 높다 — 두 목적이 같은 방향이라 규칙이 하나로 족하다.
 *
 * ⚠ 하루 한 문항: **오늘 이미 물었으면 null**. 그리고 미해소 예측이 쌓여 있으면 새로 안 묻는다 —
 *   대답 없는 질문을 늘리는 것은 이 항목이 피하려던 소음 그 자체다.
 */
export function askToday(
  state: Pick<AppState, 'jolAsks' | 'blankResults' | 'reviewTouches'>,
  ds: string,
): { sid: string; chapter: string; daysSince: number } | null {
  if (asksOf(state).some((a) => a.ds === ds)) return null;
  if (pendingAsks(state).length > 0) return null;

  const touches = state.reviewTouches || {};
  let best: { sid: string; chapter: string; daysSince: number } | null = null;
  for (const [key, lastDs] of Object.entries(touches)) {
    if (typeof lastDs !== 'string') continue;
    const at = key.indexOf('|');
    if (at < 0) continue;
    const daysSince = dayDiff(lastDs, ds);
    if (daysSince < MIN_DELAY_DAYS) continue; // 지연이 없으면 지연 JOL 이 아니다
    if (!best || daysSince > best.daysSince) best = { sid: key.slice(0, at), chapter: key.slice(at + 1), daysSince };
  }
  return best;
}

/** 예측을 적는다. ⚠ 뮤테이터 — immer 초안 위에서 부른다. 같은 날 두 번째는 무시(하루 한 문항). */
export function recordAsk(state: AppState, ask: JolAsk): boolean {
  if ((state.jolAsks || []).some((a) => a.ds === ask.ds)) return false;
  state.jolAsks = state.jolAsks || [];
  state.jolAsks.push(ask);
  return true;
}
