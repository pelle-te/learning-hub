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
}: {
  segs: NeonSeg[];
  rangeStart: number;
  rangeEnd: number;
  nowMin?: number | null;
  ariaLabel?: string;
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
          const toneCls = g.tone === 'primary' ? s.primary : g.tone === 'soft' ? s.soft : s.muted;
          const showAnn = g.place && g.label && width >= 5.5;
          return (
            <div key={i}>
              <div
                className={`${s.seg} ${toneCls}`}
                style={{ left: `${left}%`, width: `${width}%`, ['--sd' as string]: `${0.3 + i * 0.04}s` }}
                title={g.title}
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
