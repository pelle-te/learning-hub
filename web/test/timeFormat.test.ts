/* ============================================================
   timeFormat.test.ts — 시각 표기 포매터(lib/utils · CT-S3 수렴분).
   왜: 같은 표기 규약이 여섯 군데에 손으로 복제돼 있었고, 이제 한 곳으로 모았다.
   모은 자리는 **경계에서 조용히 틀리기 쉬운 곳**(0분·자정·60초 캐리·음수)이라 잠근다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { pad2, hhmm, mmss } from '@/lib/utils';

describe('pad2', () => {
  it('한 자리는 0 을 채우고 두 자리 이상은 그대로', () => {
    expect(pad2(0)).toBe('00');
    expect(pad2(7)).toBe('07');
    expect(pad2(59)).toBe('59');
    expect(pad2(123)).toBe('123'); // 자르지 않는다 — 잘라내면 값이 조용히 왜곡된다
  });
});

describe('hhmm — Date → 로컬 HH:MM', () => {
  it('자정·정오·한 자리 시각', () => {
    expect(hhmm(new Date(2026, 6, 24, 0, 0))).toBe('00:00');
    expect(hhmm(new Date(2026, 6, 24, 9, 5))).toBe('09:05');
    expect(hhmm(new Date(2026, 6, 24, 12, 0))).toBe('12:00');
    expect(hhmm(new Date(2026, 6, 24, 23, 59))).toBe('23:59');
  });
});

describe('mmss — 초 → MM:SS', () => {
  it('0·한 자리·캐리 경계', () => {
    expect(mmss(0)).toBe('00:00');
    expect(mmss(9)).toBe('00:09');
    expect(mmss(59)).toBe('00:59');
    expect(mmss(60)).toBe('01:00');
    expect(mmss(1500)).toBe('25:00'); // 포모도로 기본
  });
  it('60분을 넘으면 분이 계속 커진다(시로 넘기지 않는다 — 타이머 표기 관례)', () => {
    expect(mmss(3600)).toBe('60:00');
    expect(mmss(3661)).toBe('61:01');
  });
  it('음수는 0 으로 클램프 — 시계 오차가 "-1:-30" 을 만들지 않게', () => {
    expect(mmss(-5)).toBe('00:00');
  });
  it('소수 초는 반올림', () => {
    expect(mmss(59.6)).toBe('01:00');
  });
});
