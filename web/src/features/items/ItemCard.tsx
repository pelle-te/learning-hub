/* ItemCard — 접이식 과목 카드(헤더 요약 + 펼친 편집 영역). 변경은 store.mutate로.
   스타일: 공유 디자인 시스템은 ds.module(ds.*), 요소·토큰은 전역 base. */
import { memo, useCallback, type CSSProperties } from 'react';
import { iso, dayDiff, ddayInfo } from '@/lib/utils';
import { Button, Pill, type PillTone } from '@/components/ui';
import { useHeroPointer } from '@/lib/interactions';
import ds from '@/styles/ds.module.css';
import c from './ItemCard.module.css';
import type { AppState, Item } from '@/lib/types';
import { ChapterEditor } from './ChapterEditor';

const RING_C = 2 * Math.PI * 20; // 진행 링 둘레(r=20).

type Mutate = (recipe: (st: AppState) => void) => void;

export interface ItemCardProps {
  item: Item;
  open: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  mutate: Mutate;
}

/** +/- 스텝퍼 — 분/시간 직관 입력(0 미만 방지·소수 첫째자리 반올림). */
function Stepper({
  value,
  step,
  unit,
  onChange,
}: {
  value: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const bump = (d: number) => onChange(Math.max(0, Math.round((value + d) * 10) / 10));
  return (
    <div className={ds.row} style={{ gap: 4, alignItems: 'center', maxWidth: 170 }}>
      <Button sm onClick={() => bump(-step)} aria-label={`${unit} 줄이기`}>
        –
      </Button>
      <input
        type="number"
        step={step}
        min={0}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{ textAlign: 'center' }}
      />
      <Button sm onClick={() => bump(step)} aria-label={`${unit} 늘리기`}>
        +
      </Button>
      <span className={`${ds.muted} ${ds.tiny}`}>{unit}</span>
    </div>
  );
}

function ItemCardImpl({ item, open, onToggle, onDelete, mutate }: ItemCardProps) {
  const id = item.id;
  const daily = item.mode === 'daily';
  const chs = item.chapters || [];
  const totalH = chs.reduce((t, c) => t + (+c.hours || 0), 0);
  const doneCh = chs.filter((c) => c.done).length;
  const prog = chs.length ? Math.round((doneCh / chs.length) * 100) : 0;

  /** 이 과목만 변형. */
  const upd = useCallback(
    (fn: (it: Item) => void) =>
      mutate((st) => {
        const it = st.items.find((x) => x.id === id);
        if (it) fn(it);
      }),
    [mutate, id],
  );

  // ── 헤더 요약 칩 ──
  const ddTone: PillTone = (() => {
    if (!item.deadline) return 'neutral';
    const { cls } = ddayInfo(dayDiff(iso(new Date()), item.deadline));
    return cls === 'bad' ? 'bad' : cls === 'warn' ? 'warn' : 'neutral';
  })();

  // 과목색 스포트라이트(틸트 없음 — 갤러리 카드). 구조분해로 ref-접근 린트 회피.
  const { ref: cardRef, onMouseMove, onMouseLeave } = useHeroPointer(0);

  return (
    <div
      ref={cardRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={`${c.row}${open ? ' ' + c.open : ''} ${ds.spotHost} ${ds.glow}`}
      style={item.color ? ({ ['--tint']: item.color } as CSSProperties) : undefined}
    >
      <div className={ds.spotlight} aria-hidden="true" />
      <div
        className={c.head}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => onToggle(id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(id);
          }
        }}
      >
        <span className={c.colorRail} style={{ background: item.color || 'var(--acc)' }} />
        <div className={c.idRow}>
          <span className={`${c.name}${item.name ? '' : ' ' + c.nameEmpty}`}>{item.name || '(이름 없음)'}</span>
          {item.deadline && (
            <Pill tiny tone={ddTone}>
              {ddayInfo(dayDiff(iso(new Date()), item.deadline)).lab}
            </Pill>
          )}
          <span className={c.chev}>{open ? '▾' : '▸'}</span>
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
                <svg viewBox="0 0 48 48" className={c.ringSvg} aria-hidden="true">
                  <circle className={c.ringTrack} cx="24" cy="24" r="20" />
                  <circle
                    className={c.ringArc}
                    cx="24"
                    cy="24"
                    r="20"
                    style={{ strokeDasharray: RING_C, strokeDashoffset: RING_C * (1 - prog / 100) }}
                  />
                </svg>
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
      </div>

      {open && (
        <div className={ds.itembody}>
          <div className={ds.fieldgrid}>
            <div className={`${ds.fld} ${ds.wide}`}>
              <label htmlFor={`it-name-${id}`}>과목 이름</label>
              <input
                id={`it-name-${id}`}
                type="text"
                value={item.name}
                onChange={(e) => upd((it) => void (it.name = e.target.value))}
                style={{ fontWeight: 600 }}
                placeholder="과목 이름"
              />
            </div>
            <div className={ds.fld}>
              <label htmlFor={`it-mode-${id}`}>유형</label>
              <select
                id={`it-mode-${id}`}
                value={item.mode}
                onChange={(e) => upd((it) => void (it.mode = e.target.value as Item['mode']))}
              >
                <option value="weekly">주당 시간</option>
                <option value="daily">매일(Anki)</option>
              </select>
            </div>
            <div className={ds.fld}>
              <label>{daily ? '매일 학습 (분)' : '주당 목표 시간'}</label>
              {daily ? (
                <Stepper
                  value={item.dailyMin || 30}
                  step={5}
                  unit="분"
                  onChange={(v) => upd((it) => void (it.dailyMin = v))}
                />
              ) : (
                <Stepper
                  value={item.weeklyHours || 3}
                  step={0.5}
                  unit="h"
                  onChange={(v) => upd((it) => void (it.weeklyHours = v))}
                />
              )}
            </div>
            <div className={ds.fld}>
              <label htmlFor={`it-dl-${id}`}>마감일 (선택)</label>
              <input
                id={`it-dl-${id}`}
                type="date"
                value={item.deadline || ''}
                onChange={(e) => upd((it) => void (it.deadline = e.target.value))}
              />
            </div>
          </div>

          {!daily && <ChapterEditor item={item} mutate={mutate} />}

          <div className={ds.itemfoot}>
            <span className={`${ds.tiny} ${ds.muted}`}>
              출처 {item.source || '직접'}
              {!daily && chs.length ? ` · ${chs.length}챕터 · 약 ${totalH}h` : ''}
            </span>
            <Button sm variant="ghost" danger onClick={() => onDelete(id)}>
              과목 삭제
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export const ItemCard = memo(ItemCardImpl);
