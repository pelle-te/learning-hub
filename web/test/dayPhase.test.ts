/* ============================================================
   dayPhase.test.ts — 하루의 국면(N-5).

   여기서 잠그는 것은 값이 아니라 **무엇을 근거로 삼지 않는가**다. 국면 판정에 시각 상수가
   끼어드는 순간 밤샘하는 날·오전만 공부하는 날에 화면이 틀린 질문을 크게 던지고, 잘못 맞춘
   국면은 아무것도 안 맞춘 것보다 나쁘다. 함수가 시계를 아예 안 받는다는 사실 자체가 계약이라
   시그니처가 그걸 보장한다 — 아래는 그 위의 판정들이다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { dayPhase } from '../src/lib/dayPhase';

describe('하루의 국면', () => {
  it('굴릴 것이 남았고 자리도 있으면 진행 중이다', () => {
    expect(dayPhase({ todayTotal: 4, pending: 2, freeLeftMin: 180, shortestPendingMin: 60 })).toBe('run');
  });

  it('전부 체크했으면 닫을 때다 — 창이 남아 있어도', () => {
    expect(dayPhase({ todayTotal: 4, pending: 0, freeLeftMin: 300, shortestPendingMin: 0 })).toBe('closing');
  });

  /* ⚠ 이 케이스가 이 항목의 값이다. 흔한 하루는 "다 한 날"이 아니라 **"못 한 채로 끝나는
     날"**인데, 그날 화면은 계속 "▶ 집중 시작"을 크게 띄우며 있지도 않은 시간을 쓰라고 했다. */
  it('할 일이 남았어도 가장 짧은 것조차 안 들어가면 닫을 때다', () => {
    expect(dayPhase({ todayTotal: 4, pending: 3, freeLeftMin: 20, shortestPendingMin: 60 })).toBe('closing');
  });

  /* ⚠⚠ 회귀 — 첫 판(`freeLeftMin <= 0`)은 이 경우를 'run' 이라 답했다. 일과가 "07:00–24:00
     자유"면 23:40 에도 창이 20분 남아, 판정이 사실상 "자정이 지났는가"가 됐다(우회로로
     되돌아온 시각 상수). 실렌더 확인이 잡은 그 장면을 여기에 고정한다. */
  it('⚠ 창이 양수여도 자리가 안 나면 닫을 때다 — 시각 상수의 우회 재발 방지', () => {
    expect(dayPhase({ todayTotal: 1, pending: 1, freeLeftMin: 20, shortestPendingMin: 90 })).toBe('closing');
  });

  it('빈 날은 닫을 하루가 없다 — 그 화면은 계획 짜기가 소유한다', () => {
    expect(dayPhase({ todayTotal: 0, pending: 0, freeLeftMin: 0, shortestPendingMin: 0 })).toBe('run');
  });

  it('딱 들어맞으면 아직 진행 중이다(경계)', () => {
    expect(dayPhase({ todayTotal: 2, pending: 1, freeLeftMin: 60, shortestPendingMin: 60 })).toBe('run');
  });
});
