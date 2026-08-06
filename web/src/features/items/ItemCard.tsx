/* ItemCard — 과목 현황 카드(요약 전용). 계획 재개편 v3에서 아코디언을 걷어냈다:
   제자리 펼침은 뒤 카드를 밀어 갤러리 조망을 깨뜨렸다 → 클릭하면 SubjectSheet(중앙 시트)가 열린다.
   그래서 이 카드는 '읽는' 물건이고, 편집은 전부 시트가 소유한다.
   스타일: 공유 디자인 시스템은 styles/ds.css(`ds-*` 전역), 요소·토큰은 전역 base. */
import { memo, type CSSProperties } from 'react';
import { dayDiff, ddayInfo, hLabel } from '@/lib/utils';
import { Pill, type PillTone } from '@/components/ui';
import { useHeroPointer } from '@/hooks/interactions';
import { ProgressRing } from '@/components/ProgressRing';
import { EXAM_LABEL, isSoftSubject, nextExamOf } from '@/lib/semester';
import type { Item } from '@/lib/types';
import { Icon } from '@/components/Icon';

// 과목명 톤 — 정적 맵(§15). 이름 유무로 색·굵기만 가른다(head 는 div[role=button] 이라
// 폼 컨트롤이 아니다 → 커스텀 크기 text-item-name 은 LH 를 안 흘리고 본문 1.6 을 상속).
const NAME_BASE = 'min-w-0 flex-1 truncate text-item-name tracking-title max-mobile:text-item-name-sm';
const NAME_FILLED = 'font-extrabold text-txt';
const NAME_EMPTY = 'font-bold text-mut';
// ProgressRing 스켈레톤('ds-ringTrack'/.ringArc) 조정 — 과목 틴트·얇은 5px·짧은 전이.
// px·런타임 --tint 값이라 임의값 클래스로 표현 불가(예외 ②) → 인라인 커스텀 속성.
const RING_VARS: CSSProperties = {
  ['--ring-w' as string]: 5,
  ['--ring-tint' as string]: 'var(--tint, var(--acc))',
  ['--ring-glow-r' as string]: '6px',
  ['--ring-glow' as string]: 'color-mix(in srgb, var(--tint, var(--glow)) 55%, transparent)',
  ['--ring-dur' as string]: '0.5s',
};

export interface ItemCardProps {
  item: Item;
  /** 카드 클릭 → 과목 상세 시트 열기. */
  onOpen: (id: string) => void;
  /** 이 과목(sid=item.id)의 반복 약점 총합 — ≥2면 ⚠반복 배지 표시(SR-2). */
  weakCount?: number;
  /** 이번 주 이 과목에 배분된 분(요일 합) — 배분 보드/시트와 같은 출처. 미배분이면 undefined. */
  allocMin?: number;
  /** 앱 정본 '오늘'(todayISO, `_today` 시드 존중). D-day 계산이 벽시계로 새지 않게 호출부가 주입한다. */
  todayIso: string;
}

