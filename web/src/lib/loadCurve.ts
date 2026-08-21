/* ============================================================
   loadCurve.ts — **노브를 돌리기 전에 곡선을 본다**(I019 · 2026-08-22 발상 축).

   ## 이 앱에는 「바꾸기 전에 결과를 보는 자리」가 없었다

   과거는 잘 잰다. 현재는 정확히 판정한다. **미래는 없다** — 그중 복습 축이 특히 그렇다:
   사다리(1·3·7·16·34)는 상수이고, 그것을 늘리거나 줄이면 4주 뒤 하루 부하가 어떻게 되는지
   말해 주는 곳이 0이다. 밖의 표본이 이 자리를 갖고 있고(docs.ankiweb.net/deck-options.html ·
   확인 2026-08-22), 그 문서의 요지는 **노브가 아니라 곡선이 먼저**라는 것이다: 사용자는 간격을
   고르는 게 아니라 «얼마나 비싼 것을 고르는지»를 봐야 하는데 그 관계가 비선형이다.

   ## ⚠⚠ 대가를 함께 판다 — 「더 잊는다」

   같은 문서가 못박는 것: 사다리를 늘리면 하루 부하는 줄지만 **파지율이 떨어진다.** 곡선만
   보여 주고 그 문장을 빼면 이 화면은 «부하를 줄이는 법»을 파는 것이 되고, 그건 간격반복이
   막으려는 바로 그 선택을 돕는 꼴이다. 그래서 `stretched` 는 항상 **경고 문구와 짝**으로만
   쓰인다(그 문구는 화면이 아니라 여기 `TRADEOFF` 가 소유한다 — 화면마다 다르게 말하면
   그 경고는 곧 장식이 된다).

   ## ⚠ 예측이 아니라 형태다

   `dueForecast` 와 같은 모델을 쓴다(같은 함수를 다른 사다리로 부른다) — 즉 여기 나오는 수는
   «그 사다리에서 파도가 어떤 모양인가»이지 «며칠에 몇 개»의 예측이 아니다. 두 곡선을 **같은
   함수**로 뽑는 것이 요점이다: 따로 계산하면 비교가 두 모델의 차이를 보게 된다.
============================================================ */
import { dueForecast, FORECAST_OFFSETS } from './spacedReview';
import type { AppState, Day } from './types';

/** 곡선 지평(일). 4주 — 사다리의 꼬리(34일)를 한 바퀴 넘기지 않으면 «늘림»의 효과가 안 보인다. */
export const CURVE_HORIZON = 28;

/** 사다리를 한 칸 늘린다 — 각 칸을 **다음 칸으로** 민다(임의 계수를 만들지 않는다).
 *  ⚠ 이 규율은 `spacedReview` 가 이미 세웠다: 앞당김·미룸의 폭이 전부 `REVIEW_OFFSETS`
 *  자신에서 나오므로 «왜 하필 그 숫자인가»가 안 생긴다. 마지막 칸은 두 배로 민다(다음 칸이 없다). */
export function stretchedOffsets(offsets: readonly number[] = FORECAST_OFFSETS): number[] {
  return offsets.map((v, i) => offsets[i + 1] ?? v * 2);
}

/** 사용자에게 반드시 함께 보여 줄 대가. **화면이 이 문장을 새로 짓지 않는다**(머리주석). */
export const TRADEOFF =
  '간격을 늘리면 하루 부하는 줄지만 **더 많이 잊습니다** — 총량을 줄이는 것이 아니라 미루는 것이에요.';

export interface LoadCurve {
  /** 현행 사다리의 일별 챕터 수(길이 = `CURVE_HORIZON`). */
  now: number[];
  /** 한 칸 늘린 사다리의 같은 값. */
  stretched: number[];
  /** 두 곡선의 최댓값 — 화면이 같은 눈금으로 그리게 한다(다른 눈금이면 비교가 거짓이 된다). */
  peak: number;
}

/**
 * 현행 대 「한 칸 늘림」 두 곡선.
 *
 * ⚠ 최댓값을 **함께** 돌려주는 것이 계약이다. 두 곡선을 각자 정규화해 그리면 «늘리면 낮아진다»가
 * 그림에서 사라진다 — 그건 이 기능의 전부다.
 */
export function loadCurve(state: AppState, days: Day[], todayDs: string, horizon = CURVE_HORIZON): LoadCurve {
  const at = (offsets: readonly number[]): number[] => {
    const f = dueForecast(state, days, todayDs, horizon, offsets);
    const out = Array<number>(horizon).fill(0);
    for (const d of f) if (d.offset >= 1 && d.offset <= horizon) out[d.offset - 1] = d.chapters;
    return out;
  };
  const now = at(FORECAST_OFFSETS);
  const stretched = at(stretchedOffsets());
  return { now, stretched, peak: Math.max(1, ...now, ...stretched) };
}
