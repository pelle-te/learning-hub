/* ============================================================
   graphData — 지식맵(Graph) 탭의 순수 데이터 레이어. 로컬 state.items만으로
   힘-방향 그래프의 노드/링크를 구성한다(서버 페치 없음 → 항상 가용).
   구조: 항목 1개 = HUB 노드, 챕터 1개 = LEAF 노드, HUB→각 챕터 = LINK(허브-앤-스포크).
   • 초기 좌표는 결정론적(id 해시로 시드) — Math.random() 금지, 스냅샷/테스트 안정.
   • 대형 그래프 방어: 총 노드 > MAX_NODES면 허브당 잎을 캡하고 "+N개" 오버플로 노드로
     명시(조용한 절단 금지). 허브의 done/total 집계는 캡과 무관하게 실제 챕터 수를 반영.
   렌더/색 해석·힘 시뮬레이션은 Graph.tsx가 담당(이 파일은 UI/캔버스 비의존, 단위테스트 대상).
============================================================ */
import { PALETTE } from '@/lib/utils';
import type { Item } from '@/lib/types';

/** 총 노드 상한(허브+잎). 초과 시 허브당 잎을 캡한다.
 *  힘 시뮬이 Barnes–Hut(Θ(N log N), features/graph/barnesHut.ts)로 바뀌어 옛 O(N²) 병목이
 *  사라졌다 — 이 캡을 400→2000으로 올려 대형 볼트도 그린다(SD-3). 그래도 캔버스 렌더·라벨
 *  가독성 한계가 있어 상한 자체는 유지하고, 초과분은 '+N개 더' 오버플로 노드로 명시한다. */
export const MAX_NODES = 2000;

/** 잎(챕터) 상태 색조 — Graph.tsx가 토큰(--good/--learning/--mut)으로 해석. */
export type LeafTone = 'done' | 'learning' | 'idle';

export interface GraphNode {
  id: string;
  kind: 'hub' | 'leaf';
  label: string;
  /** 소속 항목 id(허브=자기 자신, 잎=부모 허브). 색 그룹핑/포커스에 사용. */
  itemId: string;
  /** 결정론적 초기 좌표(임의 단위 공간 — Graph.tsx가 화면에 자동 맞춤). */
  x: number;
  y: number;
  /** 시뮬레이션 속도(초기 0). */
  vx: number;
  vy: number;
  radius: number;
  /** 허브 색(항목 색 또는 팔레트 폴백, hex). 잎은 tone으로 색을 낸다. */
  color?: string;
  /** 잎 색조(허브는 undefined). */
  tone?: LeafTone;
  /** 허브 집계 — 완료/전체 챕터 수, 총 학습시간(리드아웃·툴팁·반지름). */
  done?: number;
  total?: number;
  hours?: number;
  /** "+N개 더" 오버플로 잎(캡으로 생략된 잎을 대표). */
  overflow?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** FNV-1a 32bit 해시 — id에서 결정론적 시드 산출(Math.random 대체). */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 해시에서 [-SPREAD/2, SPREAD/2] 범위의 결정론적 (x, y). */
function seedPos(id: string): { x: number; y: number } {
  const h = hash32(id);
  const SPREAD = 800;
  const x = ((h & 0xffff) / 0xffff - 0.5) * SPREAD;
  const y = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * SPREAD;
  return { x, y };
}

/** 허브 반지름 — 총 학습시간(없으면 챕터 수)에 따라 완만히 증가. */
function hubRadius(hours: number, chapters: number): number {
  const mag = hours > 0 ? hours : chapters;
  return Math.min(34, 12 + Math.sqrt(mag) * 3.2);
}

/**
 * 로컬 항목 배열 → 지식맵 그래프(노드/링크). 순수·결정론적.
 * 빈 입력 → 빈 그래프. 총 노드가 MAX_NODES를 넘으면 허브당 잎을 캡하고 오버플로 노드로 표시.
 * expandedHubs: 사용자가 '+N개 더'를 눌러 펼친 허브(itemId) — 이 허브는 캡을 풀어 전 챕터를 보인다.
 */
export function buildGraph(items: Item[], expandedHubs?: ReadonlySet<string>): Graph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  if (!items.length) return { nodes, links };

  // 총 잎 수를 미리 세어 캡 여부를 판단(허브 수 = items.length).
  const totalChapters = items.reduce((t, it) => t + (it.chapters?.length || 0), 0);
  const rawTotal = items.length + totalChapters;
  const capping = rawTotal > MAX_NODES;
  // 허브당 잎 상한 — 허브 자신 + 오버플로 노드 자리를 남겨 총합이 MAX_NODES 근처에 머물게.
  const perHubCap = capping ? Math.max(1, Math.floor((MAX_NODES - items.length) / items.length)) : Infinity;
  if (capping) {
    // 조용한 절단이 아니라 명시적 캡 — 오버플로 노드로 사용자에게도 드러난다.
    console.info(`[knowledge-map] 노드 ${rawTotal} > ${MAX_NODES} — 허브당 잎을 ${perHubCap}개로 캡했습니다.`);
  }

  items.forEach((it, i) => {
    const chapters = it.chapters || [];
    const done = chapters.filter((c) => c.done).length;
    const hours = chapters.reduce((t, c) => t + (c.hours || 0), 0);
    const color = it.color || PALETTE[i % PALETTE.length] || '#8a8f9c';
    const pos = seedPos(it.id);
    nodes.push({
      id: it.id,
      kind: 'hub',
      label: it.name,
      itemId: it.id,
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      radius: hubRadius(hours, chapters.length),
      color,
      done, // 집계는 캡과 무관 — 실제 전체 챕터 기준
      total: chapters.length,
      hours,
    });

    // 이 허브를 펼쳤으면 캡 해제 — '+N개 더' 클릭이 숨은 챕터를 실제로 드러낸다(빈 상세 데드엔드 해소).
    const cap = expandedHubs?.has(it.id) ? chapters.length : Number.isFinite(perHubCap) ? perHubCap : chapters.length;
    const shown = chapters.slice(0, cap);
    shown.forEach((c) => {
      const tone: LeafTone = c.done ? 'done' : c.hours > 0 ? 'learning' : 'idle';
      const p = seedPos(c.id);
      nodes.push({
        id: c.id,
        kind: 'leaf',
        label: c.name,
        itemId: it.id,
        x: p.x,
        y: p.y,
        vx: 0,
        vy: 0,
        radius: 5,
        tone,
      });
      links.push({ source: it.id, target: c.id });
    });

    const hidden = chapters.length - shown.length;
    if (hidden > 0) {
      const ovId = `${it.id}::+more`;
      const p = seedPos(ovId);
      nodes.push({
        id: ovId,
        kind: 'leaf',
        label: `+${hidden}개 더`,
        itemId: it.id,
        x: p.x,
        y: p.y,
        vx: 0,
        vy: 0,
        radius: 6,
        tone: 'idle',
        overflow: true,
      });
      links.push({ source: it.id, target: ovId });
    }
  });

  return { nodes, links };
}
