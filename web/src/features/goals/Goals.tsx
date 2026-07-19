/* ============================================================
   Goals(내 길) — 탭: 🧭 내 길 지도(P9 Phase 6 · 축 A · D2/D10).
   손저작 goals.json(전파통신 연구원 자립 트리)을 렌더 — 루트 성취목표 히어로 + 하위목표 카드
   (상대 중요도 weight 바 · 학위요건 흡수 degree_req 롤업 · kind 배지). 노트→목표 연관은
   하이브리드(핵심만 goals: 명시링크·나머지 개념그래프 거리 Phase 4)라 콜드면 정직하게 안내.
   레이어: store(queries·usePageChrome)·lib(goals)만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import { useMemo } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useGoals, useDiscovery } from '@/store/queries';
import {
  buildGoalTree,
  byWeightDesc,
  degreeReqRows,
  activeGoals,
  projectNodes,
  projectViews,
  type GoalTreeNode,
  type ProjectView,
} from '@/lib/goals';
import { capabilitySignals, entryTitle, type DiscoveryEntry } from '@/lib/discovery';
import EmptyState from '@/components/EmptyState';
import s from './Goals.module.css';

export default function Goals() {
  const goals = useGoals();
  const data = goals.data;

  // 발견 큐(capability-unlock 가능신호 · D10 양방향). 콜드면 404→undefined(내 길 렌더 무영향).
  const disc = useDiscovery();

  const roots = useMemo(() => buildGoalTree(data), [data]);
  const active = useMemo(() => activeGoals(data), [data]);
  const projects = useMemo(() => projectNodes(data), [data]);
  const projViews = useMemo(() => projectViews(data), [data]);
  const capSignals = useMemo(() => capabilitySignals(disc.data), [disc.data]);

  // 상단 리드아웃 — 목표 수·활성·프로젝트·명시 링크(하이브리드 콜드 정직).
  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '목표 노드', value: data?.nodes.length ?? 0 },
        { label: '활성', value: active.length },
        { label: '프로젝트', value: projects.length },
        { label: '가능신호', value: capSignals.length },
      ],
    }),
    [data?.nodes.length, active.length, projects.length, capSignals.length],
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
              손저작 계약 <code>knowledge/_meta/contract/goals.json</code> 을 읽어 옵니다. 설정 탭에서 워크스페이스를
              지정하면 목표 트리가 여기 그려집니다.
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

      {/* 프로젝트·활용 표면(D10) — 선언 프로젝트(진행 중) + capability-unlock 가능신호(양방향). */}
      <ProjectsSection projects={projViews} signals={capSignals} />

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

/** 프로젝트·활용 표면(D10) — 학습을 응용에 붙이는 앵커. 두 축을 한 화면에:
   ① 선언된 프로젝트(kind:project · 진행 중) = 앵커목표↑·필요지식↓·산출물(done)·capability임계.
   ② capability-unlock 가능신호 = 발견 큐가 "이제 이 프로젝트 가능"으로 surface 한 후보(승격은 발견 탭).
   둘 다 콜드(프로젝트 미명시·신호 없음)면 억지 시드 없이 D10 모델을 정직하게 안내(과설계 금지). */
function ProjectsSection({ projects, signals }: { projects: ProjectView[]; signals: DiscoveryEntry[] }) {
  const cold = projects.length === 0 && signals.length === 0;
  return (
    <section className={s.projWrap} aria-label="프로젝트·활용 표면">
      <div className={s.projHead}>
        <h2 className={s.projTitle}>프로젝트 · 활용 표면</h2>
        <span className={s.projMeta}>학습을 응용에 잇는 앵커 — 관계성이 학습을 견인(D10)</span>
      </div>

      {cold ? (
        <div className={s.projCold}>
          <b>아직 선언된 프로젝트가 없어요.</b> 분야 개론이 임계에 도달하면 “이제 이 프로젝트 가능”(capability-unlock)이
          <b> 발견 큐</b>에 가능신호로 뜨고, 여기 <code>kind:project</code> 노드(분야·산출물·필요지식·capability임계)를
          더하면 진행 중 프로젝트가 그려집니다. 상향(축적→가능) · 하향(프로젝트→필요지식 분해)의 양방향 앵커예요.
        </div>
      ) : (
        <>
          {projects.length > 0 && (
            <div className={s.grid}>
              {projects.map((p) => (
                <ProjectCard key={p.node.id} p={p} />
              ))}
            </div>
          )}

          {/* capability-unlock 가능신호 — 발견 큐가 surface. 여기선 읽기만(승격은 발견 탭). */}
          {signals.length > 0 && (
            <div className={s.signals}>
              <div className={s.signalsHead}>
                <span className={s.signalDot} />
                <b>가능신호</b> <span className={s.projMeta}>필요지식이 임계 도달 — 발견 큐에서 승격</span>
              </div>
              <div className={s.signalList}>
                {signals.map((e) => (
                  <span key={e.id} className={s.signalChip} title="발견 큐에서 승격/기각(사람 결정)">
                    {entryTitle(e)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** 프로젝트 카드 — 앵커목표(상향)·산출물(done)·필요지식 칩(하향)·capability임계.
   capability '가능/잠김' 판정은 라이브 숙련 신호 축적 후(콜드 정직 · 시퀀싱과 대칭)라 임계값만 표시. */
function ProjectCard({ p }: { p: ProjectView }) {
  return (
    <article className={`${s.card} ${p.node.active ? '' : s.cardOff}`}>
      <div className={s.cardHead}>
        <h3 className={s.cardTitle}>{p.node.title}</h3>
        <span className={`${s.kind} ${s.kindProject}`}>프로젝트</span>
      </div>

      {p.분야 && (
        <div className={s.projRow}>
          <span className={s.projK}>분야</span>
          <span className={s.projV}>{p.분야}</span>
        </div>
      )}
      {p.산출물 && (
        <div className={s.projRow}>
          <span className={s.projK}>산출물</span>
          <span className={s.projV}>{p.산출물}</span>
        </div>
      )}
      {p.anchor && (
        <div className={s.projRow}>
          <span className={s.projK}>앵커 목표</span>
          <span className={s.projV}>↑ {p.anchor.title}</span>
        </div>
      )}

      {p.필요지식.length > 0 && (
        <div className={s.needWrap}>
          <span className={s.projK}>필요지식</span>
          <div className={s.needList}>
            {p.필요지식.map((n) => (
              <span key={n} className={s.needChip}>
                ↓ {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {typeof p.capability임계 === 'number' && (
        <div className={s.capRow} title="축적 숙달이 이 임계에 도달하면 '가능' — 판정은 라이브 신호 후">
          capability 임계 <b>{Math.round(p.capability임계 * 100)}%</b>
          <span className={s.capPend}>· 판정 대기(신호 콜드)</span>
        </div>
      )}

      {!p.node.active && <div className={s.offTag}>비활성</div>}
    </article>
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
