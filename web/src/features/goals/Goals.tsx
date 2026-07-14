/* ============================================================
   Goals(내 길) — 탭: 🧭 내 길 지도(P9 Phase 6 · 축 A · D2/D10).
   손저작 goals.json(전파통신 연구원 자립 트리)을 렌더 — 루트 성취목표 히어로 + 하위목표 카드
   (상대 중요도 weight 바 · 학위요건 흡수 degree_req 롤업 · kind 배지). 노트→목표 연관은
   하이브리드(핵심만 goals: 명시링크·나머지 개념그래프 거리 Phase 4)라 콜드면 정직하게 안내.
   레이어: store(queries·usePageChrome)·lib(goals)만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import { useMemo } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useGoals } from '@/store/queries';
import { buildGoalTree, byWeightDesc, degreeReqRows, activeGoals, projectNodes, type GoalTreeNode } from '@/lib/goals';
import EmptyState from '@/components/EmptyState';
import s from './Goals.module.css';

export default function Goals() {
  const goals = useGoals();
  const data = goals.data;

  const roots = useMemo(() => buildGoalTree(data), [data]);
  const active = useMemo(() => activeGoals(data), [data]);
  const projects = useMemo(() => projectNodes(data), [data]);

  // 상단 리드아웃 — 목표 수·활성·프로젝트·명시 링크(하이브리드 콜드 정직).
  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '목표 노드', value: data?.nodes.length ?? 0 },
        { label: '활성', value: active.length },
        { label: '프로젝트', value: projects.length },
      ],
    }),
    [data?.nodes.length, active.length, projects.length],
  );

  if (goals.isLoading) {
    return (
      <section className={s.root}>
        <p className={s.muted}>내 길을 불러오는 중…</p>
      </section>
    );
  }

  // serve.js 꺼짐/계약 부재 → 빈 상태(goals.json 은 손저작이라 실전에선 항상 실재 · 서버 없을 때만).
  if (goals.isError || !data || roots.length === 0) {
    return (
      <section className={s.root}>
        <EmptyState
          glyph="🧭"
          title="내 길이 아직 안 보여요"
          desc={
            <>
              손저작 계약 <code>knowledge/_meta/contract/goals.json</code> 을 serve.js 가 서빙합니다. 제어판이 켜지면
              목표 트리가 여기 그려집니다.
            </>
          }
        />
      </section>
    );
  }

  return (
    <section className={s.root}>
      {roots.map((root) => (
        <GoalBranch key={root.id} node={root} maxWeight={maxChildWeight(root)} isRoot />
      ))}

      {/* 노트→목표 연관 — 하이브리드 모델 안내(핵심만 명시링크·나머지 개념그래프 거리 Phase 4). */}
      <div className={s.relNote}>
        <span className={s.relDot} />
        <div>
          <b>노트→목표 연관 = 하이브리드.</b> 핵심 노트만 <code>goals:</code> 로 직접 잇고, 나머지는 개념그래프 거리로
          계산합니다(연관성 엔진). 명시 링크·라이브 숙련 신호가 쌓이면 시퀀싱이 목표 근접도로 재정렬됩니다(숙달도 지도 ·
          Phase 4).
        </div>
      </div>
    </section>
  );
}

/** 최대 자식 weight(바 스케일 기준). 자식 없으면 1(0 나눗셈 방어). */
function maxChildWeight(node: GoalTreeNode): number {
  return node.children.reduce((m, c) => Math.max(m, c.weight), 0) || 1;
}

/** 목표 가지 — 루트는 히어로, 자식은 카드 그리드로. 재귀(프로젝트 중첩 대비 · 현재 2단). */
function GoalBranch({ node, maxWeight, isRoot }: { node: GoalTreeNode; maxWeight: number; isRoot?: boolean }) {
  const children = byWeightDesc(node.children);
  if (isRoot) {
    return (
      <>
        <header className={s.hero}>
          <div className={s.heroKicker}>내 길 · 성취목표</div>
          <h1 className={s.heroTitle}>{node.title}</h1>
          <p className={s.heroDesc}>이 단일 목표를 하위목표로 분해해 학습 노력의 연관성 그래디언트를 만듭니다.</p>
        </header>
        {children.length > 0 && (
          <div className={s.grid}>
            {children.map((c) => (
              <GoalCard key={c.id} node={c} maxWeight={maxWeight} />
            ))}
          </div>
        )}
      </>
    );
  }
  return <GoalCard node={node} maxWeight={maxWeight} />;
}

/** 하위목표 카드 — 제목 + kind 배지 + 상대 중요도 바 + (학위요건이면) degree_req 롤업 + 중첩 자식. */
function GoalCard({ node, maxWeight }: { node: GoalTreeNode; maxWeight: number }) {
  const pct = Math.round((node.weight / maxWeight) * 100);
  const degRows = degreeReqRows(node);
  const kids = byWeightDesc(node.children);
  return (
    <article className={`${s.card} ${node.active ? '' : s.cardOff}`}>
      <div className={s.cardHead}>
        <h2 className={s.cardTitle}>{node.title}</h2>
        <span className={`${s.kind} ${node.kind === 'project' ? s.kindProject : s.kindGoal}`}>
          {node.kind === 'project' ? '프로젝트' : '목표'}
        </span>
      </div>

      <div className={s.wRow} aria-label={`상대 중요도 ${node.weight}`}>
        <div className={s.wbar}>
          <span className={s.wbarFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={s.wVal}>{node.weight.toFixed(2)}</span>
      </div>

      {degRows && (
        <dl className={s.degGrid}>
          {degRows.map((r) => (
            <div key={r.label} className={s.degItem}>
              <dt className={s.degK}>{r.label}</dt>
              <dd className={s.degV}>
                {r.credits}
                <span className={s.degU}>학점</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!node.active && <div className={s.offTag}>비활성</div>}

      {kids.length > 0 && (
        <div className={s.subGrid}>
          {kids.map((k) => (
            <GoalCard key={k.id} node={k} maxWeight={maxWeight} />
          ))}
        </div>
      )}
    </article>
  );
}
