/* ============================================================
   pins.ts — **T-26 핀 슬롯**(어느 화면의 무엇이든 고정). 순수.

   ## 무엇이 없었나

   세션 내내 다시 보는 대상이 있다 — 이번 주 시험 과목, 막힌 챕터 하나, 오늘 정한 목표.
   그런데 다시 보려면 **매번 그 화면으로 돌아간다**. `resume` 커서(N-7)가 비슷한 일을 하지만
   그건 "마지막에 하던 것" 하나이고 TTL 6시간이라, *내가 고른* 대상을 쥐고 있지 못한다.

   ## ⚠ 기기별이다 — 동기화하지 않는다

   무엇을 눈앞에 두고 싶은가는 **이 기기의 주의**에 대한 사실이다(`seenDs`·`trayResident` 와
   같은 논증). PC 에서 고정한 것이 폰 화면 위쪽을 차지하면, 폰의 좁은 화면에서 그건 방해다.

   ## ⚠⚠ 상한이 기능의 일부다

   `MAX_PINS` 를 넘으면 **가장 오래된 것이 빠진다**. 무제한이면 핀 슬롯이 두 번째 목록이 되고,
   그러면 "매번 그 화면으로 돌아간다"를 "매번 핀 목록을 훑는다"로 바꾼 것뿐이다. 고정은
   **소수여야** 값이 있다(로드맵의 전제도 _"다시 보는 대상이 실제로 소수 고정"_ 이었다).
============================================================ */

/** 고정 하나 — 라우트와 라벨만. **값을 복사해 두지 않는다**(복사하면 원본이 바뀔 때 낡는다). */
export interface Pin {
  /** 라우트 경로(`/subject/abc`·`/review-run`). 정체성이자 이동 주소다. */
  to: string;
  label: string;
  /** 고정한 시각(epoch ms) — 상한 초과 시 가장 오래된 것을 뺀다. */
  at: number;
}

/** 동시에 쥘 수 있는 수. **늘리면 기능이 목록이 된다**(머리주석). */
export const MAX_PINS = 4;

/** 이미 고정돼 있나 — 토글 UI 가 자기 상태를 그리는 데 쓴다. */
export function isPinned(pins: readonly Pin[], to: string): boolean {
  return pins.some((p) => p.to === to);
}

/**
 * 고정/해제 토글. **같은 `to` 는 하나뿐**이고, 넘치면 가장 오래된 것이 빠진다.
 *
 * ⚠ 순수 함수다(새 배열을 돌려준다) — 스토어가 이 결과를 담기만 하면 되고, 상한 규칙이
 * 화면마다 흩어지지 않는다.
 */
export function togglePin(pins: readonly Pin[], pin: Pin): Pin[] {
  if (isPinned(pins, pin.to)) return pins.filter((p) => p.to !== pin.to);
  const next = [...pins, pin];
  // 오래된 것부터 버린다 — 방금 고정한 것을 버리면 토글이 아무 일도 안 한 것처럼 보인다.
  return next.length > MAX_PINS ? next.slice(next.length - MAX_PINS) : next;
}

/** 라벨이 비었거나 라우트가 아니면 고정하지 않는다 — 이름 없는 핀은 다시 못 찾는다. */
export function canPin(to: string, label: string): boolean {
  return to.startsWith('/') && label.trim().length > 0;
}
