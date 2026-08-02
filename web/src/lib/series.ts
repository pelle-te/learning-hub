/* ============================================================
   series.ts — **셀 단위 시계열**의 판정(T-14 데이터워드 · T-21 지층 · T-23 작은 배수). 순수.

   ## 왜 셋이 한 파일을 공유하나

   셋 다 같은 질문에서 막힌다: _"이 셀에 그릴 만한 점이 충분한가."_ 그 문턱을 컴포넌트마다
   따로 두면 한 화면은 3점으로 스파크를 그리고 옆 화면은 안 그리는 상태가 되고, 그때
   **어느 쪽이 규칙인지 말할 수 없다.**

   ## ⚠⚠ 이 파일의 존재 이유는 **거절**이다

   로드맵이 T-14 의 전제를 이렇게 적었다: _"셀 단위 시계열이 **최소 6점** 있다 — **3점 이하면
   스파크는 거짓말**"_. 두 점을 이은 선은 추세처럼 보이지만 추세가 아니고, 사용자는 그 차이를
   픽셀에서 구분할 방법이 없다. 그래서 판정을 여기 한 곳에 두고 **모자라면 `null`** 을 준다 —
   화면은 `null` 을 받으면 그 칸을 비운다(0 으로 그리지 않는다 · 이 저장소가 반복해 세운 규율).

   ## ⚠ 값 없는 주는 0 이다, 하지만 **꼬리의 0 은 점이 아니다**

   주간 시계열에서 중간의 빈 주는 진짜 0 이다("그 주에 안 했다"). 그런데 아직 오지 않은 미래
   주까지 0 으로 채우면 **모든 스파크가 우하향한다** — 데이터가 아니라 달력이 만든 모양이다.
   그래서 뒤쪽 연속 0 은 잘라낸다.
============================================================ */

/** 스파크를 그릴 수 있는 최소 점 수. **3 이하면 거짓말**이라는 것이 이 상수의 근거다(머리주석). */
export const MIN_POINTS = 6;

/** 주 → 대상 → 값 형태(스케줄러의 `weekHours` 와 같은 모양). */
export type WeekMatrix = Record<string, Record<string, number>>;

/** 뒤쪽 연속 0 을 잘라낸다 — 미래 주가 만드는 가짜 우하향을 막는다(머리주석). */
function trimTrailingZeros(xs: number[]): number[] {
  let end = xs.length;
  while (end > 0 && xs[end - 1] === 0) end -= 1;
  return xs.slice(0, end);
}

/**
 * 한 대상의 주간 시계열. **점이 모자라면 `null`**(= 화면이 그 칸을 비운다).
 *
 * ⚠ 주 순서는 **키의 사전순**이다(`YYYY-MM-DD` 라 곧 시간순). 정렬을 호출부에 맡기면
 * 화면마다 다른 순서로 같은 데이터를 그릴 수 있다.
 */
export function weekSeries(m: WeekMatrix, key: string): number[] | null {
  const weeks = Object.keys(m).sort();
  const xs = trimTrailingZeros(weeks.map((w) => m[w]?.[key] ?? 0));
  return xs.length >= MIN_POINTS ? xs : null;
}

/** 전 대상 합계의 주간 시계열(지층 띠의 분모). 규칙은 위와 같다. */
export function weekTotals(m: WeekMatrix): number[] | null {
  const weeks = Object.keys(m).sort();
  const xs = trimTrailingZeros(weeks.map((w) => Object.values(m[w] || {}).reduce((a, b) => a + b, 0)));
  return xs.length >= MIN_POINTS ? xs : null;
}

/** 지층 한 주 — 대상별 값(합이 0 인 주도 그대로 남긴다: 쉰 주도 지층의 일부다). */
export interface StrataWeek {
  wk: string;
  parts: { key: string; v: number }[];
  total: number;
}

/**
 * 지층 띠의 입력(T-21) — **모자라면 `null`**. 최소 주 수는 스파크와 같은 상수를 쓴다.
 *
 * ⚠ 여기서도 뒤쪽 빈 주를 자른다. 자르지 않으면 학기 초에 띠의 오른쪽 절반이 통째로 비어
 * "지금 무너지는 중"처럼 보인다 — 실제로는 아직 안 온 주다.
 */
export function strata(m: WeekMatrix, keys: string[]): StrataWeek[] | null {
  const weeks = Object.keys(m).sort();
  const rows: StrataWeek[] = weeks.map((wk) => {
    const parts = keys.map((key) => ({ key, v: m[wk]?.[key] ?? 0 }));
    return { wk, parts, total: parts.reduce((a, p) => a + p.v, 0) };
  });
  let end = rows.length;
  while (end > 0 && rows[end - 1]!.total === 0) end -= 1;
  const trimmed = rows.slice(0, end);
  return trimmed.length >= MIN_POINTS ? trimmed : null;
}

/**
 * 작은 배수(T-23)의 **공유 척도** — 여러 계열을 같은 자로 재게 한다.
 *
 * ⚠ 이것이 "작은 배수"의 정의 전부다. 계열마다 자기 최댓값으로 정규화하면 격자는 예뻐지지만
 * **비교가 불가능해진다**(모든 칸이 천장에 닿는다) — 그러면 그건 작은 배수가 아니라 그냥
 * 작은 차트 여러 개다.
 */
export function sharedMax(seriesList: (number[] | null)[]): number {
  let max = 0;
  for (const s of seriesList) if (s) for (const v of s) if (v > max) max = v;
  return max || 1; // 0 으로 나누지 않는다 — 전부 0 이면 평평한 바닥이 정답이다
}
