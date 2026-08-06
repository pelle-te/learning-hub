/* ============================================================
   predictionScore.ts — **N-5 예측 → 채점**(순수 · React 무관)

   ## 왜 생겼나
   이 앱은 매일 판정을 내린다: 어느 챕터가 흔들리는가(`riskOf`·`chapterStrength`), 무엇이 급한가
   (`weakSpots`), 시험날 뭐가 샐 것인가(`examStaleChapters`). 그런데 **앱이 자기가 맞았는지
   물어본 적이 한 번도 없다.** 판정은 쌓이는데 그 판정의 적중률을 세는 코드가 0줄이었다.

   ⚠ 형태는 이미 이 저장소 안에 있다 — `estimateCalibration` 이 *시간 추정*에 대해 정확히 같은
   일을 한다(추정 vs 실측). 없던 것은 대상뿐이다: **위험 판정**에 대한 같은 대조.

   ## 그래서 이 파일이 하는 일 (둘뿐이다)
   ① **봉인** — 오늘 시점의 "흔들린다" 목록을 그대로 얼린다(`sealPrediction`).
   ② **채점** — 봉인 뒤 실제로 인출된 결과와 대조한다(`scorePrediction`).

   ## ⚠⚠ 이 파일이 **말하지 않는** 것
   - **회상확률·신뢰도 같은 연속값을 안 낸다.** `chapterStrength` 머리주석이 세운 규율 그대로다:
     한 자릿수 관측으로 소수점을 내면 정밀도의 착시가 된다. 여기서 내는 것은 **맞은 수/틀린 수**다.
   - **표본이 얇으면 `null` 이다.** `estimateCalibration.MIN_SAMPLES` 와 같은 형태이고 같은 이유다 —
     3전 2승으로 "적중률 67%"를 말하면 그 수는 진단이 아니라 잡음이다.
     ⚠ `null` 은 "적중률 0" 이 아니다. 호출부는 **안 그리는 쪽**으로 다뤄야 한다.

   ## ⚠ 무엇이 "맞음"인가 — 이 정의가 이 파일의 전부다
   봉인 시점에 **위험(due·overdue)** 이라고 말한 챕터가, 그 뒤 첫 인출에서 **막히면 적중**이다.
   통과하면 **오경보**(겁을 줬는데 멀쩡했다). 반대로 위험이 아니라고 말한 챕터가 막히면 **놓침**
   이고, 그게 가장 비싼 오류다 — 앱이 "괜찮다"고 해서 안 본 것이 시험에서 터지는 경로다.

   ⚠ **아직 인출되지 않은 챕터는 어느 칸에도 안 센다.** 미인출을 통과로 치면 시간이 갈수록
   적중률이 저절로 올라가고(분모만 커진다), 그건 채점이 아니라 자기 위안이다.
============================================================ */
import type { AppState } from './types';
import type { ChapterReview } from './spacedReview';

/** 채점이 말을 하기 위한 최소 표본. `estimateCalibration.MIN_SAMPLES` 와 같은 자다. */
export const MIN_SCORED = 4;

/** 봉인된 예측 — "이 날 앱은 이렇게 말했다". */
export interface SealedPrediction {
  /** 봉인한 날(ISO). 채점은 **이 날 이후**의 인출만 본다. */
  ds: string;
  /** 위험이라고 말한 챕터 키(`sid|chapter`). */
  atRisk: string[];
  /** 그날 판정 대상이던 챕터 키 전부 — 위험이 아니라고 말한 것의 분모. */
  scanned: string[];
}

/**
 * 지금 시점의 판정을 얼린다.
 *
 * ⚠ `chapterReviews` 산출을 **그대로** 받는다(다시 계산하지 않는다) — 여기서 판정을 재현하면
 * 봉인이 화면과 다른 규칙을 쓰게 되고, 그러면 채점하는 것이 앱의 판정이 아니라 이 파일의 판정이다.
 */
export function sealPrediction(reviews: readonly ChapterReview[], ds: string): SealedPrediction {
  const key = (r: ChapterReview): string => r.sid + '|' + r.chapter;
  return {
    ds,
    atRisk: reviews.filter((r) => r.risk !== 'fresh').map(key),
    scanned: reviews.map(key),
  };
}

export interface PredictionScore {
  /** 위험이라 말했고 실제로 막혔다. */
  hits: number;
  /** 위험이라 말했는데 통과했다 — 겁을 줬다. */
  falseAlarms: number;
  /** 괜찮다고 말했는데 막혔다 — **가장 비싼 오류**. */
  misses: number;
  /** 괜찮다고 말했고 실제로 통과했다. */
  correctRejections: number;
  /** 채점된 총 건수(= 봉인 뒤 실제로 인출된 챕터 수). */
  scored: number;
  /** `(hits + correctRejections) / scored`. */
  accuracy: number;
}

/**
 * 봉인 뒤 실제 결과로 채점한다. 표본이 `MIN_SCORED` 미만이면 **null**.
 *
 * @param sealed `sealPrediction` 산출
 * @param state  현재 상태(`blankResults` 를 읽는다)
 * @param todayDs 오늘 — 미래 기록은 안 센다(시드·시계 어긋남 방어 · 이 저장소 공통 규율)
 */
export function scorePrediction(sealed: SealedPrediction, state: AppState, todayDs: string): PredictionScore | null {
  /* 봉인 **뒤** 첫 인출만 본다. 두 번째부터는 그 사이의 학습이 결과를 바꾸므로 봉인 시점의
     판정을 채점하는 것이 아니게 된다("첫 인출"이 이 채점의 관측 창이다). */
  const first = new Map<string, boolean>();
  for (const b of state.blankResults || []) {
    const chapter = (b.chapter || '').trim();
    if (!b.sid || !chapter || !b.ds) continue;
    if (b.ds <= sealed.ds || b.ds > todayDs) continue;
    const key = b.sid + '|' + chapter;
    if (!first.has(key)) first.set(key, !!b.passed);
  }
  const risk = new Set(sealed.atRisk);
  let hits = 0;
  let falseAlarms = 0;
  let misses = 0;
  let correctRejections = 0;
  for (const key of sealed.scanned) {
    const passed = first.get(key);
    if (passed === undefined) continue; // ⚠ 미인출은 어느 칸에도 안 센다(머리주석)
    if (risk.has(key)) {
      if (passed) falseAlarms++;
      else hits++;
    } else if (passed) correctRejections++;
    else misses++;
  }
  const scored = hits + falseAlarms + misses + correctRejections;
  if (scored < MIN_SCORED) return null;
  return { hits, falseAlarms, misses, correctRejections, scored, accuracy: (hits + correctRejections) / scored };
}

/**
 * 채점의 사람 말 — **적중률 하나가 아니라 어느 쪽으로 틀리는지**를 말한다.
 *
 * ⚠ 적중률만 보이면 "놓침 3 · 오경보 0" 과 "놓침 0 · 오경보 3" 이 같은 문장이 된다. 둘은 전혀
 * 다른 처방을 요구한다(전자는 사다리가 느슨하다 · 후자는 겁이 많다).
 */
export function scoreLabel(s: PredictionScore): string {
  const pct = Math.round(s.accuracy * 100);
  if (s.misses > s.falseAlarms) return `적중 ${pct}% — 놓치는 쪽으로 틀린다(괜찮다고 한 것이 막혔다)`;
  if (s.falseAlarms > s.misses) return `적중 ${pct}% — 겁이 많은 쪽으로 틀린다(위험이라 한 것이 붙어 있었다)`;
  return `적중 ${pct}%`;
}
