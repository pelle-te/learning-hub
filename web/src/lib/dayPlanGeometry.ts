/* ============================================================
   dayPlanGeometry.ts — 일 편집기(DayPlanner) 타임라인의 시간↔좌표 변환과 구간 겹침 판정.

   왜 lib인가: 이 계산들은 순수한데 1137줄짜리 컴포넌트 안 클로저로 묻혀 있어 단위 테스트가
   불가능했다. 드래그로 시간을 박고 리사이즈하는 편집기에서 좌표 산식이 틀리면 사용자가 놓은
   블록이 엉뚱한 시각에 앉는데, 그걸 잡아줄 그물이 시각 스냅샷뿐이었다.

   ⚠ scheduleView.timeSpan과 혼동 금지 — 그쪽은 '주간 캘린더의 표시 범위'로 패딩·최소폭·폴백을
   갖는 반면, 여기 timelineSpan은 '그 날의 깨어있는 창'을 기준으로 하고 창 밖 일정만 union한다.
   비슷해 보이지만 규칙이 달라 합치면 한쪽 레이아웃이 조용히 틀어진다.
============================================================ */

/** 전체 대비 비율(분모 0이면 0 — 0으로 나누기 방지). */
export function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/** 분 길이 → 트랙 높이 %(눈금·카드 top/height). */
export function minToPct(min: number, spanMin: number): number {
  return ratio(min, spanMin) * 100;
}

/** 드래그 픽셀 → 분(리사이즈). colH=타임라인 컬럼 높이(px). */
export function pxToMin(px: number, colH: number, spanMin: number): number {
  return ratio(px, colH) * spanMin;
}

export interface TimelineSpan {
  lo: number; // 트랙 시작(분, 시각 경계로 내림)
  hi: number; // 트랙 끝(분, 시각 경계로 올림)
  span: number; // hi - lo (최소 60)
}

/** 타임라인 표시 범위 — 깨어있는 창(wake0~wake1)을 기본으로 하되, 창 **밖**의 일정(새벽 블록 등)은
 *  union해 화면 밖으로 잘리지 않게 한다. 정시 경계로 스냅하고, 창이 비정상(0폭)이어도 최소 1시간을 준다.
 *
 *  왜 '일정 있는 구간 ±1h'로 좁히지 않는가: 예전엔 그랬는데, 일정이 하나도 없는 날엔 폴백이
 *  `wake0 + 8h`라 07시 기상이면 07:00–15:00만 그렸다(오후가 통째로 사라짐). 시간 행이 프레임을
 *  채우도록 신축하면서 "창 전체를 그리면 납작해진다"는 원래 우려도 사라졌다. */
export function timelineSpan(wake0: number, wake1: number, marks: number[]): TimelineSpan {
  const clampDay = (m: number) => Math.max(0, Math.min(1440, m));
  const lo = clampDay(Math.floor(Math.min(wake0, ...marks) / 60) * 60);
  const hiRaw = clampDay(Math.ceil(Math.max(wake1, ...marks) / 60) * 60);
  const hi = hiRaw > lo ? hiRaw : Math.min(1440, lo + 60);
  return { lo, hi, span: Math.max(1, hi - lo) };
}

/** 반열린 구간 [s, s+m)이 ranges 중 하나와 겹치는가. 경계가 맞닿는 건(끝==시작) 겹침이 아니다. */
export function overlaps(ranges: [number, number][], s: number, m: number): boolean {
  return ranges.some(([a, b]) => s < b && a < s + m);
}
