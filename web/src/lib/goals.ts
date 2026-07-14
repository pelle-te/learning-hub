/* ============================================================
   goals.ts — '내 길(goals)' 데이터 레이어 (P9 Phase 6 · D2/D10).
   원천: serve.js GET /api/artifact/goals (손저작 knowledge/_meta/contract/goals.json).
   타입은 부모 스키마에서 생성(artifacts.gen · goalsArtifactSchema) — 손유지 파서 0.
   여기선 페치 + 순수 트리 파생만(설계도 §1-B). 무결성은 부모 goals.py 게이트가 소유.
============================================================ */
import { getArtifact } from './api';
import { checkSchemaVersion } from './artifacts';
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
  checkSchemaVersion('goals', j.data); // P7 Bet 1: 버전 드리프트 경고
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
