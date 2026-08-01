/* ============================================================
   mastery/KnowledgeMap.tsx — 히어로 시각화 묶음: 전체 숙달 링 · 상태 분포 · 발광 지식맵.
   "지금 내 지식이 어떤 모양인가"를 한눈에. 825줄짜리 Mastery.tsx에서 화면 구성 단위로 분리.

   VaultLink도 여기서 내보낸다 — 지식맵 셀과 Gaps 행 양쪽이 쓰는 공유 조각인데
   예전엔 Gaps 안에 같은 obsidian:// 열기가 손으로 한 번 더 구현돼 있었다.
============================================================ */
import { useState, type ReactNode, type CSSProperties } from 'react';
import { useCountUp } from '@/hooks/interactions';
import { masteryColor, openVaultSearch, pctLabel } from '@/lib/utils';
import { ProgressRing } from '@/components/ProgressRing';
import type { Knowledge, KnowledgeSubject } from '@/lib/knowledge';
import { subjectConfidence, type Confidence } from '@/lib/confidence';
import { M } from './classes';
import { Icon } from '@/components/Icon';

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
      className={variant === 'text' ? `ds-tiny ${M.rcLink}` : M.deep}
      onClick={() => openVaultSearch(q)}
      title={`Obsidian에서 ${label || `"${q}"`} 검색 (설치돼 있어야 함)`}
      aria-label={`Obsidian에서 ${label || q} 검색`}
    >
      {variant === 'text' ? children : <Icon name="search" />}
    </button>
  );
}

/**
 * 전체 숙달 — 발광 원형 링. 히어로의 시선 집중점.
 *
 * ⚠⚠ **P-12 — 이 링은 이제 사라지지 않는다.** 종전 호출부가 `k.overall != null &&` 로 감싸고
 * 있어서, 상류가 사전분포 검역을 걸면(= 표본이 얇아 평균이 사실이 아닐 때) **페이지의 시그니처가
 * 통째로 증발했다.** 사용자 입장에서 "아직 안 불러왔다"와 "불러왔는데 표본이 없다"가 같은 화면이
 * 된다 — 그 가드가 곧 사라짐이었다.
 *
 * 세 등급을 다르게 그린다(`lib/confidence.ts` 가 판정 · 여기는 그리기만):
 * · `solid`     — 종전과 동일(0→target 카운트업).
 * · `tentative` — **카운트업을 생략한다.** 자기 크기까지 자라지 않는 것이 곧 "자기 크기를 모른다"
 *                 이고, 이건 `draw` 어휘를 **의도적으로 안 쓰는** 자리다. 획은 흐리다.
 * · `unknown`   — 빈 링 + `—`. 캡션이 분모를 말한다.
 */
export function OverallRing({ overall, conf }: { overall: number | null; conf: Confidence }) {
  const target = overall == null ? 0 : Math.round(overall * 100);
  const counted = useCountUp(target);
  // ⚠ 훅은 항상 부른다(조건부 호출 금지) — 값만 고른다.
  const shown = conf.level === 'solid' ? counted : target;
  const label = conf.level === 'unknown' ? `전체 숙달 미측정 — ${conf.speech}` : `전체 숙달 ${target}%`;
  return (
    <div className="flex flex-none flex-col items-center gap-1">
      <div
        className={M.ring}
        style={{ '--ring-w': 8, '--ring-glow-r': '8px' } as CSSProperties}
        role="img"
        aria-label={conf.level === 'tentative' ? `${label} · ${conf.speech}` : label}
      >
        <ProgressRing
          size={120}
          r={46}
          pct={shown}
          className="ds-ringSvg"
          trackClassName={'ds-ringTrack'}
          arcClassName={'ds-ringArc'}
          tentative={conf.level !== 'solid'}
        />
        <span className={M.ringNum}>
          {conf.level === 'unknown' ? (
            '—'
          ) : (
            <>
              {Math.round(shown)}
              <small className={M.ringNumSmall}>%</small>
            </>
          )}
        </span>
      </div>
      {/* 캡션 — 값 옆에 **분모**를 둔다. 이게 없으면 흐린 획이 "비활성"으로 읽힌다(NN/g). */}
      {conf.caption && <span className="text-2xs text-mut tabular-nums">{conf.caption}</span>}
    </div>
  );
}

const DIST: { key: 'mastered' | 'learning' | 'weak' | 'unknown'; color: string; lab: string }[] = [
  { key: 'mastered', color: 'var(--good)', lab: '숙달' },
  { key: 'learning', color: 'var(--learning)', lab: '학습중' },
  { key: 'weak', color: 'var(--bad)', lab: '약점' },
  { key: 'unknown', color: 'var(--line)', lab: '미관측' },
];

