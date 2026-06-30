/* ============================================================
   NeonTrack — 발광 타임라인(오늘/스케줄 시그니처). 순수 표현 컴포넌트.
   분 단위로 이미 배치된 세그먼트(학습 세션·루틴 블록)를 하루 트랙으로 그린다.
   데이터(layoutDay 등)는 소비처(features)가 만들어 넘긴다(components → lib만 의존).
============================================================ */
import s from './NeonTrack.module.css';

export interface NeonSeg {
  start: number; // 분(0~1440)
  end: number;
  tone: 'primary' | 'soft' | 'muted';
  label?: string; // 주석 라벨(있으면 표시)
  sub?: string; // 주석 보조줄
  place?: 'up' | 'dn'; // 주석 위치(생략 = 주석 없음)
  accent?: boolean; // 라벨을 액센트 색으로
  title?: string; // 호버 툴팁
  color?: string; // 칸 색(과목/블록 색) — 있으면 톤 대신 이 색으로 채움
  variant?: 'free'; // 빈 시간 칸(점선 윤곽)
}

function hh(min: number): string {
  return String(Math.floor(min / 60)).padStart(2, '0');
}

export default function NeonTrack({
  segs,
  rangeStart,
  rangeEnd,
  nowMin = null,
  ariaLabel,
  activeIdx = null,
  onScrub,
}: {
  segs: NeonSeg[];
  rangeStart: number;
  rangeEnd: number;
  nowMin?: number | null;
  ariaLabel?: string;
  activeIdx?: number | null; // 강조할 세그먼트(스크럽 미리보기와 동기화)
  onScrub?: (i: number | null) => void; // 세그먼트 호버 시 인덱스, 벗어나면 null
}) {
  const span = Math.max(1, rangeEnd - rangeStart);
  const pos = (m: number) => ((Math.max(rangeStart, Math.min(rangeEnd, m)) - rangeStart) / span) * 100;

  // 3시간 간격 틱(데모의 06·09·12…).
  const ticks: number[] = [];
  for (let m = rangeStart; m <= rangeEnd + 1; m += 180) ticks.push(m);

  const nowInRange = nowMin != null && nowMin >= rangeStart && nowMin <= rangeEnd;

  return (
    <div className={s.wrap} role="img" aria-label={ariaLabel || '오늘의 학습 타임라인'}>
      <div className={s.box}>
        <div className={s.lane} />
        {segs.map((g, i) => {
          const left = pos(g.start);
          const width = Math.max(0.6, pos(g.end) - left);
          const toneCls =
            g.variant === 'free' ? s.free : g.tone === 'primary' ? s.primary : g.tone === 'soft' ? s.soft : s.muted;
          const showAnn = g.place && g.label && width >= 5.5;
          const active = activeIdx === i;
          const style: Record<string, string> = {
            left: `${left}%`,
            width: `${width}%`,
            ['--sd']: `${0.3 + i * 0.04}s`,
          };
          if (g.color) style['--seg'] = g.color;
          return (
            <div key={i}>
              <div
                className={`${s.seg} ${toneCls}${active ? ' ' + s.segActive : ''}${onScrub ? ' ' + s.segHit : ''}`}
                style={style}
                title={g.title}
                onMouseEnter={onScrub ? () => onScrub(i) : undefined}
                onMouseLeave={onScrub ? () => onScrub(null) : undefined}
              />
              {showAnn && (
                <div className={`${s.ann} ${g.place === 'up' ? s.up : s.dn}`} style={{ left: `${left + width / 2}%` }}>
                  {g.place === 'dn' && <div className={s.line} />}
                  <div className={`${s.lab}${g.accent ? ' ' + s.labAcc : ''}`}>{g.label}</div>
                  {g.sub && <div className={s.sub}>{g.sub}</div>}
                  {g.place === 'up' && <div className={s.line} />}
                </div>
              )}
            </div>
          );
        })}
        {nowInRange && <div className={s.nowdot} style={{ left: `${pos(nowMin!)}%` }} />}
      </div>
      <div className={s.ticks}>
        {ticks.map((m) => (
          <span key={m}>{hh(m)}</span>
        ))}
      </div>
    </div>
  );
}
