/* ============================================================
   Goals(내 길) — 탭: 🧭 내 길 지도(P9 Phase 6 · 축 A · D2/D10).
   손저작 goals.json(전파통신 연구원 자립 트리)을 렌더 — 루트 성취목표 히어로 + 하위목표 카드
   (상대 중요도 weight 바 · 학위요건 흡수 degree_req 롤업 · kind 배지). 노트→목표 연관은
   하이브리드(핵심만 goals: 명시링크·나머지 개념그래프 거리 Phase 4)라 콜드면 정직하게 안내.
   레이어: store(queries·usePageChrome)·lib(goals)만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import { useMemo } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useGoals, useDiscovery, useKnowledge } from '@/store/queries';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { addBacklog, openBacklog } from '@/lib/methodology';
import type { Knowledge } from '@/lib/knowledge';
import {
  buildGoalTree,
  byWeightDesc,
  degreeReqRows,
  activeGoals,
  projectNodes,
  projectViews,
  type GoalTreeNode,
  needKnowledgeRows,
  type NeedKnowledgeRow,
  type ProjectView,
} from '@/lib/goals';
import { capabilitySignals, entryTitle, type DiscoveryEntry } from '@/lib/discovery';
import State from '@/components/State';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';

/* ── C-7 네 번째 이식(goals) ─────────────────────────────────────────────
   `Goals.module.css`(307줄) 를 없앴다. 규약은 설계서 §15 + `styles/tokenBridge.css`
   머리주석이 SSOT(색은 tokens.css 파생 · 임의값 금지 · 사다리로 반올림).

   이 파일에서 처음 만난 것 둘:
   ① **em 단위 min-width**(`.wVal` 2.5em · `.projK` 4.5em) — 라벨 컬럼을 폰트에 상대적으로
      맞추던 자리다. `min-w-[2.5em]` 은 임의값이라 린트가 막는다 → `--container-*` 로 이름을
      주고 `min-w-wval`·`min-w-projk` 로 쓴다(규약 2·3 의 결).
   ② **auto-fill 카드 그리드**(`repeat(auto-fill, minmax(240px, 1fr))`) — 임의값 대신
      `--grid-template-columns-goals` 테마 항목으로(guide 의 `grid-cols-guide` 와 동형).

   ⚠ 반올림: 간격은 최근접 4px(동점은 내림 · discovery/review-run 선례 14→12·22→20).
   단 **치수적 그래픽 요소**(6px 중요도 바 높이 · 8px 점 · 6px 점 정렬 오프셋)는 사다리
   반올림의 예외로 표준 분수 유틸(`h-1.5`·`mt-1.5`)로 정확히 남긴다 — 2px 가 사라지면
   보이지 않는 간격이 아니라 시각 신호(바 두께·점 정렬)가 흔들리기 때문. 임의값(`[6px]`)이
   아니라 표준 유틸이라 규약 위반이 아니다.

   ⚠ acc2 색 4종은 정적으로 나뉜다 — 14%(`tint-acc2`)·18%(`tint-acc2-strong`)·
   25%(`line-acc2`)·40%(`line-acc2-strong`)·6%-over-panel(`panel-acc2-faint`). 한 이름에
   여러 세기를 몰면 guide 이식에서 물린 규약 5(재정의) 를 다시 밟는다. */
const ROOT = 'px-5 pt-4 pb-12';
const HERO = 'mb-5 rounded-lg border border-line-acc bg-linear-to-b from-acc-soft to-transparent p-5';
const GRID = 'grid grid-cols-goals gap-3';
const CARD = 'flex flex-col gap-2 rounded-md border border-line bg-panel px-4 py-3';
const CARD_HEAD = 'flex items-baseline justify-between gap-2';
const CARD_TITLE = 'm-0! text-md! tracking-tight!'; // h1~h3 — 언레이어드 전역 h2/h3{} 를 ! 로 이긴다
const KIND_BASE = 'flex-none rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap';
const KIND = { goal: 'bg-acc-soft text-acc-on-soft', project: 'bg-tint-acc2-strong text-acc2' } as const;
const PROJ_ROW = 'flex items-baseline gap-2 text-sm';
const PROJ_K = 'min-w-projk flex-none text-xs text-mut';

