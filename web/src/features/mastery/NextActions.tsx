/* ============================================================
   mastery/NextActions.tsx — "그래서 다음에 뭘 하나" 열: 프런티어 · 시퀀싱 · 약점/갭 ·
   근본원인 · 엔진 건강 · 캘리브레이션. 전부 ConceptList 한 골격을 공유한다.
============================================================ */
import { useState, type ReactNode } from 'react';
import { useCurriculum } from '@/store/queries';
import {
  topSequencing,
  seqReasonCounts,
  SEQ_REASON_META,
  depthMeta,
  roleMeta,
  engineHealthTiers,
  isHealthCold,
  isRelevanceMonotone,
  type SeqReason,
} from '@/lib/curriculum';
import { rootCauseRollup, type Knowledge } from '@/lib/knowledge';
import { masteryColor } from '@/lib/utils';
import { VaultLink } from './KnowledgeMap';
import ds from '@/styles/ds.module.css';
import { M } from './classes';

const pct = (x?: number) => `${Math.round((x || 0) * 100)}%`;

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
      <div className={M.mslist}>
        {shown.map((it, i) => (
          <div key={it.basename ?? i} className={M.msrow}>
            <span className={M.msdot} style={{ background: dotColor }}>
              {dot}
            </span>
            <span className={M.nm}>{it.title || it.basename}</span>
            <span className={`${ds.tiny} ${ds.muted}`}>{it.subject || ''}</span>
            {renderMeta(it)}
            {/* AN-12 — 개념명으로 볼트 딥링크(행 자체는 비대화형이라 명시 아이콘 버튼). */}
            <VaultLink query={it.title || it.basename || ''} />
          </div>
        ))}
      </div>
      {/* 조용한 절단 금지 — 숨은 개념 수를 밝히고 펼칠 수 있게. */}
      {(hidden > 0 || expanded) && (
        <button type="button" className={M.msMore} onClick={() => setExpanded((v) => !v)}>
          {expanded ? '접기' : `+${hidden}개 더 보기`}
        </button>
      )}
    </div>
  );
}

