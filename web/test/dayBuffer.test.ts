/* ============================================================
   dayBuffer.test.ts — **하루를 텍스트 한 장으로**(N-15 · W7).

   이 파일이 잠그는 것은 조판이 아니라 **선택**이다: 무엇이 한 장에 들어가고 무엇이 안 들어가나.
   ① 빈 절은 안 적는다("여기 뭔가 있어야 하는데 없다"로 읽힌다)
   ② 일과·수업엔 체크박스가 없다(안 한 것처럼 보이면 하루가 실패로 읽힌다)
   ③ 시각 미정은 **뒤로** 간다(하루는 시간 순으로 읽힌다)
============================================================ */
import { describe, expect, it } from 'vitest';
import { dayBuffer, type BufferBlock } from '@/lib/dayBuffer';

const blk = (o: Partial<BufferBlock>): BufferBlock => ({
  start: null,
  min: 60,
  done: false,
  name: '회로이론',
  ...o,
});

describe('dayBuffer — 한 장에 무엇이 들어가나', () => {
  it('아무것도 없으면 날짜 한 줄이다 — 빈 절을 지어내지 않는다', () => {
    expect(dayBuffer({ ds: '2026-08-07', blocks: [], summaries: [], misses: [] })).toBe('# 2026-08-07');
  });

  it('시각 있는 블록이 먼저, 미정이 뒤 — 하루는 시간 순으로 읽힌다', () => {
    const out = dayBuffer({
      ds: '2026-08-07',
      blocks: [blk({ name: '미정' }), blk({ start: 540, name: '아홉시' }), blk({ start: 300, name: '다섯시' })],
      summaries: [],
      misses: [],
    });
    const order = ['다섯시', '아홉시', '미정'].map((n) => out.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('⭐ 일과·수업엔 체크박스가 없다 — 안 한 것처럼 보이면 하루가 실패로 읽힌다', () => {
    const out = dayBuffer({
      ds: '2026-08-07',
      blocks: [blk({ start: 540, name: '전자기학 수업', routine: true })],
      summaries: [],
      misses: [],
    });
    expect(out).toContain('- 09:00 · 전자기학 수업');
    expect(out).not.toContain('[ ] 09:00');
  });

  it('완료는 체크된 상자다(볼트에 그대로 붙일 수 있는 마크다운)', () => {
    const out = dayBuffer({ ds: '2026-08-07', blocks: [blk({ start: 540, done: true })], summaries: [], misses: [] });
    expect(out).toContain('- [x] 09:00 · 회로이론');
  });

  it('요약·오답은 있을 때만 절을 연다', () => {
    const base = { ds: '2026-08-07', blocks: [], misses: [] };
    expect(dayBuffer({ ...base, summaries: ['맥스웰 방정식은 …'] })).toContain('## 남긴 것');
    expect(dayBuffer({ ...base, summaries: [] })).not.toContain('## 남긴 것');
  });

  it('어제 한 줄과 하루 판정은 맨 위 문맥이다(있을 때만)', () => {
    const out = dayBuffer({
      ds: '2026-08-07',
      blocks: [],
      summaries: [],
      misses: [],
      prevNote: '3장 다시',
      fitLine: '창 3.0h · 남은 계획 2.0h — 여유 1.0h',
    });
    expect(out.indexOf('어제')).toBeLessThan(out.indexOf('창 3.0h'));
  });
});
