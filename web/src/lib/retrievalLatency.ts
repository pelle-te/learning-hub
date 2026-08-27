/* ============================================================
   retrievalLatency.ts — **A-2 인출 지연**(순수 · React 무관)

   ## ⚠ 파일명이 왜 `retrieval.ts` 가 아닌가
   그 이름은 이미 다른 것이 쓰고 있다 — `lib/retrieval.ts` 는 **회상 카드 선택**(내 3문장
   요약을 인출 연습 재료로 고르는 것)이다. 이름이 인접해 보인다고 같은 것이 아니다: 저기는
   *무엇을 물을까*, 여기는 *얼마나 걸렸나*. 한 파일에 합치면 "인출"이라는 말이 두 뜻을 갖는다.

   ## 왜 생겼나
   이 앱의 인출 관측은 **통과/막힘 1비트가 전부**였다(`ReviewRun.tsx` 에 `performance.now`
   0건 · 발산 6회차 각도 5 실측). 그런데 같은 통과라도 3초와 40초는 다른 상태다 — 후자는
   붙은 것이 아니라 *더듬어 찾아낸* 것이고, 시험은 그것을 통과로 안 쳐 준다.

   CBMS 의 `T`(시간) 코드가 사후 자기보고로 같은 것을 잡고 있었지만 그건 **이미 늦은 관측**
   이다(틀린 뒤에야 적는다). 지연은 *맞은 카드에 대해서도* 생기고, 사용자가 아무것도 더 하지
   않아도 생긴다 — 이 회차의 신규 신호 중 **입력을 요구하지 않는 유일한 것**이다.

   ## ⚠⚠ 이 파일이 **하지 않는** 것
   - **순위를 안 매긴다.** 관측 며칠치로 챕터를 줄 세우면 `chapterStrength` 가 이미 거절한
     정밀도의 착시가 된다.
   - **소비처가 아직 없다.** `doneHm`(T-8)이 세운 관용구 그대로다 — 재는 것을 먼저 달고,
     무엇을 그릴지는 표본이 쌓인 뒤에 정한다. 순환 대기(관측을 기다리며 관측 장치를 안 다는
     것)를 끊는 것이 이 파일의 목적이다.

   ## ⚠ 쓰레기를 막는 문턱 둘 (이게 이 파일의 실질이다)
   측정이 **탭을 놔두고 자리를 뜬 시간**을 담으면 그 값은 인출 지연이 아니라 잡음이다.
   그래서 위아래를 자른다 — 자르지 않으면 중앙값조차 이상치에 끌려간다.
============================================================ */
import { rid, todayISO } from './utils';
import type { AppState } from './types';

/* ⚠⚠ **두 문턱은 `[추측]` 이다 — 잰 적이 없다**(P048 · 2026-08-28 데이터 축).

   아래 두 주석은 각 문턱이 *무엇을 뜻하는지*는 말하지만 **그 값이 왜 400/120,000 인지**는 말하지
   않는다. 실측(2026-08-28): 이 원장의 표본은 **0건**이다(실 DB `records` 0행 · 읽기 전용 사본으로
   확인). 즉 이 문턱들은 한 번도 실제 분포와 대조된 적이 없고, 「이상치를 잘랐다」는 말은
   **잘린 것이 있었는지조차 모르는 상태**에서의 주장이다.

   ⚠⚠ 그리고 더 나쁜 것: `usable()` 이 문턱 밖을 **세지 않고 버린다**. 그래서 표본이 쌓이기
   시작해도 «문턱이 맞았나»를 판정할 증거는 **생성되는 순간 사라진다** — 이 저장소가 성능 축
   1회차에서 근본 원인 R2 로 이름 붙인 형태(*"잰 수를 어디에도 착지시키지 않는다"*) 그대로다.

   ⛔ **그렇다고 지금 버리는 값을 배열에 함께 담지 마라.** 검토했고 기각했다: 그러면 행 모양이
   바뀌는데, 이 슬라이스를 읽는 **구버전**은 그 «버려야 할 행»을 통계에 그대로 넣는다(P043 이
   고친 것과 같은 부류의 앞뒤 호환 사고). 소비처가 0이고 표본도 0인 지금 그 위험을 살 이유가 없다.

   ✅ **다시 열 조건**: 이 원장에 표본이 **쌓이기 시작하면**(`records` 의 `retrievals` 행 > 0).
   그때 판정에 필요한 것은 «문턱 밖이 몇 건이었나»이고, 그 계수기를 어디에 둘지가 첫 질문이다
   (동기화되는 배열은 위 이유로 답이 아니다 — 기기-로컬 자리를 먼저 정할 것). */

/** 이보다 짧으면 **안 읽고 눌렀다**(연타·오조작). 담으면 "즉답"으로 오독된다. ⚠ 값은 `[추측]`. */
export const MIN_MS = 400;
/** 이보다 길면 **자리를 떴다**. 인출 지연이 아니라 부재 시간이다. ⚠ 값은 `[추측]`. */
export const MAX_MS = 120_000;

/** 담을 만한 측정인가. 문턱 밖은 **버린다 — 0 이나 상한으로 눌러 담지 않는다**(가짜 값이 된다).
 *  ⚠ 버린 건수를 **아무도 안 센다**. 위 머리주석이 그 대가와 다시 열 조건을 진다. */
