/* ============================================================
   semesterFingerprint.test.ts — **학기 지문**(N-22 · W6).

   로드맵이 적은 가장 싼 검증이 이것이다: *"씨앗으로 SVG → 과목 2/4/8 × 균등/편중 **여섯 장이
   구분되나**."* 구분이 안 되면 이 안은 장식이고 값이 0이다 — 그래서 그 명제를 그대로 잠근다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { semesterFingerprint, type FingerprintInput } from '@/lib/semesterFingerprint';

/** 과목 n개 · 균등 배분. */
const even = (n: number): FingerprintInput[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, minutes: 600 }));
/** 과목 n개 · 첫 과목에 몰림. */
const skewed = (n: number): FingerprintInput[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, minutes: i === 0 ? 3000 : 200 }));

const shape = (xs: FingerprintInput[]): string =>
  semesterFingerprint(xs)
    .map((b) => b.d)
    .join('|');

describe('학기 지문 — 여섯 장이 구분되나(이 안의 유일한 검증)', () => {
  const six = [even(2), even(4), even(8), skewed(2), skewed(4), skewed(8)];

  it('⭐ 여섯 조합이 전부 다른 도형이다', () => {
    const shapes = six.map(shape);
    expect(new Set(shapes).size, `여섯 중 겹치는 것이 있다:\n${shapes.join('\n')}`).toBe(6);
  });

  it('같은 학기를 두 번 그리면 같다 — 지문은 결정적이다(해시 파생)', () => {
    expect(shape(even(4))).toBe(shape(even(4)));
  });

  it('가지 수 = 과목 수', () => {
    expect(semesterFingerprint(even(8))).toHaveLength(8);
    expect(semesterFingerprint([])).toEqual([]);
  });
});

describe('길이 규칙', () => {
  it('많이 한 과목이 더 길다 — 편중 학기의 첫 가지가 가장 길다', () => {
    const bs = semesterFingerprint(skewed(4));
    const lenOf = (d: string): number => {
      const m = /([\d.-]+) ([\d.-]+)$/.exec(d)!;
      return Math.hypot(Number(m[1]) - 50, Number(m[2]) - 50);
    };
    const first = lenOf(bs[0]!.d);
    for (const b of bs.slice(1)) expect(first).toBeGreaterThan(lenOf(b.d));
  });

  it('0분 과목도 **점이 아니라 가지**다 — 등록했다는 사실 자체가 학기의 일부다', () => {
    const bs = semesterFingerprint([
      { id: 'a', minutes: 0 },
      { id: 'b', minutes: 900 },
    ]);
    expect(bs[0]!.d).not.toBe('M50 50Q50 50 50 50');
  });

  it('색을 정하지 않는다 — 그건 `colorForId` 가 소유한다(절대규칙 #3)', () => {
    for (const b of semesterFingerprint(even(3))) expect(Object.keys(b).sort()).toEqual(['d', 'id']);
  });
});
