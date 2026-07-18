/* ============================================================
   goals.ts — '내 길(goals)' 데이터 레이어 (P9 Phase 6 · D2/D10).
   원천: serve.js GET /api/artifact/goals (손저작 knowledge/_meta/contract/goals.json).
   타입은 부모 스키마에서 생성(artifacts.gen · goalsArtifactSchema) — 손유지 파서 0.
   여기선 페치 + 순수 트리 파생만(설계도 §1-B). 무결성은 부모 goals.py 게이트가 소유.
============================================================ */
import { getArtifact } from './api';
import { parseArtifact } from './artifacts';
import type { GoalsArtifact } from './artifacts.gen';

export type { GoalsArtifact };
/** 목표/프로젝트 노드 1개 — 생성 스키마에서 파생(손유지 아님). */
export type GoalNode = GoalsArtifact['nodes'][number];
/** 노드 종류 — goal(커리어 길) | project(분야 실습·산출물 · D10). */
export type GoalKind = GoalNode['kind'];

/** 트리 노드 — 원 노드 + 자식(재귀) + depth. 렌더가 소비(내 길 지도). */
export interface GoalTreeNode extends GoalNode {
  children: GoalTreeNode[];
  depth: number;
}

export async function fetchGoalsArtifact(): Promise<GoalsArtifact> {
  const j = await getArtifact<GoalsArtifact>('goals');
  if (!j || !j.ok || !j.data) throw new Error("'내 길(goals)' 계약을 찾지 못했어요.");
  parseArtifact('goals', j.data); // 버전 + 모양 드리프트 경고(비차단)
  return j.data;
}

/** nodes(평면 · parent 링크)를 루트 트리로 조립 — parent DAG 는 부모 goals.py 가 보장(사이클 없음).
    부모 미상/자기참조는 방어적으로 루트 취급(게이트가 이미 걸러 실전엔 없음). 입력 순서 보존(결정론). */
export function buildGoalTree(g: GoalsArtifact | null | undefined): GoalTreeNode[] {
  const nodes = g?.nodes ?? [];
  const byId = new Map<string, GoalTreeNode>();
  for (const n of nodes) byId.set(n.id, { ...n, children: [], depth: 0 });
  const roots: GoalTreeNode[] = [];
  for (const n of nodes) {
    const tn = byId.get(n.id)!;
    const parent = n.parent && n.parent !== n.id ? byId.get(n.parent) : undefined;
    if (parent) parent.children.push(tn);
    else roots.push(tn);
  }
  // depth 부여(BFS · 렌더 들여쓰기용).
  const walk = (list: GoalTreeNode[], depth: number) => {
    for (const t of list) {
      t.depth = depth;
      walk(t.children, depth + 1);
    }
  };
  walk(roots, 0);
  return roots;
}

/** 활성 goal(kind=goal·active) 리스트 — 배분 그래디언트 앵커. weight 내림차순(동률=입력순). */
export function activeGoals(g: GoalsArtifact | null | undefined): GoalNode[] {
  return (g?.nodes ?? [])
    .filter((n) => n.kind === 'goal' && n.active)
    .slice()
    .sort((a, b) => b.weight - a.weight);
}

/** 프로젝트 노드(kind=project) — capability inbox·관계성 앵커(D10). 현재 볼트엔 0(과설계 금지). */
export function projectNodes(g: GoalsArtifact | null | undefined): GoalNode[] {
  return (g?.nodes ?? []).filter((n) => n.kind === 'project');
}

/** 프로젝트 뷰(D10) — 원 노드 + 표시 파생(분야·산출물=done·필요지식 칩·capability임계)
    + 앵커 목표(parent · 상향: 축적→"가능해짐" / 하향: 프로젝트→필요지식 분해 = 양방향). */
export interface ProjectView {
  node: GoalNode;
  분야?: string;
  /** done 정의 — 이 프로젝트가 '완료'라 부를 산출물. */
  산출물?: string;
  /** 필요지식 개념들(하향 분해 — 관계성이 학습을 견인). */
  필요지식: string[];
  /** capability-unlock 임계(축적 숙달이 이 값 도달 시 "이제 가능"). */
  capability임계?: number;
  /** 앵커 목표 노드(상향 — 이 목표의 축적이 프로젝트를 가능케 함). 미상이면 undefined. */
  anchor?: GoalNode;
}

/** 프로젝트 노드들을 뷰로(앵커 목표 해소 포함) — 내 길 지도의 프로젝트 섹션이 소비. 콜드면 빈 배열. */
export function projectViews(g: GoalsArtifact | null | undefined): ProjectView[] {
  const nodes = g?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return projectNodes(g).map((n) => ({
    node: n,
    분야: n.분야,
    산출물: n.산출물,
    필요지식: n.필요지식 ?? [],
    capability임계: n.capability임계,
    anchor: n.parent && n.parent !== n.id ? byId.get(n.parent) : undefined,
  }));
}

/** 형제 노드를 weight 내림차순으로(동률=원 순서 안정정렬) — 내 길 지도 표시순(배분 그래디언트 상대값). */
export function byWeightDesc(children: GoalTreeNode[]): GoalTreeNode[] {
  return children
    .map((c, i) => [c, i] as const)
    .sort((a, b) => b[0].weight - a[0].weight || a[1] - b[1])
    .map(([c]) => c);
}

/** degree_req(학위요건 노드 흡수 · 단위=학점)를 표시용 항목 배열로. 없으면 null. degree.ts DEGREE_REQ 동형. */
export function degreeReqRows(node: GoalNode): { label: string; credits: number }[] | null {
  const d = node.degree_req;
  if (!d || typeof d !== 'object') return null;
  const rows: { label: string; credits: number }[] = [];
  if (typeof d.targetTotal === 'number') rows.push({ label: '졸업 총', credits: d.targetTotal });
  if (typeof d.reqMajorReq === 'number') rows.push({ label: '전공필수', credits: d.reqMajorReq });
  if (typeof d.reqMajorSel === 'number') rows.push({ label: '전공선택', credits: d.reqMajorSel });
  if (typeof d.reqLiberal === 'number') rows.push({ label: '교양', credits: d.reqLiberal });
  return rows.length ? rows : null;
}
