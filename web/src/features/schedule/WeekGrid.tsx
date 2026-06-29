/* ============================================================
   WeekGrid — 네온 위크-그리드(스케줄 시그니처). 7일 = 가로 발광 트랙 7줄.
   computeDay가 빚은 DayData[](parts)를 받아 줄마다 세그먼트로 그린다(순수 표현 — 데이터는 Schedule이 준비).
   요일 클릭 → onSelect(그날 상세 DayCard). 오늘=하이라이트+지금 마커, 마감일=네온 플래그.
============================================================ */
import { toHM } from '@/lib/utils';
import type { DayData } from '@/lib/scheduleView';
import s from './WeekGrid.module.css';

type Tone = 'primary' | 'soft' | 'muted';
interface Seg {
  start: number;
  end: number;
  tone: Tone;
  title: string;
}

function hh(min: number): string {
  return String(Math.floor(min / 60)).padStart(2, '0');
}

function segsOf(p: DayData): Seg[] {
  const out: Seg[] = [];
  for (const r of p.rows) {
    if (r.kind === 'block' && r.start != null) {
      out.push({ start: r.start, end: r.end, tone: 'muted', title: `${r.name} ${toHM(r.start)}–${toHM(r.end)}` });
    } else if (r.kind === 'study' && r.start != null && r.end != null) {
      const t = r.it.type;
      const tone: Tone = t === 'new' ? 'primary' : 'soft';
      out.push({ start: r.start, end: r.end, tone, title: `${r.it.name} ${toHM(r.start)}–${toHM(r.end)}` });
    }
  }
  return out;
}

export function WeekGrid({
  parts,
  sel,
  onSelect,
  nowMin,
  dows,
  deadlines,
}: {
  parts: DayData[];
  sel: number;
  onSelect: (k: number) => void;
  nowMin: number;
  dows: string[];
  deadlines: string[][];
}) {
  // 모든 줄이 같은 시간 범위를 공유해 열이 정렬되게 — 세그 최소/최대를 3시간 격자로 스냅(기본 06–24).
  const allMins: number[] = [];
  parts.forEach((p) =>
    p.rows.forEach((r) => {
      if ((r.kind === 'block' || r.kind === 'study') && r.start != null) allMins.push(r.start, r.end as number);
    }),
  );
  let lo = 6 * 60;
  let hi = 24 * 60;
  if (allMins.length) {
    lo = Math.min(lo, Math.min(...allMins));
    hi = Math.max(hi, Math.max(...allMins));
  }
  lo = Math.max(0, Math.floor(lo / 180) * 180);
  hi = Math.min(1440, Math.ceil(hi / 180) * 180);
  const span = Math.max(1, hi - lo);
  const pos = (m: number) => ((Math.max(lo, Math.min(hi, m)) - lo) / span) * 100;
  const ticks: number[] = [];
  for (let m = lo; m <= hi + 1; m += 180) ticks.push(m);

  return (
    <div className={s.board}>
      <div className={s.head}>
        <span className={s.title}>주간 보드 — WEEK</span>
        <span className={s.legend}>
          <span>
            <i className={s.lgPrimary} />
            학습
          </span>
          <span>
            <i className={s.lgSoft} />
            복습·Anki
          </span>
          <span>
            <i className={s.lgMuted} />
            일과
          </span>
        </span>
      </div>
      <div className={s.rows} role="tablist" aria-label="요일 선택">
        {parts.map((p, k) => {
          const segs = segsOf(p);
          const dls = deadlines[k] || [];
          return (
            <button
              key={p.ds}
              type="button"
              role="tab"
              aria-selected={k === sel}
              aria-label={`${dows[k]} ${p.date.getMonth() + 1}/${p.date.getDate()} · 배정 ${(p.used / 60).toFixed(1)}시간${dls.length ? ' · 마감 ' + dls.join(', ') : ''}`}
              className={`${s.row}${k === sel ? ' ' + s.sel : ''}${p.isToday ? ' ' + s.today : ''}`}
              onClick={() => onSelect(k)}
            >
              <span className={s.label}>
                <span className={s.dow}>{dows[k]}</span>
                <span className={s.date}>{p.date.getDate()}</span>
              </span>
              <span className={s.lane}>
                {segs.map((g, i) => {
                  const left = pos(g.start);
                  const w = Math.max(0.8, pos(g.end) - left);
                  return (
                    <span
                      key={i}
                      className={`${s.seg} ${s[g.tone]}`}
                      style={{ left: `${left}%`, width: `${w}%` }}
                      title={g.title}
                    />
                  );
                })}
                {dls.length > 0 && <span className={s.flag} title={`마감: ${dls.join(', ')}`} />}
                {p.isToday && nowMin >= lo && nowMin <= hi && (
                  <span className={s.now} style={{ left: `${pos(nowMin)}%` }} />
                )}
              </span>
              <span className={`${s.hours}${p.over ? ' ' + s.over : ''}`}>{(p.used / 60).toFixed(1)}h</span>
            </button>
          );
        })}
      </div>
      <div className={s.axis}>
        <span className={s.axisPad} />
        <span className={s.axisTicks}>
          {ticks.map((m) => (
            <span key={m}>{hh(m)}</span>
          ))}
        </span>
        <span className={s.axisEnd} />
      </div>
    </div>
  );
}
