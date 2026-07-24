/* ============================================================
   JournalStream — 오늘의 로그(기록 시그니처). 그날 남긴 산출물을 검정 위 에디토리얼
   타임라인으로: 요약=얇은 행, CBMS=진단 칩 행(C/B/M/S/T 색), 보충=네온 플래그.
   순수 파생(읽기 전용 개요) — 입력은 아래 카드들이 소유. 데이터는 기존 selector 그대로.

   월드클래스 라운드(AmbientCanvas 언어) — 패널이 살아있는 발광 보드로: 포인터 추적
   스포트라이트 + 색 오로라('ds-spotHost'/spotlight/aura/glow) + 카운트 카운트업.

   ── C-7 이식(journal) — Tailwind ──────────────────────────────────────────────
   보드 껍데기는 전역 `ds-board` 를 유지하고, fill(시그니처 발광 보드) 델타만 `!` 로 얹는다.
   시그니처 배경/상단 헤어라인은 review 가 토큰화한 --bg-sig-chart/--bg-sig-top 을 그대로 공유하고,
   마운트 애니는 rv-fade-up(tw.css)을 재사용한다(값·키프레임 동일). 노드/칩의 색·발광은 정적
   클래스로 자식에 직접 준다(규약 4 · 동적 조립 금지 — 백지 통과/막힘은 passed 로 가른다).
============================================================ */
import { useApp } from '@/store/useApp';
import { useHeroPointer, useCountUp } from '@/hooks/interactions';
import { summariesFor, cbmsBetween, CBMS_INFO } from '@/lib/methodology';
import { itemById, hhmm } from '@/lib/utils';
import type { CbmsCode } from '@/lib/types';

// fill 시그니처 보드 델타 — 'ds-board' 를 발광 보드로(회색 카드 탈피). 배경/헤어라인/애니는 공유 토큰.
const BOARD_FILL =
  "flex h-full min-h-0 flex-col rounded-lg! mb-0! bg-[image:var(--bg-sig-chart)]! px-5! pt-4.5! pb-4! shadow-card animate-[rv-fade-up_0.46s_var(--ease)_both] motion-reduce:animate-none before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-[1] before:h-px before:rounded-t-lg before:bg-[image:var(--bg-sig-top)] before:content-['']";
// 스트림 행 · 노드 · 종류 칩의 공유 base(상태별 색은 아래에서 조건부로 얹는다).
const ROW =
  'relative flex min-h-7.5 items-center gap-2 border-b border-dashed border-line2 py-1.75 pl-5.5 last:border-b-0';
const NODE = 'absolute top-1/2 left-1.25 size-2.25 -translate-y-1/2';
const KIND = 'flex-none rounded-xs px-1.5 py-0.5 text-2xs font-extrabold tracking-widest uppercase';

/** 헤더 카운트 — 마운트 시 0→값 카운트업(reduced-motion이면 즉시). */
function Count({ n }: { n: number }) {
  const v = useCountUp(n);
  return <b className="mr-0.75 text-md font-extrabold text-acc tabular-nums">{Math.round(v)}</b>;
}

/** 작성 시각 HH:MM — 구버전 기록엔 at이 없어 빈 문자열(타임스탬프 생략). */
function fmtTime(at?: number): string {
  if (!at) return '';
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  return hhmm(d);
}

