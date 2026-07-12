/* ============================================================
   Mastery — 탭: 🧠 숙달도 지도 (Phase 5 · 서버/외부 = TanStack Query)
   지식엔진.py 산출(_지식상태.json)을 소비 — 히트맵(A)·프런티어/갭(B)·캘리브레이션(E).
   데이터 원본 둘: serve.js /api/artifact/knowledge(자동) · 볼트 폴더 FS Access(수동 폴백).
   둘 다 같은 ['knowledge'] Query 캐시로 모여 본문이 렌더(설계도 §1-B). 레거시 _knowState 수동배선 제거.

   월드클래스 재설계(데모 v6 사상) — HudFrame fill 가득.
   상단 시네마틱 히어로 밴드(전체 숙달 발광 링 + 상태 분포 + 로드) → 본문 2컬럼
   [발광 지식맵(시그니처) | 다음 행동(프런티어·약점·캘리브레이션)]. 살아있는 인터랙션(스포트라이트·오로라·카운트업).
============================================================ */
import { type ReactNode, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useKnowledge, useCurriculum, usePing, KNOWLEDGE_KEY } from '@/store/queries';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useHeroPointer, useCountUp } from '@/hooks/interactions';
import { ui } from '@/shell';
import { loadKnowledgeStateFromVault, rootCauseRollup, type Knowledge, type KnowledgeSubject } from '@/lib/knowledge';
import { topSequencing, seqReasonCounts, SEQ_REASON_META, type SeqReason } from '@/lib/curriculum';
import { classifyArtifact } from '@/lib/artifactState';
import { masteryColor } from '@/lib/utils';
import { Button } from '@/components/ui';
import { ProgressRing } from '@/components/ProgressRing';
import ds from '@/styles/ds.module.css';
import m from './Mastery.module.css';

const pct = (x?: number) => `${Math.round((x || 0) * 100)}%`;

/** AN-12 — 볼트 딥링크 아이콘 버튼. obsidian://search는 볼트명 없이도 동작(설치돼 있으면).
   Graph 탭 E-5 패턴 미러 — 죽은 개념 텍스트를 "볼트에서 이 개념 열기"로 살린다. */
function VaultLink({ query, label }: { query: string; label?: string }) {
  const q = (query || '').trim();
  if (!q) return null; // 검색어 없으면 링크 무의미(basename조차 없는 행).
  return (
    <button
      type="button"
      className={m.deep}
      onClick={() => window.open('obsidian://search?query=' + encodeURIComponent(q))}
      title={`Obsidian에서 ${label || `"${q}"`} 검색 (설치돼 있어야 함)`}
      aria-label={`Obsidian에서 ${label || q} 검색`}
    >
      🔎
    </button>
  );
}

/** 전체 숙달 — 발광 원형 링(마운트 시 0→target 카운트업). 히어로의 시선 집중점. */
function OverallRing({ overall }: { overall: number }) {
  const target = Math.round((overall || 0) * 100);
  const shown = useCountUp(target);
  return (
    <div className={m.ring} role="img" aria-label={`전체 숙달 ${target}%`}>
      <ProgressRing
        size={120}
        r={46}
        pct={shown}
        className={ds.ringSvg}
        trackClassName={ds.ringTrack}
        arcClassName={ds.ringArc}
      />
      <span className={m.ringNum}>
        {Math.round(shown)}
        <small>%</small>
      </span>
    </div>
  );
}

const DIST: { key: 'mastered' | 'learning' | 'weak' | 'unknown'; color: string; lab: string }[] = [
  { key: 'mastered', color: 'var(--good,#4caf50)', lab: '숙달' },
  { key: 'learning', color: 'var(--learning,#d6a72b)', lab: '학습중' },
  { key: 'weak', color: 'var(--bad,#e3564a)', lab: '약점' },
  { key: 'unknown', color: 'var(--line,#444)', lab: '미관측' },
];

