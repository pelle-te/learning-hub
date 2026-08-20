/* ============================================================
   prereq.test.ts — T-27 선수 관계.

   ⚠ 여기서 특히 잠그는 것 셋:
   - **순환을 조용히 멈추지 않는다**(`cycle: true` 로 말한다). 조용한 실패는 이 저장소가 반복해
     물린 형태다.
   - **챕터 0 개인 선행은 결손이 아니다.** "아직 안 적은 것"을 결손으로 부르면 첫 학기 화면이
     온통 빨갛다.
   - **`deferred` 는 결손이 아니다.** 스케줄러에서 뺐다는 것과 모른다는 것은 다른 사실이다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { addPrereq, dependentsOf, prereqChain, prereqGaps, prereqsOf, removePrereq } from '@/lib/prereq';
import type { Item } from '@/lib/types';

const ch = (id: string, done = false, deferred = false) => ({ id, name: id, hours: 1, done, deferred });
const it_ = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, name: id, mode: 'weekly', chapters: [], ...over }) as Item;
const st = (items: Item[]) => ({ items }) as Pick<AppState, 'items'>;

describe('prereqsOf · dependentsOf', () => {
  it('지워진 과목을 가리키는 링크는 결과에서 빠진다(잔재이지 결손이 아니다)', () => {
    const s = st([it_('a', { prereqIds: ['b', '없음'] }), it_('b')]);
    expect(prereqsOf(s, s.items![0]!).map((i) => i.id)).toEqual(['b']);
  });
  it('역방향은 순회로 답한다 — 저장은 한 방향뿐이다', () => {
    const s = st([it_('a', { prereqIds: ['m'] }), it_('c', { prereqIds: ['m'] }), it_('m')]);
    expect(dependentsOf(s, 'm').map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('prereqChain', () => {
  it('간접 선행까지 편다', () => {
    const s = st([it_('a', { prereqIds: ['b'] }), it_('b', { prereqIds: ['c'] }), it_('c')]);
    expect(prereqChain(s, 'a').order.map((i) => i.id)).toEqual(['b', 'c']);
  });
  it('순환이면 멈추되 cycle=true 로 말한다', () => {
    const s = st([it_('a', { prereqIds: ['b'] }), it_('b', { prereqIds: ['a'] })]);
    const r = prereqChain(s, 'a');
    expect(r.order.map((i) => i.id)).toEqual(['b']);
    expect(r.cycle).toBe(true);
  });
  it('순환이 없으면 cycle=false — 판별력이 있는지 본다', () => {
    const s = st([it_('a', { prereqIds: ['b'] }), it_('b')]);
    expect(prereqChain(s, 'a').cycle).toBe(false);
  });
});

describe('prereqGaps', () => {
  it('안 끝났고 미루지도 않은 챕터만 결손이다', () => {
    const s = st([
      it_('a', { prereqIds: ['b'] }),
      it_('b', { chapters: [ch('c1', true), ch('c2'), ch('c3', false, true)] }),
    ]);
    const g = prereqGaps(s, s.items![0]!);
    expect(g).toHaveLength(1);
    expect(g[0]!.missing.map((c) => c.id)).toEqual(['c2']);
    expect(g[0]!.total).toBe(3);
  });
  it('챕터가 0 개인 선행은 결손이 아니다', () => {
    const s = st([it_('a', { prereqIds: ['b'] }), it_('b')]);
    expect(prereqGaps(s, s.items![0]!)).toEqual([]);
  });
  it('선행을 다 끝냈으면 결손이 없다', () => {
    const s = st([it_('a', { prereqIds: ['b'] }), it_('b', { chapters: [ch('c1', true)] })]);
    expect(prereqGaps(s, s.items![0]!)).toEqual([]);
  });
});

describe('뮤테이터', () => {
  it('자기 자신은 선행이 될 수 없고 중복도 안 쌓인다', () => {
    const a = it_('a');
    addPrereq(a, 'a');
    addPrereq(a, 'b');
    addPrereq(a, 'b');
    expect(a.prereqIds).toEqual(['b']);
  });
  it('마지막 링크를 지우면 필드 자체가 사라진다', () => {
    const a = it_('a', { prereqIds: ['b'] });
    removePrereq(a, 'b');
    expect(a.prereqIds).toBeUndefined();
  });
});