export function usable(ms: number): boolean {
  return Number.isFinite(ms) && ms >= MIN_MS && ms <= MAX_MS;
}

/**
 * 인출 1건을 기록한다. 문턱 밖이면 **아무것도 안 남긴다**(반환 `null`).
 *
 * ⚠ 챕터가 없으면 안 담는다 — 이 값의 쓸모가 전부 "어느 챕터가 느린가"에 있고, 챕터를
 * 모르는 행은 분모만 키운다.
 */
export function addRetrieval(
  state: AppState,
  sid: string,
  chapter: string,
  ms: number,
  got: boolean,
  ds?: string,
): string | null {
  if (!sid || !chapter.trim() || !usable(ms)) return null;
  state.retrievals = state.retrievals || [];
  const id = rid();
  state.retrievals.push({
    id,
    ds: ds || todayISO(state), // '오늘' 단일 출처(_today 시드 존중) — 벽시계 직접 참조 금지
    sid,
    chapter: chapter.trim(),
    ms: Math.round(ms),
    got,
  });
  return id;
}

/**
 * 방금 담은 인출의 판정을 채운다.
 *
 * ⚠ 왜 두 걸음인가: **펼치는 순간엔 떠올렸는지 모른다.** 지연은 그때 확정되고 판정은 그 뒤에
 * 온다. 한 걸음으로 만들려고 펼칠 때 `got: true` 를 낙관적으로 넣으면 넘긴 카드까지 전부
 * "떠올림"이 되어 `gotRate` 가 통째로 거짓이 된다.
 */
export function setRetrievalGot(state: AppState, id: string, got: boolean): void {
  const r = (state.retrievals || []).find((x) => x.id === id);
  if (r) r.got = got;
}

/** 표본이 말을 하기 위한 최소 건수 — `estimateCalibration.MIN_SAMPLES` 와 같은 자다. */
export const MIN_SAMPLES = 4;

export interface RetrievalStat {
  sid: string;
  chapter: string;
  /** 담긴 측정 수. */
  n: number;
  /** **중앙값** ms. */
  medianMs: number;
  /** 떠올린 비율. */
  gotRate: number;
}

/** 중앙값(정렬된 배열). 짝수면 가운데 둘의 평균 — 한 곳에서만 정의한다. */
function median(sorted: readonly number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * 챕터별 지연 요약 — 느린 순. 표본이 `min` 미만인 챕터는 **안 낸다**.
 *
 * ⚠ **평균이 아니라 중앙값**이다. 인출 시간은 오른쪽으로 길게 늘어지는 분포라(한 번 헤매면
 * 10배가 된다) 평균은 이상치 하나를 그 챕터의 성격으로 만든다. 위 문턱이 극단은 이미 잘랐지만
 * 문턱 안에서도 그 왜곡은 남는다.
 */
export function retrievalStats(state: AppState, min = MIN_SAMPLES): RetrievalStat[] {
  const by = new Map<string, { sid: string; chapter: string; ms: number[]; got: number }>();
  for (const r of state.retrievals || []) {
    const key = r.sid + '|' + r.chapter;
    const g = by.get(key);
    if (g) {
      g.ms.push(r.ms);
      if (r.got) g.got++;
    } else by.set(key, { sid: r.sid, chapter: r.chapter, ms: [r.ms], got: r.got ? 1 : 0 });
  }
  const out: RetrievalStat[] = [];
  for (const g of by.values()) {
    if (g.ms.length < min) continue;
    const sorted = [...g.ms].sort((a, b) => a - b);
    out.push({
      sid: g.sid,
      chapter: g.chapter,
      n: g.ms.length,
      medianMs: Math.round(median(sorted)),
      gotRate: g.got / g.ms.length,
    });
  }
  return out.sort((a, b) => b.medianMs - a.medianMs || (a.chapter < b.chapter ? -1 : 1));
}

/**
 * **통과하지만 느린** 챕터 — 이 신호의 존재 이유.
 *
 * 통과율이 높은데 중앙값이 전체 중앙값의 `factor` 배를 넘는 챕터. 기존 어느 지표도 이걸
 * 못 본다: `chapterStrength` 는 통과라 `strong` 이라 말하고, 그래서 사다리가 **미룬다**.
 *
 * ⚠ 기준을 상수로 박지 않고 **자기 분포의 중앙값**에서 뽑는다 — "몇 초가 느린가"는 과목·
 * 사람마다 다르고, 절대값을 박으면 그 수가 어디서 왔는지 아무도 설명할 수 없다(이 저장소가
 * 사다리 파생 상수에 대해 세운 규율과 같은 자).
 * ⚠ 비교 대상이 2챕터 미만이면 빈 배열이다 — 기준 자체가 잡음이 된다.
 */
export function slowButPassing(state: AppState, factor = 2, minGotRate = 0.75): RetrievalStat[] {
  const stats = retrievalStats(state);
  if (stats.length < 2) return [];
  const base = median([...stats.map((s) => s.medianMs)].sort((a, b) => a - b));
  return stats.filter((s) => s.gotRate >= minGotRate && s.medianMs >= base * factor);
}
