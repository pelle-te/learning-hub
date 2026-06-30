/* ============================================================
   DayRing — 24h 가용시간 링(가용시간·일과 시그니처). 하루(24h)를 원형 트랙으로,
   수면·고정 블록 = 뮤트 호, 비운 시간(공부 가능 창) = 네온 호로 발광.
   순수 표현(components → lib만): freeWindowsForWeekday가 빚은 창/블록을 받아 그린다.
============================================================ */
import { toHM, toMin, hLabel } from '@/lib/utils';
import type { RoutineBlock } from '@/lib/types';
import s from './DayRing.module.css';

const CX = 100;
const CY = 100;
const R = 78;
const TAU = Math.PI * 2;

/** 분(0~1440+) → 링 위 좌표. 0:00 = 12시 방향, 시계방향. */
function pt(min: number): [number, number] {
  const a = (min / 1440) * TAU - Math.PI / 2;
  return [CX + R * Math.cos(a), CY + R * Math.sin(a)];
}
/** s→e(분) 구간을 시계방향 호 path로. */
function arc(start: number, end: number): string {
  const [x0, y0] = pt(start);
  const [x1, y1] = pt(end);
  const large = end - start > 720 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const TICKS = [0, 6, 12, 18];

export default function DayRing({
  dow,
  blocks,
  windows,
  wake0,
  wake1,
  freeMin,
  nowMin,
}: {
  dow: string;
  blocks: RoutineBlock[];
  windows: { s: number; e: number }[];
  wake0: number;
  wake1: number;
  freeMin: number;
  nowMin: number | null;
}) {
  const fixed = blocks.filter((b) => b.type !== '수면');
  const asleep = wake0 > 0 || wake1 < 1440; // 수면 블록으로 깨어있는 범위가 좁혀졌으면 자정 가로질러 호를 그림
  const h = Math.floor(freeMin / 60);
  const m = freeMin % 60;

  return (
    <div className={s.wrap}>
      <svg viewBox="0 0 200 200" className={s.svg} role="img" aria-label={`${dow}요일 24시간 가용시간 링`}>
        {/* 트랙 */}
        <circle cx={CX} cy={CY} r={R} className={s.track} />
        {/* 수면(깨어있지 않은) 구간 — 자정 넘어 wake1 → wake0+1440 */}
        {asleep &&
          (() => {
            const tip = `수면\n${toHM(wake1)}–${toHM(wake0)} 취침`;
            return (
              <path
                d={arc(wake1, wake0 + 1440)}
                className={s.sleep}
                data-tip={tip}
                aria-label={tip.replace('\n', ' — ')}
              />
            );
          })()}
        {/* 고정 일과 블록(수업·식사·취미 등) */}
        {fixed.map((b, i) => {
          const bs = toMin(b.start);
          const be = toMin(b.end);
          const cat = b.type && b.type !== b.name ? `${b.type} · ` : '';
          const tip = `${b.name}\n${cat}${toHM(bs)}–${toHM(be)} · ${hLabel(be - bs)}`;
          return (
            <path
              key={b.id + i}
              d={arc(bs, be)}
              className={s.block}
              data-tip={tip}
              aria-label={tip.replace('\n', ' — ')}
            />
          );
        })}
        {/* 비운 시간 = 공부 가능 창(네온) */}
        {windows.map((w, i) => {
          const tip = `공부 가능\n${toHM(w.s)}–${toHM(w.e)} · ${hLabel(w.e - w.s)}`;
          return (
            <path
              key={`w${i}`}
              d={arc(w.s, w.e)}
              className={s.free}
              data-tip={tip}
              aria-label={tip.replace('\n', ' — ')}
            />
          );
        })}
        {/* 지금 마커 */}
        {nowMin != null && <line {...nowLine(nowMin)} className={s.now} />}
        {/* 시각 눈금 */}
        {TICKS.map((t) => {
          const [tx, ty] = pt(t * 60);
          const [lx, ly] = labelPt(t * 60);
          return (
            <g key={t}>
              <line x1={tx} y1={ty} x2={(tx - CX) * 0.92 + CX} y2={(ty - CY) * 0.92 + CY} className={s.tick} />
              <text x={lx} y={ly} className={s.ticklab}>
                {t}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={s.center}>
        <span className={s.cnum}>
          {h}
          <small>h</small>
          {m > 0 && (
            <>
              {' '}
              {m}
              <small>m</small>
            </>
          )}
        </span>
        <span className={s.clab}>공부 가능</span>
        <span className={s.csub}>{asleep ? `${toHM(wake0)}–${toHM(wake1)} 활동` : '하루 종일 활동'}</span>
      </div>
    </div>
  );
}

/** 눈금 라벨 위치(트랙 안쪽). */
function labelPt(min: number): [number, number] {
  const a = (min / 1440) * TAU - Math.PI / 2;
  const r = R - 17;
  return [CX + r * Math.cos(a) + 0.5, CY + r * Math.sin(a) + 3.5];
}
/** 지금 마커 = 트랙을 가로지르는 짧은 방사선. */
function nowLine(min: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = (min / 1440) * TAU - Math.PI / 2;
  const r0 = R - 9;
  const r1 = R + 9;
  return {
    x1: CX + r0 * Math.cos(a),
    y1: CY + r0 * Math.sin(a),
    x2: CX + r1 * Math.cos(a),
    y2: CY + r1 * Math.sin(a),
  };
}
