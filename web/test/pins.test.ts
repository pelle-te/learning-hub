/* ============================================================
   pins.test.ts — T-26 핀 슬롯.

   ⚠ 여기서 잠그는 것 셋:
   - **상한이 기능의 일부다.** 무제한이면 핀 슬롯이 두 번째 목록이 되고, "매번 그 화면으로
     돌아간다"를 "매번 핀 목록을 훑는다"로 바꾼 것뿐이다.
   - **넘칠 때 버리는 쪽이 오래된 것**이다. 방금 고정한 것을 버리면 토글이 아무 일도 안 한
     것처럼 보인다.
   - **이름 없는 핀은 안 만든다** — 다시 못 찾는다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { MAX_PINS, canPin, isPinned, togglePin, type Pin } from '@/lib/pins';

const p = (to: string, at = 1): Pin => ({ to, label: to, at });

describe('togglePin', () => {
  it('없으면 넣고 있으면 뺀다', () => {
    const one = togglePin([], p('/a'));
    expect(one.map((x) => x.to)).toEqual(['/a']);
    expect(togglePin(one, p('/a'))).toEqual([]);
  });
  it('같은 경로는 하나뿐이다', () => {
    const twice = togglePin(togglePin([], p('/a')), p('/a', 2));
    expect(twice).toEqual([]); // 두 번째는 해제이지 중복 추가가 아니다
  });
  it('상한을 넘으면 **가장 오래된 것**이 빠진다', () => {
    let pins: Pin[] = [];
    for (let i = 0; i < MAX_PINS + 1; i += 1) pins = togglePin(pins, p(`/x${i}`, i));
    expect(pins).toHaveLength(MAX_PINS);
    expect(pins.map((x) => x.to)).not.toContain('/x0'); // 첫 번째가 빠졌다
    expect(pins[pins.length - 1]!.to).toBe(`/x${MAX_PINS}`); // 방금 것은 남았다
  });
  it('원본을 안 건드린다(순수)', () => {
    const before: Pin[] = [p('/a')];
    togglePin(before, p('/b'));
    expect(before).toHaveLength(1);
  });
});

describe('isPinned · canPin', () => {
  it('경로로 판정한다', () => {
    expect(isPinned([p('/a')], '/a')).toBe(true);
    expect(isPinned([p('/a')], '/b')).toBe(false);
  });
  it('라우트가 아니거나 이름이 비면 고정하지 않는다 — 다시 못 찾는다', () => {
    expect(canPin('/a', '가나')).toBe(true);
    expect(canPin('a', '가나')).toBe(false);
    expect(canPin('/a', '   ')).toBe(false);
  });
});