function ItemCardImpl({ item, onOpen, weakCount, allocMin, todayIso }: ItemCardProps) {
  const id = item.id;
  const daily = item.mode === 'daily';
  // 스케줄러 입력 부재 — 시간이 0이면 매일 블록이 잡히지 않아 오늘 탭에 뜨지 않는다(조용한 데드엔드 경고, SR-1).
  const noSchedule = daily ? !item.dailyMin : !item.weeklyHours;
  const chs = item.chapters || [];
  const totalH = chs.reduce((t, ch) => t + (+ch.hours || 0), 0);
  const doneCh = chs.filter((ch) => ch.done).length;
  const prog = chs.length ? Math.round((doneCh / chs.length) * 100) : 0;

  // ── 헤더 요약 칩 ──
  // T-1. **다가오는** 시험을 본다(마지막 시험이 아니라). 중간이 코앞인데 기말까지의 D-60 을 그리면
  // 그 숫자는 거짓말이다 — 옛 모델은 마감이 하나뿐이라 이 구분이 존재할 수 없었다.
  const nextExam = nextExamOf(item, todayIso);
  const ddTone: PillTone = (() => {
    if (!nextExam) return 'neutral';
    const { cls } = ddayInfo(dayDiff(todayIso, nextExam.date));
    return cls === 'bad' ? 'bad' : cls === 'warn' ? 'warn' : 'neutral';
  })();

  // 이번 주 배분 vs 주당 예산 — 카드에서 "이 과목 이번 주 채워졌나"를 바로 읽는다(시트 들어가기 전).
  const budgetMin = Math.round((item.weeklyHours || 0) * 60);
  const allocTone: PillTone | null =
    daily || allocMin == null || budgetMin === 0
      ? null
      : allocMin === budgetMin
        ? 'good'
        : allocMin > budgetMin
          ? 'bad'
          : 'warn';

  // 과목색 스포트라이트(틸트 없음 — 갤러리 카드). 구조분해로 ref-접근 린트 회피.
  const { ref: cardRef, onMouseMove, onMouseLeave } = useHeroPointer(0);

  return (
    <div
      ref={cardRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className="ds-spotHost ds-glow relative self-start rounded-lg border border-line bg-panel bg-[image:var(--bg-item-card)] tint-scope"
      style={item.color ? ({ ['--tint']: item.color } as CSSProperties) : undefined}
    >
      <div className="ds-spotlight" aria-hidden="true" />
      <div
        className="relative flex cursor-pointer flex-col gap-4 pt-4 pr-4.5 pb-4 pl-5 select-none focus-visible:rounded-lg! focus-visible:-outline-offset-2!"
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        onClick={() => onOpen(id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(id);
          }
        }}
      >
        <span
          className="absolute top-3 bottom-3 left-0 w-0.75 rounded-r-cell shadow-rail"
          style={{ background: item.color || 'var(--acc)' }}
        />
        <div className="flex items-center gap-2.5">
          <span className={`${NAME_BASE} ${item.name ? NAME_FILLED : NAME_EMPTY}`}>{item.name || '(이름 없음)'}</span>
          {/* P10 D6 — 구분은 **목록에서 보여야 한다.** 안 그리면 소양인지 아닌지가 편집 화면에만
              살고, "왜 이 과목만 시험 칸이 없지"가 카드에서 답이 안 된다. 톤은 중립이다 —
              소양은 경고도 성취도 아니고 **분류**다. */}
          {isSoftSubject(item) && <Pill tiny>소양</Pill>}
          {nextExam && (
            <Pill tiny tone={ddTone}>
              {EXAM_LABEL[nextExam.kind]} {ddayInfo(dayDiff(todayIso, nextExam.date)).lab}
            </Pill>
          )}
          {noSchedule && (
            <Pill tiny tone="warn">
              시간 없음 · 스케줄 안 됨
            </Pill>
          )}
          {weakCount != null && weakCount >= 2 && (
            <Pill tiny tone="bad">
              <Icon name="alert" /> 반복 {weakCount}
            </Pill>
          )}
          <span className="w-3.5 flex-none text-center text-sm leading-text text-mut" aria-hidden="true">
            ›
          </span>
        </div>
        <div className="flex items-center gap-4.5">
          {daily ? (
            <div className="text-2xl leading-text font-extrabold text-txt tabular-nums">
              매일 {item.dailyMin || 30}
              <small className="text-sm leading-text font-semibold text-mut"> 분</small>
            </div>
          ) : (
            <>
              <span
                className="relative size-12 flex-none"
                style={RING_VARS}
                role="img"
                aria-label={`완료 챕터 ${doneCh}/${chs.length}`}
                data-tip={`완료 챕터 ${doneCh}/${chs.length} · 약 ${totalH}h`}
              >
                <ProgressRing
                  size={48}
                  r={20}
                  pct={prog}
                  className="ds-ringSvg"
                  trackClassName={'ds-ringTrack'}
                  arcClassName={'ds-ringArc'}
                />
                <span className="absolute inset-0 flex items-center justify-center text-base14 font-extrabold tracking-ringnum text-txt tabular-nums">
                  {prog}
                  <small className="text-ring-pct-unit font-bold text-mut">%</small>
                </span>
              </span>
              <div className="flex gap-5 max-mobile:gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xl leading-none font-extrabold tracking-title text-txt tabular-nums">
                    {item.weeklyHours || 0}
                    <small className="text-xs leading-none font-bold text-mut">h</small>
                  </span>
                  <span className="ds-caps-sm">주당</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xl leading-none font-extrabold tracking-title text-txt tabular-nums">
                    {doneCh}
                    <small className="text-xs leading-none font-bold text-mut">/{chs.length}</small>
                  </span>
                  <span className="ds-caps-sm">챕터</span>
                </div>
                {totalH > 0 && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xl leading-none font-extrabold tracking-title text-txt tabular-nums">
                      {totalH}
                      <small className="text-xs leading-none font-bold text-mut">h</small>
                    </span>
                    <span className="ds-caps-sm">분량</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {allocTone && (
          <div className="flex">
            <Pill tiny tone={allocTone}>
              이번 주 {hLabel(allocMin!)} / {item.weeklyHours}h
            </Pill>
          </div>
        )}
      </div>
    </div>
  );
}

export const ItemCard = memo(ItemCardImpl);
