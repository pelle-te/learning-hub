/* ============================================================
   frameMemory.test.ts — Q-16. **기억이 거짓말이 되지 않는 경계**를 잠근다.

   W15 가 `SkeletonText` 를 금지한 이유는 "3행을 약속하고 12행이 오는" 거짓말이었다. Q-16 은 그
   금지를 되돌리는 것처럼 보이므로, 되돌리지 **않았다**는 사실이 검사로 남아야 한다: 기억하는 것은
   화면 구조(리드아웃 수·앵커 유무)뿐이고 데이터 파생 수치는 애초에 API 에 들어올 자리가 없다.
============================================================ */
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetFrames, recallFrame, rememberFrame } from '@/lib/frameMemory';
import { storage } from '@/lib/kv';

const KEY = 'hub.frameShapes.v1';

beforeEach(() => forgetFrames());

describe('frameMemory — 형상 기억', () => {
  it('쓰고 읽으면 같은 형상이 나온다', () => {
    rememberFrame('today', { readouts: 3, primary: true });
    expect(recallFrame('today')).toEqual({ readouts: 3, primary: true });
  });

  it('기억이 없으면 null — 뼈대가 종전 일반 형상으로 떨어진다', () => {
    expect(recallFrame('stats')).toBeNull();
  });

  it('같은 값을 다시 쓰면 저장하지 않는다 — 크롬 주입마다 직렬화하면 상시 비용이 된다', () => {
    expect(rememberFrame('today', { readouts: 3, primary: false })).toBe(true);
    expect(rememberFrame('today', { readouts: 3, primary: false })).toBe(false);
    expect(rememberFrame('today', { readouts: 4, primary: false })).toBe(true);
  });

  it('리드아웃 수에 상한이 있다 — 그보다 많으면 리드아웃이 아니라 목록이다', () => {
    rememberFrame('x', { readouts: 999, primary: false });
    expect(recallFrame('x')?.readouts).toBe(6);
    rememberFrame('y', { readouts: -3, primary: false });
    expect(recallFrame('y')?.readouts).toBe(0);
  });

  it('손상된 값은 "기억 없음"으로 떨어진다 — 화면은 계속 뜬다', () => {
    storage.setItem(KEY, '{ not json');
    expect(recallFrame('today')).toBeNull();
    storage.setItem(KEY, JSON.stringify({ today: { readouts: 'three', primary: true } }));
    expect(recallFrame('today')).toBeNull();
  });

  it('빈 탭 키는 쓰지도 읽지도 않는다', () => {
    expect(rememberFrame('', { readouts: 3, primary: true })).toBe(false);
    expect(recallFrame('')).toBeNull();
  });

  /* ⚠⚠ 이 케이스가 Q-16 과 W15 의 경계 그 자체다 — 타입에 데이터 파생 필드가 없다는 사실을
     런타임에서도 확인한다(있으면 저장 후 되읽기에서 살아남는다). */
  it('데이터 파생 값(행 수·항목 수)은 기억되지 않는다 — W15 의 거짓말을 되돌리지 않았다', () => {
    rememberFrame('items', { readouts: 2, primary: true, rows: 12 } as never);
    expect(recallFrame('items')).toEqual({ readouts: 2, primary: true });
    expect(JSON.stringify(recallFrame('items'))).not.toContain('rows');
  });
});