/** 지식 상태 분포 — 한 줄 세그먼트 바 + 범례 칩(히어로에 베이크). */
export function Distribution({ k }: { k: Knowledge }) {
  const s = k.states || {};
  const tot = k.n_notes || 1;
  return (
    <div className={M.dist}>
      <div className={M.msbar}>
        {DIST.map(({ key, color, lab }) => {
          const n = s[key] || 0;
          const w = Math.round((n / tot) * 100);
          if (!w) return null;
          const t = `${lab} ${n} (${w}%)`;
          return (
            <div
              key={key}
              className={M.msbarSeg}
              data-tip={t}
              role="img"
              aria-label={t}
              style={{ width: `${w}%`, background: color }}
            />
          );
        })}
      </div>
      <div className={M.distLegend}>
        {DIST.map(({ key, color, lab }) => (
          <span key={key}>
            <i className={M.dot} style={{ background: color }} />
            {lab} <b className={M.distLegendB}>{s[key] || 0}</b>
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
    <div className={M.msheat}>
      {shown.map((c, i) => {
        const t = `${c.title || c.basename}  ·  유효숙달 ${pctLabel(c.p_eff)} (${c.state})${
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
            className={M.mscell}
            style={{ background: col, boxShadow }}
            data-tip={t}
            role="img"
            aria-label={t}
          />
        );
      })}
      {/* 조용한 절단 금지 — 숨은 셀 수를 밝히고 펼칠 수 있게(ConceptList와 동형). */}
      {(hidden > 0 || expanded) && (
        <button type="button" className={M.heatMore} onClick={() => setExpanded((v) => !v)}>
          {expanded ? '접기' : `+${hidden}개`}
        </button>
      )}
    </div>
  );
}

/** 숙달 히트맵 — 과목별 히트맵(셀 하나가 개념). 데이터 보드의 immersive 시그니처(카드 래퍼 없이 bare).
 *  ⚠ 옛 제목은 "발광 지식맵"이었는데, `graph` 탭 라벨도 '지식맵'이라 **같은 세그먼트 바에 같은
 *  이름이 둘** 있었다(E10). 둘은 다른 질문에 답한다 — 저기는 항목→챕터 *구조*, 여기는 개념 단위
 *  *숙달 분포*. 이름이 그 차이를 말하게 했다. */
export function KnowledgeMap({ k }: { k: Knowledge }) {
  // 미측정(null) 과목은 정렬 뒤로 — 0으로 취급하면 '가장 약한 과목'으로 올라와 거짓 우선순위가 된다(②#54).
  const mval = (m: number | null | undefined) => (m == null ? Number.POSITIVE_INFINITY : m);
  const subs = (k.subjects || []).slice().sort((a, b) => mval(a.mastery) - mval(b.mastery));
  const tot = k.n_notes || 1;
  const manyUnknown = (k.states?.unknown || 0) > tot * 0.5;
  return (
    <>
      <div className={M.mapHead}>
        <span className={M.mapTitle}>숙달 히트맵 — MASTERY HEATMAP</span>
        <span className={M.mapMeta}>셀 하나가 개념 · 빨강=약점 · 초록=숙달 · 회색=미관측</span>
      </div>
      {manyUnknown && (
        <div className={M.note}>
          <Icon name="alert" /> 미관측이 과반 — 인출 데이터(Anki due·CBMS·백지)가 쌓이면 회색이 색을 찾습니다. 그래프
          기반 <b className="text-txt">프런티어</b>는 관측 없이도 작동하니 우측에서 다음 배울 개념을 보세요.
        </div>
      )}
      {subs.length ? (
        subs.map((s) => (
          <div key={s.subject} className={M.mssub}>
            <div className={M.subHead}>
              <b className={M.subNm}>{s.subject}</b>
              {/* P-12 — 과목 줄도 확신을 말한다. `pctLabel` 은 `62%` 아니면 `미측정` 2진이라
                  "62% 가 3개 관측에서 나온 값"인지 "40개에서 나온 값"인지 구분이 없었다. */}
              <span className="ds-tiny text-mut">
                {s.n}개 · 숙달 {pctLabel(s.mastery)}
                {subjectConfidence(s).level === 'tentative' && (
                  <span className="text-2xs"> (잠정 {subjectConfidence(s).caption})</span>
                )}
                {s.weak ? ` · 약점 ${s.weak}` : ''}
                {s.unknown ? ` · 미관측 ${s.unknown}` : ''}
              </span>
            </div>
            <SubjectHeat s={s} />
          </div>
        ))
      ) : (
        <div className="ds-tiny text-mut">과목 없음</div>
      )}
      <div className={M.mapFoot}>테두리 친 셀 ⬡ = 프런티어(지금 배울 준비됨).</div>
    </>
  );
}
