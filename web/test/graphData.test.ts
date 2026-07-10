/* ============================================================
   graphData.test.ts — 지식맵 그래프 빌더(buildGraph) 회귀(Vitest).
   순수·결정론: 노드/잎/링크 수, 허브 done/total 집계, 빈 입력, 대형 그래프 캡을 고정.
============================================================ */
import { describe, expect, it, vi } from 'vitest';
import { buildGraph, MAX_NODES, type GraphNode } from '@/features/graph/graphData';
import type { Chapter, Item } from '@/lib/types';

function ch(id: string, done = false, hours = 1): Chapter {
  return { id, name: `ch-${id}`, hours, done };
}
function item(id: string, chapters: Chapter[], color?: string): Item {
  return { id, name: `item-${id}`, mode: 'weekly', color, chapters };
}

describe('buildGraph — 지식맵 노드/링크 구성', () => {
  it('빈 입력 → 빈 그래프', () => {
    const g = buildGraph([]);
    expect(g.nodes).toEqual([]);
    expect(g.links).toEqual([]);
  });

  it('허브 수 = 항목 수, 잎 수 = 챕터 총합, 링크 = 챕터 총합', () => {
    const items = [item('a', [ch('a1'), ch('a2')]), item('b', [ch('b1'), ch('b2'), ch('b3')])];
    const g = buildGraph(items);
    const hubs = g.nodes.filter((n) => n.kind === 'hub');
    const leaves = g.nodes.filter((n) => n.kind === 'leaf');
    expect(hubs).toHaveLength(2);
    expect(leaves).toHaveLength(5);
    expect(g.nodes).toHaveLength(7);
    expect(g.links).toHaveLength(5); // 허브→각 챕터
  });

  it('링크는 허브 id를 source로, 챕터 id를 target으로 연결', () => {
    const g = buildGraph([item('a', [ch('a1')])]);
    expect(g.links[0]).toEqual({ source: 'a', target: 'a1' });
  });

  it('허브 done/total은 실제 챕터 완료 상태를 집계', () => {
    const g = buildGraph([item('a', [ch('a1', true), ch('a2', false), ch('a3', true)])]);
    const hub = g.nodes.find((n) => n.kind === 'hub');
    expect(hub?.done).toBe(2);
    expect(hub?.total).toBe(3);
    expect(hub?.hours).toBe(3); // 1+1+1
  });

  it('잎 색조(tone): 완료=done · 시간>0=learning · 시간0=idle', () => {
    const g = buildGraph([item('a', [ch('a1', true, 2), ch('a2', false, 2), ch('a3', false, 0)])]);
    const tones = g.nodes.filter((n) => n.kind === 'leaf').map((n) => n.tone);
    expect(tones).toEqual(['done', 'learning', 'idle']);
  });

  it('항목 색이 없으면 팔레트 폴백으로 허브 색을 채운다', () => {
    const g = buildGraph([item('a', [], undefined), item('b', [], '#123456')]);
    const [ha, hb] = g.nodes.filter((n) => n.kind === 'hub');
    expect(ha?.color).toBeTruthy();
    expect(hb?.color).toBe('#123456');
  });

  it('초기 좌표는 결정론적 — 같은 입력은 같은 좌표', () => {
    const mk = () => buildGraph([item('a', [ch('a1'), ch('a2')])]);
    const p = (n: GraphNode) => `${n.id}:${n.x}:${n.y}`;
    expect(mk().nodes.map(p)).toEqual(mk().nodes.map(p));
    // Math.random 미사용 → NaN/불안정 없음
    expect(mk().nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });

  it('총 노드 > MAX_NODES면 허브당 잎을 캡하고 오버플로 노드로 표시(조용한 절단 금지)', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    // Barnes–Hut로 캡을 2000으로 올렸으므로(SD-3), 캡 발동을 보려면 그보다 큰 입력이 필요.
    const N = MAX_NODES + 500;
    const many: Chapter[] = Array.from({ length: N }, (_, i) => ch(`c${i}`, i < 10));
    const g = buildGraph([item('big', many)]);
    const leaves = g.nodes.filter((n) => n.kind === 'leaf');
    const overflow = leaves.filter((n) => n.overflow);
    // 캡으로 잎이 입력 전체(N)보다 적게 남는다
    expect(leaves.length).toBeLessThan(N);
    expect(overflow).toHaveLength(1);
    expect(overflow[0]?.label).toMatch(/개 더$/);
    // 허브 집계는 캡과 무관하게 실제 전체(N) 반영
    const hub = g.nodes.find((n) => n.kind === 'hub');
    expect(hub?.total).toBe(N);
    expect(hub?.done).toBe(10);
    // 링크 수 = 표시된 잎 수(오버플로 포함)
    expect(g.links).toHaveLength(leaves.length);
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it('캡이 필요 없는 소형 그래프는 오버플로 노드가 없다', () => {
    const g = buildGraph([item('a', [ch('a1'), ch('a2')])]);
    expect(g.nodes.some((n) => n.overflow)).toBe(false);
    expect(MAX_NODES).toBeGreaterThan(2);
  });
});
