/* ItemCard — 과목 현황 카드(요약 전용). 계획 재개편 v3에서 아코디언을 걷어냈다:
   제자리 펼침은 뒤 카드를 밀어 갤러리 조망을 깨뜨렸다 → 클릭하면 SubjectSheet(중앙 시트)가 열린다.
   그래서 이 카드는 '읽는' 물건이고, 편집은 전부 시트가 소유한다.
   스타일: 공유 디자인 시스템은 ds.module(ds.*), 요소·토큰은 전역 base. */
import { memo, type CSSProperties } from 'react';
import { dayDiff, ddayInfo } from '@/lib/utils';
import { Pill, type PillTone } from '@/components/ui';
import { useHeroPointer } from '@/hooks/interactions';
import { ProgressRing } from '@/components/ProgressRing';
import ds from '@/styles/ds.module.css';
import c from './ItemCard.module.css';
import type { Item } from '@/lib/types';

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
  const ddTone: PillTone = (() => {
    if (!item.deadline) return 'neutral';
    const { cls } = ddayInfo(dayDiff(todayIso, item.deadline));
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
      className={`${c.row} ${ds.spotHost} ${ds.glow}`}
      style={item.color ? ({ ['--tint']: item.color } as CSSProperties) : undefined}
    >
      <div className={ds.spotlight} aria-hidden="true" />
      <div
        className={c.head}
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
        <span className={c.colorRail} style={{ background: item.color || 'var(--acc)' }} />
        <div className={c.idRow}>
          <span className={`${c.name}${item.name ? '' : ' ' + c.nameEmpty}`}>{item.name || '(이름 없음)'}</span>
          {item.deadline && (
            <Pill tiny tone={ddTone}>
              {ddayInfo(dayDiff(todayIso, item.deadline)).lab}
            </Pill>
          )}
          {noSchedule && (
            <Pill tiny tone="warn">
              시간 없음 · 스케줄 안 됨
            </Pill>
          )}
          {weakCount != null && weakCount >= 2 && (
            <Pill tiny tone="bad">
              ⚠ 반복 {weakCount}
            </Pill>
          )}
          <span className={c.chev} aria-hidden="true">
            ›
          </span>
        </div>
        <div className={c.statRow}>
          {daily ? (
            <div className={c.bigStat}>
              매일 {item.dailyMin || 30}
              <small> 분</small>
            </div>
          ) : (
            <>
              <span
                className={c.ring}
                role="img"
                aria-label={`완료 챕터 ${doneCh}/${chs.length}`}
                data-tip={`완료 챕터 ${doneCh}/${chs.length} · 약 ${totalH}h`}
              >
                <ProgressRing
                  size={48}
                  r={20}
                  pct={prog}
                  className={ds.ringSvg}
                  trackClassName={ds.ringTrack}
                  arcClassName={ds.ringArc}
                />
                <span className={c.ringNum}>
                  {prog}
                  <small>%</small>
                </span>
              </span>
              <div className={c.stats}>
                <div className={c.stat}>
                  <span className={c.statV}>
                    {item.weeklyHours || 0}
                    <small>h</small>
                  </span>
                  <span className={c.statL}>주당</span>
                </div>
                <div className={c.stat}>
                  <span className={c.statV}>
                    {doneCh}
                    <small>/{chs.length}</small>
                  </span>
                  <span className={c.statL}>챕터</span>
                </div>
                {totalH > 0 && (
                  <div className={c.stat}>
                    <span className={c.statV}>
                      {totalH}
                      <small>h</small>
                    </span>
                    <span className={c.statL}>분량</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {allocTone && (
          <div className={c.allocRow}>
            <Pill tiny tone={allocTone}>
              이번 주 {Number.isInteger(allocMin! / 60) ? allocMin! / 60 : (allocMin! / 60).toFixed(1)}h /{' '}
              {item.weeklyHours}h
            </Pill>
          </div>
        )}
      </div>
    </div>
  );
}

export const ItemCard = memo(ItemCardImpl);
