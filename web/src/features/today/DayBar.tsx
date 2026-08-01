/* ============================================================
   DayBar — 하루의 남은 창과 남은 계획을 **길이로**(P-7 · 2026-08-01).

   ## 무엇을 고치나

   W6 이 대각선 뺄셈을 판정 문장(`fitLine`)으로 바꿨지만 **비교 자체는 여전히 언어**였다 —
   250ms 전주의 채널이 아니라 읽기 채널이다. 오늘 화면에서 길이로 부호화된 것은 타이머
   진행바와 셋업 진행바 둘뿐이고, 상시 정량 5종은 **하나도 그래픽이 아니었다.**
   외부 근거: 정량 비교에 이상적인 채널은 **길이·2D 위치**이고 게이지·도넛은 비권장
   ([NN/g](https://www.nngroup.com/articles/dashboards-preattentive/) · 확인 2026-08-01).

   ## ⚠⚠ 삐져나오는 것이 이 컴포넌트의 전부다

   축척이 **창이 아니라 `max(창, 남은 계획)`** 이라(`dayCapacity.scaleMin`) 초과분이 잘리지
   않고 창 표시선 **밖으로 삐져나온다**. 창으로 나눴다면 넘쳤다는 사실 자체가 100% 에서
   잘려 안 보이고, 그건 지금 앱이 `beyondKeys` 를 조용히 필터로 지우던 실패를 그래픽으로
   반복하는 것이다. → 그래서 이 막대가 붙는 것과 **동시에** 레일의 그 필터가 사라진다.

   ## ⚠ 좁은 칸은 라벨을 떨어뜨린다 — 색으로 정량을 말하지 않기 위해

   20분짜리 칸에 이름을 밀어 넣으면 글자가 잘리고, 잘린 글자를 보완하려고 색을 쓰기 시작하면
   NN/g 가 금지한 바로 그 형태(정량을 색으로)가 된다. 임계 아래는 라벨을 **안 그리고**
   `title` 로 내린다 — "한눈에"의 일부가 온디맨드로 밀리는 것이 정직한 교환이다.

   ## ⚠ SR 은 길이를 못 본다

   `fitLine` 문장은 사라진 것이 아니라 이 막대의 `aria-label` 이 됐다. 길이로 옮긴 것을 SR 이
   못 읽으면 그건 이전(移轉)이 아니라 손실이다.
============================================================ */
import type { CapacitySegment } from '@/lib/dayCapacity';
import { hLabel } from '@/lib/utils';

/** 이 비율 아래의 칸은 라벨을 안 그린다(머리주석). */
const LABEL_MIN_RATIO = 0.14;

const S = {
  wrap: 'mt-1.5 flex flex-col gap-1',
  /* 트랙은 축척 전체다 — 창은 그 안의 **배경 구역**이고, 칸들은 그 위를 시각 순으로 덮는다. */
  track: 'relative flex h-day-bar w-full items-stretch rounded-full bg-panel2',
  window: 'absolute inset-y-0 left-0 rounded-full bg-tint-acc-9',
  segs: 'relative flex w-full items-stretch gap-px',
  /* 창 안 — 과목색으로 **채운다**(길이가 곧 양이다). */
  segIn: 'relative min-w-px overflow-hidden rounded-cell text-2xs leading-none font-bold text-on-acc',
  /* 창 밖 — 채우지 않고 **파선 윤곽**만. ⚠ `opacity` 로 흐리게 하지 않는다: 통과 최솟값이
     0.8~0.95 라 원본과 구분되지 않고, 컨테이너 opacity 는 자기 글자의 대비를 함께 떨군다
     (CLAUDE.md a11y 절의 실측 2건). 채움 유무가 그 자리에서 이미 이분(二分)이다. */
  segOut:
    'relative min-w-px overflow-hidden rounded-cell border border-dashed text-2xs leading-none font-bold text-mut',
  label: 'absolute inset-0 flex items-center justify-center truncate px-1',
  /* 창의 끝 = 오늘의 끝. 삐져나온 칸이 있을 때만 그린다(없으면 트랙 끝과 같은 자리다). */
  mark: 'absolute inset-y-[-2px] w-px bg-acc',
  foot: 'flex items-baseline gap-2 text-2xs leading-none font-bold text-mut tabular-nums',
} as const;

export function DayBar({
  segments,
  scaleMin,
  windowRatio,
  fitLine,
  beyondMin,
}: {
  segments: readonly CapacitySegment[];
  scaleMin: number;
  windowRatio: number;
  fitLine: string | null;
  beyondMin: number;
}) {
  // 그릴 것이 없으면 안 그린다(0·평온은 아무것도 안 그린다 — 이 앱의 빈 상태 규율).
  if (!segments.length || scaleMin <= 0) return null;
  const overflowed = beyondMin > 0;
  return (
    <div className={S.wrap}>
      <div className={S.track} role="img" aria-label={fitLine ?? '오늘의 남은 계획'}>
        <div className={S.window} style={{ width: `${windowRatio * 100}%` }} aria-hidden="true" />
        <div className={S.segs} aria-hidden="true">
          {segments.map((s) => {
            const ratio = s.min / scaleMin;
            const wide = ratio >= LABEL_MIN_RATIO;
            return (
              <span
                key={s.key}
                className={s.beyond ? S.segOut : S.segIn}
                style={{
                  width: `${ratio * 100}%`,
                  ...(s.beyond
                    ? { borderColor: s.color || 'var(--line-acc-pill)' }
                    : { background: s.color || 'var(--acc)' }),
                }}
                title={`${s.name} ${hLabel(s.min)}${s.beyond ? ' — 오늘 밖' : ''}`}
              >
                {wide && <span className={S.label}>{s.name}</span>}
              </span>
            );
          })}
        </div>
        {overflowed && <span className={S.mark} style={{ left: `${windowRatio * 100}%` }} aria-hidden="true" />}
      </div>
      {/* 삐져나온 양은 숫자로 한 번만 — 막대가 *어느 것이* 넘쳤는지를 말하고, 이 줄이 *얼마나*를
          말한다. 넘치지 않은 날엔 이 줄 자체가 없다(여유는 막대의 빈 공간이 이미 보여준다). */}
      {overflowed && (
        <p className={S.foot}>
          <span aria-hidden="true">↦</span> 오늘 밖 {hLabel(beyondMin)}
        </p>
      )}
    </div>
  );
}