export function Frontier({ k }: { k: Knowledge }) {
  return (
    <ConceptList
      heading="🎯 다음 배울 개념"
      subtitle="(ZPD · 선수 충족·고레버리지순 — 이걸 배우면 가장 많은 게 풀린다)"
      empty={<div className={`${ds.muted} ${ds.tiny}`}>프런티어 없음(선수 미충족 또는 충분 숙달).</div>}
      items={k.frontier || []}
      dot="⬡"
      dotColor="var(--acc2)"
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
  zpd: 'var(--acc2)',
  frontier: 'var(--line,#666)',
};

/** 🧭 다음 학습 순서 — 커리큘럼(단계③ 적응형 시퀀싱) arc 랭크. 개념-레벨 프런티어(Frontier)의 arc-레벨 짝:
   선수 게이트 위에서 약점(보강)·ZPD·커버리지를 결합해 커리큘럼.py 가 이미 정렬한 순서를 그대로 보여준다.
   서버 없음/산출물 미생성이면 데이터가 없어 조용히 생략(패널 자체를 접음 · Frontier·Gaps와 동형). */
export function Sequencing() {
  const { data: cur } = useCurriculum();
  const seq = topSequencing(cur, 8);
  if (!cur || !seq.length) return null;
  const counts = seqReasonCounts(cur.sequencing);
  const total = cur.overall?.sequencing ?? cur.sequencing?.length ?? seq.length;
  const o = cur.overall || {};
  // 단계④ 연관성 배분이 켜졌나(노트 goals: 링크 존재). 콜드면 역할=파생기본·relevance 0 이라 배분항 무영향.
  const relActive = !!o.relevance_active;
  return (
    <div className={ds.card}>
      <h3>
        🧭 다음 학습 순서{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>
          (커리큘럼 arc 단위 — 개념 단위는 위 🎯 · 선수게이트+약점+ZPD+삶연관성 결합 랭크)
        </span>
      </h3>
      <div className={ds.row} style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {/* data-tip은 눈으로 보는 사용자용 — 스크린리더는 같은 정보를 aria-label로 받는다
            (TooltipHost가 네이티브 title을 대체하므로 설명이 aria로도 안 실리면 통째로 유실된다).
            여기 담긴 게 "왜 이 순서인가"라는 랭킹 근거라 더더욱 빠뜨릴 수 없다. */}
        <span
          className={ds.chip}
          data-tip={SEQ_REASON_META.remediate.hint}
          role="img"
          aria-label={`보강 ${counts.remediate} — ${SEQ_REASON_META.remediate.hint}`}
        >
          보강 {counts.remediate}
        </span>
        <span
          className={ds.chip}
          data-tip={SEQ_REASON_META.zpd.hint}
          role="img"
          aria-label={`ZPD ${counts.zpd} — ${SEQ_REASON_META.zpd.hint}`}
        >
          ZPD {counts.zpd}
        </span>
        <span
          className={ds.chip}
          data-tip={SEQ_REASON_META.frontier.hint}
          role="img"
          aria-label={`프론티어 ${counts.frontier} — ${SEQ_REASON_META.frontier.hint}`}
        >
          프론티어 {counts.frontier}
        </span>
        {/* 단계④ 유한 예산(#2) 배분 요약 — 주당 시간 상한 안에서 몇 arc 배분/미룸. */}
        {typeof o.allocated_arcs === 'number' ? (
          <span
            className={ds.chip}
            data-tip={`주당 ${o.time_budget_hours ?? '?'}h 예산 내 배분 ${o.allocated_arcs}개 · 초과 미룸 ${o.deferred_arcs ?? 0}개 (약 ${o.allocated_hours ?? '?'}h)`}
            role="img"
            aria-label={`주당 ${o.time_budget_hours ?? '?'}h 예산 내 배분 ${o.allocated_arcs}개 · 초과 미룸 ${o.deferred_arcs ?? 0}개 (약 ${o.allocated_hours ?? '?'}h)`}
          >
            배분 {o.allocated_arcs}
            {o.deferred_arcs ? ` · 미룸 ${o.deferred_arcs}` : ''}
          </span>
        ) : null}
      </div>
      {counts.remediate === 0 && (
        /* 콜드스타트 정직성 — '보강 0'을 '약점 없음'으로 오해하지 않게(KnowledgeMap의 미관측 배너와 대칭). */
        <div className={`${ds.foot} ${ds.muted} ${ds.tiny}`} style={{ marginBottom: 8 }}>
          보강 0 — 약점이 없다기보다 인출 관측(Anki·CBMS)이 아직 없어서일 수 있어요. 관측이 쌓이면 약점 arc가 보강으로
          올라옵니다.
        </div>
      )}
      {!relActive && (
        /* 연관성 콜드 정직성 — 역할/깊이는 파생 기본값(중심·숙련)이고 삶연관성 가중은 아직 0. */
        <div className={`${ds.foot} ${ds.muted} ${ds.tiny}`} style={{ marginBottom: 8 }}>
          역할·깊이 배지는 지금 <b>파생 기본값</b>(핵심=중심·숙련)이에요. 핵심 노트에 <code>goals:</code> 링크를 달면
          삶-연관성이 켜지고(relevance) 순서가 목표 그래디언트로 갈립니다.
        </div>
      )}
      <div className={M.mslist}>
        {seq.map((it) => {
          const meta = SEQ_REASON_META[it.reason];
          const role = roleMeta(it.역할);
          const depth = depthMeta(it.target_depth);
          const deferred = it.allocated === false;
          const rel = relActive && typeof it.relevance === 'number' && it.relevance > 0 ? it.relevance : null;
          return (
            <div key={it.arc_id} className={`${M.msrow}${deferred ? ' ' + M.deferred : ''}`}>
              <span
                className={M.msdot}
                style={{ background: SEQ_DOT[it.reason] }}
                title={meta.hint}
                role="img"
                aria-label={meta.label}
              >
                {meta.icon}
              </span>
              <span className={M.nm}>{it.arc || it.arc_id}</span>
              <span className={`${ds.tiny} ${ds.muted}`}>{it.slug || ''}</span>
              {/* 역할 배지(삶-연관 축 · 액센트 틴트) — 콜드면 파생기본 중심. */}
              {role ? (
                <span
                  className={`${M.seqbadge} ${M.role}`}
                  data-tip={role.hint}
                  role="img"
                  aria-label={`${role.label} — ${role.hint}`}
                >
                  {role.label}
                </span>
              ) : null}
              {/* 깊이 배지(복습 강도 축 · 중립) — target_depth 롤업. */}
              {depth ? (
                <span
                  className={M.seqbadge}
                  data-tip={depth.hint}
                  role="img"
                  aria-label={`${depth.label} — ${depth.hint}`}
                >
                  {depth.label}
                </span>
              ) : null}
              {/* 삶-연관성 — 활성 & >0 일 때만(콜드=0 은 숨겨 노이즈 방지). goal 은 tip 에. */}
              {rel != null ? (
                <span
                  className={ds.chip}
                  data-tip={`삶-연관성 ${pct(rel)}${it.goal ? ` · 목표 ${it.goal}` : ''} — 배분 우선순위 근거(연관성×gap)`}
                  role="img"
                  aria-label={`삶-연관성 ${pct(rel)}${it.goal ? ` · 목표 ${it.goal}` : ''} — 배분 우선순위 근거(연관성×gap)`}
                >
                  연관 {pct(rel)}
                </span>
              ) : null}
              {typeof it.mastery === 'number' ? (
                <span
                  className={ds.chip}
                  data-tip="arc 노트 평균 유효숙달"
                  role="img"
                  aria-label={`arc 노트 평균 유효숙달 ${pct(it.mastery)}`}
                >
                  {pct(it.mastery)}
                </span>
              ) : null}
              {it.unlocks ? (
                <span
                  className={ds.chip}
                  data-tip="이 arc를 선수로 삼는 arc 수 — 먼저 익히면 이만큼 풀린다"
                  role="img"
                  aria-label={`푼다 ${it.unlocks} — 이 arc를 선수로 삼는 arc 수. 먼저 익히면 이만큼 풀린다`}
                >
                  푼다 {it.unlocks}
                </span>
              ) : null}
              {/* 미룸(예산·quota) — 이번 주기 배분 아님을 명시(트레이드오프). */}
              {deferred ? (
                <span
                  className={ds.chip}
                  data-tip={
                    it.defer_reason === 'quota'
                      ? '소양·지평 quota 초과 — 과점 방지로 이번 주기 미룸'
                      : '주당 시간 예산 초과 — "이걸 파려면 상위 arc를 미룸" 트레이드오프'
                  }
                  role="img"
                  aria-label={
                    it.defer_reason === 'quota'
                      ? '미룸 — 소양·지평 quota 초과. 과점 방지로 이번 주기 미룸'
                      : '미룸 — 주당 시간 예산 초과. 이걸 파려면 상위 arc를 미루는 트레이드오프'
                  }
                >
                  미룸{it.defer_reason ? `·${it.defer_reason === 'quota' ? 'quota' : '예산'}` : ''}
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

/** 📈 엔진 건강 — 연관성 3분위(상/중/하)별 평균 숙달 회고(D11 · 준-필수 R4). Sequencing(전방 배분)의
   후방 짝: "연관성↑ 노트가 실제 더 숙달됐나"를 되돌아본다. 라이브 인출 신호 0(P8 콜드)이면 평균숙달 null →
   판정 유예를 정직하게 배너로(Wave F 패턴 · Sequencing 콜드 배너와 대칭). 데이터 없으면 패널 접음. */
export function EngineHealth() {
  const { data: cur } = useCurriculum();
  const health = cur?.engine_health;
  const tiers = engineHealthTiers(health);
  if (!cur || !tiers) return null;
  const cold = isHealthCold(health);
  const monotone = isRelevanceMonotone(health);
  return (
    <div className={ds.card}>
      <h3>
        📈 엔진 건강{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>(연관성↑ 노트가 실제 더 숙달됐나 — 배분 논지 회고 · D11)</span>
      </h3>
      {cold ? (
        /* 콜드 정직성 — 라이브 인출 신호 0(P8 콜드)이라 평균숙달이 없음. 스캐폴드만 켜고 판정은 신호 축적 후. */
        <div className={`${ds.foot} ${ds.muted} ${ds.tiny}`} style={{ marginBottom: 8 }}>
          라이브 인출 신호가 아직 없어요(P8 콜드) — 연관성↑ 노트가 더 숙달됐는지는 <b>판정 유예</b>. 인출 관측이 쌓이는
          순간 아래 분위별 평균 숙달로 배분 논지가 검증됩니다.
        </div>
      ) : monotone != null ? (
        /* 라이브 판정 — 상≥중≥하 평균숙달이면 배분 논지 성립. */
        <div className={ds.row} style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <span
            className={ds.chip}
            style={{ color: monotone ? 'var(--good)' : 'var(--learning)' }}
            data-tip="연관성 상위 노트일수록 평균 숙달이 높으면 배분(연관성×gap) 논지 성립"
            role="img"
            aria-label={`${monotone ? '연관성↑ → 숙달↑ 성립' : '아직 단조 아님'} — 연관성 상위 노트일수록 평균 숙달이 높으면 배분(연관성×gap) 논지 성립`}
          >
            {monotone ? '연관성↑ → 숙달↑ 성립' : '아직 단조 아님'}
          </span>
          <span className={`${ds.tiny} ${ds.muted}`}>증거 노트 {health?.evidenced_notes ?? 0}</span>
        </div>
      ) : null}
      <div className={M.mslist}>
        {tiers.map((t) => {
          const mm = t.bucket.mean_mastery;
          return (
            <div key={t.label} className={M.msrow}>
              <span className={M.msdot} title={t.hint}>
                {t.label}
              </span>
              <span className={M.nm} title={t.hint}>
                연관성 {t.label}위
              </span>
              <span className={`${ds.tiny} ${ds.muted}`}>{t.bucket.n}개 노트</span>
              {typeof mm === 'number' ? (
                <span
                  className={ds.chip}
                  style={{ color: masteryColor(mm) }}
                  data-tip="이 분위 노트의 평균 유효숙달"
                  role="img"
                  aria-label={`이 분위 노트의 평균 유효숙달 ${pct(mm)}`}
                >
                  {pct(mm)}
                </span>
              ) : (
                <span
                  className={ds.chip}
                  data-tip="인출 신호 없음 — 평균 숙달 미산출(콜드)"
                  role="img"
                  aria-label="인출 신호 없음 — 평균 숙달 미산출(콜드)"
                >
                  —
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Gaps({ k }: { k: Knowledge }) {
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
            /* AN-12 — 선수약점(root_cause)도 볼트에서 열 수 있게 텍스트 딥링크로(VaultLink text 변형). */
            <VaultLink query={x.root_cause} label={`선수약점 "${x.root_cause}"`} variant="text">
              ← 선수약점: {x.root_cause} 🔎
            </VaultLink>
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
export function RootCauses({ k }: { k: Knowledge }) {
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
      <div className={M.mslist}>
        {roll.map(({ cause, count }) => (
          <div key={cause} className={M.msrow}>
            <span className={M.msdot} style={{ background: 'var(--bad,#e3564a)' }}>
              🌱
            </span>
            <span className={M.nm}>{cause}</span>
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

export function Calibration({ k }: { k: Knowledge }) {
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
          <div className={M.msbar} style={{ marginTop: 10 }}>
            <div
              className={M.msbarSeg}
              data-tip={`확신했는데 틀림(과신) ${cw}/${nErr}`}
              role="img"
              aria-label={`확신했는데 틀림(과신) ${cw}/${nErr}`}
              style={{ width: `${nErr ? Math.round((cw / nErr) * 100) : 0}%`, background: 'var(--bad,#e3564a)' }}
            />
            <div
              className={M.msbarSeg}
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
