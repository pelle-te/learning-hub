/* ============================================================
   focusState.test.ts — 전역 집중 세션의 순수 로직 회귀(Vitest).
   부팅/영속(벽시계 복원·그레이스)·포커스 선택 규칙을 KV 주입으로 검증(브라우저 없이).
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  bootFocus,
  persistFocus,
  pickFocus,
  focusMinutes,
  FOCUS_KEY,
  FOCUS_GRACE_MS,
  type FocusSession,
  type FocusEntry,
} from '@/lib/focusState';
import { memKV } from '@/lib/kv';

const NOW = 1_750_000_000_000; // 고정 기준 시각(ms)

function sess(over: Partial<FocusSession> = {}): FocusSession {
  return {
    endsAt: NOW + 20 * 60_000,
    total: 25 * 60,
    startedAt: NOW - 5 * 60_000,
    ds: '2026-06-15',
    sid: 'it1',
    type: 'new',
    name: '일반물리',
    blockMin: 90,
    ...over,
  };
}

describe('bootFocus — 부팅/복원', () => {
  it('저장된 게 없으면 null', () => {
    expect(bootFocus(memKV(), NOW)).toBeNull();
  });
  it('진행 중 세션(endsAt 미래)은 그대로 복원한다 — 새로고침 생존', () => {
    const kv = memKV();
    const s = sess();
    persistFocus(kv, s);
    expect(bootFocus(kv, NOW)).toEqual(s);
  });
  it('끝난 지 그레이스 이내면 복원(부팅 직후 완료 알림으로 이어짐)', () => {
    const kv = memKV();
    const s = sess({ endsAt: NOW - FOCUS_GRACE_MS / 2 });
    persistFocus(kv, s);
    expect(bootFocus(kv, NOW)).toEqual(s);
  });
  it('끝난 지 그레이스를 넘긴 세션은 버린다', () => {
    const kv = memKV();
    persistFocus(kv, sess({ endsAt: NOW - FOCUS_GRACE_MS - 1 }));
    expect(bootFocus(kv, NOW)).toBeNull();
  });
  it('손상 JSON·스키마 불일치(엉뚱한 type)는 null 폴백(throw 없음)', () => {
    const kv = memKV();
    kv.setItem(FOCUS_KEY, '{not json');
    expect(bootFocus(kv, NOW)).toBeNull();
    kv.setItem(FOCUS_KEY, JSON.stringify(sess({ type: 'hack' as never })));
    expect(bootFocus(kv, NOW)).toBeNull();
  });
  it('persistFocus(null)은 저장 키를 제거한다', () => {
    const kv = memKV();
    persistFocus(kv, sess());
    persistFocus(kv, null);
    expect(kv.getItem(FOCUS_KEY)).toBeNull();
  });
});

describe('pickFocus — 지금 할 일 선택 규칙', () => {
  const entry = (over: Partial<FocusEntry> & { sid: string }): FocusEntry => ({
    it: { type: 'new', sid: over.sid, name: over.sid, min: 60 },
    start: null,
    end: null,
    done: false,
    ...over,
  });

  it('현재 시간대 블록이 있으면 current=focus', () => {
    const a = entry({ sid: 'a', start: 540, end: 600 }); // 09:00–10:00
    const b = entry({ sid: 'b', start: 600, end: 660 });
    const p = pickFocus([a, b], 550);
    expect(p.current).toBe(a);
    expect(p.focus).toBe(a);
  });
  it('현재 블록이 없으면 다음 예정 블록', () => {
    const a = entry({ sid: 'a', start: 540, end: 600, done: true });
    const b = entry({ sid: 'b', start: 700, end: 760 });
    const p = pickFocus([a, b], 620);
    expect(p.current).toBeNull();
    expect(p.focus).toBe(b);
  });
  it('남은 예정이 없으면 가장 이른 미완료(밀린 블록)', () => {
    const a = entry({ sid: 'a', start: 540, end: 600 });
    const b = entry({ sid: 'b', start: 480, end: 520 });
    const p = pickFocus([a, b], 1200);
    expect(p.focus).toBe(b);
  });
  it('전부 완료면 focus=null', () => {
    const a = entry({ sid: 'a', start: 540, end: 600, done: true });
    expect(pickFocus([a], 550).focus).toBeNull();
  });
  it('완료된 블록은 현재 시간대여도 건너뛴다', () => {
    const a = entry({ sid: 'a', start: 540, end: 600, done: true });
    const b = entry({ sid: 'b', start: 610, end: 660 });
    expect(pickFocus([a, b], 550).focus).toBe(b);
  });
});

describe('focusMinutes — 세션 길이', () => {
  const e = (min: number): FocusEntry => ({
    it: { type: 'new', sid: 'x', name: 'x', min },
    start: null,
    end: null,
    done: false,
  });
  it('블록 분량을 따르되 50분 상한', () => {
    expect(focusMinutes(e(30))).toBe(30);
    expect(focusMinutes(e(120))).toBe(50);
  });
  it('분량이 없으면 25분(포모도로), 대상이 없어도 25분', () => {
    expect(focusMinutes(e(0))).toBe(25);
    expect(focusMinutes(null)).toBe(25);
  });
});
