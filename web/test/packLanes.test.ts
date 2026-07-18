import { describe, expect, it } from 'vitest';
import { packLanes } from '@/lib/scheduleView';

/* 캘린더 겹침 배치 — 겹치는 일정을 나란한 레인으로. 픽셀·DOM 무관 순수 로직이라 여기서 잠근다. */
const ev = (id: string, start: number, end: number) => ({ item: id, start, end });
const byId = (out: ReturnType<typeof packLanes<string>>, id: string) => out.find((p) => p.item === id)!;

describe('packLanes — 캘린더 레인 배치', () => {
  it('겹치지 않는 일정은 모두 lane 0 · lanes 1(전폭)', () => {
    const out = packLanes([ev('a', 540, 600), ev('b', 600, 660), ev('c', 700, 760)]);
    expect(out).toHaveLength(3);
    for (const p of out) {
      expect(p.lane).toBe(0);
      expect(p.lanes).toBe(1);
    }
  });

  it('맞닿기만 한 일정(끝==시작)은 겹침이 아니다', () => {
    const out = packLanes([ev('a', 540, 600), ev('b', 600, 660)]);
    expect(byId(out, 'b').lane).toBe(0);
    expect(byId(out, 'b').lanes).toBe(1);
  });

  it('겹치면 다른 레인으로 나뉘고 폭 분모가 함께 커진다', () => {
    const out = packLanes([ev('a', 540, 660), ev('b', 600, 720)]);
    expect(byId(out, 'a').lane).toBe(0);
    expect(byId(out, 'b').lane).toBe(1);
    expect(byId(out, 'a').lanes).toBe(2);
    expect(byId(out, 'b').lanes).toBe(2);
  });

  it('3중 겹침 → 레인 0·1·2', () => {
    const out = packLanes([ev('a', 540, 720), ev('b', 560, 700), ev('c', 580, 640)]);
    expect(new Set(out.map((p) => p.lane))).toEqual(new Set([0, 1, 2]));
    for (const p of out) expect(p.lanes).toBe(3);
  });

  it('레인은 재사용된다 — 앞 일정이 끝난 자리에 다음이 앉는다', () => {
    // a: 9–12(lane0), b: 10–11(lane1), c: 11–12(lane1 재사용 — b가 끝났으므로)
    const out = packLanes([ev('a', 540, 720), ev('b', 600, 660), ev('c', 660, 720)]);
    expect(byId(out, 'a').lane).toBe(0);
    expect(byId(out, 'b').lane).toBe(1);
    expect(byId(out, 'c').lane).toBe(1);
  });

  it('클러스터가 끊기면 폭 분모도 독립 — 한 번의 3중 겹침이 하루 전체를 좁히지 않는다', () => {
    const out = packLanes([ev('a', 540, 700), ev('b', 560, 700), ev('c', 580, 700), ev('solo', 800, 900)]);
    expect(byId(out, 'solo').lanes).toBe(1); // 앞 클러스터의 3레인에 끌려가지 않는다
    expect(byId(out, 'a').lanes).toBe(3);
  });

  it('길이 0/음수 구간은 버린다(위치를 못 정하는 값)', () => {
    const out = packLanes([ev('zero', 600, 600), ev('neg', 700, 650), ev('ok', 540, 600)]);
    expect(out.map((p) => p.item)).toEqual(['ok']);
  });

  it('입력 순서가 달라도 결과는 같다(시작 시각 기준 정렬)', () => {
    const a = packLanes([ev('x', 600, 720), ev('y', 540, 660)]);
    const b = packLanes([ev('y', 540, 660), ev('x', 600, 720)]);
    expect(byId(a, 'x')).toEqual(byId(b, 'x'));
    expect(byId(a, 'y')).toEqual(byId(b, 'y'));
  });
});
