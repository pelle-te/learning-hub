/* ============================================================
   goals.test.ts — '내 길(goals)' 소비 순수 헬퍼 회귀(Vitest · P9 Phase 6).
   손저작 goals.json(부모 goals.py 게이트가 무결성 소유)을 hub 가 트리로 조립·필터하는
   순수 변환을 못박는다. IO(fetch)는 대상 아님(경계는 artifactsGen.test 가 zod 로 커버).
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  buildGoalTree,
  activeGoals,
  projectNodes,
  projectViews,
  byWeightDesc,
  degreeReqRows,
  type GoalsArtifact,
  type GoalNode,
} from '@/lib/goals';

const g = (id: string, parent: string | null, weight = 1, extra: Partial<GoalNode> = {}): GoalNode => ({
  id,
  kind: 'goal',
  title: id,
  weight,
  active: true,
  parent,
  ...extra,
});

const artifact = (nodes: GoalNode[]): GoalsArtifact => ({ _schemaVersion: 1, nodes });

describe('goals — buildGoalTree', () => {
  it('평면 nodes(parent 링크)를 루트 트리로 조립 + depth 부여', () => {
    const a = artifact([g('root', null), g('child-a', 'root'), g('grand', 'child-a'), g('child-b', 'root')]);
    const roots = buildGoalTree(a);
    expect(roots.map((r) => r.id)).toEqual(['root']);
    expect(roots[0].depth).toBe(0);
    expect(roots[0].children.map((c) => c.id)).toEqual(['child-a', 'child-b']);
    const childA = roots[0].children[0];
    expect(childA.depth).toBe(1);
    expect(childA.children[0].id).toBe('grand');
    expect(childA.children[0].depth).toBe(2);
  });
  it('입력 순서 보존(결정론) — 형제는 nodes 순서대로', () => {
    const a = artifact([g('root', null), g('z', 'root'), g('a', 'root')]);
    expect(buildGoalTree(a)[0].children.map((c) => c.id)).toEqual(['z', 'a']);
  });
  it('부모 미상/자기참조는 방어적으로 루트 취급(게이트가 이미 걸러 실전엔 없음)', () => {
    const a = artifact([g('orphan', 'ghost'), g('selfref', 'selfref')]);
    expect(
      buildGoalTree(a)
        .map((r) => r.id)
        .sort(),
    ).toEqual(['orphan', 'selfref']);
  });
  it('빈/undefined 입력 → 빈 배열(콜드·부재 graceful)', () => {
    expect(buildGoalTree(null)).toEqual([]);
    expect(buildGoalTree(undefined)).toEqual([]);
    expect(buildGoalTree(artifact([]))).toEqual([]);
  });
});

describe('goals — activeGoals', () => {
  it('kind=goal·active 만, weight 내림차순', () => {
    const a = artifact([
      g('r', null, 1.0),
      g('low', 'r', 0.5),
      g('high', 'r', 0.9),
      g('off', 'r', 0.8, { active: false }),
      {
        id: 'proj',
        kind: 'project',
        title: 'p',
        weight: 1,
        active: true,
        parent: 'r',
        분야: 'x',
        산출물: 'y',
        필요지식: [],
        capability임계: 0.7,
      },
    ]);
    expect(activeGoals(a).map((n) => n.id)).toEqual(['r', 'high', 'low']);
  });
  it('빈 입력 → 빈 배열', () => {
    expect(activeGoals(undefined)).toEqual([]);
  });
});

describe('goals — projectNodes', () => {
  it('kind=project 만(D10 앵커) · 현재 볼트엔 0', () => {
    const a = artifact([g('r', null)]);
    expect(projectNodes(a)).toEqual([]);
    const withProj = artifact([
      g('r', null),
      {
        id: 'proj',
        kind: 'project',
        title: 'p',
        weight: 1,
        active: true,
        parent: 'r',
        분야: 'x',
        산출물: 'y',
        필요지식: ['k'],
        capability임계: 0.7,
      },
    ]);
    expect(projectNodes(withProj).map((n) => n.id)).toEqual(['proj']);
  });
});

describe('goals — projectViews (D10 · Wave⑤)', () => {
  const proj = (extra: Partial<GoalNode> = {}): GoalNode => ({
    id: 'sdr-rx',
    kind: 'project',
    title: 'SDR 수신기',
    weight: 1,
    active: true,
    parent: 'communication-theory',
    분야: '통신이론',
    산출물: '동작하는 FM 수신기',
    필요지식: ['샘플링', '복조'],
    capability임계: 0.7,
    ...extra,
  });
  it('표시 파생(분야·산출물·필요지식·capability임계) + 앵커 목표 해소(parent)', () => {
    const a = artifact([g('communication-theory', null), proj()]);
    const v = projectViews(a);
    expect(v).toHaveLength(1);
    expect(v[0].분야).toBe('통신이론');
    expect(v[0].산출물).toBe('동작하는 FM 수신기');
    expect(v[0].필요지식).toEqual(['샘플링', '복조']);
    expect(v[0].capability임계).toBe(0.7);
    expect(v[0].anchor?.id).toBe('communication-theory'); // 상향 앵커
  });
  it('앵커 미상/자기참조·필요지식 부재는 graceful(undefined·빈배열)', () => {
    const a = artifact([proj({ parent: 'ghost', 필요지식: undefined })]);
    const v = projectViews(a);
    expect(v[0].anchor).toBeUndefined();
    expect(v[0].필요지식).toEqual([]);
  });
  it('프로젝트 없으면 빈 배열(콜드 · 과설계 금지)', () => {
    expect(projectViews(artifact([g('r', null)]))).toEqual([]);
    expect(projectViews(null)).toEqual([]);
  });
});

describe('goals — byWeightDesc', () => {
  it('weight 내림차순 · 동률=원 순서 안정정렬', () => {
    const roots = buildGoalTree(artifact([g('r', null), g('a', 'r', 0.5), g('b', 'r', 0.9), g('c', 'r', 0.5)]));
    // 원 순서: a(0.5) b(0.9) c(0.5) → 정렬: b(0.9) a(0.5) c(0.5 · 동률 원순서)
    expect(byWeightDesc(roots[0].children).map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('goals — degreeReqRows', () => {
  it('degree_req 있으면 학점 항목 배열(총·전공필수·전공선택·교양)', () => {
    const node = g('deg', 'r', 0.5, {
      degree_req: { targetTotal: 128, reqMajorReq: 41, reqMajorSel: 27, reqLiberal: 51 },
    });
    expect(degreeReqRows(node)).toEqual([
      { label: '졸업 총', credits: 128 },
      { label: '전공필수', credits: 41 },
      { label: '전공선택', credits: 27 },
      { label: '교양', credits: 51 },
    ]);
  });
  it('degree_req 없으면 null(대부분 노드)', () => {
    expect(degreeReqRows(g('x', 'r'))).toBeNull();
  });
});
