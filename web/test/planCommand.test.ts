/* ============================================================
   planCommand.test.ts — T-12 명령줄이 계획을 쓴다.

   ⚠ 여기서 특히 잠그는 것 셋:
   - **모호하면 실패다.** 여러 과목이 걸리면 아무거나 고르지 않는다 — 아무거나 고르면 사용자가
     안 본 사이에 다른 과목의 계획이 바뀌고, 그 편집은 되돌리기 전까지 눈에 안 띈다.
   - **못 알아들었을 때 조용히 실패하지 않는다.** 이 항목의 검증이 "15개로 파서 적중률"이라,
     빗나간 것이 보여야 잴 수 있다.
   - **분↔시간 환산.** `+90분` 은 1.5h 다. 여기가 틀리면 계획이 60배 어긋난다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { PLAN_GRAMMAR, parseDelta, parsePlanCommand } from '@/lib/planCommand';

const items = [
  { id: 's1', name: '회로이론' },
  { id: 's2', name: '선형 대수' },
  { id: 's3', name: '회로설계' },
];

describe('parseDelta', () => {
  it('시간·분을 모두 읽고 시간으로 환산한다', () => {
    expect(parseDelta('+1h')).toBe(1);
    expect(parseDelta('-30m')).toBe(-0.5);
    expect(parseDelta('+90분')).toBe(1.5);
    expect(parseDelta('+1.5시간')).toBe(1.5);
  });
  it('부호·단위가 없거나 0 이면 null', () => {
    expect(parseDelta('1h')).toBeNull();
    expect(parseDelta('+1')).toBeNull();
    expect(parseDelta('+0h')).toBeNull();
    expect(parseDelta('')).toBeNull();
  });
});

describe('parsePlanCommand', () => {
  it('과목 + 증감을 읽는다', () => {
    const r = parsePlanCommand('회로이론 +1h', items);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.cmd).toEqual({ kind: 'bump', sid: 's1', name: '회로이론', deltaH: 1 });
      expect(r.echo).toContain('+1h');
    }
  });
  it('이름에 공백이 있어도 읽는다 — 앞쪽 전부가 이름이다', () => {
    const r = parsePlanCommand('선형 대수 -30m', items);
    expect(r.kind === 'ok' && r.cmd.sid).toBe('s2');
  });
  it('접두가 유일하면 줄여 쓸 수 있다', () => {
    expect(parsePlanCommand('회로이 +1h', items).kind).toBe('ok');
  });
  it('⚠ 모호하면 고르지 않는다 — "회로"는 둘에 걸린다', () => {
    const r = parsePlanCommand('회로 +1h', items);
    expect(r.kind).toBe('unknown-subject');
    if (r.kind === 'unknown-subject') expect(r.typed).toBe('회로');
  });
  it('없는 과목이면 후보를 함께 준다 — 조용히 실패하지 않는다', () => {
    const r = parsePlanCommand('통계학 +1h', items);
    expect(r.kind).toBe('unknown-subject');
    if (r.kind === 'unknown-subject') expect(r.candidates.length).toBeGreaterThan(0);
  });
  it('문법이 아니면 no-match — 그리고 아는 형태가 코드에 있다', () => {
    expect(parsePlanCommand('오늘 뭐하지', items).kind).toBe('no-match');
    expect(parsePlanCommand('회로이론', items).kind).toBe('no-match');
    expect(PLAN_GRAMMAR.length).toBeGreaterThan(0);
  });
});
