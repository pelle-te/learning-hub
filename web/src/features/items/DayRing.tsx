/* ============================================================
   DayRing — 24h 가용시간 링(가용시간·일과 시그니처). 하루(24h)를 원형 트랙으로,
   수면·고정 블록 = 뮤트 호, 비운 시간(공부 가능 창) = 네온 호로 발광.
   순수 표현(components → lib만): freeWindowsForWeekday가 빚은 창/블록을 받아 그린다.
============================================================ */
import { toHM, toMin, hLabel } from '@/lib/utils';
import type { RoutineBlock } from '@/lib/types';

// 라이브 도트 톤 — 정적 클래스 맵(§15 · 동적 조립 금지). 배경색만 구간으로 가른다.
const DOT_BASE = 'size-1.5 flex-none rounded-full';
const DOT_TONE: Record<'free' | 'block' | 'sleep', string> = {
  free: 'bg-acc',
  block: 'bg-[var(--ring-dot-block)]',
  sleep: 'bg-mut',
};
// 호 공통 — hover 시 굵어지고 또렷해지는 전이(reduced-motion 은 전이 제거). butt/round linecap 만 개별.
const ARC_BASE =
  'fill-none [stroke-width:13] cursor-pointer transition-[stroke-width,filter] duration-fast ease-[var(--ease)] motion-reduce:transition-none';

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
/** 임의 반지름 r에서의 시계방향 호(피크 밴드처럼 메인 링과 다른 궤도에 얇게 얹을 때). */
function arcR(start: number, end: number, r: number): string {
  const p = (min: number): [number, number] => {
    const a = (min / 1440) * TAU - Math.PI / 2;
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  };
  const [x0, y0] = p(start);
  const [x1, y1] = p(end);
  const large = end - start > 720 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** 지금(nowMin)이 속한 구간 판정 — 수면 > 고정 일과 > 공부 가능 창 우선순위. 순수 계산. */
function currentSegment(
  now: number,
  windows: { s: number; e: number }[],
  fixed: RoutineBlock[],
  wake0: number,
  wake1: number,
  asleep: boolean,
): { label: string; remain: number; tone: 'free' | 'block' | 'sleep' } | null {
  // 깨어있는 범위 [wake0, wake1] 밖이면 취침 중(자정 넘김까지 고려해 남은 분 계산).
  if (asleep && (now < wake0 || now >= wake1)) {
    const remain = now < wake0 ? wake0 - now : wake0 + 1440 - now;
    return { label: '수면', remain, tone: 'sleep' };
  }
  for (const b of fixed) {
    const bs = toMin(b.start);
    const be = toMin(b.end);
    if (now >= bs && now < be) return { label: b.name || '일과', remain: be - now, tone: 'block' };
  }
  for (const w of windows) {
    if (now >= w.s && now < w.e) return { label: '공부 가능', remain: w.e - now, tone: 'free' };
  }
  return null;
}
/** 남은 분 → "42분 남음" / "1시간 20분 남음". */
function remainLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분 남음` : `${h}시간 남음`;
  return `${m}분 남음`;
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
  peak,
}: {
  dow: string;
  blocks: RoutineBlock[];
  windows: { s: number; e: number }[];
  wake0: number;
  wake1: number;
  freeMin: number;
  nowMin: number | null;
  peak: [number, number] | null;
}) {
  const fixed = blocks.filter((b) => b.type !== '수면');
  const asleep = wake0 > 0 || wake1 < 1440; // 수면 블록으로 깨어있는 범위가 좁혀졌으면 자정 가로질러 호를 그림
  const h = Math.floor(freeMin / 60);
  const m = freeMin % 60;
  // '지금' 라이브 구간(오늘 선택 시만) — 이펙트 없는 순수 파생.
  const live = nowMin != null ? currentSegment(nowMin, windows, fixed, wake0, wake1, asleep) : null;
  const dotClass = live ? DOT_TONE[live.tone] : '';

  /* ⚠ 링 전체의 접근 가능한 이름 — **구간 요약까지 여기 싣는다**(2026-07-25 a11y 게이트).
     종전엔 각 `<path>` 에 `aria-label` 을 달았는데 두 가지가 틀려 있었다:
     ① axe `aria-prohibited-attr` — 롤 없는 `path` 에는 `aria-label` 을 못 단다.
     ② 설령 달아도 **읽히지 않는다.** 부모 `<svg role="img">` 는 하위 트리를 통째로
        하나의 이미지로 만들어 자식을 접근성 트리에서 지운다. 즉 그 라벨들은 검증만
        실패시키고 아무에게도 안 읽히는 죽은 코드였다(`data-tip` 은 시각 툴팁이라 별개다).
     그래서 라벨을 자식에서 걷어내고 **부모 이름 하나에 요약을 합친다** — 스크린리더가
     파편 대신 문장 하나를 받는다. 픽셀은 1도 안 바뀐다. */
  const 요약 = [
    `공부 가능 ${windows.length}구간 총 ${h > 0 ? `${h}시간 ` : ''}${m}분`,
    fixed.length > 0 ? `고정 일과 ${fixed.length}개` : null,
    peak ? `고집중 ${toHM(peak[0])}–${toHM(peak[1])}` : null,
    asleep ? `취침 ${toHM(wake1)}–${toHM(wake0)}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="relative aspect-square w-full max-w-115 flex-none">
      <svg
        viewBox="0 0 200 200"
        className="block h-full w-full"
        role="img"
        aria-label={`${dow}요일 24시간 가용시간 링 — ${요약}`}
      >
        {/* 트랙 */}
        <circle cx={CX} cy={CY} r={R} className="fill-none [stroke:var(--ring-track)] [stroke-width:13]" />
        {/* 수면(깨어있지 않은) 구간 — 자정 넘어 wake1 → wake0+1440 */}
        {asleep &&
          (() => {
            const tip = `수면\n${toHM(wake1)}–${toHM(wake0)} 취침`;
            return (
              <path
                d={arc(wake1, wake0 + 1440)}
                className={`${ARC_BASE} [stroke:var(--ring-sleep)] [stroke-linecap:butt] hover:[stroke:var(--ring-sleep-hover)] hover:[stroke-width:16]`}
                data-tip={tip}
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
              className={`${ARC_BASE} [stroke:var(--ring-block)] [stroke-linecap:butt] hover:[stroke:var(--ring-block-hover)] hover:[stroke-width:16]`}
              data-tip={tip}
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
              className={`${ARC_BASE} stroke-acc [filter:var(--filter-ring-free)] [stroke-linecap:round] hover:[stroke-width:16] hover:[filter:var(--filter-ring-free-hover)] motion-reduce:[filter:none]`}
              data-tip={tip}
            />
          );
        })}
        {/* 피크 시간대 — 고집중 작업이 우선 배치되는 구간(메인 링 안쪽 얇은 밴드, 발광 없이 절제). */}
        {peak &&
          (() => {
            const tip = `고집중 배치\n${toHM(peak[0])}–${toHM(peak[1])} · 우선 배치`;
            return (
              <path
                d={arcR(peak[0], peak[1], R - 11)}
                className="cursor-pointer fill-none stroke-acc [stroke-width:2.5] opacity-50 [stroke-linecap:round]"
                data-tip={tip}
              />
            );
          })()}
        {/* 지금 마커 */}
        {nowMin != null && (
          <line
            {...nowLine(nowMin)}
            className="stroke-txt [stroke-width:2] [filter:var(--filter-ring-now)] [stroke-linecap:round]"
          />
        )}
        {/* 시각 눈금 */}
        {TICKS.map((t) => {
          const [tx, ty] = pt(t * 60);
          const [lx, ly] = labelPt(t * 60);
          return (
            <g key={t}>
              <line
                x1={tx}
                y1={ty}
                x2={(tx - CX) * 0.92 + CX}
                y2={(ty - CY) * 0.92 + CY}
                className="[stroke:var(--ring-tick)] [stroke-width:1]"
              />
              <text x={lx} y={ly} className="fill-mut text-ring-tick font-bold tabular-nums [text-anchor:middle]">
                {t}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-px">
        <span className="text-ring-num leading-none font-extrabold tracking-price text-acc tabular-nums">
          {h}
          <small className="text-ring-num-unit font-bold text-mut">h</small>
          {m > 0 && (
            <>
              {' '}
              {m}
              <small className="text-ring-num-unit font-bold text-mut">m</small>
            </>
          )}
        </span>
        <span className="mt-1.25 text-xs leading-[1.6] font-extrabold tracking-caps text-mut uppercase">공부 가능</span>
        <span className="text-xs leading-[1.6] text-mut tabular-nums opacity-80">
          {asleep ? `${toHM(wake0)}–${toHM(wake1)} 활동` : '하루 종일 활동'}
        </span>
        {live && (
          <span className="mt-1.75 inline-flex items-center gap-1.25 text-xs leading-[1.6] font-bold text-txt tabular-nums">
            <i className={`${DOT_BASE} ${dotClass}`} />
            지금 · {live.label}
            {live.remain > 0 && ` · ${remainLabel(live.remain)}`}
          </span>
        )}
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
