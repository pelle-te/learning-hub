/* ============================================================
   mastery/KnowledgeMap.tsx — 히어로 시각화 묶음: 전체 숙달 링 · 상태 분포 · 발광 지식맵.
   "지금 내 지식이 어떤 모양인가"를 한눈에. 825줄짜리 Mastery.tsx에서 화면 구성 단위로 분리.

   VaultLink도 여기서 내보낸다 — 지식맵 셀과 Gaps 행 양쪽이 쓰는 공유 조각인데
   예전엔 Gaps 안에 같은 obsidian:// 열기가 손으로 한 번 더 구현돼 있었다.
============================================================ */
import { useState, type ReactNode } from 'react';
import { useCountUp } from '@/hooks/interactions';
import { masteryColor } from '@/lib/utils';
import { ProgressRing } from '@/components/ProgressRing';
import type { Knowledge, KnowledgeSubject } from '@/lib/knowledge';
import ds from '@/styles/ds.module.css';
import m from './Mastery.module.css';

const pct = (x?: number) => `${Math.round((x || 0) * 100)}%`;

/** AN-12 — 볼트 딥링크. obsidian://search는 볼트명 없이도 동작(설치돼 있으면).
   Graph 탭 E-5 패턴 미러 — 죽은 개념 텍스트를 "볼트에서 이 개념 열기"로 살린다.

   variant: 'icon'(기본) = 🔎 아이콘 버튼 · 'text' = 서술형 인라인 링크(children으로 문구 주입).
   두 형태가 각자 window.open을 손으로 짜고 있었다(같은 URL 조립 2벌) — 모양만 다르고 행위는 같다. */
export function VaultLink({
  query,
  label,
  variant = 'icon',
  children,
}: {
  query: string;
  label?: string;
  variant?: 'icon' | 'text';
  children?: ReactNode;
}) {
  const q = (query || '').trim();
  if (!q) return null; // 검색어 없으면 링크 무의미(basename조차 없는 행).
  return (
    <button
      type="button"
      className={variant === 'text' ? `${ds.tiny} ${m.rcLink}` : m.deep}
      onClick={() => window.open('obsidian://search?query=' + encodeURIComponent(q))}
      title={`Obsidian에서 ${label || `"${q}"`} 검색 (설치돼 있어야 함)`}
      aria-label={`Obsidian에서 ${label || q} 검색`}
    >
      {variant === 'text' ? children : '🔎'}
    </button>
  );
}

/** 전체 숙달 — 발광 원형 링(마운트 시 0→target 카운트업). 히어로의 시선 집중점. */
export function OverallRing({ overall }: { overall: number }) {
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
export function Distribution({ k }: { k: Knowledge }) {
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
export function KnowledgeMap({ k }: { k: Knowledge }) {
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
