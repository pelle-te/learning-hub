/* ============================================================
   todaySlots.test.ts — 오늘 탭이 **몇 개를 띄우는가**(W19·W20).
   요지: 슬롯을 줄이되 **없애지는 않는다** — 우발적 인출의 빈도가 유지되는 것이 W20 의 조건이다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { pickNextStep, pickRetrievalSlot } from '@/lib/todaySlots';

describe('pickRetrievalSlot — 하루 한 장(회전)', () => {
  it('둘 다 있으면 날짜로 회전한다 — 어느 날에도 한 장은 뜬다', () => {
    expect(pickRetrievalSlot(true, true, 2)).toBe('conf');
    expect(pickRetrievalSlot(true, true, 3)).toBe('recall');
  });
  it('⚠ 하나뿐이면 회전과 무관하게 그것이 뜬다(회전이 유실이 되면 안 된다)', () => {
    expect(pickRetrievalSlot(true, false, 3)).toBe('conf'); // 홀수 날이어도 회상이 없으니 착각
    expect(pickRetrievalSlot(false, true, 2)).toBe('recall'); // 짝수 날이어도 착각이 없으니 회상
  });
  it('둘 다 없으면 아무것도 안 그린다', () => {
    expect(pickRetrievalSlot(false, false, 1)).toBeNull();
  });
});

describe('pickNextStep — 완료 화면의 다음 걸음 하나', () => {
  it('행동을 바꾸는 것부터: 밀린 복습 > 열린 보충', () => {
    expect(pickNextStep(3, 5)?.kind).toBe('review');
    expect(pickNextStep(0, 5)?.kind).toBe('backlog');
    /* ⚠ 셋째 후보(`frontier` — 다음 개념 추천)는 2026-08-31 에 걷혔다(U044·U086): 생산자인
       지식엔진이 은퇴해 그 값이 영구히 비었고, 착지처로 적힌 「숙달도 탭」은 라우터에 없어
       `*` 가 `/today` 로 삼켰다 — 즉 사슬을 허용하던 조건(후보 전부가 화면에 자기 자리를
       갖는다)이 이미 깨져 있었다. 근거는 `lib/todaySlots.ts` 머리주석. */
    expect(pickNextStep(0, 0)).toBeNull();
  });
  it('라벨에 수가 들어간다 — "있다"가 아니라 "몇 개"가 행동을 정한다', () => {
    expect(pickNextStep(3, 0)?.label).toContain('3');
    expect(pickNextStep(0, 7)?.label).toContain('7');
  });
});
