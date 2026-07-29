/* ============================================================
   daySignals.test.ts — 조용함의 **정의**(E23 · 2026-07-29).

   `isQuiet` 은 오늘 탭 스트립의 표시 조건을 그대로 옮긴 것이다. 여기서 조건이 갈리면
   "우리가 재는 조용함"과 "사용자가 보는 조용함"이 달라지고, 그 차이는 아무 데도 안 적힌다 —
   그리고 그 상태로 '정적(quiet)의 설계'를 착수하면 **틀린 빈도 위에 설계를 세우게** 된다.
   DB 경로(upsert·보존기간)는 브라우저에서 무동작이라 여기선 판정만 잠근다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { isQuiet, type DaySignal } from '@/lib/daySignals';

const sig = (p: Partial<DaySignal>): DaySignal => ({
  pending: 0,
  overdue: 0,
  backlog: 0,
  ankiDue: -1,
  dueSoon: 0,
  ...p,
});

describe('isQuiet — 스트립이 아무것도 안 그리는 날', () => {
  it('마감·Anki·보충이 전부 없으면 조용하다', () => {
    expect(isQuiet(sig({}))).toBe(true);
  });

  it('임박 마감이 하나라도 있으면 조용하지 않다', () => {
    expect(isQuiet(sig({ dueSoon: 1 }))).toBe(false);
  });

  it('열린 보충이 있으면 조용하지 않다', () => {
    expect(isQuiet(sig({ backlog: 1 }))).toBe(false);
  });

  it('Anki due 가 있으면 조용하지 않다', () => {
    expect(isQuiet(sig({ ankiDue: 3 }))).toBe(false);
  });

  it('⚠ Anki **미연결(-1)** 은 조용함에 기여한다 — 스트립이 그걸 안 그린다', () => {
    // 0(없음)과 -1(모름)을 구분하되, 화면이 둘 다 안 그리므로 판정은 같다.
    expect(isQuiet(sig({ ankiDue: -1 }))).toBe(true);
    expect(isQuiet(sig({ ankiDue: 0 }))).toBe(true);
  });

  it('⚠ 남은 블록·밀린 복습은 **판정에 안 들어간다** — 스트립이 그 둘을 안 그린다', () => {
    // 남은 블록은 흐름 레일이, 밀린 복습은 레일 신호가 소유한다. 재되 판정엔 안 쓴다.
    expect(isQuiet(sig({ pending: 5, overdue: 3 }))).toBe(true);
  });
});
