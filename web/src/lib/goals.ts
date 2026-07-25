/* ============================================================
   goals.ts — '내 길(goals)' 데이터 레이어 (P9 Phase 6 · D2/D10).
   원천: 산출물 `goals`(셸이 워크스페이스에서 읽는다) (손저작 knowledge/_meta/contract/goals.json).
   타입은 부모 스키마에서 생성(artifacts.gen · goalsArtifactSchema) — 손유지 파서 0.
   여기선 페치 + 순수 트리 파생만(설계도 §1-B). 무결성은 부모 goals.py 게이트가 소유.
============================================================ */
import { getArtifact } from './api';
import { parseArtifact } from './artifacts';
import type { GoalsArtifact } from './artifacts.gen';
import type { Knowledge, KnowledgeConcept } from './knowledge';

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

/** 프로젝트 '필요지식' 한 칸 — 이름 + (찾았다면) 지식엔진이 아는 그 개념(ID-8). */
export interface NeedKnowledgeRow {
  /** 프로젝트가 적은 이름 그대로. 조인이 실패해도 이 이름은 **항상** 보인다. */
  name: string;
  /** basename 정확 매칭으로 찾은 개념. 못 찾으면 undefined = 링크 없는 그냥 칩. */
  concept?: KnowledgeConcept;
  /** 그 개념이 약점인가. 조인 실패면 false — 모르는 것을 약점이라 부르지 않는다. */
  weak: boolean;
}

/**
 * 프로젝트의 `필요지식` 이름들을 지식엔진 개념에 붙여 **약점 여부**를 함께 돌려준다(ID-8).
 *
 * 왜 필요한가: capability 상향(축적 → "이제 가능")은 배선돼 있는데 **역방향이 죽어 있었다** —
 * "이 프로젝트를 열려면 이 지식이 약하다"를 화면이 말하지 않아, 필요지식 칩이 정적 텍스트였다.
 *
 * ⚠ **조인은 `basename` 정확 일치만이다.** fuzzy(부분일치·정규화)로 넓히면 엉뚱한 개념이 붙어
 *   "약점"이라 잘못 말하고, 그 거짓이 사용자의 학습 순서를 바꾼다 — 조용한 오류라 더 나쁘다.
 *   같은 이유로 SR-19(Anki 이름 조인)가 드롭됐다. 못 찾으면 **링크를 안 붙이는 것이 정답**이다.
 * ⚠ basename 이 겹치면 먼저 나온 개념이 이긴다(결정론). 지식엔진이 basename 을 노트 파일명으로
 *   쓰므로 실전 중복은 없지만, 순서에 의존하지 않는다는 사실을 여기 적어 둔다.
 */
export function needKnowledgeRows(names: string[], k: Knowledge | null | undefined): NeedKnowledgeRow[] {
  const byBasename = new Map<string, KnowledgeConcept>();
  for (const s of k?.subjects ?? []) {
    for (const c of s.concepts ?? []) {
      const b = c.basename;
      if (b && !byBasename.has(b)) byBasename.set(b, c);
    }
  }
  return names.map((name) => {
    const concept = byBasename.get(name);
    return { name, concept, weak: !!concept?.weak };
  });
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