export default function Goals() {
  const navigate = useNavigate();
  const goals = useGoals();
  const data = goals.data;

  // 발견 큐(capability-unlock 가능신호 · D10 양방향). 콜드면 404→undefined(내 길 렌더 무영향).
  const disc = useDiscovery();
  /* ID-8 하향 루프 — 필요지식이 **약점인가**를 알려면 지식엔진 산출물이 필요하다. 숙달도·리뷰 탭이
     이미 쓰는 같은 쿼리라 캐시를 공유한다(신규 IO 0에 가깝다). 콜드면 undefined → 칩은 지금까지처럼
     정적으로 남는다(조인 실패를 '약점 아님'으로 조용히 바꾸지 않는다는 뜻이기도 하다). */
  const knowledge = useKnowledge().data;

  const roots = useMemo(() => buildGoalTree(data), [data]);
  const active = useMemo(() => activeGoals(data), [data]);
  const projects = useMemo(() => projectNodes(data), [data]);
  const projViews = useMemo(() => projectViews(data), [data]);
  const capSignals = useMemo(() => capabilitySignals(disc.data), [disc.data]);

  // 상단 리드아웃 — 목표 수·활성·프로젝트·명시 링크(하이브리드 콜드 정직).
  usePageChromeEffect(
    () => ({
      /* W22/H3 — `primary` 는 **필수 키**다(`store/usePageChrome.ts` 머리주석). 이 화면은 렌즈라
         44px 앵커를 세우지 않는다 — 잊은 것이 아니라 없다고 정한 것이다. */
      primary: null,
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
      /* W15 — 골격이 아니라 `indeterminate`(Discovery 와 같은 판단·같은 근거). 목표 카드 수는
         데이터가 정하므로 행 수를 약속하면 그 약속이 곧 오답이다. */
      <section className={ROOT}>
        <State kind="loading" shape="indeterminate" title="내 길을 불러오는 중" />
      </section>
    );
  }

  // 워크스페이스 미설정/계약 부재 → 빈 상태(goals.json 은 손저작이라 실전에선 항상 실재 · 서버 없을 때만).
  if (goals.isError || !data || roots.length === 0) {
    return (
      <section className={ROOT}>
        <State
          glyph="compass"
          title="내 길이 아직 안 보여요"
          desc={
            <>
              손저작 계약 <code>knowledge/_meta/contract/goals.json</code> 을 읽어 옵니다. 설정 탭에서 워크스페이스를
              지정하면 목표 트리가 여기 그려집니다.
            </>
          }
          /* 콜드 게이트 — 막힌 지점(워크스페이스 미설정)으로 **데려다준다**. 종전엔 어디로
             가야 하는지 문장으로만 말하고 사용자가 탭을 찾아야 했다. */
          next={
            <Button sm onClick={() => navigate('/settings')}>
              설정에서 워크스페이스 지정 →
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section className={ROOT}>
      {roots.map((root) => (
        <GoalBranch key={root.id} node={root} maxWeight={maxChildWeight(root)} isRoot />
      ))}

      {/* 프로젝트·활용 표면(D10) — 선언 프로젝트(진행 중) + capability-unlock 가능신호(양방향). */}
      <ProjectsSection projects={projViews} signals={capSignals} k={knowledge} />

      {/* 노트→목표 연관 — 하이브리드 모델 안내(핵심만 명시링크·나머지 개념그래프 거리 Phase 4). */}
      <div className="mt-5 flex gap-2 rounded-md border border-dashed border-line bg-panel px-4 py-3 text-sm leading-normal text-mut">
        <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-acc" />
        <div>
          <b className="text-txt">노트→목표 연관 = 하이브리드.</b> 핵심 노트만 <code>goals:</code> 로 직접 잇고,
          나머지는 개념그래프 거리로 계산합니다(연관성 엔진). 명시 링크·라이브 숙련 신호가 쌓이면 시퀀싱이 목표 근접도로
          재정렬됩니다(숙달도 지도 · Phase 4).
        </div>
      </div>
    </section>
  );
}

/** 프로젝트·활용 표면(D10) — 학습을 응용에 붙이는 앵커. 두 축을 한 화면에:
   ① 선언된 프로젝트(kind:project · 진행 중) = 앵커목표↑·필요지식↓·산출물(done)·capability임계.
   ② capability-unlock 가능신호 = 발견 큐가 "이제 이 프로젝트 가능"으로 surface 한 후보(승격은 발견 탭).
   둘 다 콜드(프로젝트 미명시·신호 없음)면 억지 시드 없이 D10 모델을 정직하게 안내(과설계 금지). */
function ProjectsSection({
  projects,
  signals,
  k,
}: {
  projects: ProjectView[];
  signals: DiscoveryEntry[];
  k: Knowledge | undefined;
}) {
  const cold = projects.length === 0 && signals.length === 0;
  return (
    <section className="mt-6" aria-label="프로젝트·활용 표면">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="m-0! text-lg! tracking-tight!">프로젝트 · 활용 표면</h2>
        <span className="text-xs text-mut">학습을 응용에 잇는 앵커 — 관계성이 학습을 견인(D10)</span>
      </div>

      {cold ? (
        <div className="rounded-md border border-dashed border-line-acc2-strong bg-panel-acc2-faint px-4 py-3 text-sm leading-relaxed text-mut">
          <b className="text-txt">아직 선언된 프로젝트가 없어요.</b> 분야 개론이 임계에 도달하면 “이제 이 프로젝트
          가능”(capability-unlock)이<b className="text-txt"> 발견 큐</b>에 가능신호로 뜨고, 여기{' '}
          <code>kind:project</code> 노드(분야·산출물·필요지식·capability임계)를 더하면 진행 중 프로젝트가 그려집니다.
          상향(축적→가능) · 하향(프로젝트→필요지식 분해)의 양방향 앵커예요.
        </div>
      ) : (
        <>
          {projects.length > 0 && (
            <div className={GRID}>
              {projects.map((p) => (
                <ProjectCard key={p.node.id} p={p} k={k} />
              ))}
            </div>
          )}

          {/* capability-unlock 가능신호 — 발견 큐가 surface. 여기선 읽기만(승격은 발견 탭). */}
          {signals.length > 0 && (
            <div className="mt-3 rounded-md border border-line-acc2 bg-panel px-3 py-3">
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="h-2 w-2 flex-none rounded-full bg-acc2" />
                <b className="text-txt">가능신호</b>{' '}
                <span className="text-xs text-mut">필요지식이 임계 도달 — 발견 큐에서 승격</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {signals.map((e) => (
                  <span
                    key={e.id}
                    className="rounded-full bg-tint-acc2 px-2 py-1 text-xs text-acc2"
                    title="발견 큐에서 승격/기각(사람 결정)"
                  >
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

/** 필요지식 칩 — 약점이면 **행동 가능한 버튼**, 아니면 지금까지처럼 정적 칩(ID-8).
 *
 *  이 칩이 이 탭의 핵심 비대칭이었다: capability **상향**(축적 → "이제 가능")은 배선돼 있는데
 *  **하향**("이 프로젝트를 열려면 이 지식이 약하다")은 정적 텍스트라 죽어 있었다. 약점인 것만
 *  보충으로 담을 수 있게 해서 그 방향을 잇는다 — 제품 telos(관계성이 학습을 견인)에 정확히 붙는다.
 *
 *  ⚠ 약점이 아니거나 **조인이 안 된 이름은 버튼으로 만들지 않는다.** 지식엔진이 모르는 이름을
 *    누르게 하면 "담았다"는 피드백만 주고 무엇에 대한 보충인지가 비어 버린다(칩은 그대로 보인다).
 *  ⚠ 이미 담긴 주제는 잠근다 — 같은 보충이 여러 번 쌓이면 목록이 곧 소음이 된다(SR-4 '✓보냄' 선례). */
function NeedChip({ row, seeded, onSeed }: { row: NeedKnowledgeRow; seeded: boolean; onSeed: () => void }) {
  const base = 'rounded-full px-2 py-1 text-xs';
  if (!row.weak) {
    return (
      <span
        className={`${base} bg-line2 text-txt`}
        title={row.concept ? '지식엔진이 아는 개념 — 지금은 약점이 아니에요' : '지식엔진에 같은 이름의 개념이 없어요'}
      >
        ↓ {row.name}
      </span>
    );
  }
  if (seeded) {
    return (
      <span className={`${base} bg-tint-warn text-warn`} title="이미 보충에 담겨 있어요">
        ✓ {row.name}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${base} bg-tint-warn font-semibold text-warn`}
      onClick={onSeed}
      title={`'${row.name}'은(는) 지금 약점이에요 — 보충('나중에 볼 것')에 담기`}
      aria-label={`${row.name} — 약점, 보충에 담기`}
    >
      <Icon name="alert" /> {row.name}
    </button>
  );
}

/** 프로젝트 카드 — 앵커목표(상향)·산출물(done)·필요지식 칩(하향)·capability임계.
   capability '가능/잠김' 판정은 라이브 숙련 신호 축적 후(콜드 정직 · 시퀀싱과 대칭)라 임계값만 표시. */
function ProjectCard({ p, k }: { p: ProjectView; k: Knowledge | undefined }) {
  const mutate = useApp((s) => s.mutate);
  // 이미 열려 있는 보충의 주제 집합 — 중복 시드 잠금의 근거를 로컬 state 가 아니라 **실제 상태**에서 판다
  // (탭을 다시 열어도, 다른 화면에서 담았어도 같은 답이 나온다).
  /* ⚠⚠ **셀렉터가 새 객체를 만들면 구독이 항상 깨진다(H17 · 2026-07-30 `/감사 근본`).**
     종전엔 `useApp((s) => new Set(openBacklog(s.state).map(...)))` 였다. zustand 의 기본 비교는
     `Object.is` 이므로 **앱 스토어의 모든 알림마다** 참조가 달라져(다른 탭의 완료 토글·집중
     시작·`setRuntimeCache` 까지) 마운트된 카드 전부가 리렌더했다. React Compiler 는 훅 **반환값**
     이 매번 새 참조인 것을 고칠 수 없다 — 메모의 입력 자체가 달라지기 때문이다.
     → 원시 슬라이스만 구독하고 파생은 렌더 본문에서 한다(그건 컴파일러가 메모한다). */
  const backlog = useApp((s) => s.state.backlog);
  const openTopics = new Set(openBacklog({ backlog }).map((b) => b.topic));
  const rows = needKnowledgeRows(p.필요지식, k);
  const weakN = rows.filter((r) => r.weak).length;

  const seed = (name: string): void => {
    mutate((s) => addBacklog(s, '', '', name, `프로젝트 '${p.node.title}'의 필요지식`));
    ui.toast(`보충에 담았어요 — ${name}`, 'ok', 4000);
  };

  /* Q-10 — 비활성은 `ds-past`(채도만 낮춤 · 명도 보존). `opacity-55` 는 카드 안 글자를
     통째로 대비 미달로 떨궜다(H5·H6 와 같은 형태). */
  return (
    <article className={`${CARD} ${p.node.active ? '' : 'ds-past'}`}>
      <div className={CARD_HEAD}>
        <h3 className={CARD_TITLE}>{p.node.title}</h3>
        <span className={`${KIND_BASE} ${KIND.project}`}>프로젝트</span>
      </div>

      {p.분야 && (
        <div className={PROJ_ROW}>
          <span className={PROJ_K}>분야</span>
          <span className="text-txt">{p.분야}</span>
        </div>
      )}
      {p.산출물 && (
        <div className={PROJ_ROW}>
          <span className={PROJ_K}>산출물</span>
          <span className="text-txt">{p.산출물}</span>
        </div>
      )}
      {p.anchor && (
        <div className={PROJ_ROW}>
          <span className={PROJ_K}>앵커 목표</span>
          <span className="text-txt">↑ {p.anchor.title}</span>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex items-start gap-2">
          <span className={PROJ_K}>필요지식</span>
          <div className="flex flex-wrap items-center gap-1">
            {rows.map((r) => (
              <NeedChip key={r.name} row={r} seeded={openTopics.has(r.name)} onSeed={() => seed(r.name)} />
            ))}
            {/* 조인이 아무것도 못 찾았을 수도, 전부 튼튼할 수도 있다 — 약점이 **있을 때만** 말한다.
                (지식 산출물이 콜드면 rows 는 전부 weak=false 라 이 줄이 자연히 침묵한다.) */}
            {weakN > 0 && <span className="ml-1 text-xs text-mut">— {weakN}개가 약점이에요(눌러서 보충에 담기)</span>}
          </div>
        </div>
      )}

      {typeof p.capability임계 === 'number' && (
        <div
          className="border-t border-line2 pt-1 text-xs text-mut"
          title="축적 숙달이 이 임계에 도달하면 '가능' — 판정은 라이브 신호 후"
        >
          capability 임계 <b className="text-acc2 tabular-nums">{Math.round(p.capability임계 * 100)}%</b>
          <span className="ml-1 text-mut">· 판정 대기(신호 콜드)</span>
        </div>
      )}

      {!p.node.active && <div className="self-start text-xs text-mut">비활성</div>}
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
        <header className={HERO}>
          <div className="font-mono text-xs font-semibold tracking-wide text-acc uppercase">내 길 · 성취목표</div>
          {/* ⚠ **`h1` 이 아니라 `h2` 다**(M-12 · 2026-08-06 감사). W9 이 이 화면을 `/degree` 의
              뷰로 접으면서 페이지의 `h1` 은 앱 셸이 갖게 됐는데(`러닝허브`), 이 히어로가 계속
              `h1` 이라 **한 페이지에 h1 이 둘**이고 호스트의 `h2 졸업` **뒤에** h1 이 오는
              역전이 생겼다(실측). 흡수는 도달 경로만 바꾼 게 아니라 **문서 구조상의 깊이**도
              바꾼다 — 그 축이 안 따라온 것이다.
              ⚠ `font-extrabold` 는 픽셀 보존용이다: 전역 `h1`=800 · `h2`=700 이고 크기·자간·여백은
              이미 `!` 로 못박혀 있어 **굵기만** 달라진다(유틸리티 레이어가 base 를 이긴다). */}
          <h2 className="mt-1! mb-2! text-xl! font-extrabold tracking-tight!">{node.title}</h2>
          <p className="m-0 max-w-prose text-sm text-mut">
            이 단일 목표를 하위목표로 분해해 학습 노력의 연관성 그래디언트를 만듭니다.
          </p>
        </header>
        {children.length > 0 && (
          <div className={GRID}>
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
    <article className={`${CARD} ${node.active ? '' : 'ds-past'}`}>
      <div className={CARD_HEAD}>
        <h2 className={CARD_TITLE}>{node.title}</h2>
        <span className={`${KIND_BASE} ${node.kind === 'project' ? KIND.project : KIND.goal}`}>
          {node.kind === 'project' ? '프로젝트' : '목표'}
        </span>
      </div>

      <div className="flex items-center gap-2" aria-label={`상대 중요도 ${node.weight}`}>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line2">
          <span className="block h-full rounded-full bg-acc" style={{ width: `${pct}%` }} />
        </div>
        <span className="min-w-wval text-right text-xs text-mut tabular-nums">{node.weight.toFixed(2)}</span>
      </div>

      {degRows && (
        <dl className="m-0 grid grid-cols-2 gap-1">
          {degRows.map((r) => (
            <div
              key={r.label}
              className="flex items-baseline justify-between rounded-sm border border-line2 bg-bg px-2 py-1"
            >
              <dt className="text-xs text-mut">{r.label}</dt>
              <dd className="m-0 text-sm font-semibold tabular-nums">
                {r.credits}
                <span className="ml-1 text-xs font-normal text-mut">학점</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!node.active && <div className="self-start text-xs text-mut">비활성</div>}

      {kids.length > 0 && (
        <div className="mt-1 grid gap-2 border-l-2 border-line2 pl-2">
          {kids.map((k) => (
            <GoalCard key={k.id} node={k} maxWeight={maxWeight} />
          ))}
        </div>
      )}
    </article>
  );
}
