/* ============================================================
   dayPlanGeometry.test.ts — 일 편집기 타임라인 좌표·겹침 계약.
   이 계산들은 DayPlanner(1137줄) 안 클로저라 테스트가 불가능했다 — 드래그로 놓은 블록이
   엉뚱한 시각에 앉아도 시각 스냅샷 말고는 잡아줄 그물이 없었다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { minToPct, overlaps, pxToMin, ratio, timelineSpan } from '@/lib/dayPlanGeometry';

describe('시간 ↔ 좌표 변환', () => {
  it('ratio는 분모가 0이면 0(0으로 나누기 방지)', () => {
    expect(ratio(30, 0)).toBe(0);
    expect(ratio(30, 60)).toBe(0.5);
  });

  it('minToPct: 트랙 span 대비 백분율', () => {
    expect(minToPct(60, 600)).toBeCloseTo(10);
    expect(minToPct(0, 600)).toBe(0);
    expect(minToPct(600, 600)).toBeCloseTo(100);
  });

  it('pxToMin은 minToPct의 역변환과 정합한다(왕복 보존)', () => {
    const span = 720; // 12시간 트랙
    const colH = 600; // px
    const min = 90;
    const px = (minToPct(min, span) / 100) * colH;
    expect(pxToMin(px, colH, span)).toBeCloseTo(min, 6);
  });

  it('컬럼 높이가 0이면(레이아웃 전) 분도 0 — NaN을 흘리지 않는다', () => {
    expect(pxToMin(120, 0, 720)).toBe(0);
  });
});

describe('timelineSpan — 표시 범위', () => {
  it('깨어있는 창을 정시 경계로 스냅한다', () => {
    const { lo, hi } = timelineSpan(7 * 60 + 30, 23 * 60 + 10, []);
    expect(lo).toBe(7 * 60); // 내림
    expect(hi).toBe(24 * 60); // 올림
  });

  it('창 밖 일정(새벽)도 union해 화면 밖으로 자르지 않는다', () => {
    const { lo } = timelineSpan(7 * 60, 22 * 60, [2 * 60, 3 * 60]); // 새벽 2시 일정
    expect(lo).toBe(2 * 60);
  });

  it('일정이 없어도 오후가 사라지지 않는다(옛 wake0+8h 폴백 회귀)', () => {
    const { lo, hi } = timelineSpan(7 * 60, 23 * 60, []);
    expect(lo).toBe(7 * 60);
    expect(hi).toBe(23 * 60); // 15:00에서 끊기지 않는다
  });

  it('창이 0폭이어도 최소 1시간을 준다(span 0 방지)', () => {
    const { span } = timelineSpan(9 * 60, 9 * 60, []);
    expect(span).toBeGreaterThanOrEqual(60);
  });

  it('하루 경계(0~1440)를 넘지 않는다', () => {
    const { lo, hi } = timelineSpan(-120, 3000, []);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1440);
  });
});

describe('overlaps — 구간 겹침', () => {
  const ranges: [number, number][] = [
    [540, 600], // 09:00–10:00
    [780, 840], // 13:00–14:00
  ];

  it('겹치면 true', () => {
    expect(overlaps(ranges, 570, 60)).toBe(true); // 09:30–10:30
  });

  it('맞닿기만 하면 겹침이 아니다(끝 == 시작)', () => {
    expect(overlaps(ranges, 600, 60)).toBe(false); // 10:00–11:00
    expect(overlaps(ranges, 480, 60)).toBe(false); // 08:00–09:00
  });

  it('구간을 통째로 감싸도 겹침', () => {
    expect(overlaps(ranges, 480, 240)).toBe(true); // 08:00–12:00
  });

  it('빈 목록이면 항상 false', () => {
    expect(overlaps([], 540, 60)).toBe(false);
  });
});
