/* ============================================================
   railLayout.test.ts — **사용자가 조립한 레일**의 규칙(N-17 · W5).

   여기서 잠그는 것 셋:
   ① **나브가 통째로 비지 않는다** — 전부 숨기면 설정으로 돌아갈 길이 ⌘K 뿐이고, 그건
      "되돌릴 방법이 화면에 없는 상태"다(H9 가 미니 모드에서 이미 한 번 물린 부류).
   ② **순서는 섹션 안에서만** 움직인다 — 넘나들면 질문 축(N-16)이 아무것도 안 묶는다.
   ③ **새 화면이 사용자 순서를 밀어내지 않는다** — 선호 목록에 없는 탭은 뒤로 간다.

   ⚠ 이 규칙들의 실패는 전부 **조용하다**(화면으로는 "아무 일도 안 일어남"). 그래서 순수
   함수로 뽑아 여기서 잰다 — 스토어를 읽었다면 이 셋 중 어느 것도 못 쟀다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { moveRailTab, railLayout, toggleRailHidden } from '@/shell/railLayout';
import type { NavGroup, TabMeta } from '@/shell/tabs';

const tab = (key: string): TabMeta => ({ key, label: key, order: 0, role: 'lens', icon: 'file' });
const G: NavGroup[] = [
  { key: 'now', label: '지금 뭐부터?', tabs: [tab('find'), tab('today'), tab('review-run')] },
  { key: 'plan', label: '언제 얼마나 할까?', tabs: [tab('schedule'), tab('alloc')] },
];
const keys = (gs: NavGroup[]): string[][] => gs.map((g) => g.tabs.map((t) => t.key));

describe('railLayout — 숨김과 순서', () => {
  it('아무 취향도 없으면 선언 순서 그대로다', () => {
    expect(keys(railLayout(G, { hidden: [], order: [] }))).toEqual([
      ['find', 'today', 'review-run'],
      ['schedule', 'alloc'],
    ]);
  });

  it('숨긴 탭이 빠지고, **빈 섹션은 통째로 사라진다**(답 없는 질문은 노이즈다)', () => {
    const out = railLayout(G, { hidden: ['schedule', 'alloc'], order: [] });
    expect(out.map((g) => g.key)).toEqual(['now']);
  });

  it('선호 순서가 섹션 **안에서** 적용된다', () => {
    expect(keys(railLayout(G, { hidden: [], order: ['review-run', 'find'] }))[0]).toEqual([
      'review-run',
      'find',
      'today',
    ]);
  });

  it('선호 목록에 없는 탭은 **뒤로** 간다 — 새 화면이 사용자 순서 맨 위에 끼어들지 않게', () => {
    const withNew = [{ ...G[0]!, tabs: [...G[0]!.tabs, tab('brand-new')] }];
    expect(keys(railLayout(withNew, { hidden: [], order: ['today', 'find', 'review-run'] }))[0]).toEqual([
      'today',
      'find',
      'review-run',
      'brand-new',
    ]);
  });

  it('알 수 없는 키(삭제된 탭이 저장본에 남은 것)는 조용히 무시된다', () => {
    expect(keys(railLayout(G, { hidden: ['ghost'], order: ['ghost'] }))).toEqual(keys(G));
  });
});

describe('toggleRailHidden — 마지막 하나는 못 숨긴다', () => {
  const all = ['a', 'b', 'c'];

  it('숨기고 되돌린다', () => {
    const off = toggleRailHidden([], 'a', all);
    expect(off).toEqual({ hidden: ['a'], ok: true });
    expect(toggleRailHidden(off.hidden, 'a', all)).toEqual({ hidden: [], ok: true });
  });

  it('⭐ 마지막 하나는 거절하고 **거절했다고 말한다**(조용한 무시 금지)', () => {
    const r = toggleRailHidden(['a', 'b'], 'c', all);
    expect(r.ok).toBe(false);
    expect(r.hidden).toEqual(['a', 'b']); // 상태는 안 바뀐다
  });
});

describe('moveRailTab — 섹션 밖으로는 못 나간다', () => {
  const members = ['x', 'y', 'z'];

  it('한 칸 위로', () => {
    const order = moveRailTab([], members, 'y', -1);
    expect(order.filter((k) => members.includes(k))).toEqual(['y', 'x', 'z']);
  });

  it('맨 끝에서 더 내리면 아무 일도 안 한다(경계에서 조용히 멈춘다)', () => {
    expect(moveRailTab(['p'], members, 'z', 1)).toEqual(['p']);
  });

  it('⭐ 다른 섹션의 상대 순서를 흔들지 않는다', () => {
    const order = moveRailTab(['p', 'q'], members, 'x', 1);
    expect(order.filter((k) => !members.includes(k))).toEqual(['p', 'q']);
  });
});
