/* ============================================================
   estimateCalibration.ts — **Q-5 추정 vs 실측 대조**(순수 · React 무관)

   ## 왜 생겼나
   이 앱의 모든 시간 추정은 **상수 하나**에서 나온다: `vault.ts` 의 `estH = notes × 0.5h`.
   씨앗이 들어간 뒤 그 한 줄이 **312시간**을 만들었는데, 그 값이 맞는지 **대조하는 코드가 0줄**
   이었다. 한편 `completions[].actualMin`(G-1)은 **실제 경과 분**을 이미 쌓고 있다 — 즉 재료는
   양쪽 다 있는데 둘을 곱해 보는 곳이 없었다(발산 수렴점 ①: _"앱은 계산하는 것보다 결과가 적다"_).

   🌍 격차표의 **계획 오류**(예측 33.9일 vs 실제 55.5일 · "99% 확신" 완주 30% · Buehler 1994)가
   말하는 것이 정확히 이 사각이다.

   ## ⚠⚠ 채움률 게이트 — 이 파일의 존재 이유의 절반
   `actualMin` 은 **집중 세션을 완주한 경로에만** 실린다(손으로 체크하면 없다). 그래서 표본이
   얇을 때 배율을 내면 **한두 번의 긴 세션이 과목 전체의 추정을 뒤집는다.** 로드맵 Q-5 가 티어를
   `Now*` 로 표시하고 _"채움률 ≥15% 확인 선행"_ 이라 단 것이 그 뜻이다.
   그 확인을 **사람의 기억이 아니라 코드가** 한다: 채움률이 문턱 미만이면 `null` 을 돌려준다.
   ⚠ `null` 은 "배율 1.0" 이 아니다. 호출부는 **안 그리는 쪽**으로 다뤄야 한다(값 부재와 값 1.0 이
   같은 픽셀이 되면 그게 조용한 거짓말이다).
============================================================ */
import type { AppState } from './types';

/** 배율을 말하기 위한 **최소 채움률**. 로드맵 Q-5 의 선행 조건을 코드로 옮긴 것이다. */
export const MIN_FILL = 0.15;
/** 채움률이 높아도 표본이 이만큼은 있어야 한다 — 1건 중 1건(100%)으로 배율을 말할 순 없다. */
export const MIN_SAMPLES = 4;

export interface Calibration {
  /** 실측이 있는 완료 수. */
  samples: number;
  /** 이 과목의 전체 완료 수(실측 유무 무관) — 채움률의 분모. */
  total: number;
  /** `samples / total`. */
  fill: number;
  /** `Σ actualMin / Σ 계획 min`. 1보다 크면 **내 추정이 낙관적이었다**는 뜻이다. */
  ratio: number;
}

/**
 * 한 과목의 추정 배율. 표본이 얇으면 **null**(위 게이트 참조).
 *
 * ⚠ 분모는 `min`(계획된 분)이고 분자는 `actualMin`(실제 경과 분)이다 — `completionMin()` 을 쓰면
 * 실측이 없을 때 계획으로 폴백하므로 **비율이 항상 1** 이 된다. 여기서만은 그 폴백을 쓰면 안 된다.
 */
export function subjectCalibration(state: AppState, sid: string): Calibration | null {
  let total = 0;
  let samples = 0;
  let planned = 0;
  let actual = 0;
  for (const day of Object.values(state.completions || {})) {
    for (const [key, entry] of Object.entries(day || {})) {
      if (!entry?.done || key.split('|')[0] !== sid) continue;
      total++;
      const a = entry.actualMin;
      if (typeof a !== 'number' || a <= 0) continue;
      const p = +(entry.min || 0);
      if (p <= 0) continue;
      samples++;
      planned += p;
      actual += a;
    }
  }
  if (!total || samples < MIN_SAMPLES || !planned) return null;
  const fill = samples / total;
  if (fill < MIN_FILL) return null;
  return { samples, total, fill, ratio: actual / planned };
}

/** 배율의 사람 말. 5% 안쪽은 "대체로 맞음" — 소수점을 그대로 보이면 잡음을 신호로 읽게 된다. */
export function calibrationLabel(c: Calibration): string {
  const pct = Math.round((c.ratio - 1) * 100);
  if (Math.abs(pct) < 5) return '추정 대체로 맞음';
  return pct > 0 ? `추정보다 ${pct}% 더 걸림` : `추정보다 ${-pct}% 덜 걸림`;
}
