/* ============================================================
   JournalStream — 오늘의 로그(기록 시그니처). 그날 남긴 산출물을 검정 위 에디토리얼
   타임라인으로: 요약=얇은 행, CBMS=진단 칩 행(C/B/M/S/T 색), 보충=네온 플래그.
   순수 파생(읽기 전용 개요) — 입력은 아래 카드들이 소유. 데이터는 기존 selector 그대로.

   월드클래스 라운드(AmbientCanvas 언어) — 패널이 살아있는 발광 보드로: 포인터 추적
   스포트라이트 + 색 오로라(ds.spotHost/spotlight/aura/glow) + 카운트 카운트업.
============================================================ */
import { useApp } from '@/store/useApp';
import { useHeroPointer, useCountUp } from '@/hooks/interactions';
import { summariesFor, cbmsBetween, CBMS_INFO } from '@/lib/methodology';
import { itemById } from '@/lib/utils';
import ds from '@/styles/ds.module.css';
import s from './JournalStream.module.css';
import type { CbmsCode } from '@/lib/types';

/** 헤더 카운트 — 마운트 시 0→값 카운트업(reduced-motion이면 즉시). */
function Count({ n }: { n: number }) {
  const v = useCountUp(n);
  return <b>{Math.round(v)}</b>;
}

/** 작성 시각 HH:MM — 구버전 기록엔 at이 없어 빈 문자열(타임스탬프 생략). */
function fmtTime(at?: number): string {
  if (!at) return '';
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
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
      className={`${s.board}${fill ? ' ' + s.boardFill : ''} ${ds.spotHost} ${ds.glow}`}
    >
      <div className={ds.spotlight} aria-hidden="true" />
      <div className={ds.aura} aria-hidden="true" />
      <div className={s.head}>
        <span className={s.title}>{titleLabel} — LOG</span>
        <span className={s.counts}>
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
        <div className={s.empty}>
          {/* 빈 보드가 의도된 상태로 읽히도록 — 흐릿한 에디토리얼 글리프 + 중앙 정렬(문구는 그대로). */}
          <span className={s.emptyGlyph} aria-hidden="true">
            ✎
          </span>
          <div>
            오늘 아직 기록이 없어요. <b>블록을 끝낼 때마다 하나씩</b> — 요약 한 줄, 막힌 곳 한 개.
          </div>
        </div>
      ) : (
        <ol className={s.stream}>
          {sums.map((x) => {
            const lead = x.s1?.trim() || x.s2?.trim() || x.s3?.trim() || '(내용 없음)';
            return (
              <li key={`s-${x.id}`} className={s.row}>
                <span className={s.node} />
                {fmtTime(x.at) && <span className={s.time}>{fmtTime(x.at)}</span>}
                <span className={`${s.kind} ${s.kSum}`}>요약</span>
                <span className={s.swatch} style={{ background: itemById(state, x.sid)?.color || 'var(--acc)' }} />
                <span className={s.name}>{x.name || '(과목 없음)'}</span>
                <span className={s.lead}>{lead}</span>
              </li>
            );
          })}
          {cbms.map((e) => {
            const inf = CBMS_INFO[e.code as CbmsCode] || { label: '?', color: 'var(--mut)' };
            return (
              <li key={`c-${e.id}`} className={s.row}>
                <span className={s.node} />
                {fmtTime(e.at) && <span className={s.time}>{fmtTime(e.at)}</span>}
                <span className={ds.cbmsChip} style={{ '--c': inf.color } as React.CSSProperties}>
                  {e.code} {inf.label}
                </span>
                <span className={s.name}>{e.name || '오답'}</span>
                {e.chapter && <span className={s.meta}>· {e.chapter}</span>}
                {e.note && <span className={s.lead}>{e.note}</span>}
              </li>
            );
          })}
          {blanks.map((b) => (
            <li key={`bl-${b.id}`} className={s.row}>
              <span className={s.node} />
              <span className={`${s.kind} ${s.kBlank}`} data-passed={b.passed ? '1' : '0'}>
                {b.passed ? '백지 통과' : '백지 막힘'}
              </span>
              <span className={s.swatch} style={{ background: itemById(state, b.sid)?.color || 'var(--acc)' }} />
              <span className={s.name}>{b.name || '(과목 없음)'}</span>
              {b.note && <span className={s.lead}>{b.note}</span>}
            </li>
          ))}
          {backlogToday.map((b) => (
            <li key={`b-${b.id}`} className={`${s.row}${b.done ? ' ' + s.dim : ''}`}>
              <span className={`${s.node} ${s.flag}`} />
              {fmtTime(b.at) && <span className={s.time}>{fmtTime(b.at)}</span>}
              <span className={`${s.kind} ${s.kBl}`}>{b.done ? '회수' : '보충'}</span>
              <span className={s.name}>{b.topic || '(주제 없음)'}</span>
              {b.name && <span className={s.meta}>· {b.name}</span>}
              {b.note && <span className={s.lead}>{b.note}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
