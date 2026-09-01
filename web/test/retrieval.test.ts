/* ============================================================
   retrieval.test.ts — 회상 카드 선택(순수) 회귀.
============================================================ */
import { describe, expect, it } from 'vitest';
import { pickRetrieval, retrievableCount } from '@/lib/retrieval';
import type { Summary } from '@/lib/types';
import type { AppState } from '@/lib/schema';

let _n = 0;
const sum = (name: string): Summary => ({ id: 's' + ++_n, sid: 'a', name, s1: '핵심', s2: '도구', s3: '의미' });
const st = (summaries: Record<string, Summary[]>): AppState => ({ items: [], summaries }) as unknown as AppState;

const TODAY = '2026-07-04';

describe('retrieval — pickRetrieval', () => {
  it('minAge 이상 지난 요약만 후보(같은 날/최신은 제외)', () => {
    const s = st({
      '2026-07-01': [sum('수학')], // age 3
      '2026-07-03': [sum('물리')], // age 1
      '2026-07-04': [sum('화학')], // age 0
    });
    const card = pickRetrieval(s, TODAY, 2);
    expect(card).not.toBeNull();
    expect(card!.summary.name).toBe('수학');
    expect(card!.ageDays).toBe(3);
    expect(card!.ds).toBe('2026-07-01');
  });

  it('같은 날엔 결정적(같은 카드) — 날짜 해시 회전', () => {
    const s = st({ '2026-06-20': [sum('a'), sum('b')], '2026-06-25': [sum('c')] });
    const a = pickRetrieval(s, TODAY, 2);
    const b = pickRetrieval(s, TODAY, 2);
    expect(a!.summary.id).toBe(b!.summary.id);
  });

  it('전부 너무 최신이면 1일↑로 완화(첫 며칠 공백 방지)', () => {
    const s = st({ '2026-07-03': [sum('어제것')] }); // age 1
    const card = pickRetrieval(s, TODAY, 2); // minAge 2지만 완화
    expect(card).not.toBeNull();
    expect(card!.summary.name).toBe('어제것');
    expect(card!.ageDays).toBe(1);
  });

  it('요약이 없으면 null', () => {
    expect(pickRetrieval(st({}), TODAY, 2)).toBeNull();
    expect(pickRetrieval({ items: [] } as unknown as AppState, TODAY)).toBeNull();
  });

  it('손상된 날짜 키는 무음 통과 없이 제외(NaN 가드 회귀)', () => {
    // 'not-a-date' → dayDiff NaN. 가드 없으면 NaN<minAge=false로 필터를 통과해 ageDays=NaN 카드가 샜다.
    const s = st({ 'not-a-date': [sum('손상')], '2026-07-01': [sum('정상')] });
    const card = pickRetrieval(s, TODAY, 2);
    expect(card!.summary.name).toBe('정상'); // 손상 키는 후보에서 빠짐
    expect(Number.isFinite(card!.ageDays)).toBe(true);
    // 손상 키만 있으면 후보 0 → null(무음 NaN 카드 아님)
    expect(pickRetrieval(st({ 'not-a-date': [sum('x')] }), TODAY, 2)).toBeNull();
  });

  it('날이 바뀌면 회전(cross-day) — 여러 날에 걸쳐 1장 이상 순환', () => {
    const s = st({ '2026-06-20': [sum('a')], '2026-06-21': [sum('b')], '2026-06-22': [sum('c')] });
    const picks = new Set<string>();
    for (let d = 10; d < 25; d++) {
      picks.add(pickRetrieval(s, `2026-07-${String(d).padStart(2, '0')}`, 2)!.summary.name);
    }
    expect(picks.size).toBeGreaterThan(1); // 하루 단위로 다른 카드(고정 아님)
  });
});

describe('retrieval — retrievableCount', () => {
  it('1일 이상 지난 요약 수', () => {
    const s = st({ '2026-07-01': [sum('a')], '2026-07-03': [sum('b')], '2026-07-04': [sum('c')] });
    expect(retrievableCount(s, TODAY, 1)).toBe(2); // 07-04(오늘)만 제외
    expect(retrievableCount(s, TODAY, 2)).toBe(1); // 07-01만
  });
});
