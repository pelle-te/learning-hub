/* ============================================================
   JournalStream — 오늘의 로그(기록 시그니처). 그날 남긴 산출물을 검정 위 에디토리얼
   타임라인으로: 요약=얇은 행, CBMS=진단 칩 행(C/B/M/S/T 색), 보충=네온 플래그.
   순수 파생(읽기 전용 개요) — 입력은 아래 카드들이 소유. 데이터는 기존 selector 그대로.
============================================================ */
import { useApp } from '@/store/useApp';
import { summariesFor, cbmsBetween, CBMS_INFO } from '@/lib/methodology';
import { itemById } from '@/lib/utils';
import ds from '@/styles/ds.module.css';
import s from './JournalStream.module.css';
import type { CbmsCode } from '@/lib/types';

export default function JournalStream({ ds: dsKey }: { ds: string }) {
  const state = useApp((st) => st.state);
  const sums = summariesFor(state, dsKey);
  const cbms = cbmsBetween(state, dsKey, dsKey);
  const backlogToday = (state.backlog || []).filter((b) => b.ds === dsKey);
  const total = sums.length + cbms.length + backlogToday.length;

  return (
    <div className={s.board}>
      <div className={s.head}>
        <span className={s.title}>오늘의 로그 — LOG</span>
        <span className={s.counts}>
          <span>
            <b>{sums.length}</b> 요약
          </span>
          <span>
            <b>{cbms.length}</b> 오답
          </span>
          <span>
            <b>{backlogToday.length}</b> 보충
          </span>
        </span>
      </div>

      {total === 0 ? (
        <div className={s.empty}>
          오늘 아직 기록이 없어요. <b>블록을 끝낼 때마다 하나씩</b> — 요약 한 줄, 막힌 곳 한 개.
        </div>
      ) : (
        <ol className={s.stream}>
          {sums.map((x) => {
            const lead = x.s1?.trim() || x.s2?.trim() || x.s3?.trim() || '(내용 없음)';
            return (
              <li key={`s-${x.id}`} className={s.row}>
                <span className={s.node} />
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
                <span className={ds.cbmsChip} style={{ '--c': inf.color } as React.CSSProperties}>
                  {e.code} {inf.label}
                </span>
                <span className={s.name}>{e.name || '오답'}</span>
                {e.chapter && <span className={s.meta}>· {e.chapter}</span>}
                {e.note && <span className={s.lead}>{e.note}</span>}
              </li>
            );
          })}
          {backlogToday.map((b) => (
            <li key={`b-${b.id}`} className={`${s.row}${b.done ? ' ' + s.dim : ''}`}>
              <span className={`${s.node} ${s.flag}`} />
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
