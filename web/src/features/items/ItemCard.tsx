/* ItemCard — 접이식 과목 카드(헤더 요약 + 펼친 편집 영역). 변경은 store.mutate로.
   스타일: 공유 디자인 시스템은 ds.module(ds.*), 요소·토큰은 전역 base. */
import { memo, useCallback } from 'react';
import { iso, dayDiff, ddayInfo } from '@/lib/utils';
import { Button, Pill, type PillTone } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import type { AppState, Item } from '@/lib/types';
import { ChapterEditor } from './ChapterEditor';

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

  return (
    <div className={`${ds.card} ${ds.itemrow}${open ? ' ' + ds.open : ''}`}>
      <div
        className={ds.itemhead}
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
        <span className={ds.chev}>{open ? '▾' : '▸'}</span>
        <span className={ds.swatch} style={{ background: item.color, width: 13, height: 13 }} />
        <span className={ds.itemname}>{item.name || <span className={ds.muted}>(이름 없음)</span>}</span>
        <span className={ds.itemmeta}>
          <Pill tiny>{daily ? `매일 ${item.dailyMin || 30}분` : `주 ${item.weeklyHours || 0}h`}</Pill>
          {!daily && (
            <span className={`${ds.muted} ${ds.tiny}`}>
              {chs.length}챕터·~{totalH}h
            </span>
          )}
          {!daily && chs.length > 0 && (
            <span
              className={ds.minibar}
              data-tip={`완료 챕터 ${doneCh}/${chs.length}`}
              role="img"
              aria-label={`완료 챕터 ${doneCh}/${chs.length}`}
            >
              <i style={{ width: `${prog}%`, background: item.color }} />
            </span>
          )}
          {item.deadline && (
            <Pill tiny tone={ddTone}>
              {ddayInfo(dayDiff(iso(new Date()), item.deadline)).lab}
            </Pill>
          )}
        </span>
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
