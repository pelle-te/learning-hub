/* ============================================================
   lastLens.test.ts — 레일이 마지막 렌즈로 착지한다(E27 · 2026-07-29).

   `hostTabKey()` 가 그룹의 첫 항목을 호스트로 삼아, 레일의 '계획'은 5렌즈 중 언제나
   `schedule` 에 착지했다 — 배분 보드를 보려면 매번 2클릭이었다.

   ⚠ 이 기능은 **근육기억을 건드린다**(같은 버튼이 다른 화면을 연다). 그래서 세션 한정이고,
   여기서 잠그는 것은 그 경계다: 조망으로 돌아오면 기억이 지워지는가 · IA 가 바뀌면 엉뚱한
   곳으로 안 보내는가.
============================================================ */
import { beforeEach, describe, expect, it } from 'vitest';
import { noteLens, railTarget, resetLastLens } from '@/shell/lastLens';

beforeEach(resetLastLens);

describe('railTarget — 레일 클릭의 착지', () => {
  it('기억이 없으면 호스트 자신(= 종전 동작)', () => {
    expect(railTarget('schedule')).toBe('schedule');
  });

  it('렌즈를 보고 있었으면 다음 레일 클릭이 거기로 간다', () => {
    noteLens('alloc');
    expect(railTarget('schedule')).toBe('alloc');
  });

  it('조망(호스트)으로 돌아오면 기억이 **지워진다** — 그 의도를 다음 클릭이 존중한다', () => {
    noteLens('alloc');
    noteLens('schedule');
    expect(railTarget('schedule')).toBe('schedule');
  });

  it('호스트마다 따로 기억한다', () => {
    noteLens('alloc'); // 계획 호스트
    noteLens('mastery'); // 앎 호스트
    expect(railTarget('schedule')).toBe('alloc');
    expect(railTarget('stats')).toBe('mastery');
  });

  it('⚠ 기억이 그 호스트 그룹 밖이면 무시한다 — IA 재편으로 렌즈가 옮겨갈 수 있다', () => {
    noteLens('alloc');
    // 계획의 기억으로 통계 호스트를 열려 하면 안 된다.
    expect(railTarget('stats')).toBe('stats');
  });

  it('세션 격리 — 초기화하면 종전 동작으로 돌아온다(영속하지 않는다는 계약의 관측 가능한 형태)', () => {
    noteLens('alloc');
    resetLastLens();
    expect(railTarget('schedule')).toBe('schedule');
  });
});