/** 지식 상태 분포 — 한 줄 세그먼트 바 + 범례 칩(히어로에 베이크). */
function Distribution({ k }: { k: Knowledge }) {
  const s = k.states || {};
  const tot = k.n_notes || 1;
  return (
    <div className={m.dist}>
      <div className={m.msbar}>
        {DIST.map(({ key, color, lab }) => {
          const n = s[key] || 0;
          const w = Math.round((n / tot) * 100);
          if (!w) return null;
          const t = `${lab} ${n} (${w}%)`;
          return <div key={key} data-tip={t} role="img" aria-label={t} style={{ width: `${w}%`, background: color }} />;
        })}
      </div>
      <div className={m.distLegend}>
        {DIST.map(({ key, color, lab }) => (
          <span key={key}>
            <i className={m.dot} style={{ background: color }} />
            {lab} <b>{s[key] || 0}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 히트맵 셀 캡 — 과목당 개념 셀을 상한(HEAT_CAP)까지만 그리고 "+N개"로 나머지를 펼친다.
   X-7 B — 무제한 <i> 셀은 대형 과목에서 DOM 폭주(형제 ConceptList는 캡18) → 같은 캡+펼침 패턴을 미러. */
const HEAT_CAP = 60;
function SubjectHeat({ s }: { s: KnowledgeSubject }) {
  const [expanded, setExpanded] = useState(false);
  const concepts = s.concepts || [];
  const shown = expanded ? concepts : concepts.slice(0, HEAT_CAP);
  const hidden = concepts.length - shown.length;
  return (
    <div className={m.msheat}>
      {shown.map((c, i) => {
        const t = `${c.title || c.basename}  ·  유효숙달 ${pct(c.p_eff)} (${c.state})${
          c.weak && c.root_cause && c.root_cause !== 'self' ? ' ← 선수약점: ' + c.root_cause : ''
        }`;
        const col = masteryColor(c.p_eff, c.state);
        // 유효숙달 p가 높을수록 글로우 강하게(0.55↑부터 번짐). 미관측/약점은 차분.
        // 프런티어는 accent 링 + 글로우를 함께(인라인이 .fr의 box-shadow를 덮으므로 합성).
        const ring = c.frontier ? '0 0 0 1.5px var(--acc)' : '';
        const glow = c.p_eff >= 0.55 ? `0 0 ${Math.round((c.p_eff - 0.4) * 14)}px ${col}` : '';
        const boxShadow = [ring, glow].filter(Boolean).join(', ') || undefined;
        return (
          <i
            key={i}
            className={`${m.mscell}${c.frontier ? ' ' + m.fr : ''}`}
            style={{ background: col, boxShadow }}
            data-tip={t}
            role="img"
            aria-label={t}
          />
        );
      })}
      {/* 조용한 절단 금지 — 숨은 셀 수를 밝히고 펼칠 수 있게(ConceptList와 동형). */}
      {(hidden > 0 || expanded) && (
        <button type="button" className={m.heatMore} onClick={() => setExpanded((v) => !v)}>
          {expanded ? '접기' : `+${hidden}개`}
        </button>
      )}
    </div>
  );
}

/** 발광 지식맵 — 과목별 히트맵(셀 하나가 개념). 데이터 보드의 immersive 시그니처(카드 래퍼 없이 bare). */
function KnowledgeMap({ k }: { k: Knowledge }) {
  const subs = (k.subjects || []).slice().sort((a, b) => a.mastery - b.mastery);
  const tot = k.n_notes || 1;
  const manyUnknown = (k.states?.unknown || 0) > tot * 0.5;
  return (
    <>
      <div className={m.mapHead}>
        <span className={m.mapTitle}>발광 지식맵 — KNOWLEDGE MAP</span>
        <span className={m.mapMeta}>셀 하나가 개념 · 빨강=약점 · 초록=숙달 · 회색=미관측</span>
      </div>
      {manyUnknown && (
        <div className={m.note}>
          ⚠ 미관측이 과반 — 인출 데이터(Anki due·CBMS·백지)가 쌓이면 회색이 색을 찾습니다. 그래프 기반 <b>프런티어</b>는
          관측 없이도 작동하니 우측에서 다음 배울 개념을 보세요.
        </div>
      )}
      {subs.length ? (
        subs.map((s) => (
          <div key={s.subject} className={m.mssub}>
            <div className={m.subHead}>
              <b className={m.subNm}>{s.subject}</b>
              <span className={`${ds.tiny} ${ds.muted}`}>
                {s.n}개 · 숙달 {pct(s.mastery)}
                {s.weak ? ` · 약점 ${s.weak}` : ''}
                {s.unknown ? ` · 미관측 ${s.unknown}` : ''}
              </span>
            </div>
            <SubjectHeat s={s} />
          </div>
        ))
      ) : (
        <div className={`${ds.muted} ${ds.tiny}`}>과목 없음</div>
      )}
      <div className={m.mapFoot}>테두리 친 셀 ⬡ = 프런티어(지금 배울 준비됨).</div>
    </>
  );
}

interface ConceptRow {
  title?: string;
  basename?: string;
  subject?: string;
}
/** 프런티어/약점 등 '개념 리스트' 공통 카드 — 점·이름·과목은 동일, 우측 메타만 renderMeta로 주입. */
function ConceptList<T extends ConceptRow>({
  heading,
  subtitle,
  empty,
  items,
  dot,
  dotColor,
  renderMeta,
  cap = 18,
}: {
  heading: string;
  subtitle: string;
  empty: ReactNode;
  items: T[];
  dot: string;
  dotColor: string;
  renderMeta: (it: T) => ReactNode;
  cap?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, cap);
  const hidden = items.length - shown.length;
  if (!items.length)
    return (
      <div className={ds.card}>
        <h3>{heading}</h3>
        {empty}
      </div>
    );
  return (
    <div className={ds.card}>
      <h3>
        {heading} <span className={`${ds.muted} ${ds.tiny}`}>{subtitle}</span>
      </h3>
      <div className={m.mslist}>
        {shown.map((it, i) => (
          <div key={it.basename ?? i} className={m.msrow}>
            <span className={m.msdot} style={{ background: dotColor }}>
              {dot}
            </span>
            <span className={m.nm} style={{ flex: 1 }}>
              {it.title || it.basename}
            </span>
            <span className={`${ds.tiny} ${ds.muted}`}>{it.subject || ''}</span>
            {renderMeta(it)}
            {/* AN-12 — 개념명으로 볼트 딥링크(행 자체는 비대화형이라 명시 아이콘 버튼). */}
            <VaultLink query={it.title || it.basename || ''} />
          </div>
        ))}
      </div>
      {/* 조용한 절단 금지 — 숨은 개념 수를 밝히고 펼칠 수 있게. */}
      {(hidden > 0 || expanded) && (
        <button type="button" className={m.msMore} onClick={() => setExpanded((v) => !v)}>
          {expanded ? '접기' : `+${hidden}개 더 보기`}
        </button>
      )}
    </div>
  );
}

function Frontier({ k }: { k: Knowledge }) {
  return (
    <ConceptList
      heading="🎯 다음 배울 개념"
      subtitle="(ZPD · 선수 충족·고레버리지순 — 이걸 배우면 가장 많은 게 풀린다)"
      empty={<div className={`${ds.muted} ${ds.tiny}`}>프런티어 없음(선수 미충족 또는 충분 숙달).</div>}
      items={k.frontier || []}
      dot="⬡"
      dotColor="hsl(200 60% 50%)"
      renderMeta={(f) => (
        <span
          className={ds.chip}
          data-tip="이 개념을 선수로 삼는 개념 수"
          role="img"
          aria-label={`의존 ${f.prereq_in} — 이 개념을 선수로 삼는 개념 수`}
        >
          의존 {f.prereq_in}
        </span>
      )}
    />
  );
}

/** reason 버킷 점 색(디자인시스템 변수 · 프런티어 셀/약점 점과 같은 언어). */
const SEQ_DOT: Record<SeqReason, string> = {
  remediate: 'var(--bad,#e3564a)',
  zpd: 'hsl(200 60% 50%)',
  frontier: 'var(--line,#666)',
};

/** 🧭 다음 학습 순서 — 커리큘럼(단계③ 적응형 시퀀싱) arc 랭크. 개념-레벨 프런티어(Frontier)의 arc-레벨 짝:
   선수 게이트 위에서 약점(보강)·ZPD·커버리지를 결합해 커리큘럼.py 가 이미 정렬한 순서를 그대로 보여준다.
   서버 없음/산출물 미생성이면 데이터가 없어 조용히 생략(패널 자체를 접음 · Frontier·Gaps와 동형). */
function Sequencing() {
  const { data: cur } = useCurriculum();
  const seq = topSequencing(cur, 8);
  if (!cur || !seq.length) return null;
  const counts = seqReasonCounts(cur.sequencing);
  const total = cur.overall?.sequencing ?? cur.sequencing?.length ?? seq.length;
  return (
    <div className={ds.card}>
      <h3>
        🧭 다음 학습 순서{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>
          (커리큘럼 arc 단위 — 개념 단위는 위 🎯 · 선수게이트+약점+ZPD 결합 랭크)
        </span>
      </h3>
      <div className={ds.row} style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className={ds.chip} data-tip={SEQ_REASON_META.remediate.hint}>
          보강 {counts.remediate}
        </span>
        <span className={ds.chip} data-tip={SEQ_REASON_META.zpd.hint}>
          ZPD {counts.zpd}
        </span>
        <span className={ds.chip} data-tip={SEQ_REASON_META.frontier.hint}>
          프론티어 {counts.frontier}
        </span>
      </div>
      {counts.remediate === 0 && (
        /* 콜드스타트 정직성 — '보강 0'을 '약점 없음'으로 오해하지 않게(KnowledgeMap의 미관측 배너와 대칭). */
        <div className={`${ds.foot} ${ds.muted} ${ds.tiny}`} style={{ marginBottom: 8 }}>
          보강 0 — 약점이 없다기보다 인출 관측(Anki·CBMS)이 아직 없어서일 수 있어요. 관측이 쌓이면 약점 arc가 보강으로
          올라옵니다.
        </div>
      )}
      <div className={m.mslist}>
        {seq.map((it) => {
          const meta = SEQ_REASON_META[it.reason];
          return (
            <div key={it.arc_id} className={m.msrow}>
              <span
                className={m.msdot}
                style={{ background: SEQ_DOT[it.reason] }}
                title={meta.hint}
                role="img"
                aria-label={meta.label}
              >
                {meta.icon}
              </span>
              <span className={m.nm} style={{ flex: 1 }}>
                {it.arc || it.arc_id}
              </span>
              <span className={`${ds.tiny} ${ds.muted}`}>{it.slug || ''}</span>
              {typeof it.mastery === 'number' ? (
                <span className={ds.chip} data-tip="arc 노트 평균 유효숙달">
                  {pct(it.mastery)}
                </span>
              ) : null}
              {it.unlocks ? (
                <span className={ds.chip} data-tip="이 arc를 선수로 삼는 arc 수 — 먼저 익히면 이만큼 풀린다">
                  푼다 {it.unlocks}
                </span>
              ) : null}
              <VaultLink query={it.arc || it.arc_id} />
            </div>
          );
        })}
      </div>
      {total > seq.length ? (
        <div className={`${ds.foot} ${ds.muted} ${ds.tiny}`}>
          +{total - seq.length}개 더 (커리큘럼 시퀀싱 전체 {total})
        </div>
      ) : null}
    </div>
  );
}

function Gaps({ k }: { k: Knowledge }) {
  return (
    <ConceptList
      heading="🩹 약점 진단"
      subtitle="(약한 순 · 근본원인을 먼저 메우면 상류가 같이 풀린다)"
      empty={<div className={`${ds.foot} ${ds.muted}`}>증거상 약점 없음 — 인출 관측이 쌓이면 약점이 드러납니다.</div>}
      items={k.gaps || []}
      dot="✗"
      dotColor="var(--bad,#e3564a)"
      renderMeta={(x) => (
        <>
          <span className={ds.chip}>{pct(x.p_eff)}</span>{' '}
          {x.root_cause === 'self' ? (
            <span className={ds.tiny} style={{ color: 'var(--bad)' }}>
              본인 개념
            </span>
          ) : x.root_cause ? (
            /* AN-12 — 선수약점(root_cause)도 볼트에서 열 수 있게 텍스트 딥링크로. */
            <button
              type="button"
              className={`${ds.tiny} ${m.rcLink}`}
              onClick={() => window.open('obsidian://search?query=' + encodeURIComponent(x.root_cause!))}
              title={`Obsidian에서 선수약점 "${x.root_cause}" 검색 (설치돼 있어야 함)`}
            >
              ← 선수약점: {x.root_cause} 🔎
            </button>
          ) : null}
        </>
      )}
    />
  );
}

/** AN-2 — 약점 '근본원인 롤업' 카드. 개별 행의 '← 선수약점: X'는 약점마다 뿔뿔이 흩어져 있어
   어떤 선수개념이 *몇 개* 약점의 공통 뿌리인지 안 보인다 → 여기서 root_cause를 집계·랭크한다.
   프런티어의 prereq_in('이걸 배우면 N개가 풀린다')의 약점판 미러: 가장 많은 약점의 뿌리를 먼저 메우면
   상류가 함께 풀린다. 이미 페치된 k.gaps만 소비(신규 IO 0) · 롤업이 비면 카드 자체를 접는다. */
function RootCauses({ k }: { k: Knowledge }) {
  const roll = rootCauseRollup(k); // 상위 5개(self·무근원 제외, count 내림차순).
  if (!roll.length) return null;
  return (
    <div className={ds.card}>
      <h3>
        🌱 약점의 뿌리{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>
          (한 선수개념이 여러 약점의 공통 근본원인 — 먼저 메우면 상류가 같이 풀린다)
        </span>
      </h3>
      <div className={m.mslist}>
        {roll.map(({ cause, count }) => (
          <div key={cause} className={m.msrow}>
            <span className={m.msdot} style={{ background: 'var(--bad,#e3564a)' }}>
              🌱
            </span>
            <span className={m.nm} style={{ flex: 1 }}>
              {cause}
            </span>
            <span
              className={ds.chip}
              data-tip="이 뿌리를 메우면 함께 풀릴 약점 수"
              role="img"
              aria-label={`${count}개 약점의 뿌리`}
            >
              {count}개 약점의 뿌리
            </span>
            {/* AN-12 정합 — 원인 개념도 볼트에서 바로 열 수 있게. */}
            <VaultLink query={cause} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Calibration({ k }: { k: Knowledge }) {
  const c = k.calibration || {};
  if (!c.n_errors && !c.blank_total)
    return (
      <div className={ds.card}>
        <h3>🎚 메타인지 캘리브레이션</h3>
        <div className={`${ds.foot} ${ds.muted}`}>
          CBMS 오답·백지 기록이 없습니다 — 러닝허브에서 기록 후 <b>볼트 백업</b>→<code>지식엔진.py build --export</code>
          로 인제스트하면 '확신했는데 틀린' 과신율이 잡힙니다(투입 아닌 출력 지표 · 설계 E).
        </div>
      </div>
    );
  const over = c.overconfidence_rate || 0;
  const overCol = over > 0.5 ? 'var(--bad)' : over > 0.3 ? 'var(--learning)' : 'var(--good)';
  return (
    <div className={ds.card}>
      <h3>
        🎚 메타인지 캘리브레이션{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>(확신도 vs 정확도 — 낮을수록 자기 앎을 정확히 안다)</span>
      </h3>
      <div className={ds.row} style={{ gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div className={ds.kpi} style={{ color: overCol }}>
            {pct(over)}
          </div>
          <div className={ds.foot}>
            과신율 — 확신했는데 틀림 {c.confident_wrong || 0} / 전체 오답 {c.n_errors || 0}
          </div>
        </div>
        {c.blank_total ? (
          <div>
            <div className={ds.kpi}>{pct(c.blank_pass_rate)}</div>
            <div className={ds.foot}>
              백지복습 통과율 {c.blank_pass || 0}/{c.blank_total || 0}
            </div>
          </div>
        ) : null}
      </div>
      {/* 실제 오답 개수로 분할 — 추상 비율(1-over) 대신 과신/적정 개수를 직접 보여줘 데이터가 있는 척하지 않게. */}
      {(() => {
        const nErr = c.n_errors || 0;
        const cw = c.confident_wrong || 0;
        const appropriate = Math.max(0, nErr - cw);
        return (
          <div className={m.msbar} style={{ marginTop: 10 }}>
            <div
              data-tip={`확신했는데 틀림(과신) ${cw}/${nErr}`}
              role="img"
              aria-label={`확신했는데 틀림(과신) ${cw}/${nErr}`}
              style={{ width: `${nErr ? Math.round((cw / nErr) * 100) : 0}%`, background: 'var(--bad,#e3564a)' }}
            />
            <div
              data-tip={`확신없이 틀림(적정) ${appropriate}/${nErr}`}
              role="img"
              aria-label={`확신없이 틀림(적정) ${appropriate}/${nErr}`}
              style={{
                width: `${nErr ? Math.round((appropriate / nErr) * 100) : 0}%`,
                background: 'var(--learning)',
              }}
            />
          </div>
        );
      })()}
      <div className={`${ds.foot} ${ds.muted} ${ds.tiny}`} style={{ marginTop: 6 }}>
        과신 오답 = 다음 복습에서 우선 표적. 백지 통과율 = '꺼낼 수 있는가'의 직접 증거.
      </div>
    </div>
  );
}

function Setup() {
  // 카드 크롬은 offWrap(발광 패널)이 제공 — 본문은 투명 콘텐츠만(지식맵 패널과 같은 언어).
  return (
    <div className={m.stateBody}>
      <h3>아직 지식상태가 없어요</h3>
      <ol className={ds.foot} style={{ lineHeight: 1.9 }}>
        <li>
          볼트 인덱스 최신화: <code>python pipeline/_도구/벌트DB.py build</code>
        </li>
        <li>
          (선택) 러닝허브 데이터 먹이기: 설정 탭에서 <b>볼트 백업</b>(<code>러닝허브_백업.json</code>) → 엔진이
          CBMS·백지를 인제스트
        </li>
        <li>
          지식상태 빌드: <code>python pipeline/_도구/지식엔진.py build --export 러닝허브_백업.json</code>
        </li>
        <li>
          위 <b>📁 볼트에서 불러오기</b> 클릭 → 전공 폴더 선택
        </li>
      </ol>
      <div className={`${ds.foot} ${ds.muted}`}>
        엔진은 선수개념 그래프로 "지금 배울 준비된 것(ZPD)"과 "약점의 근본원인"을 진단합니다. 인출 관측(Anki/CBMS)이
        쌓일수록 추정이 날카로워집니다.
      </div>
    </div>
  );
}

export default function Mastery() {
  const { data: k, isLoading, isFetching, isError, error, refetch } = useKnowledge();
  const ping = usePing(); // serve.js 도달성 — 오프라인(프록시 500 포함)과 진짜 서버 실패를 구분.
  const qc = useQueryClient();
  const setRuntimeCache = useApp((s) => s.setRuntimeCache);
  // 포인터 추적 스포트라이트 — 히어로 밴드·지식맵 패널이 커서를 따라 발광(틸트 없는 큰 보드).
  const { ref: heroRef, onMouseMove: heroMove, onMouseLeave: heroLeave } = useHeroPointer(0);
  const { ref: mapRef, onMouseMove: mapMove, onMouseLeave: mapLeave } = useHeroPointer(0);

  // 전체 유효숙달·노트·약점 리드아웃을 상단 바로(데모 v6 헤더).
  const weak = k?.states?.weak;
  usePageChromeEffect(
    () => ({
      readouts: !k
        ? []
        : [
            { label: '전체 숙달', value: pct(k.overall), accent: true },
            { label: '노트', value: k.n_notes ?? 0 },
            { label: '약점', value: weak ?? 0 },
          ],
    }),
    [k, weak],
  );

  // 볼트 폴더에서 수동 로드(serve.js 없을 때) → 같은 ['knowledge'] 캐시에 주입 + write-through.
  // 큰 _지식상태.json 파싱은 Query 스피너가 아니라 이 async가 소유 → 자체 로딩상태로 '멈춘 듯'을 없앤다.
  const [vaultLoading, setVaultLoading] = useState(false);
  const loadFromVault = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker;
    if (!picker) {
      ui.toast('이 브라우저는 폴더 연결 미지원(Chrome/Edge). 또는 node serve.js로 띄우면 자동 로드됩니다.', 'warn');
      return;
    }
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker();
    } catch {
      return; // 취소
    }
    setVaultLoading(true);
    try {
      const loaded = await loadKnowledgeStateFromVault(handle);
      if (!loaded) {
        ui.toast('_지식상태.json을 못 찾았어요. 전공 폴더를 골랐는지, 지식엔진.py build를 돌렸는지 확인하세요.', 'bad');
        return;
      }
      qc.setQueryData(KNOWLEDGE_KEY, loaded);
      setRuntimeCache('_knowState', loaded);
    } finally {
      setVaultLoading(false);
    }
  };

  const loading = (isLoading || isFetching) && !k;

  // 쿼리 에러 분류 — '아직 데이터 없음'(산출물 미생성 404·산출물 부재 메시지·서버 미가동)은 정상적인
  // 무데이터 → 셋업 안내. serve.js가 살아 있는데(ping 성공) 실패한 경우만 에러 패널로 —
  // 실패를 셋업 뒤에 숨기지 않되, 오프라인(dev/preview 프록시 500 포함)을 장애로 오판하지 않는다.
  const errMsg = isError ? (error instanceof Error ? error.message : String(error)) : '';
  // 산출물 상태 분류는 공용 SSOT(classifyArtifact) — reads·markets와 같은 규칙(오프라인/미생성/진짜에러 구분).
  const realError = classifyArtifact({ hasData: !!k, loading, query: { isError, error }, ping }) === 'error';

  return (
    <section className={m.wrap} aria-label="숙달도 지도">
      {/* ── 시네마틱 히어로 밴드 — 전체 숙달 발광 링 + 상태 분포 + 로드 ── */}
      <div
        ref={heroRef}
        onMouseMove={heroMove}
        onMouseLeave={heroLeave}
        className={`${m.hero} ${ds.spotHost} ${ds.glow}`}
      >
        <div className={ds.spotlight} aria-hidden="true" />
        <div className={ds.aura} aria-hidden="true" />
        <div className={m.heroLeft}>
          <span className={m.eyebrow}>지식 지도</span>
          <h2 className={m.headTitle}>🧠 숙달도 지도</h2>
          <span className={m.headMeta}>
            {k ? (
              <>
                생성 {k.generated || '—'} · 노트 {k.n_notes}개
              </>
            ) : (
              '선수개념 그래프로 지금 배울 것을 진단'
            )}
          </span>
        </div>
        {k && <OverallRing overall={k.overall || 0} />}
        {k && (
          <div className={m.heroDistWrap}>
            <span className={m.distLab}>지식 상태 분포</span>
            <Distribution k={k} />
          </div>
        )}
        <div className={m.heroAction}>
          {loading && (
            <span className={m.headMeta}>
              <span className={ds.spin} /> 로드 중
            </span>
          )}
          <Button sm variant="primary" onClick={loadFromVault} disabled={vaultLoading}>
            {vaultLoading ? (
              <>
                <span className={ds.spin} /> 읽는 중…
              </>
            ) : (
              <>📁 볼트에서 {k ? '새로고침' : '지식상태 불러오기'}</>
            )}
          </Button>
        </div>
      </div>

      {k ? (
        <div className={m.cols}>
          {/* 좌 — 발광 지식맵(immersive 시그니처) */}
          <div
            ref={mapRef}
            onMouseMove={mapMove}
            onMouseLeave={mapLeave}
            className={`${m.mapCol} ${ds.spotHost} ${ds.glow}`}
          >
            <div className={ds.spotlight} aria-hidden="true" />
            <div className={ds.aura} aria-hidden="true" />
            <div className={m.mapScroll}>
              <KnowledgeMap k={k} />
            </div>
          </div>
          {/* 우 — 다음 행동(프런티어·약점·캘리브레이션) */}
          <div className={m.actionCol}>
            <Frontier k={k} />
            <Sequencing />
            <Gaps k={k} />
            <RootCauses k={k} />
            <Calibration k={k} />
          </div>
        </div>
      ) : loading ? (
        <div className={m.offWrap}>
          <div className={`${ds.muted}`}>
            <span className={ds.spin} /> 지식상태 로드 중...
          </div>
        </div>
      ) : realError ? (
        /* 진짜 실패(서버 응답 에러) — 셋업 안내로 위장하지 않고 에러를 드러내고 재시도를 제공. */
        <div className={m.offWrap}>
          <div className={m.errBody} role="alert">
            <span className={m.errGlyph} aria-hidden="true">
              ⚠
            </span>
            <h3>지식상태를 불러오지 못했어요</h3>
            <div className={`${ds.foot} ${ds.muted}`}>{errMsg}</div>
            <Button sm variant="primary" onClick={() => refetch()}>
              다시 시도
            </Button>
          </div>
        </div>
      ) : (
        <div className={m.offWrap}>
          <Setup />
        </div>
      )}
    </section>
  );
}