export default function JournalStream({
  ds: dsKey,
  isToday = true,
  fill,
}: {
  ds: string;
  isToday?: boolean;
  fill?: boolean;
}) {
  const state = useApp((st) => st.state);
  // 포인터 추적 스포트라이트 — 시그니처 보드가 커서를 따라 발광(틸트 없는 큰 보드).
  const { ref, onMouseMove, onMouseLeave } = useHeroPointer(0);
  const sums = summariesFor(state, dsKey);
  const cbms = cbmsBetween(state, dsKey, dsKey);
  const backlogToday = (state.backlog || []).filter((b) => b.ds === dsKey);
  // 백지 복습 결과(통과/막힘) — 7일 활동피드엔 이미 들지만 일일 로그엔 빠져 불일치였다.
  const blanks = (state.blankResults || []).filter((b) => b.ds === dsKey);
  const total = sums.length + cbms.length + blanks.length + backlogToday.length;
  // 날짜 스테퍼로 과거일 백필 시 '오늘의 로그'는 모호 → 오늘이 아니면 날짜 표기.
  const [, mm, dd] = dsKey.split('-');
  const titleLabel = isToday ? '오늘의 로그' : `${Number(mm)}/${Number(dd)} 로그`;

  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={`ds-board ds-spotHost relative ds-glow${fill ? ' ' + BOARD_FILL : ''}`}
    >
      <div className="ds-spotlight" aria-hidden="true" />
      <div className="ds-aura" aria-hidden="true" />
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs leading-[1.6] font-extrabold tracking-caps text-mut uppercase">
          {titleLabel} — LOG
        </span>
        <span className="flex gap-3.5 text-xs leading-[1.6] text-mut">
          <span>
            <Count n={sums.length} /> 요약
          </span>
          <span>
            <Count n={cbms.length} /> 오답
          </span>
          {blanks.length > 0 && (
            <span>
              <Count n={blanks.length} /> 백지
            </span>
          )}
          <span>
            <Count n={backlogToday.length} /> 보충
          </span>
        </span>
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-1 pt-2.5 pb-1.5 text-center text-sm leading-[1.6] text-mut">
          {/* 빈 보드가 의도된 상태로 읽히도록 — 흐릿한 에디토리얼 글리프 + 중앙 정렬(문구는 그대로). */}
          <span className="text-display leading-none text-acc opacity-14 select-none" aria-hidden="true">
            ✎
          </span>
          <div>
            오늘 아직 기록이 없어요. <b>블록을 끝낼 때마다 하나씩</b> — 요약 한 줄, 막힌 곳 한 개.
          </div>
        </div>
      ) : (
        <ol
          className={`relative m-0 list-none p-0 pl-1.5 before:absolute before:top-1.5 before:bottom-1.5 before:left-2.25 before:w-px before:bg-line before:content-['']${fill ? ' min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto' : ''}`}
        >
          {sums.map((x) => {
            const lead = x.s1?.trim() || x.s2?.trim() || x.s3?.trim() || '(내용 없음)';
            return (
              <li key={`s-${x.id}`} className={ROW}>
                <span className={`${NODE} rounded-full bg-bg shadow-node-ring`} />
                {fmtTime(x.at) && (
                  <span className="w-8.5 flex-none text-2xs font-bold tracking-wide text-mut tabular-nums">
                    {fmtTime(x.at)}
                  </span>
                )}
                <span className={`${KIND} bg-acc-soft text-acc`}>요약</span>
                <span
                  className="size-2.25 flex-none rounded-xs"
                  style={{ background: itemById(state, x.sid)?.color || 'var(--acc)' }}
                />
                <span className="max-w-45 flex-none truncate text-md font-bold">{x.name || '(과목 없음)'}</span>
                <span className="min-w-0 flex-1 truncate text-sm leading-[1.6] text-mut">{lead}</span>
              </li>
            );
          })}
          {cbms.map((e) => {
            const inf = CBMS_INFO[e.code as CbmsCode] || { label: '?', color: 'var(--mut)' };
            return (
              <li key={`c-${e.id}`} className={ROW}>
                <span className={`${NODE} rounded-full bg-bg shadow-node-ring`} />
                {fmtTime(e.at) && (
                  <span className="w-8.5 flex-none text-2xs font-bold tracking-wide text-mut tabular-nums">
                    {fmtTime(e.at)}
                  </span>
                )}
                <span className="ds-cbmsChip" style={{ '--c': inf.color } as React.CSSProperties}>
                  {e.code} {inf.label}
                </span>
                <span className="max-w-45 flex-none truncate text-md font-bold">{e.name || '오답'}</span>
                {e.chapter && <span className="flex-none text-xs leading-[1.6] text-mut">· {e.chapter}</span>}
                {e.note && <span className="min-w-0 flex-1 truncate text-sm leading-[1.6] text-mut">{e.note}</span>}
              </li>
            );
          })}
          {blanks.map((b) => (
            <li key={`bl-${b.id}`} className={ROW}>
              <span className={`${NODE} rounded-full bg-bg shadow-node-ring`} />
              <span className={`${KIND} ${b.passed ? 'bg-tint-good text-good' : 'bg-tint-warn-soft text-warn'}`}>
                {b.passed ? '백지 통과' : '백지 막힘'}
              </span>
              <span
                className="size-2.25 flex-none rounded-xs"
                style={{ background: itemById(state, b.sid)?.color || 'var(--acc)' }}
              />
              <span className="max-w-45 flex-none truncate text-md font-bold">{b.name || '(과목 없음)'}</span>
              {b.note && <span className="min-w-0 flex-1 truncate text-sm leading-[1.6] text-mut">{b.note}</span>}
            </li>
          ))}
          {backlogToday.map((b) => (
            <li key={`b-${b.id}`} className={`${ROW}${b.done ? ' opacity-50' : ''}`}>
              <span className={`${NODE} rotate-45 rounded-xs bg-acc shadow-dot motion-reduce:shadow-none`} />
              {fmtTime(b.at) && (
                <span className="w-8.5 flex-none text-2xs font-bold tracking-wide text-mut tabular-nums">
                  {fmtTime(b.at)}
                </span>
              )}
              <span className={`${KIND} bg-tint-ink text-txt`}>{b.done ? '회수' : '보충'}</span>
              <span className="max-w-45 flex-none truncate text-md font-bold">{b.topic || '(주제 없음)'}</span>
              {b.name && <span className="flex-none text-xs leading-[1.6] text-mut">· {b.name}</span>}
              {b.note && <span className="min-w-0 flex-1 truncate text-sm leading-[1.6] text-mut">{b.note}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
