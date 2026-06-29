/* ============================================================
   ics.test.ts — 캘린더(.ics) 빌드 + 계획 서명 회귀(Vitest).
   buildICS는 DTSTAMP/UID에 현재시각·난수가 섞여 완전 결정적이진 않으므로 *구조*를 검증하고,
   planSignature는 순수·결정적이라 동치성/민감도를 정밀 검증한다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { buildICS, planSignature } from '@/lib/ics';
import type { AppState } from '@/lib/types';

let _id = 0;
const nid = () => 'id' + ++_id;
function weeklyItem(name: string, weeklyHours: number, chapters: [string, number][] = []) {
  return {
    id: nid(),
    name,
    mode: 'weekly',
    weeklyHours,
    chapters: chapters.map(([cn, h]) => ({ id: nid(), name: cn, hours: h, done: false })),
  };
}
function baseState(items: unknown[], over?: Record<string, unknown>): AppState {
  return {
    startDate: '2026-06-23',
    moduleLen: 120,
    reviewRatio: 20,
    routine: [], // 빈 일과 = 하루 종일 가용 → 결정적으로 학습 세션이 생긴다
    dayOverrides: {},
    items: items || [],
    ...(over || {}),
  } as unknown as AppState;
}

describe('buildICS — VCALENDAR 구조', () => {
  const ics = buildICS(baseState([weeklyItem('수학', 5, [['1장', 4]])]));

  it('VCALENDAR로 감싸고 CRLF로 줄을 잇는다', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//러닝허브//KR');
  });

  it('학습 세션마다 VEVENT(시작/종료/요약)를 만든다', () => {
    const begins = ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT').length;
    const ends = ics.split('\r\n').filter((l) => l === 'END:VEVENT').length;
    expect(begins).toBeGreaterThan(0);
    expect(begins).toBe(ends); // 짝이 맞는다
    expect(ics).toContain('DTSTART:');
    expect(ics).toContain('DTEND:');
    expect(ics).toMatch(/SUMMARY:.*수학/);
  });

  it('DTSTART는 플로팅 로컬타임 YYYYMMDDTHHMMSS 형식', () => {
    const m = ics.match(/DTSTART:(\d{8}T\d{6})/);
    expect(m).not.toBeNull();
  });

  it('학습할 항목이 없으면 이벤트 없이 빈 달력만 만든다', () => {
    const empty = buildICS(baseState([]));
    expect(empty).toContain('BEGIN:VCALENDAR');
    expect(empty).not.toContain('BEGIN:VEVENT');
  });

  it('요약/설명의 특수문자(; ,)를 ICS 규약대로 이스케이프한다', () => {
    const out = buildICS(baseState([weeklyItem('수학; 미적분, 적분', 5, [['1장', 4]])]));
    expect(out).toContain('\\;');
    expect(out).toContain('\\,');
  });
});

describe('planSignature — 계획 지문(.ics 신선도 판정)', () => {
  it('같은 상태는 같은 서명(결정적)', () => {
    const s = baseState([weeklyItem('수학', 5, [['1장', 4]])]);
    expect(planSignature(s)).toBe(planSignature(s));
  });

  it('계획에 영향을 주는 입력이 바뀌면 서명도 바뀐다', () => {
    const a = planSignature(baseState([weeklyItem('수학', 5)], { moduleLen: 120 }));
    const b = planSignature(baseState([weeklyItem('수학', 5)], { moduleLen: 90 }));
    expect(a).not.toBe(b);
  });

  it('항목 내용(이름/시간)이 바뀌면 서명도 바뀐다', () => {
    _id = 0;
    const a = planSignature(baseState([weeklyItem('수학', 5)]));
    _id = 0;
    const b = planSignature(baseState([weeklyItem('수학', 8)]));
    expect(a).not.toBe(b);
  });

  it('정상 입력은 파싱 가능한 JSON 문자열', () => {
    const sig = planSignature(baseState([weeklyItem('수학', 5)]));
    expect(() => JSON.parse(sig)).not.toThrow();
  });

  it('손상/비정상 입력(null)은 throw 없이 빈 문자열로 폴백', () => {
    expect(planSignature(null as unknown as AppState)).toBe('');
  });
});
