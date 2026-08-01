/* ============================================================
   dayPhase.test.ts — 하루의 국면(N-5 · P-15 에서 '여는 중'이 붙었다).

   여기서 잠그는 것은 값이 아니라 **무엇을 근거로 삼지 않는가**다. 국면 판정에 시각 상수가
   끼어드는 순간 밤샘하는 날·오전만 공부하는 날에 화면이 틀린 질문을 크게 던지고, 잘못 맞춘
   국면은 아무것도 안 맞춘 것보다 나쁘다. 함수가 시계를 아예 안 받는다는 사실 자체가 계약이라
   시그니처가 그걸 보장한다 — 아래는 그 위의 판정들이다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { dayPhase, type DayPhaseInput } from '../src/lib/dayPhase';

/** 기본은 **굴리는 중**(하루의 대부분) — 케이스마다 바꾸는 축만 덮어쓴다. */
const at = (o: Partial<DayPhaseInput>): DayPhaseInput => ({
  todayTotal: 4,
  pending: 2,
  freeLeftMin: 180,
  shortestPendingMin: 60,
  underway: true,
  ...o,
});

describe('하루의 국면', () => {
  it('굴릴 것이 남았고 자리도 있으면 진행 중이다', () => {
    expect(dayPhase(at({}))).toBe('run');
  });

  it('전부 체크했으면 닫을 때다 — 창이 남아 있어도', () => {
    expect(dayPhase(at({ pending: 0, freeLeftMin: 300, shortestPendingMin: 0 }))).toBe('closing');
  });

  /* ⚠ 이 케이스가 이 항목의 값이다. 흔한 하루는 "다 한 날"이 아니라 **"못 한 채로 끝나는
     날"**인데, 그날 화면은 계속 "▶ 집중 시작"을 크게 띄우며 있지도 않은 시간을 쓰라고 했다. */
  it('할 일이 남았어도 가장 짧은 것조차 안 들어가면 닫을 때다', () => {
    expect(dayPhase(at({ pending: 3, freeLeftMin: 20 }))).toBe('closing');
  });

  /* ⚠⚠ 회귀 — 첫 판(`freeLeftMin <= 0`)은 이 경우를 'run' 이라 답했다. 일과가 "07:00–24:00
     자유"면 23:40 에도 창이 20분 남아, 판정이 사실상 "자정이 지났는가"가 됐다(우회로로
     되돌아온 시각 상수). 실렌더 확인이 잡은 그 장면을 여기에 고정한다. */
  it('⚠ 창이 양수여도 자리가 안 나면 닫을 때다 — 시각 상수의 우회 재발 방지', () => {
    expect(dayPhase(at({ todayTotal: 1, pending: 1, freeLeftMin: 20, shortestPendingMin: 90 }))).toBe('closing');
  });

  it('빈 날은 닫을 하루가 없다 — 그 화면은 계획 짜기가 소유한다', () => {
    expect(dayPhase(at({ todayTotal: 0, pending: 0, freeLeftMin: 0, shortestPendingMin: 0 }))).toBe('run');
  });

  it('딱 들어맞으면 아직 진행 중이다(경계)', () => {
    expect(dayPhase(at({ todayTotal: 2, pending: 1, freeLeftMin: 60, shortestPendingMin: 60 }))).toBe('run');
  });
});

describe('여는 중(P-15) — 신호는 시계도 체크박스도 아니다', () => {
  it('아무것도 안 했고 진행 중 자리도 아니고 창이 계획을 담으면 여는 중이다', () => {
    expect(dayPhase(at({ todayTotal: 3, pending: 3, freeLeftMin: 300, underway: false }))).toBe('opening');
  });

  it('하나라도 체크했으면 이미 굴러가는 중이다', () => {
    expect(dayPhase(at({ todayTotal: 3, pending: 2, freeLeftMin: 300, underway: false }))).toBe('run');
  });

  it('지금이 어느 블록의 자리 안이면 여는 중이 아니다(시각이 이미 지나갔다)', () => {
    expect(dayPhase(at({ todayTotal: 3, pending: 3, freeLeftMin: 300, underway: true }))).toBe('run');
  });

  /* ⚠⚠ **국면은 용량을 안 본다(2026-08-01 정정).** 첫 판은 `freeLeftMin >= remainMin`
     ("남은 창이 아직 계획을 담는다")을 밤샘 자물쇠로 달았는데, 그 자물쇠는 잠그려던 문을 안
     잠그고(새벽 2시엔 그날 남은 자유시간이 오히려 커서 조건이 참이다) **초과 배정된 평범한
     아침**만 걸렀다 — 실측에서 공유 e2e 시드가 09:00 에 'run' 으로 떨어져 On This Day 회고가
     통째로 사라졌다. "오늘 안에 들어가는가"는 `DayBar` 가 이미 길이로 말하는 별개의 축이다. */
  it('⚠ 초과 배정된 아침도 여는 중이다 — 국면과 용량을 섞지 않는다', () => {
    expect(dayPhase(at({ todayTotal: 3, pending: 3, freeLeftMin: 100, underway: false }))).toBe('opening');
  });

  it('가장 짧은 것조차 안 들어가면 여는 중보다 닫을 때가 이긴다(판정 순서)', () => {
    expect(dayPhase(at({ todayTotal: 3, pending: 3, freeLeftMin: 20, shortestPendingMin: 60, underway: false }))).toBe(
      'closing',
    );
  });
});
