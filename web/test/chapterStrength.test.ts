/* ============================================================
   chapterStrength.test.ts — T-5 챕터 기억 강도.

   이 파일이 지키는 핵심은 **"표본 없음"이 "강도 0"이 아니라는 것**이다. 그 둘이 섞이면 화면이
   값 부재를 값 0 으로 그리게 되고, 그게 이 저장소가 반복해서 물린 "조용한 거짓말"의 형태다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { BAND_LABEL, chapterStrength } from '@/lib/chapterStrength';
import type { AppState } from '@/lib/types';

let n = 0;
const bres = (sid: string, chapter: string, ds: string, passed: boolean) => ({
  id: `b${++n}`,
  ds,
  sid,
  name: '전자기학',
  passed,
  note: '',
  chapter,
});
const st = (blankResults: unknown[], reviewTouches: Record<string, string> = {}) =>
  ({ blankResults, reviewTouches }) as unknown as AppState;

describe('chapterStrength — 3구간(연속값을 안 낸다)', () => {
  const TODAY = '2026-08-02';

  it('채점 기록이 없으면 unseen — 0 이 아니다', () => {
    const s = chapterStrength(st([]), 'sub1', '3장', TODAY);
    expect(s.band).toBe('unseen');
    expect(s.attempts).toBe(0);
    expect(s.lastPassed).toBeNull();
  });

  it('⚠ 인출만 하고 채점이 없으면 여전히 unseen — 본 것과 붙은 것은 다르다', () => {
    const s = chapterStrength(st([], { 'sub1|3장': '2026-07-30' }), 'sub1', '3장', TODAY);
    expect(s.band).toBe('unseen');
    expect(s.lastTouchDs).toBe('2026-07-30');
    expect(s.daysSince).toBe(3); // 인출 기록은 그대로 실린다(구간만 unseen)
  });

  it('챕터 이름이 없으면 unseen — 과목 단위 옛 기록이 챕터로 새지 않게', () => {
    expect(chapterStrength(st([bres('sub1', '', '2026-08-01', true)]), 'sub1', '', TODAY).band).toBe('unseen');
  });

  it('연속 통과는 strong', () => {
    const s = chapterStrength(
      st([bres('sub1', '3장', '2026-07-20', true), bres('sub1', '3장', '2026-07-28', true)]),
      'sub1',
      '3장',
      TODAY,
    );
    expect(s.band).toBe('strong');
    expect(s).toMatchObject({ attempts: 2, passes: 2, lastPassed: true });
  });

  it('⭐ 마지막 시도가 막힘이면 통과율이 높아도 shaky — 평균은 최근성을 지운다', () => {
    const s = chapterStrength(
      st([
        bres('sub1', '3장', '2026-07-10', true),
        bres('sub1', '3장', '2026-07-15', true),
        bres('sub1', '3장', '2026-07-20', true),
        bres('sub1', '3장', '2026-08-01', false),
      ]),
      'sub1',
      '3장',
      TODAY,
    );
    expect(s.passes).toBe(3);
    expect(s.attempts).toBe(4); // 75% 인데도
    expect(s.band).toBe('shaky'); // 지금 흔들리는 중이다
  });

  it('통과율이 절반 미만이면 shaky(마지막이 통과여도)', () => {
    const s = chapterStrength(
      st([
        bres('sub1', '3장', '2026-07-10', false),
        bres('sub1', '3장', '2026-07-15', false),
        bres('sub1', '3장', '2026-07-20', true),
      ]),
      'sub1',
      '3장',
      TODAY,
    );
    expect(s.lastPassed).toBe(true);
    expect(s.band).toBe('shaky');
  });

  it('다른 과목·다른 챕터의 기록은 안 섞인다', () => {
    const s = chapterStrength(
      st([bres('other', '3장', '2026-08-01', false), bres('sub1', '4장', '2026-08-01', false)]),
      'sub1',
      '3장',
      TODAY,
    );
    expect(s.band).toBe('unseen');
  });

  it('구간 어휘는 한 곳에서만 나온다', () => {
    expect(Object.keys(BAND_LABEL).sort()).toEqual(['shaky', 'strong', 'unseen']);
  });
});
